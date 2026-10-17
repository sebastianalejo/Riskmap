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
    validate_incident_row,
)

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

ARCGIS_SOURCE = "inei"
LEGACY_SOURCE = "modalidad"
RISK_LEVELS = ("bajo", "medio", "alto")
SEVERITY_TO_RISK = {"baja": "bajo", "media": "medio", "alta": "alto"}


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


def detect_schema(columns) -> str:
    """Detecta el esquema del CSV: 'arcgis' (v2) o 'legacy'."""
    return "arcgis" if {"occurred_year", "severity_level"} <= set(columns) else "legacy"


def normalize_row(raw: dict) -> dict:
    """Misma normalización que hace la interfaz (`toIncident` en DataPage.tsx)."""
    return {
        "crime_type": str(raw["crime_type"]).strip(),
        "hour": int(float(raw["hour"])),
        "day_of_week": str(raw["day_of_week"]).strip().lower(),
        "district": str(raw["district"]).strip().upper(),
        "latitude": float(raw["latitude"]),
        "longitude": float(raw["longitude"]),
        "historical_frequency": int(float(raw["historical_frequency"])),
        "risk_level": str(raw["risk_level"]).strip().lower(),
    }


def normalize_arcgis_row(raw: dict) -> dict:
    """Esquema v2: valida y añade la fuente."""
    cleaned = validate_arcgis_incident_row(raw)
    cleaned["source"] = ARCGIS_SOURCE
    return cleaned


def load_rows(csv_path: Path) -> tuple[list[tuple[str, dict]], list[str], str]:
    """Devuelve ([[doc_id, fila]], errores, esquema) deduplicando por ID."""
    frame = pd.read_csv(csv_path, dtype=str, encoding="utf-8-sig")
    schema = detect_schema(frame.columns)
    rows: list[tuple[str, dict]] = []
    errors: list[str] = []
    seen: set[str] = set()

    for index, raw in enumerate(frame.to_dict(orient="records"), start=2):
        try:
            if schema == "arcgis":
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
