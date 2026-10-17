"""Pruebas del extractor de oferta policial — sin red ni XLSX reales."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "pipeline"))
sys.path.insert(0, str(REPO_ROOT / "functions"))

import pandas as pd  # noqa: E402

from ingest_police import CONTEXT_COLUMNS, _plain, build_context, parse_gps  # noqa: E402


def test_parse_gps_valida_y_filtra_por_bbox():
    assert parse_gps("-12.051234,-77.104567") == (-12.051234, -77.104567)
    assert parse_gps("-9.52938327,-77.52979372") is None  # fuera de Lima/Callao
    assert parse_gps("abc") is None
    assert parse_gps("") is None
    assert parse_gps(None) is None


def test_plain_quita_acentos_y_colapsa_espacios():
    assert _plain("  san  martín de porres ") == "SAN MARTIN DE PORRES"


def test_build_context_cruza_por_distrito():
    stations = pd.DataFrame(
        [
            {"ubigeo": "150101", "district": "LIMA", "station_name": "CPNP A"},
            {"ubigeo": "150101", "district": "LIMA", "station_name": "CPNP B"},
            {"ubigeo": "070101", "district": "CALLAO", "station_name": "CPNP C"},
        ]
    )
    infra = pd.DataFrame(
        [{"district": "LIMA", "stations_2022_count": 2, "servicios_ok_2022": 1, "infra_ok_2022": 1}]
    )
    context = build_context(stations, infra)

    assert list(context.columns) == CONTEXT_COLUMNS
    lima = context[context["ubigeo"] == "150101"].iloc[0]
    assert int(lima["stations_count"]) == 2
    assert int(lima["stations_2022_count"]) == 2
    assert int(lima["servicios_ok_2022"]) == 1

    callao = context[context["ubigeo"] == "070101"].iloc[0]
    assert int(callao["stations_count"]) == 1
    assert int(callao["stations_2022_count"]) == 0  # sin match en 2022
    assert callao["source"] == "MININTER-comisarias"


def test_build_context_sin_comisarias():
    empty = pd.DataFrame(columns=["ubigeo", "district", "station_name"])
    context = build_context(empty, pd.DataFrame())
    assert list(context.columns) == CONTEXT_COLUMNS
    assert len(context) == 0
