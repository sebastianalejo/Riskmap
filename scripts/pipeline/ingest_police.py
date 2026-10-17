"""Ingesta de la oferta policial geolocalizada de Lima Metropolitana y Callao.

Combina dos fuentes del Observatorio Nacional de Seguridad Ciudadana (OBNASEC,
MININTER) para construir variables de contexto por distrito (ubigeo 1501/0701):

- **Comisarías básicas 2019** (MININTER): 1 318 comisarías a nivel nacional con
  coordenadas (`GPS`) y nombre de distrito (`NOMBREDI`); el `ubigeo` se resuelve
  por nombre con la lista canónica de SIDPOL (el XLSX no publica ubigeo).
- **Estado de infraestructura y servicios básicos de comisarías 2022** (MININTER):
  indicadores por comisaría con departamento/provincia/distrito (sin coordenadas).

Salidas (pensadas para unir por `ubigeo` con los incidentes/SIDPOL):

    data/raw/police/comisarias_2019.xlsx           (crudo, no versionado)
    data/raw/police/comisarias_infra_2022.xlsx     (crudo, no versionado)
    data/processed/police_stations_lima.csv        (comisarías con lat/lon y ubigeo)
    data/processed/police_context_lima.csv         (contexto agregado por distrito)
    data/processed/police_quality_report.json

Uso (desde la raíz del repositorio):

    python scripts/pipeline/ingest_police.py --refresh

Nota: son fuentes **estáticas** (2019/2022), no series temporales. La fuente no
publica personal ni capacidad operativa en estos archivos.
"""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from openpyxl import load_workbook

PIPELINE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PIPELINE_DIR.parents[1]
sys.path.insert(0, str(PIPELINE_DIR))
sys.path.insert(0, str(REPO_ROOT / "functions"))

from crime_ml.validation import LAT_MAX, LAT_MIN, LON_MAX, LON_MIN  # noqa: E402
from derive import load_frequency_lookup  # noqa: E402

# Fuentes (MININTER / OBNASEC).
STATIONS_URL = (
    "https://observatorio.mininter.gob.pe/sites/default/files/proyecto/archivos/"
    "Relaci%C3%B3n%20de%20comisar%C3%ADas%20b%C3%A1sicas%201318.xlsx"
)
INFRA_URL = (
    "https://observatorio.mininter.gob.pe/sites/default/files/proyecto/archivos/"
    "Base%20de%20datos%20del%20estado%20de%20infraestructura%20y%20servicios%20"
    "basicos%20de%20las%20comisari%CC%81as%20ba%CC%81sicas%202022.xlsx"
)
USER_AGENT = "RiskmapPipeline/1.0 (ingesta policial; proyecto academico)"

DEFAULT_STATIONS = REPO_ROOT / "data" / "raw" / "police" / "comisarias_2019.xlsx"
DEFAULT_INFRA = REPO_ROOT / "data" / "raw" / "police" / "comisarias_infra_2022.xlsx"
SCOPE_PREFIXES = ("1501", "0701")  # Lima Metropolitana + Callao

STATION_COLUMNS = [
    "ubigeo",
    "district",
    "station_name",
    "latitude",
    "longitude",
    "police_type",
    "region",
    "source",
    "year",
]
CONTEXT_COLUMNS = [
    "ubigeo",
    "district",
    "stations_count",
    "stations_2022_count",
    "servicios_ok_2022",
    "infra_ok_2022",
    "source",
]


def _plain(text: object) -> str:
    """Nombre canónico para cruzar distritos: mayúsculas, sin acentos."""
    decomposed = unicodedata.normalize("NFKD", str(text or "").strip().upper())
    return " ".join("".join(c for c in decomposed if not unicodedata.combining(c)).split())


def parse_gps(value: object) -> tuple[float, float] | None:
    """Parsea el campo `GPS` de la fuente ('lat,lon') y valida el bbox de Lima/Callao."""
    if value is None:
        return None
    text = str(value).strip().replace(";", ",").replace(" ", "")
    parts = text.split(",")
    if len(parts) < 2:
        return None
    try:
        latitude, longitude = float(parts[0]), float(parts[1])
    except ValueError:
        return None
    if not (LAT_MIN <= latitude <= LAT_MAX and LON_MIN <= longitude <= LON_MAX):
        return None
    return round(latitude, 6), round(longitude, 6)


