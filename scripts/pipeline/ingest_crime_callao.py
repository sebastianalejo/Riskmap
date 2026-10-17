"""Ingesta reproducible de hechos delictivos georreferenciados del Callao (Oleada 2).

Fuente: "Registros de hechos delictivos en la Provincia Constitucional del Callao"
(Observatorio Regional de Seguridad Ciudadana, Gobierno Regional del Callao),
publicada en el Portal Nacional de Datos Abiertos. Son registros SIDPOL
**georreferenciados** con fecha y hora del hecho, algo que la fuente de puntos del
INEI no publica.

A diferencia del INEI, aquí `hour` y `day_of_week` son **observados** (se toman de
`FECHA_HECHO`/`HORA_HECHO`), no derivados. El resto del esquema unificado se
completa igual: `risk_level` de la severidad declarada (taxonomía) y
`historical_frequency` de la media mensual real de SIDPOL (últimos 24 meses).

Uso (desde la raíz del repositorio):

    python scripts/pipeline/ingest_crime_callao.py --refresh
    python scripts/pipeline/ingest_crime_callao.py --min-year 2018

Salidas:
    data/raw/callao/registros_callao.csv           (crudo, no versionado)
    data/processed/callao_incidents_lima.csv       (esquema unificado + denuncia_id)
    data/processed/callao_quality_report.json      (cobertura y descartes)

El CSV procesado lo consumen `upload_incidents.py` (Firestore) y
`export_web_data.py` (JSON publicado), que detectan el esquema «callao» por las
columnas `occurred_year, severity_level, hour, day_of_week, denuncia_id`.
"""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
import urllib.request
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd

PIPELINE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PIPELINE_DIR.parents[1]
sys.path.insert(0, str(PIPELINE_DIR))
sys.path.insert(0, str(REPO_ROOT / "functions"))

from crime_ml.validation import (  # noqa: E402
    LAT_MAX,
    LAT_MIN,
    LON_MAX,
    LON_MIN,
    ValidationError,
    validate_callao_incident_row,
)

from derive import frequency_for, load_frequency_lookup  # noqa: E402
from incidents_dataset import CALLAO_SOURCE, UNIFIED_KEYS  # noqa: E402
from taxonomy import classify, load_taxonomy  # noqa: E402

SOURCE_URL = (
    "https://www.datosabiertos.gob.pe/sites/default/files/"
    "DATASET_SEGURIDAD_CALLAO_FEBRERO2024_0.csv"
)
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
DEFAULT_RAW = REPO_ROOT / "data" / "raw" / "callao" / "registros_callao.csv"
SCOPE_PREFIX = "0701"  # Provincia Constitucional del Callao
ENTITIES = {
    "070101": "CALLAO",
    "070102": "BELLAVISTA",
    "070103": "CARMEN DE LA LEGUA REYNOSO",
    "070104": "LA PERLA",
    "070105": "LA PUNTA",
    "070106": "VENTANILLA",
    "070107": "MI PERU",
}
SEVERITY_TO_RISK = {"alta": "alto", "media": "medio", "baja": "bajo"}
WEEKDAYS = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")

# Columnas de salida: esquema unificado + el ID de denuncia (lo consume el
# extractor de ID estable en `incidents_dataset.load_rows`).
COLUMNS = UNIFIED_KEYS + ["denuncia_id"]

# La fuente trae el carácter de reemplazo U+FFFD donde debería ir una "ñ"
# (p. ej. "14 A\uFFFDoS"). Se repara a "n" antes de normalizar (y el resto de
# acentos se eliminan igual que en la taxonomía, que es unaccented).
_REPLACEMENT = "\ufffd"

