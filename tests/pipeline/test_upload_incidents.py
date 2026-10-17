"""Paridad JS↔Python del ID determinista (los vectores también están en
`frontend/src/utils/stableId.test.ts`)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "pipeline"))
sys.path.insert(0, str(REPO_ROOT / "functions"))

from upload_incidents import (  # noqa: E402
    detect_schema,
    fnv1a64_hex,
    load_rows,
    normalize_row,
    stable_arcgis_row_id,
    stable_row_id,
)

from crime_ml.pipeline import FEATURES, TARGET  # noqa: E402
from crime_ml.validation import validate_incident_row  # noqa: E402

ROW_1 = {
    "crime_type": "robo agravado",
    "hour": 20,
    "day_of_week": "lunes",
    "district": "SAN MARTIN DE PORRES",
    "latitude": -11.99769,
    "longitude": -77.088301,
    "historical_frequency": 1545,
    "risk_level": "alto",
}

ROW_3 = {
    "crime_type": "hurto",
    "hour": 8,
    "day_of_week": "sábado",
    "district": "MIRAFLORES",
    "latitude": -12.1219,
    "longitude": -77.0297,
    "historical_frequency": 140,
    "risk_level": "bajo",
}


def test_fnv_vectores_estandar():
    assert fnv1a64_hex("") == "cbf29ce484222325"
    assert fnv1a64_hex("a") == "af63dc4c8601ec8c"


def test_ids_deterministas_paridad_con_js():
    assert stable_row_id(ROW_1) == "inc_ac49d71720e07651"
    assert stable_row_id(ROW_3) == "inc_e3b94f27353cfa45"


def test_orden_de_claves_irrelevante():
    reversed_row = dict(reversed(list(ROW_1.items())))
    assert stable_row_id(reversed_row) == stable_row_id(ROW_1)


def test_normalizacion_y_validacion():
    raw = {
        "crime_type": " robo agravado ",
        "hour": "22.0",
        "day_of_week": "Viernes",
        "district": "la victoria",
        "latitude": "-12.071",
        "longitude": "-77.0201",
        "historical_frequency": "270",
        "risk_level": "ALTO",
    }
    normalized = normalize_row(raw)
    assert normalized["day_of_week"] == "viernes"
    assert normalized["district"] == "LA VICTORIA"
    assert normalized["risk_level"] == "alto"
    assert normalized["hour"] == 22
    cleaned = validate_incident_row(normalized, FEATURES, TARGET)
    assert cleaned["risk_level"] == "alto"


def test_load_rows_deduplica_por_contenido(tmp_path):
    csv_path = tmp_path / "mini.csv"
    csv_path.write_text(
        "crime_type,hour,day_of_week,district,latitude,longitude,historical_frequency,risk_level\n"
        "hurto,8,sábado,MIRAFLORES,-12.1219,-77.0297,140,bajo\n"
        "hurto,8,sábado,MIRAFLORES,-12.1219,-77.0297,140,bajo\n"
        "robo agravado,20,lunes,SAN MARTIN DE PORRES,-11.99769,-77.088301,1545,alto\n",
        encoding="utf-8",
    )
    rows, errors, schema = load_rows(csv_path)
    assert schema == "legacy"
    assert len(rows) == 2  # la fila repetida no genera un segundo documento
    assert not errors
    assert rows[0][0] == "inc_e3b94f27353cfa45"


def test_load_rows_reporta_invalidas(tmp_path):
    csv_path = tmp_path / "mala.csv"
    csv_path.write_text(
        "crime_type,hour,day_of_week,district,latitude,longitude,historical_frequency,risk_level\n"
        "hurto,25,sábado,MIRAFLORES,-12.1219,-77.0297,140,bajo\n",
        encoding="utf-8",
    )
    rows, errors, _schema = load_rows(csv_path)
    assert rows == []
    assert len(errors) == 1
    assert "hour" in errors[0]


# ── Esquema v2 (INEI 2021-2024) ──────────────────────────────────────────────

ARCGIS_ROW = {
    "crime_type": "robo agravado",
    "district": "MIRAFLORES",
    "latitude": -12.1219,
    "longitude": -77.0297,
    "macro_category": "delitos contra el patrimonio",
    "occurred_year": 2024,
    "severity_level": "alta",
    "source": "inei",
}


def test_deteccion_de_esquema():
    assert detect_schema(["occurred_year", "severity_level", "crime_type"]) == "arcgis"
    assert detect_schema(["crime_type", "hour", "risk_level"]) == "legacy"


def test_id_v2_determinista():
    assert stable_arcgis_row_id(ARCGIS_ROW) == "arc_fd1528db7cd859d0"
    assert stable_arcgis_row_id(dict(reversed(list(ARCGIS_ROW.items())))) == "arc_fd1528db7cd859d0"
    otro = dict(ARCGIS_ROW, occurred_year=2023)
    assert stable_arcgis_row_id(otro) != stable_arcgis_row_id(ARCGIS_ROW)


def test_load_rows_v2_valida_y_añade_fuente(tmp_path):
    csv_path = tmp_path / "v2.csv"
    csv_path.write_text(
        "occurred_year,district,ubigeo,crime_type,macro_category,severity_level,latitude,longitude\n"
        "2024,MIRAFLORES,150122,robo agravado,delitos contra el patrimonio,alta,-12.1219,-77.0297\n"
        "2024,SURQUILLO,150141,hurto,delitos contra el patrimonio,imposible,-12.11,-77.02\n"
        "1800,LINCE,150116,hurto,delitos contra el patrimonio,baja,-12.08,-77.03\n",
        encoding="utf-8",
    )
    rows, errors, schema = load_rows(csv_path)
    assert schema == "arcgis"
    assert len(rows) == 1
    doc_id, payload = rows[0]
    assert doc_id.startswith("arc_")
    assert payload["source"] == "inei"
    assert payload["severity_level"] == "alta"
    assert len(errors) == 2
    assert any("severity_level" in error for error in errors)
    assert any("occurred_year" in error for error in errors)
