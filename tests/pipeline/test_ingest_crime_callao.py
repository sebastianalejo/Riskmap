"""Pruebas del extractor del Callao (Oleada 2) — sin red.

Verifican el parseo de fecha/hora, la normalización de modalidades (incluido el
carácter de reemplazo U+FFFD de la fuente y los nombres largos que exceden el
límite de `crime_type`) y que el dataset resultante cumple el esquema unificado.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "pipeline"))
sys.path.insert(0, str(REPO_ROOT / "functions"))

from ingest_crime_callao import (  # noqa: E402
    build_frame,
    canon_modality,
    parse_date,
    parse_hour,
)
from taxonomy import load_taxonomy  # noqa: E402

HEADER = "UBIGEO;DISTRITO;MODALIDAD;FECHA_HECHO;HORA_HECHO;LATITUD;LONGITUD;ID_DOC_DENUNCIA"


def _row(ubigeo, modality, fecha, hora, lat, lon, doc_id, distrito="CALLAO"):
    return f"{ubigeo};{distrito};{modality};{fecha};{hora};{lat};{lon};{doc_id}"


def _write(tmp_path: Path) -> Path:
    csv = tmp_path / "callao.csv"
    csv.write_text(
        "\n".join(
            [
                HEADER,
                _row("070101", "HURTO", "20240226", "2030", "-12.005", "-77.115", "abc"),
                # Fuente con U+FFFD donde va la "ñ": se repara a "n".
                _row("070101", "VIOLACION SEXUAL DE MENOR DE 14 A\ufffdOS", "20240220", "1400", "-12.01", "-77.12", "def"),
                # Modalidad larga (>60): se acorta al nombre canónico.
                _row("070102", "PENALIZACION DE LA CLONACION O ADULTERACION DE TERMINALES DE TELECOMUNICACIONES", "20240110", "0900", "-12.06", "-77.11", "ghi"),
                # Fuera de ámbito (Lima, no Callao).
                _row("150101", "HURTO", "20240110", "0900", "-12.05", "-77.04", "jkl"),
                # Año anterior al mínimo.
                _row("070101", "HURTO", "20100101", "0900", "-12.05", "-77.10", "mno"),
                # Hora inválida.
                _row("070101", "HURTO", "20240110", "9999", "-12.05", "-77.10", "pqr"),
                # Sin coordenadas.
                _row("070101", "HURTO", "20240110", "0900", "", "", "stu"),
            ]
        ),
        encoding="utf-8",
    )
    return csv


def test_parse_date():
    assert parse_date("20240226") == date(2024, 2, 26)
    assert parse_date("2024-02-26") == date(2024, 2, 26)
    assert parse_date("") is None
    assert parse_date("20241340") is None


def test_parse_hour():
    assert parse_hour("2030") == 20
    assert parse_hour("0200") == 2
    assert parse_hour("9999") is None
    assert parse_hour("") is None


def test_canon_modality_repara_y_acorta():
    assert canon_modality("DAÑO SIMPLE") == "dano simple"
    assert canon_modality("VIOLACION SEXUAL DE MENOR DE 14 A\ufffdOS") == (
        "violacion sexual de menor de 14 anos"
    )
    assert canon_modality(
        "PENALIZACION DE LA CLONACION O ADULTERACION DE TERMINALES DE TELECOMUNICACIONES"
    ) == "clonacion o adulteracion de terminales"


def test_build_frame_cumple_esquema(tmp_path):
    csv = _write(tmp_path)
    taxonomy = load_taxonomy()
    frame, report = build_frame(csv, taxonomy, ({}, {}, 1.0), min_year=2018)

    # Se conservan las 3 filas válidas de Callao.
    assert report["rows_kept"] == 3
    assert report["dropped"] == {
        "fuera_de_callao": 1,
        "anio_anterior": 1,
        "hora_invalida": 1,
        "validacion": 1,
    }

    # Todas las modalidades producidas existen en la taxonomía (sin fallback).
    assert report["unmapped_modalities"] == []
    crime_types = set(frame["crime_type"])
    assert crime_types <= set(taxonomy["modalities"])

    # La hora y el día son observados (no derivados).
    hurto = frame[frame["crime_type"] == "hurto"].iloc[0]
    assert int(hurto["hour"]) == 20
    assert hurto["day_of_week"] == "lunes"  # 2024-02-26 es lunes

    # Campos obligatorios del esquema unificado presentes en todas las filas.
    from incidents_dataset import UNIFIED_KEYS

    assert list(frame.columns) == UNIFIED_KEYS + ["denuncia_id"]
    assert frame["crime_type"].str.len().max() <= 60
