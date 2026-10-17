"""Pruebas del extractor de series del INEI (sin red)."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "pipeline"))

from openpyxl import Workbook  # noqa: E402

from ingest_inei_series import _matches, find_header, parse_department_series  # noqa: E402


def _workbook(tmp_path: Path) -> Path:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["DENUNCIAS POR COMISIÓN DE DELITOS, SEGÚN DEPARTAMENTO, 2018 - 2024"])
    sheet.append(["Departamento", 2018, 2019])
    sheet.append(["Lima Metropolitana 1/", 100, 110])
    sheet.append(["Lima Metropolitana 1/ y Lima 2/", 200, 220])
    sheet.append(["Región Lima 2/", 50, 55])
    path = tmp_path / "serie.xlsx"
    workbook.save(path)
    return path


def test_find_header():
    rows = [["titulo"], ["Departamento", 2018, 2019], ["Total", 1, 2]]
    assert find_header(rows) == 1


def test_matches_excluye_filas_compuestas_y_regionales():
    assert _matches("Lima Metropolitana 1/", "LIMA METROPOLITANA")
    assert not _matches("Lima Metropolitana 1/ y Lima 2/", "LIMA METROPOLITANA")
    assert not _matches("Región Lima 2/", "LIMA METROPOLITANA")
    assert not _matches("Cusco", "LIMA METROPOLITANA")


def test_parse_department_series(tmp_path):
    values = parse_department_series(_workbook(tmp_path), "LIMA METROPOLITANA")
    assert values == {2018: 100.0, 2019: 110.0}