def _resolve_column(header: list, *needles: str) -> int | None:
    """Índice de la primera columna cuyo encabezado contiene alguno de los textos."""
    for index, cell in enumerate(header):
        label = str(cell or "").strip().upper()
        if any(needle in label for needle in needles):
            return index
    return None


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        dest.write_bytes(response.read())


def district_ubigeo_map() -> dict[str, str]:
    """Mapa nombre de distrito canónico → ubigeo, derivado de la serie SIDPOL.

    Es la forma de resolver `ubigeo` en las comisarías: el XLSX 2019 no publica
    ubigeo (su columna 'CODIGO INEI' es un código interno), solo el nombre del
    distrito y las coordenadas.
    """
    _, _, _, ubigeo_names = load_frequency_lookup()
    return {_plain(name): ubigeo for ubigeo, name in ubigeo_names.items()}


def load_stations(path: Path, name_to_ubigeo: dict[str, str]) -> tuple[pd.DataFrame, dict]:
    """Lee el XLSX de comisarías básicas 2019 y devuelve (frame en ámbito, reporte).

    El ámbito se determina por las coordenadas (bbox de Lima/Callao) y el `ubigeo`
    se resuelve por nombre de distrito con `name_to_ubigeo`.
    """
    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.worksheets[0]
    rows = [list(row) for row in sheet.iter_rows(values_only=True)]

    header_index = next(
        (i for i, row in enumerate(rows) if row and _resolve_column(row, "GPS") is not None),
        None,
    )
    if header_index is None:
        raise SystemExit("No se encontró la fila de encabezados (columna GPS) en el XLSX 2019.")
    header = rows[header_index]

    i_gps = _resolve_column(header, "GPS")
    i_name = _resolve_column(header, "NOMBREDI")
    i_type = _resolve_column(header, "TIPO")
    i_region = _resolve_column(header, "REGPOL")
    i_station = _resolve_column(header, "COMISAR")
    if i_gps is None or i_name is None:
        raise SystemExit("Faltan columnas obligatorias (GPS / NOMBREDI) en el XLSX 2019.")

    records: list[dict] = []
    stats = Counter()
    for row in rows[header_index + 1:]:
        if not row or all(cell in (None, "") for cell in row):
            continue
        stats["rows_raw"] += 1
        coords = parse_gps(row[i_gps])
        if coords is None:
            stats["fuera_de_lima_callao"] += 1
            continue
        district = str(row[i_name] or "").strip().upper()
        ubigeo = name_to_ubigeo.get(_plain(district), "")
        if not ubigeo:
            stats["distrito_sin_ubigeo"] += 1
            continue
        records.append(
            {
                "ubigeo": ubigeo,
                "district": district,
                "station_name": str(row[i_station] or "").strip().upper() if i_station is not None else "",
                "latitude": coords[0],
                "longitude": coords[1],
                "police_type": str(row[i_type] or "").strip().upper() if i_type is not None else "",
                "region": str(row[i_region] or "").strip().upper() if i_region is not None else "",
                "source": "MININTER-comisarias",
                "year": 2019,
            }
        )
    frame = pd.DataFrame(records, columns=STATION_COLUMNS)
    return frame, {"stats": dict(stats)}


def load_infra(path: Path) -> tuple[pd.DataFrame, dict]:
    """Lee el XLSX de infraestructura 2022 y agrega por distrito."""
    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.worksheets[0]
    rows = [list(row) for row in sheet.iter_rows(values_only=True)]
    if not rows:
        raise SystemExit("El XLSX 2022 está vacío.")
    header = rows[0]

    i_district = _resolve_column(header, "DISTRITO")
    i_servicios = _resolve_column(header, "INDICADOR 01", "SERVICIOS BASICOS")
    i_infra = _resolve_column(header, "INDICADOR 02", "INFRAESTRUCTURA")
    if i_district is None:
        raise SystemExit("No se encontró la columna DISTRITO en el XLSX 2022.")

    records: list[dict] = []
    stats = Counter()
    for row in rows[1:]:
        if not row or row[i_district] in (None, ""):
            continue
        stats["rows_raw"] += 1
        records.append(
            {
                "district": _plain(row[i_district]),
                "servicios_ok": 1 if str(row[i_servicios] or "").strip().upper() in ("SI", "SÍ") else 0,
                "infra_ok": 1 if str(row[i_infra] or "").strip().upper() in ("SI", "SÍ") else 0,
            }
        )
    frame = pd.DataFrame(records)
    if frame.empty:
        return frame, {"stats": dict(stats)}
    frame["station"] = 1
    grouped = (
        frame.groupby("district", as_index=False)
        .agg(
            stations_2022_count=("station", "sum"),
            servicios_ok_2022=("servicios_ok", "sum"),
            infra_ok_2022=("infra_ok", "sum"),
        )
    )
    return grouped, {"stats": dict(stats)}


