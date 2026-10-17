"""Ingesta de las series oficiales de seguridad ciudadana del INEI (nivel departamento).

Descarga los cuadros XLSX del índice temático de Seguridad Ciudadana del INEI
(actualizados a 2024) y extrae la fila de **Lima Metropolitana** para cada año.
Son series **agregadas** (no por distrito) y sirven de contexto y de contraste
externo para las series distritales del sistema.

Uso (desde la raíz del repositorio):

    python scripts/pipeline/ingest_inei_series.py --refresh

Salidas:
    data/raw/inei_series/*.xlsx                 (crudo, no versionado)
    data/processed/inei_series_lima.csv         (serie larga: serie, año, valor)
    data/processed/inei_series_quality_report.json

Limitación: el departamento de Lima incluye Lima Metropolitana **y** sus provincias
(Cañete, Huaral, Huaura…), por lo que NO equivale al ámbito del sistema.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from openpyxl import load_workbook

PIPELINE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PIPELINE_DIR.parents[1]

BASE = "https://www.inei.gob.pe/media/MenuRecursivo/indices_tematicos/"
USER_AGENT = "RiskmapPipeline/1.0 (ingesta series INEI; proyecto academico)"
DEPARTMENT = "LIMA METROPOLITANA"

# serie → (archivo remoto, unidad)
SERIES = {
    "delitos": ("2.%20Denuncias%20por%20comision%20de%20delitos%20%20-%20Dpto_1_1.xlsx", "casos"),
    "tasa_delitos": ("3.%20Tasa%20de%20denuncias%20por%20comision%20de%20delitos%20-%20Dpto_1_1.xlsx", "por_10_000_hab"),
    "robo_vehiculos": ("1.%20Denuncias%20por%20robo%20de%20vehiculos_1_1.xlsx", "casos"),
    "detenidos": ("5.%20Personas%20detenidas%20por%20comision%20de%20delito%20-%20%20Dpto_1_1.xlsx", "casos"),
}
DEFAULT_RAW_DIR = REPO_ROOT / "data" / "raw" / "inei_series"


def _local_name(filename: str) -> str:
    return filename.replace("%20", "_")


def _canon(text: object) -> str:
    return str(text or "").strip().upper()


def _matches(label: object, target: str) -> bool:
    """Empareja el nombre compuesto del INEI (p. ej. 'Lima Metropolitana 1/').

    Se descartan las filas compuestas ('… y Región Lima') y las regionales.
    """
    canon = _canon(label)
    if not canon.startswith(target):
        return False
    if canon.startswith("REGION") or " Y " in canon:
        return False
    return True


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        dest.write_bytes(response.read())


def find_header(rows: list[list]) -> int | None:
    """Fila de encabezado: la que tiene 'Departamento' y años numéricos."""
    for index, row in enumerate(rows):
        if any(_canon(cell) == "DEPARTAMENTO" for cell in row) and any(
            isinstance(cell, (int, float)) and 1990 <= cell <= 2100 for cell in row
        ):
            return index
    return None


def parse_department_series(path: Path, department: str = DEPARTMENT) -> dict[int, float]:
    """Devuelve {año: valor} para el departamento dado, desde un cuadro del INEI."""
    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.worksheets[0]
    rows = [list(row) for row in sheet.iter_rows(values_only=True)]
    header_index = find_header(rows)
    if header_index is None:
        return {}

    header = rows[header_index]
    year_columns: list[tuple[int, int]] = []
    for column, cell in enumerate(header):
        if isinstance(cell, (int, float)) and 1990 <= cell <= 2100 and float(cell).is_integer():
            year_columns.append((column, int(cell)))

    target = _canon(department)
    for row in rows[header_index + 1:]:
        if not _matches(row[0] if row else "", target):
            continue
        values: dict[int, float] = {}
        for column, year in year_columns:
            value = row[column] if column < len(row) else None
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                values[year] = float(value)
        return values
    return {}


def build_frame(raw_dir: Path, department: str = DEPARTMENT) -> tuple[pd.DataFrame, dict]:
    records: list[dict] = []
    coverage: dict[str, dict] = {}
    for serie, (filename, unit) in SERIES.items():
        path = raw_dir / _local_name(filename)
        if not path.exists():
            coverage[serie] = {"status": "missing", "file": _local_name(filename)}
            continue
        values = parse_department_series(path, department)
        coverage[serie] = {
            "status": "ok" if values else "sin_datos",
            "file": _local_name(filename),
            "unit": unit,
            "years": sorted(values),
        }
        for year, value in sorted(values.items()):
            records.append(
                {
                    "serie": serie,
                    "year": year,
                    "value": round(value, 4),
                    "unit": unit,
                    "scope": "lima_metropolitana",
                    "department": department,
                    "source": "INEI",
                }
            )
    frame = pd.DataFrame(
        records,
        columns=["serie", "year", "value", "unit", "scope", "department", "source"],
    )
    return frame, {"coverage": coverage, "series": list(SERIES)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Series de seguridad ciudadana del INEI (nivel departamento).")
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--department", default=DEPARTMENT)
    parser.add_argument("--refresh", action="store_true", help="Descargar los XLSX de nuevo.")
    args = parser.parse_args()

    for serie, (filename, _unit) in SERIES.items():
        dest = args.raw_dir / _local_name(filename)
        if args.refresh or not dest.exists():
            print(f"Descargando {serie} ...")
            download(BASE + filename, dest)

    frame, report = build_frame(args.raw_dir, args.department)

    out_dir = REPO_ROOT / "data" / "processed"
    out_dir.mkdir(parents=True, exist_ok=True)
    dataset_path = out_dir / "inei_series_lima.csv"
    report_path = out_dir / "inei_series_quality_report.json"

    frame.to_csv(dataset_path, index=False, encoding="utf-8")
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": BASE,
        "department": args.department,
        "note": "Serie de Lima Metropolitana 1/ del INEI (agregada, no distrital); contexto y contraste externo.",
        "rows": int(len(frame)),
        **report,
    }
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Serie: {dataset_path} ({len(frame)} filas)")
    print(f"Reporte: {report_path}")
    for serie, info in report["coverage"].items():
        print(f"  {serie:16s} {info.get('status')} {info.get('years', '')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
