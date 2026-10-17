"""Pruebas del extractor de delitos del MPFN (sin red)."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "pipeline"))

from ingest_mpfn import COLUMNS, build_frame, in_scope  # noqa: E402

HEADER = (
    "periodo_denuncia,anio_denuncia,distrito_fiscal,especialidad,tipo_caso,"
    "generico,subgenerico,cantidad,ubigeo_pjfs,dpto_pjfs\n"
)


def _write_raw(raw_dir: Path) -> None:
    raw_dir.mkdir(parents=True, exist_ok=True)
    (raw_dir / "2024.csv").write_text(
        HEADER
        + "ENERO - DICIEMBRE,2024,LIMA CENTRO,PENAL,DENUNCIA,CONTRA EL PATRIMONIO,X,10,150101,LIMA\n"
        + "ENERO - DICIEMBRE,2024,LIMA CENTRO,PENAL,DENUNCIA,CONTRA EL PATRIMONIO,X,5,150101,LIMA\n"
        + "ENERO - DICIEMBRE,2024,CAÑETE,PENAL,DENUNCIA,CONTRA EL PATRIMONIO,X,3,150500,LIMA\n"
        + "ENERO - DICIEMBRE,2024,CALLAO,PENAL,DENUNCIA,CONTRA LA VIDA,X,2,070101,CALLAO\n",
        encoding="utf-8-sig",
    )
    (raw_dir / "2025.csv").write_text(
        HEADER
        + "ENERO - DICIEMBRE,2025,LIMA SUR,PENAL,DENUNCIA,CONTRA EL PATRIMONIO,X,7,150141,LIMA\n",
        encoding="utf-8-sig",
    )


def test_in_scope():
    assert in_scope("LIMA CENTRO")
    assert in_scope("CALLAO")
    assert not in_scope("CAÑETE")
    assert not in_scope("HUAURA")


def test_build_frame_filtra_y_agrega(tmp_path):
    _write_raw(tmp_path)
    frame, report = build_frame(tmp_path, {2024: "a", 2025: "b"})

    assert list(frame.columns) == COLUMNS
    # CAÑETE queda fuera; el resto se agrega por (año, distrito fiscal, delito).
    assert set(frame["distrito_fiscal"]) == {"LIMA CENTRO", "CALLAO", "LIMA SUR"}
    lima = frame[
        (frame["distrito_fiscal"] == "LIMA CENTRO") & (frame["generico"] == "CONTRA EL PATRIMONIO")
    ].iloc[0]
    assert int(lima["cantidad"]) == 15  # 10 + 5
    assert report["totals"]["years"] == [2024, 2025]
    assert report["totals"]["cantidad"] == 24  # 15 + 2 + 7
