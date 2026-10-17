"""Pruebas del extractor de población distrital del INEI (sin red)."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "pipeline"))

from openpyxl import Workbook  # noqa: E402

from ingest_population import _is_district, parse_population  # noqa: E402


def _workbook(tmp_path: Path) -> Path:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["CUADRO Nº 01"])
    sheet.append(["PERÚ: POBLACIÓN TOTAL PROYECTADA ..."])
    sheet.append(["UBIGEO", "Departamento, provincia y distrito", None, None])
    sheet.append([None, None, 2018, 2019])
    sheet.append([None, None, None, None])
    sheet.append(["000000", "PERÚ", 1000, 1010])
    sheet.append(["150000", "LIMA", 500, 505])
    sheet.append(["150100", "LIMA, LIMA", 300, 305])
    sheet.append(["150101", "LIMA, LIMA, LIMA", 120, 122])
    sheet.append(["070101", "CALLAO, CALLAO, CALLAO", 80, 81])
    sheet.append(["010101", "AMAZONAS, CHACHAPOYAS, CHACHAPOYAS", 40, 41])
    path = tmp_path / "poblacion.xlsx"
    workbook.save(path)
    return path


def test_is_district():
    assert _is_district("150101")
    assert not _is_district("150100")  # provincia
    assert not _is_district("150000")  # departamento


def test_parse_population(tmp_path):
    records, stats = parse_population(_workbook(tmp_path))
    ubigeos = {record["ubigeo"] for record in records}
    assert ubigeos == {"150101", "070101"}
    # 2 distritos × 2 años.
    assert len(records) == 4
    lima_2019 = next(r for r in records if r["ubigeo"] == "150101" and r["year"] == 2019)
    assert lima_2019["population"] == 122
    assert lima_2019["district"].endswith("LIMA")
    assert stats["fuera_de_ambito"] == 3  # PERÚ + AMAZONAS (010101) + LIMA (150000)
    assert stats["no_distrito"] == 1  # provincia LIMA (150100)