# Modalidades del origen cuyo nombre excede el límite de `crime_type` (60) del
# esquema (firestore.rules) o es redundante: se mapean a un nombre canónico
# corto (el de la taxonomía). Ver `data/README.md`.
MODALITY_ALIASES = {
    "produccion de peligro en el servicio publico de transporte de pasajeros": "peligro en transporte publico de pasajeros",
    "penalizacion de la clonacion o adulteracion de terminales de telecomunicaciones": "clonacion o adulteracion de terminales",
    "agresiones en contra de las mujeres o integrantes del grupo familiar": "agresiones a la mujer o grupo familiar",
    "fabricacion suministro o tenencia de materiales peligrosos (armas explosivos)": "materiales peligrosos (armas o explosivos)",
    "abandono y actos de crueldad contra animales domesticos y silvestres": "maltrato animal",
    "violencia contra la autoridad para impedir el ejercicio de sus funciones": "violencia contra la autoridad",
    "contaminacion o adulteracion de alimentos o bebidas y alteracion de la fecha de vencimiento": "contaminacion o adulteracion de alimentos",
}


def _plain(text: str) -> str:
    """Minúsculas sin acentos y con espacios colapsados (clave de la taxonomía)."""
    repaired = str(text).strip().replace(_REPLACEMENT, "n")
    decomposed = unicodedata.normalize("NFKD", repaired.lower())
    return " ".join("".join(c for c in decomposed if not unicodedata.combining(c)).split())


