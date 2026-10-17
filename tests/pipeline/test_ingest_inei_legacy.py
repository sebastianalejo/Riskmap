"""Pruebas del extractor legacy de puntos INEI (Fase A) — sin red."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "pipeline"))

from ingest_inei_legacy import (  # noqa: E402
    DEFAULT_DAYS,
    DEFAULT_HOURS,
    frequency_for,
    hour_day_for,
    sidpol_modality_key,
)


def test_hora_y_dia_son_deterministas():
    first = hour_day_for(123456, "robo agravado")
    second = hour_day_for(123456, "robo agravado")
    assert first == second
    hour, day = first
    assert hour in DEFAULT_HOURS
    assert day in DEFAULT_DAYS


def test_mapeo_modalidad_a_serie_sidpol():
    assert sidpol_modality_key("robo agravado") == "robo"
    assert sidpol_modality_key("hurto de vehiculo") == "hurto"
    assert sidpol_modality_key("estafa y otras defraudaciones") == "estafa"
    assert sidpol_modality_key("microcomercializacion de drogas") == "otros"
    assert sidpol_modality_key("homicidio por paf") == "otros"


def test_frecuencia_con_fallbacks():
    pair = {("MIRAFLORES", "robo"): 120.4}
    district = {"MIRAFLORES": 500.0}
    assert frequency_for("MIRAFLORES", "robo agravado", pair, district, 99.0) == 120
    assert frequency_for("MIRAFLORES", "estafa", pair, district, 99.0) == 500
    assert frequency_for("DESCONOCIDO", "estafa", pair, district, 99.0) == 99
    assert frequency_for("X", "estafa", {}, {"X": 0.0}, 0.0) == 1
