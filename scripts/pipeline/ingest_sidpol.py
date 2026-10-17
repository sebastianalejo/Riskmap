"""Ingesta reproducible de la serie mensual SIDPOL (MININTER) — Oleada 1.

Fuente: "Denuncias policiales registradas a nivel nacional" (SIDPOL / MININTER),
Portal Nacional de Datos Abiertos. Columnas reales: ANIO, MES, DPTO_HECHO_NEW,
PROV_HECHO, DIST_HECHO, UBIGEO_HECHO, P_MODALIDADES, cantidad.

Diseño anti-duplicados:
- Dentro del CSV: se agrupa por (año, mes, ubigeo) sumando modalidades (el origen
  ya viene sin duplicados; se verifica y se reporta).
- En Firestore: **un documento por (año, mes, ubigeo)** con ID determinista
  `AAAA-MM-UBIGEO` y escritura `set()` (upsert). Re-ejecutar la ingesta
  sobreescribe los mismos documentos: nunca crea duplicados.

Uso (desde la raíz del repositorio):

    python scripts/pipeline/ingest_sidpol.py --refresh          # descarga + procesa
    python scripts/pipeline/ingest_sidpol.py --upload           # sube a Firestore (Admin SDK)

Salidas:
    data/raw/sidpol/DATASET_Denuncias_Policiales.csv   (crudo, no versionado)
    data/processed/sidpol_monthly_lima.csv             (aplanado, versionable)
    data/processed/sidpol_quality_report.json
"""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

PIPELINE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PIPELINE_DIR.parents[1]
sys.path.insert(0, str(REPO_ROOT / "functions"))

SOURCE_URL = (
    "https://www.datosabiertos.gob.pe/sites/default/files/"
    "DATASET_Denuncias_Policiales_Ene%202018%20a%20Julio%202026.csv"
)
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
DEFAULT_RAW = REPO_ROOT / "data" / "raw" / "sidpol" / "DATASET_Denuncias_Policiales.csv"
SCOPE_PREFIXES = ("1501", "0701")  # Lima Metropolitana + Callao
COLLECTION = "crime_stats_monthly"

# P_MODALIDADES del origen → clave estable para el mapa `por_modalidad`.
MODALITY_KEYS = {
    "otros": "otros",
    "violencia contra la mujer e integrantes": "violencia_mujer",
    "hurto": "hurto",
    "robo": "robo",
    "estafa": "estafa",
    "extorsion": "extorsion",
    "secuestro": "secuestro",
}
MODALITY_LABELS = {
    "otros": "Otros",
    "violencia_mujer": "Violencia (mujer y grupo familiar)",
    "hurto": "Hurto",
    "robo": "Robo",
    "estafa": "Estafa",
    "extorsion": "Extorsión",
    "secuestro": "Secuestro",
}