def parse_date(value: object) -> date | None:
    """Parsea `FECHA_HECHO` (AAAAMMDD o YYYY-MM-DD). Devuelve None si es inválida."""
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in ("nan", "nat"):
        return None
    for fmt in ("%Y%m%d", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def parse_hour(value: object) -> int | None:
    """Parsea `HORA_HECHO` (HHMM o HH:MM) y devuelve la hora 0–23, o None."""
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in ("nan", "nat"):
        return None
    digits = "".join(ch for ch in text if ch.isdigit())
    if not digits:
        return None
    digits = digits.zfill(4)
    hour, minute = int(digits[:2]), int(digits[2:4])
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return hour


def canon_modality(value: object) -> str:
    """Modalidad normalizada a la clave de la taxonomía (sin acentos, nombre corto)."""
    key = _plain(value)
    if not key:
        return "otros"
    return MODALITY_ALIASES.get(key, key)


def download(dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        dest.write_bytes(response.read())


def build_frame(
    raw_path: Path,
    taxonomy: dict,
    freq_lookup: tuple,
    *,
    min_year: int = 2018,
) -> tuple[pd.DataFrame, dict]:
    """Normaliza el CSV del Callao al esquema unificado y devuelve (frame, reporte)."""
    frame = pd.read_csv(raw_path, dtype=str, encoding="utf-8-sig", sep=";")
    frame.columns = [column.strip() for column in frame.columns]

    required = {
        "UBIGEO",
        "DISTRITO",
        "MODALIDAD",
        "FECHA_HECHO",
        "HORA_HECHO",
        "LATITUD",
        "LONGITUD",
        "ID_DOC_DENUNCIA",
    }
    missing = required - set(frame.columns)
    if missing:
        raise SystemExit(f"Faltan columnas en el CSV del Callao: {sorted(missing)}")

    pair_mean, district_mean, global_mean = freq_lookup[:3]
    drops: Counter[str] = Counter()
    errors: list[str] = []
    records: list[dict] = []

    for index, raw in enumerate(frame.to_dict(orient="records"), start=2):
        ubigeo = str(raw.get("UBIGEO") or "").strip().zfill(6)
        if not ubigeo.startswith(SCOPE_PREFIX):
            drops["fuera_de_callao"] += 1
            continue

        occurred = parse_date(raw.get("FECHA_HECHO"))
        if occurred is None:
            drops["fecha_invalida"] += 1
            continue
        if occurred.year < min_year:
            drops["anio_anterior"] += 1
            continue

        hour = parse_hour(raw.get("HORA_HECHO"))
        if hour is None:
            drops["hora_invalida"] += 1
            continue

        modality = canon_modality(raw.get("MODALIDAD"))
        classification = classify(modality, taxonomy)
        severity = classification["severity"]
        record = {
            "crime_type": modality,
            "hour": hour,
            "day_of_week": WEEKDAYS[occurred.weekday()],
            "district": ENTITIES.get(ubigeo, str(raw.get("DISTRITO") or "").strip().upper()),
            "latitude": raw.get("LATITUD"),
            "longitude": raw.get("LONGITUD"),
            "historical_frequency": frequency_for(
                ENTITIES.get(ubigeo, str(raw.get("DISTRITO") or "").strip().upper()),
                modality,
                pair_mean,
                district_mean,
                global_mean,
            ),
            "risk_level": SEVERITY_TO_RISK.get(severity, "medio"),
            "occurred_year": occurred.year,
            "macro_category": classification["macro"],
            "ubigeo": ubigeo,
            "severity_level": severity,
            "source": CALLAO_SOURCE,
            "denuncia_id": str(raw.get("ID_DOC_DENUNCIA") or "").strip(),
        }

        try:
            validate_callao_incident_row(record)
        except ValidationError as exc:
            drops["validacion"] += 1
            if len(errors) < 20:
                errors.append(f"Fila {index}: {exc}")
            continue
        records.append(record)

    df = pd.DataFrame(records, columns=COLUMNS)
    if not df.empty:
        df = df.sort_values(["occurred_year", "district", "crime_type"]).reset_index(drop=True)

    raw_modalities = Counter(canon_modality(value) for value in frame["MODALIDAD"].dropna())
    unknown = sorted(m for m in raw_modalities if m not in taxonomy.get("modalities", {}))

    report = {
        "rows_raw": int(len(frame)),
        "rows_kept": int(len(df)),
        "dropped": dict(drops),
        "errors": errors,
        "districts": int(df["ubigeo"].nunique()) if not df.empty else 0,
        "modalities": int(df["crime_type"].nunique()) if not df.empty else 0,
        "min_year": min_year,
        "by_year": df.groupby("occurred_year").size().to_dict() if not df.empty else {},
        "by_severity": df.groupby("severity_level").size().to_dict() if not df.empty else {},
        "by_district": df.groupby("district").size().to_dict() if not df.empty else {},
        "unmapped_modalities": unknown,
        "completeness": {
            column: int(df[column].notna().sum()) if not df.empty else 0 for column in COLUMNS
        },
    }
    return df, report


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingesta de hechos delictivos del Callao (Lima Sur).")
    parser.add_argument("--csv", type=Path, default=DEFAULT_RAW, help="CSV crudo del Callao.")
    parser.add_argument("--refresh", action="store_true", help="Descargar el CSV de nuevo.")
    parser.add_argument("--min-year", type=int, default=2018, help="Descarta hechos anteriores a este año.")
    args = parser.parse_args()

    if args.refresh or not args.csv.exists():
        print(f"Descargando registros del Callao a {args.csv} ...")
        download(args.csv)

    taxonomy = load_taxonomy()
    freq_lookup = load_frequency_lookup()
    frame, report = build_frame(args.csv, taxonomy, freq_lookup, min_year=args.min_year)

    out_dir = REPO_ROOT / "data" / "processed"
    out_dir.mkdir(parents=True, exist_ok=True)
    dataset_path = out_dir / "callao_incidents_lima.csv"
    report_path = out_dir / "callao_quality_report.json"

    frame.to_csv(dataset_path, index=False, encoding="utf-8")

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": SOURCE_URL,
        "scope_prefix": SCOPE_PREFIX,
        "schema": "callao (fecha y hora observadas)",
        "documents_key": "ID = ID_DOC_DENUNCIA de la fuente (hash FNV-1a, 'cal_<hex>')",
        "columns": COLUMNS,
        **report,
    }
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Procesado: {dataset_path} ({len(frame)} filas)")
    print(f"Reporte:   {report_path}")
    print(f"Descartes: {report['dropped']}")
    if report["unmapped_modalities"]:
        print(f"AVISO: modalidades sin taxonomía: {report['unmapped_modalities']}")
    print("Por año:", report["by_year"])
    print("Por distrito:", report["by_district"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
