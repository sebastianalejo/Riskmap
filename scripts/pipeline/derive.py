"""Derivación determinista de campos ausentes (hora, día y frecuencia).

La fuente INEI DataCrime **no publica** la hora ni el día del hecho. Para poder
tratar las dos fuentes (esquema clásico y esquema v2) con el **mismo esquema**,
estos valores se derivan de forma determinista del contenido real del registro:

- ``hora``/``día``: misma semilla (ID de denuncia o clave estable del registro)
  → mismos valores en cualquier ejecución, así la publicación es idempotente.
- ``historical_frequency``: media mensual **real** de la serie SIDPOL/MININTER
  (últimos 24 meses) del distrito y modalidad, con respaldo por distrito y global.

Son valores **estimados, no observados**: la fuente no los trae (ver
``MODEL_CARD.md`` y ``data/README.md``). Compartir esta implementación evita que
la derivación diverja entre ``ingest_inei.py``, ``ingest_inei_legacy.py`` y
``incidents_dataset.py``.
"""

from __future__ import annotations

import json
import unicodedata
from pathlib import Path

import pandas as pd

PIPELINE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PIPELINE_DIR.parents[1]

DEFAULT_SIDPOL_CSV = REPO_ROOT / "data" / "processed" / "sidpol_monthly_lima.csv"

# Distribuciones heurísticas usadas cuando la fuente no publica hora/día.
# (Replican las del extractor legacy para mantener valores estables.)
DEFAULT_HOURS = [20, 21, 22, 23, 20, 21, 22, 7, 8, 20, 21, 23, 22, 20, 0, 21, 22, 23, 19, 20]
DEFAULT_DAYS = ["viernes", "sábado", "viernes", "domingo", "jueves", "sábado", "viernes", "lunes"]


def stable_hash(text: str) -> int:
    """FNV-1a de 64 bits (misma familia que los IDs deterministas del pipeline)."""
    h = 0xCBF29CE484222325
    for byte in str(text).encode("utf-8"):
        h ^= byte
        h = (h * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return h


def hour_day_for(key: object, _modality_key: str | None = None) -> tuple[int, str]:
    """Hora (0–23) y día de la semana deterministas a partir de una semilla.

    ``key`` puede ser un entero (ID de denuncia, esquema legacy) o un texto
    (clave estable del registro v2). El segundo argumento se mantiene por
    compatibilidad con el extractor legacy y no altera el resultado.
    """
    seed = key if isinstance(key, int) else stable_hash(json.dumps(str(key), ensure_ascii=False))
    hour = DEFAULT_HOURS[seed % len(DEFAULT_HOURS)]
    day = DEFAULT_DAYS[(seed + 7) % len(DEFAULT_DAYS)]
    return hour, day


def _plain(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", str(text).strip().lower())
    return " ".join("".join(ch for ch in decomposed if not unicodedata.combining(ch)).split())


def sidpol_modality_key(crime_type: str) -> str:
    """Mapea la modalidad de la taxonomía a una modalidad de la serie SIDPOL."""
    value = _plain(crime_type)
    if "robo" in value:
        return "robo"
    if "hurto" in value:
        return "hurto"
    if "estafa" in value or "defraud" in value:
        return "estafa"
    if "extorsion" in value:
        return "extorsion"
    if "secuestro" in value:
        return "secuestro"
    return "otros"


def load_frequency_lookup(
    sidpol_path: Path | None = None,
) -> tuple[dict[tuple[str, str], float], dict[str, float], float, dict[str, str]]:
    """Media mensual real (últimos 24 meses) por (distrito, modalidad), por
    distrito, y el mapa ubigeo→distrito canónico.

    Si el CSV no existe o no tiene filas, devuelve estructuras vacías y una
    media global neutra (1): la derivación nunca falla por falta de SIDPOL.
    """
    path = sidpol_path or DEFAULT_SIDPOL_CSV
    if not path.exists():
        return {}, {}, 1.0, {}

    frame = pd.read_csv(path, dtype={"ubigeo": str})
    frame["period"] = frame["year"] * 100 + frame["month"]
    last_two = sorted(frame["period"].unique())[-24:]
    frame = frame[frame["period"].isin(last_two)]

    pairs: dict[tuple[str, str], float] = {}
    districts: dict[str, float] = {}
    ubigeo_names: dict[str, str] = {}
    for _, row in frame.iterrows():
        district = str(row["district"])
        ubigeo = str(row["ubigeo"]).zfill(6)
        ubigeo_names.setdefault(ubigeo, district)
        for modality in ("robo", "hurto", "estafa", "extorsion", "secuestro", "violencia_mujer", "otros"):
            count = float(row.get(modality, 0) or 0)
            key = (district, modality)
            pairs[key] = pairs.get(key, 0.0) + count
        districts[district] = districts.get(district, 0.0) + float(row.get("total", 0) or 0)

    months = max(1, len(last_two))
    pair_mean = {key: value / months for key, value in pairs.items()}
    district_mean = {key: value / months for key, value in districts.items()}
    global_mean = sum(district_mean.values()) / max(1, len(district_mean)) if district_mean else 1.0
    return pair_mean, district_mean, global_mean, ubigeo_names


def frequency_for(
    district: str,
    crime_type: str,
    pair_mean: dict[tuple[str, str], float],
    district_mean: dict[str, float],
    global_mean: float,
) -> int:
    """Frecuencia histórica estimada (denuncias/mes) con fallbacks."""
    value = pair_mean.get((district, sidpol_modality_key(crime_type)))
    if value is None:
        value = district_mean.get(district)
    if value is None or value <= 0:
        value = global_mean
    return max(1, int(round(value)))


def arcgis_derive_key(payload: dict) -> str:
    """Clave estable de un registro v2 para derivar hora/día sin cambiar de valor."""
    return "|".join(
        [
            str(payload.get("occurred_year", "")),
            str(payload.get("district", "")),
            str(payload.get("crime_type", "")),
            str(payload.get("ubigeo", "")),
            f"{float(payload.get('latitude', 0.0)):.6f}",
            f"{float(payload.get('longitude', 0.0)):.6f}",
        ]
    )
