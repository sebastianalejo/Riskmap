"""Ingesta de delitos denunciados ante el Ministerio Público (MPFN) para Lima/Callao.

Fuente: "Delitos denunciados ante el Ministerio Público" (MPFN), portal de datos
abiertos, en archivos CSV anuales. El grano es el **distrito fiscal** (no el
distrito municipal) y el tipo de delito genérico; se agrega la cantidad.

Se filtran los distritos fiscales de Lima Metropolitana y el Callao. Es una serie
de **contexto** (grano grueso), pensada para contraste externo, no como microdato.

Uso (desde la raíz del repositorio):

    python scripts/pipeline/ingest_mpfn.py --refresh

Salidas:
    data/raw/mpfn/<año>.csv                 (crudo, no versionado)
    data/processed/mpfn_delitos_lima.csv    (año, distrito fiscal, delito, cantidad)
    data/processed/mpfn_quality_report.json
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

PIPELINE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PIPELINE_DIR.parents[1]

BASE = "https://www.datosabiertos.gob.pe/sites/default/files/"
USER_AGENT = "RiskmapPipeline/1.0 (ingesta MPFN; proyecto academico)"
DEFAULT_RAW_DIR = REPO_ROOT / "data" / "raw" / "mpfn"

YEARS = {
    2020: "delitos%20denunciados%202020.csv",
    2021: "delitos%20denunciados%202021.csv",
    2022: "delitos%20denunciados%202022.csv",
    2023: "delitos-denunciados-2023_0.csv",
    2024: "delitos-denunciados-2024.csv",
    2025: "BD-delitos-denunciados-2025-12.csv",
    2026: "DA-BD-delitos-denunciados-2026-08.csv",
}

COLUMNS = ["year", "distrito_fiscal", "generico", "cantidad", "source"]


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        dest.write_bytes(response.read())


def in_scope(distrito_fiscal: object) -> bool:
    """Lima Metropolitana (distritos fiscales LIMA*) y Callao."""
    value = str(distrito_fiscal or "").strip().upper()
    return value.startswith("LIMA") or value in ("CALLAO", "PROV. CONST. DEL CALLAO")


def read_year(path: Path) -> pd.DataFrame:
    """Lee un CSV anual del MPFN y lo normaliza (columnas y tipos)."""
    frame = pd.read_csv(path, dtype=str, encoding="utf-8-sig")
    frame.columns = [str(column).strip().lower() for column in frame.columns]
    required = {"distrito_fiscal", "generico", "cantidad", "anio_denuncia"}
    missing = required - set(frame.columns)
    if missing:
        raise SystemExit(f"Faltan columnas en {path.name}: {sorted(missing)}")

    frame["year"] = pd.to_numeric(frame["anio_denuncia"], errors="coerce")
    frame["cantidad"] = pd.to_numeric(frame["cantidad"], errors="coerce")
    frame = frame.dropna(subset=["year", "cantidad"]).copy()
    frame["year"] = frame["year"].astype(int)
    frame["cantidad"] = frame["cantidad"].astype(int)
    frame["distrito_fiscal"] = frame["distrito_fiscal"].str.strip().str.upper()
    frame["generico"] = frame["generico"].str.strip().str.upper()
    return frame[["year", "distrito_fiscal", "generico", "cantidad"]]


def build_frame(raw_dir: Path, years: dict[int, str]) -> tuple[pd.DataFrame, dict]:
    frames: list[pd.DataFrame] = []
    errors: list[str] = []
    per_year: dict[str, dict] = {}

    for year, filename in sorted(years.items()):
        path = raw_dir / f"{year}.csv"
        if not path.exists():
            per_year[str(year)] = {"status": "missing"}
            continue
        try:
            frame = read_year(path)
        except (SystemExit, ValueError) as exc:
            errors.append(f"{year}: {exc}")
            per_year[str(year)] = {"status": "error", "error": str(exc)}
            continue

        raw_rows = len(frame)
        scope = frame[frame["distrito_fiscal"].map(in_scope)]
        per_year[str(year)] = {
            "status": "ok",
            "raw_rows": raw_rows,
            "scope_rows": int(len(scope)),
        }
        frames.append(scope)

    if not frames:
        return pd.DataFrame(columns=COLUMNS), {"per_year": per_year, "errors": errors}

    combined = pd.concat(frames, ignore_index=True)
    grouped = (
        combined.groupby(["year", "distrito_fiscal", "generico"], as_index=False)["cantidad"]
        .sum()
        .sort_values(["year", "distrito_fiscal", "generico"])
        .reset_index(drop=True)
    )
    grouped["source"] = "MPFN"
    report = {
        "per_year": per_year,
        "errors": errors,
        "totals": {
            "rows": int(len(grouped)),
            "years": sorted(int(y) for y in grouped["year"].unique()),
            "fiscal_districts": int(grouped["distrito_fiscal"].nunique()),
            "crimes": int(grouped["generico"].nunique()),
            "cantidad": int(grouped["cantidad"].sum()),
        },
        "by_year": grouped.groupby("year")["cantidad"].sum().to_dict(),
    }
    return grouped[COLUMNS], report


def main() -> int:
    parser = argparse.ArgumentParser(description="Delitos denunciados ante el MPFN (Lima/Callao).")
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--refresh", action="store_true", help="Descargar los CSV de nuevo.")
    args = parser.parse_args()

    for year, filename in sorted(YEARS.items()):
        dest = args.raw_dir / f"{year}.csv"
        if args.refresh or not dest.exists():
            print(f"Descargando MPFN {year} ...")
            download(BASE + filename, dest)

    frame, report = build_frame(args.raw_dir, YEARS)

    out_dir = REPO_ROOT / "data" / "processed"
    out_dir.mkdir(parents=True, exist_ok=True)
    dataset_path = out_dir / "mpfn_delitos_lima.csv"
    report_path = out_dir / "mpfn_quality_report.json"

    frame.to_csv(dataset_path, index=False, encoding="utf-8")
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": BASE,
        "note": "Grano = distrito fiscal (no municipal); serie de contexto.",
        **report,
    }
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Dataset: {dataset_path} ({len(frame)} filas)")
    print(f"Reporte: {report_path}")
    print("Por año:", report.get("totals", {}).get("by_year", report.get("by_year", {})))
    return 0


if __name__ == "__main__":
    sys.exit(main())
