"""Taxonomía declarada de modalidades delictivas (fuente única para el pipeline).

El archivo `data/taxonomy/crime_taxonomy.json` mapea cada modalidad normalizada a
su gravedad declarada y a una macro-categoría de respaldo. Es una taxonomía
explícita (no una medición): ver el aviso dentro del propio JSON.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TAXONOMY_PATH = _REPO_ROOT / "data" / "taxonomy" / "crime_taxonomy.json"

_WHITESPACE = re.compile(r"\s+")


def normalize_modality(text: str | None) -> str:
    """Normaliza una modalidad ('HURTO  FRUSTADO ' → 'hurto frustrado')."""
    if not text:
        return "otros"
    return _WHITESPACE.sub(" ", str(text).strip().lower())


def normalize_district(text: str | None) -> str:
    """Normaliza el nombre de distrito (mayúsculas, sin prefijos de provincia)."""
    if not text:
        return ""
    value = str(text).strip().upper()
    for prefix in ("LIMA METROPOLITANA 1/", "LIMA METROPOLITANA"):
        if value.startswith(prefix):
            value = value[len(prefix):].strip()
    return _WHITESPACE.sub(" ", value)


def load_taxonomy(path: Path | None = None) -> dict[str, Any]:
    with open(path or DEFAULT_TAXONOMY_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def classify(modality: str | None, taxonomy: dict[str, Any]) -> dict[str, str]:
    """Devuelve {severity, macro} declarados para una modalidad (con respaldo)."""
    entry = taxonomy.get("modalities", {}).get(normalize_modality(modality), {})
    return {
        "severity": entry.get("severity", "media"),
        "macro": entry.get("macro", taxonomy.get("macro_fallback", "otros")),
    }
