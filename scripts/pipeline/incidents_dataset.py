"""Dataset canónico de incidentes: normalización, IDs deterministas y lectura de CSV.

Lo comparten dos scripts:

- ``upload_incidents.py``: sube los registros a Firestore (Admin SDK).
- ``export_web_data.py``: genera los JSON estáticos que sirve Firebase Hosting.

Mantener una sola implementación evita que los IDs o la normalización diverjan
entre lo que se sube a Firestore y lo que se publica en la web.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

PIPELINE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PIPELINE_DIR.parents[1]
sys.path.insert(0, str(REPO_ROOT / "functions"))

from crime_ml.pipeline import FEATURES, TARGET  # noqa: E402
from crime_ml.validation import (  # noqa: E402
    ValidationError,
    validate_arcgis_incident_row,
    validate_callao_incident_row,
    validate_incident_row,
)

from derive import (  # noqa: E402
    arcgis_derive_key,
    frequency_for,
    hour_day_for,
    load_frequency_lookup,
)
from taxonomy import classify, load_taxonomy  # noqa: E402

COLLECTION = "crime_incidents"

CANONICAL_KEYS = [
    "crime_type",
    "day_of_week",
    "district",
    "historical_frequency",
    "hour",
    "latitude",
    "longitude",
    "risk_level",
]
ARCGIS_CANONICAL_KEYS = [
    "crime_type",
    "district",
    "latitude",
    "longitude",
    "macro_category",
    "occurred_year",
    "severity_level",
    "source",
]

# Esquema unificado: ambas fuentes exponen las mismas columnas. Los campos que
# la fuente no publica (hora/día/frecuencia en INEI; año/macro en el clásico) se
# derivan de forma determinista (ver `derive.py`) para poder tratarlas igual.
UNIFIED_KEYS = [
    "crime_type",
    "hour",
    "day_of_week",
    "district",
    "latitude",
    "longitude",
    "historical_frequency",
    "risk_level",
    "occurred_year",
    "macro_category",
    "ubigeo",
    "severity_level",
    "source",
]

ARCGIS_SOURCE = "inei"
LEGACY_SOURCE = "modalidad"
# Fuente Callao (GORE Callao / SIDPOL georreferenciado): trae fecha y hora reales.
CALLAO_SOURCE = "callao"
# Los puntos del esquema clásico se descargaron del grupo de capas "2022" del
# INEI (data/raw/inei/points_2022_legacy.csv); el año no venía en el CSV.
LEGACY_YEAR = 2022
RISK_LEVELS = ("bajo", "medio", "alto")
SEVERITY_TO_RISK = {"baja": "bajo", "media": "medio", "alta": "alto"}

_FREQUENCY_LOOKUP: tuple | None = None
_TAXONOMY: dict | None = None


def _frequency_lookup() -> tuple:
    """Carga (una sola vez) la serie SIDPOL para derivar la frecuencia."""
    global _FREQUENCY_LOOKUP
    if _FREQUENCY_LOOKUP is None:
        _FREQUENCY_LOOKUP = load_frequency_lookup()
    return _FREQUENCY_LOOKUP


def _taxonomy() -> dict:
    global _TAXONOMY
    if _TAXONOMY is None:
        _TAXONOMY = load_taxonomy()
    return _TAXONOMY



def fnv1a64_hex(text: str) -> str:
    """FNV-1a de 64 bits (paridad exacta con frontend/src/utils/stableId.ts)."""
    h = 0xCBF29CE484222325
    for byte in text.encode("utf-8"):
        h ^= byte
        h = (h * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return format(h, "016x")


def stable_row_id(row: dict) -> str:
    ordered = {key: row[key] for key in CANONICAL_KEYS}
    payload = json.dumps(ordered, ensure_ascii=False, separators=(",", ":"))
    return f"inc_{fnv1a64_hex(payload)}"


def stable_arcgis_row_id(row: dict) -> str:
    """ID determinista para filas del esquema v2 (INEI 2021-2024)."""
    ordered = {key: row.get(key) for key in ARCGIS_CANONICAL_KEYS}
    payload = json.dumps(ordered, ensure_ascii=False, separators=(",", ":"))
    return f"arc_{fnv1a64_hex(payload)}"


def stable_callao_row_id(denuncia_id: object, row: dict) -> str:
    """ID determinista para filas del esquema Callao.

    Usa el identificador de denuncia de la fuente cuando existe (estable frente a
    reejecuciones) y, si no, el contenido normalizado del registro.
    """
    if denuncia_id not in (None, ""):
        key = str(denuncia_id).strip()
    else:
        key = json.dumps(
            {name: row.get(name) for name in UNIFIED_KEYS},
            ensure_ascii=False,
            separators=(",", ":"),
        )
    return f"cal_{fnv1a64_hex(key)}"


def detect_schema(columns) -> str:
    """Detecta el esquema del CSV: 'callao' (fecha/hora reales), 'arcgis' (v2) o 'legacy'."""
    available = set(columns)
    if {"occurred_year", "severity_level", "hour", "day_of_week", "denuncia_id"} <= available:
        return "callao"
    return "arcgis" if {"occurred_year", "severity_level"} <= available else "legacy"


def normalize_row(raw: dict) -> dict:
    """Misma normalización que hace la interfaz (`toIncident` en DataPage.tsx),

    ampliada al esquema unificado: añade año y macro-categoría para que el
    esquema clásico exponga las mismas columnas que el v2.
    """
    row = {
        "crime_type": str(raw["crime_type"]).strip(),
        "hour": int(float(raw["hour"])),
        "day_of_week": str(raw["day_of_week"]).strip().lower(),
        "district": str(raw["district"]).strip().upper(),
        "latitude": float(raw["latitude"]),
        "longitude": float(raw["longitude"]),
        "historical_frequency": int(float(raw["historical_frequency"])),
        "risk_level": str(raw["risk_level"]).strip().lower(),
    }
    occurred_year = raw.get("occurred_year")
    row["occurred_year"] = int(float(occurred_year)) if occurred_year not in (None, "") else LEGACY_YEAR
    row["macro_category"] = classify(row["crime_type"], _taxonomy()).get("macro", "otros")
    row["source"] = str(raw.get("source") or LEGACY_SOURCE).strip().lower()
    return row


def complete_arcgis_fields(payload: dict) -> dict:
    """Completa un registro v2 con los campos que la fuente no publica.

    `risk_level` sale de la severidad declarada; `hour`, `day_of_week` y
    `historical_frequency` se derivan de forma determinista (ver `derive.py`),
    para que el esquema INEI y el clásico compartan columnas.
    """
    severity = str(payload.get("severity_level") or "").strip().lower()
    if payload.get("risk_level") not in RISK_LEVELS:
        payload["risk_level"] = SEVERITY_TO_RISK.get(severity, "medio")

    if payload.get("hour") is None:
        hour, day = hour_day_for(arcgis_derive_key(payload))
        payload["hour"] = hour
        payload["day_of_week"] = day

    if payload.get("historical_frequency") is None:
        pair_mean, district_mean, global_mean, _ = _frequency_lookup()
        payload["historical_frequency"] = frequency_for(
            str(payload.get("district", "")),
            str(payload.get("crime_type", "")),
            pair_mean,
            district_mean,
            global_mean,
        )
    return payload


def normalize_arcgis_row(raw: dict) -> dict:
    """Esquema v2: valida, añade la fuente y completa los campos derivados."""
    cleaned = validate_arcgis_incident_row(raw)
    cleaned["source"] = ARCGIS_SOURCE
    return complete_arcgis_fields(cleaned)


def normalize_callao_row(raw: dict) -> dict:
    """Esquema Callao: valida (hora/día reales), añade la fuente y completa.

    `risk_level` se toma de la severidad declarada y `historical_frequency` de la
    serie SIDPOL si la fuente no los trae; `hour`/`day_of_week` se conservan tal
    cual (son observados, no derivados).
    """
    cleaned = validate_callao_incident_row(raw)
    cleaned["source"] = CALLAO_SOURCE
    return complete_arcgis_fields(cleaned)


def load_rows(csv_path: Path) -> tuple[list[tuple[str, dict]], list[str], str]:
    """Devuelve ([[doc_id, fila]], errores, esquema) deduplicando por ID."""
    frame = pd.read_csv(csv_path, dtype=str, encoding="utf-8-sig")
    schema = detect_schema(frame.columns)
    rows: list[tuple[str, dict]] = []
    errors: list[str] = []
    seen: set[str] = set()

    for index, raw in enumerate(frame.to_dict(orient="records"), start=2):
        try:
            if schema == "callao":
                normalized = normalize_callao_row(raw)
                doc_id = stable_callao_row_id(raw.get("denuncia_id"), normalized)
            elif schema == "arcgis":
                normalized = normalize_arcgis_row(raw)
                doc_id = stable_arcgis_row_id(normalized)
            else:
                normalized = normalize_row(raw)
                validate_incident_row(normalized, FEATURES, TARGET)
                doc_id = stable_row_id(normalized)
        except (ValidationError, ValueError, KeyError) as exc:
            errors.append(f"Fila {index}: {exc}")
            continue
        if doc_id in seen:
            continue  # contenido idéntico repetido en el archivo
        seen.add(doc_id)
        rows.append((doc_id, normalized))
    return rows, errors, schema


def risk_level(payload: dict) -> str | None:
    """Nivel de riesgo canónico: `risk_level` (legacy) o `severity_level` (v2)."""
    raw = payload.get("risk_level") or payload.get("riskLevel")
    if isinstance(raw, str):
        value = raw.strip().lower()
        if value in RISK_LEVELS:
            return value
    severity = payload.get("severity_level")
    if isinstance(severity, str):
        return SEVERITY_TO_RISK.get(severity.strip().lower())
    return None


def int_or_none(value) -> int | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number) if number.is_integer() else None