def _plain(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", str(text).strip().lower())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def modality_key(text: str) -> str:
    normalized = _plain(text)
    if normalized in MODALITY_KEYS:
        return MODALITY_KEYS[normalized]
    return normalized.replace(" ", "_")[:40] or "otros"


def download(dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        dest.write_bytes(response.read())


def build_frame(raw_path: Path) -> tuple[pd.DataFrame, dict]:
    df = pd.read_csv(raw_path, dtype=str, encoding="utf-8-sig")
    df.columns = [column.strip() for column in df.columns]

    required = {"ANIO", "MES", "DPTO_HECHO_NEW", "PROV_HECHO", "DIST_HECHO", "UBIGEO_HECHO", "P_MODALIDADES", "cantidad"}
    missing = required - set(df.columns)
    if missing:
        raise SystemExit(f"Faltan columnas en el CSV SIDPOL: {sorted(missing)}")

    df["ubigeo"] = df["UBIGEO_HECHO"].str.strip().str.zfill(6)
    df["year"] = pd.to_numeric(df["ANIO"], errors="coerce")
    df["month"] = pd.to_numeric(df["MES"], errors="coerce")
    df["count"] = pd.to_numeric(df["cantidad"], errors="coerce")
    df["mod_key"] = df["P_MODALIDADES"].map(modality_key)

    invalid = df["year"].isna() | df["month"].isna() | df["count"].isna()
    dropped_invalid = int(invalid.sum())
    df = df[~invalid].copy()
    df["year"] = df["year"].astype(int)
    df["month"] = df["month"].astype(int)
    df["count"] = df["count"].astype(int)

    negative = int((df["count"] < 0).sum())
    df = df[df["count"] >= 0].copy()

    scope = df[df["ubigeo"].str.slice(0, 4).isin(SCOPE_PREFIXES)].copy()
    if scope.empty:
        raise SystemExit("El CSV no contiene filas de Lima Metropolitana / Callao.")

    duplicates = int(scope.duplicated(subset=["year", "month", "ubigeo", "mod_key"]).sum())
    scope = scope.drop_duplicates(subset=["year", "month", "ubigeo", "mod_key"], keep="first")

    pivot = (
        scope.pivot_table(
            index=["year", "month", "ubigeo", "DIST_HECHO", "PROV_HECHO", "DPTO_HECHO_NEW"],
            columns="mod_key",
            values="count",
            aggfunc="sum",
            fill_value=0,
        )
        .reset_index()
        .rename(columns={"DIST_HECHO": "district", "PROV_HECHO": "province", "DPTO_HECHO_NEW": "department"})
    )
    modality_columns = sorted(column for column in pivot.columns if column in MODALITY_LABELS)
    pivot["total"] = pivot[modality_columns].sum(axis=1)
    pivot = pivot.sort_values(["year", "month", "district"]).reset_index(drop=True)

    stats = {
        "rows_raw": int(len(df)),
        "rows_scope": int(len(scope)),
        "dropped_invalid": dropped_invalid,
        "dropped_negative": negative,
        "duplicates_dropped": duplicates,
        "districts": int(pivot["ubigeo"].nunique()),
        "months": int(pivot.groupby(["year", "month"]).ngroups),
        "documents": int(len(pivot)),
        "modalities": modality_columns,
        "years": sorted(int(year) for year in pivot["year"].unique()),
        "total_incidents": int(pivot["total"].sum()),
    }
    return pivot, stats


def write_processed(frame: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ordered = frame[
        ["year", "month", "ubigeo", "district", "province", "department", "total"]
        + [column for column in frame.columns if column in MODALITY_LABELS]
    ]
    ordered.to_csv(path, index=False, encoding="utf-8")


_DB = None


def _get_db():
    """Inicializa firebase-admin una sola vez (idempotente dentro del proceso)."""
    global _DB
    if _DB is None:
        from firebase_admin import firestore as admin_firestore
        from firebase_admin import initialize_app

        initialize_app()
        _DB = admin_firestore.client()
    return _DB


def upload(frame: pd.DataFrame) -> int:
    db = _get_db()
    collection = db.collection(COLLECTION)

    batch = db.batch()
    pending = 0
    written = 0
    updated_at = datetime.now(timezone.utc).isoformat()
    for row in frame.to_dict(orient="records"):
        doc_id = f"{int(row['year'])}-{int(row['month']):02d}-{row['ubigeo']}"
        payload = {
            "year": int(row["year"]),
            "month": int(row["month"]),
            "ubigeo": str(row["ubigeo"]),
            "district": str(row["district"]),
            "province": str(row["province"]),
            "department": str(row["department"]),
            "scope": "LIMA",
            "total": int(row["total"]),
            "por_modalidad": {
                key: int(row.get(key, 0)) for key in MODALITY_LABELS
            },
            "source": "MININTER-SIDPOL",
            "updated_at": updated_at,
        }
        batch.set(collection.document(doc_id), payload)  # set() = upsert idempotente
        pending += 1
        written += 1
        if pending >= 400:
            batch.commit()
            batch = db.batch()
            pending = 0
    if pending:
        batch.commit()
    return written


def verify_collection() -> int:
    db = _get_db()
    try:
        result = db.collection(COLLECTION).count().get()
        return int(result[0][0].value)
    except Exception:
        return sum(1 for _ in db.collection(COLLECTION).stream())


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingesta de la serie mensual SIDPOL (Lima/Callao).")
    parser.add_argument("--csv", type=Path, default=DEFAULT_RAW, help="CSV crudo de SIDPOL.")
    parser.add_argument("--refresh", action="store_true", help="Descargar el CSV de nuevo.")
    parser.add_argument("--upload", action="store_true", help="Subir a Firestore (Admin SDK).")
    parser.add_argument("--verify", action="store_true", help="Contar documentos en Firestore.")
    args = parser.parse_args()

    if args.refresh or not args.csv.exists():
        print(f"Descargando SIDPOL a {args.csv} ...")
        download(args.csv)

    frame, stats = build_frame(args.csv)
    processed = REPO_ROOT / "data" / "processed" / "sidpol_monthly_lima.csv"
    write_processed(frame, processed)

    report_path = REPO_ROOT / "data" / "processed" / "sidpol_quality_report.json"
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": SOURCE_URL,
        "scope_prefixes": list(SCOPE_PREFIXES),
        "collection": COLLECTION,
        "documents_key": "ID determinista AAAA-MM-UBIGEO (set/upsert, sin duplicados)",
        **stats,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Procesado: {processed} ({len(frame)} documentos distrito-mes)")
    print(f"Reporte:   {report_path}")
    print(
        "Resumen: distritos={districts} meses={months} modalidades={modalities} "
        "incidentes={total_incidents}".format(**stats)
    )

    if args.upload:
        written = upload(frame)
        print(f"Firestore: {written} documentos escritos (upsert por ID determinista) en '{COLLECTION}'.")
    if args.verify:
        print(f"Verificación: {verify_collection()} documentos en '{COLLECTION}'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