def build_context(stations: pd.DataFrame, infra: pd.DataFrame) -> pd.DataFrame:
    """Cruza comisarías (ubigeo) con infraestructura 2022 (nombre de distrito)."""
    if stations.empty:
        return pd.DataFrame(columns=CONTEXT_COLUMNS)

    # Nombre canónico por ubigeo: el más frecuente entre las comisarías del distrito.
    name_map = (
        stations.assign(_canon=stations["district"].map(_plain))
        .groupby(["_canon", "ubigeo"]).size().reset_index(name="n")
        .sort_values(["ubigeo", "n"], ascending=[True, False])
        .drop_duplicates("ubigeo")
        .set_index("ubigeo")["_canon"].to_dict()
    )
    context = (
        stations.groupby("ubigeo", as_index=False)
        .agg(district=("district", "first"), stations_count=("station_name", "size"))
    )
    context["_canon"] = context["district"].map(_plain)

    if not infra.empty:
        context = context.merge(infra, left_on="_canon", right_on="district", how="left", suffixes=("", "_infra"))
        if "district_infra" in context.columns:
            context = context.drop(columns=["district_infra"])
    else:
        context["stations_2022_count"] = 0
        context["servicios_ok_2022"] = 0
        context["infra_ok_2022"] = 0

    for column in ("stations_2022_count", "servicios_ok_2022", "infra_ok_2022"):
        if column not in context.columns:
            context[column] = 0
        context[column] = context[column].fillna(0).astype(int)

    context["source"] = "MININTER-comisarias"
    context = context.drop(columns=["_canon"])
    return context[CONTEXT_COLUMNS].sort_values("ubigeo").reset_index(drop=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingesta de oferta policial (comisarías) de Lima/Callao.")
    parser.add_argument("--stations", type=Path, default=DEFAULT_STATIONS)
    parser.add_argument("--infra", type=Path, default=DEFAULT_INFRA)
    parser.add_argument("--refresh", action="store_true", help="Descargar los XLSX de nuevo.")
    args = parser.parse_args()

    if args.refresh or not args.stations.exists():
        print(f"Descargando comisarías 2019 a {args.stations} ...")
        download(STATIONS_URL, args.stations)
    if args.refresh or not args.infra.exists():
        print(f"Descargando infraestructura 2022 a {args.infra} ...")
        download(INFRA_URL, args.infra)

    stations, stations_report = load_stations(args.stations, district_ubigeo_map())
    infra, infra_report = load_infra(args.infra)
    context = build_context(stations, infra)

    out_dir = REPO_ROOT / "data" / "processed"
    out_dir.mkdir(parents=True, exist_ok=True)
    stations_path = out_dir / "police_stations_lima.csv"
    context_path = out_dir / "police_context_lima.csv"
    report_path = out_dir / "police_quality_report.json"

    stations.to_csv(stations_path, index=False, encoding="utf-8")
    context.to_csv(context_path, index=False, encoding="utf-8")

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sources": {"stations": STATIONS_URL, "infra": INFRA_URL},
        "scope_prefixes": list(SCOPE_PREFIXES),
        "stations": stations_report,
        "infra": infra_report,
        "totals": {
            "stations_lima_callao": int(len(stations)),
            "districts_with_stations": int(stations["ubigeo"].nunique()) if not stations.empty else 0,
            "context_rows": int(len(context)),
            "districts_matched_2022": int((context["stations_2022_count"] > 0).sum()) if not context.empty else 0,
        },
        "columns": {"stations": STATION_COLUMNS, "context": CONTEXT_COLUMNS},
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Comisarías: {stations_path} ({len(stations)} filas)")
    print(f"Contexto:   {context_path} ({len(context)} distritos)")
    print(f"Reporte:    {report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
