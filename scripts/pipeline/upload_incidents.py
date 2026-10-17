"""Sube incidentes del CSV a `crime_incidents` con IDs deterministas (sin duplicados).

El ID de cada documento es el hash FNV-1a de 64 bits del contenido normalizado
(`inc_<hex>`), idéntico al que calcula el frontend (`frontend/src/utils/stableId.ts`).
Con `set()` (upsert), reimportar el mismo archivo actualiza los mismos documentos:
nunca se duplican. Las pruebas de paridad viven en `tests/pipeline/`.

Uso (desde la raíz del repositorio):

    python scripts/pipeline/upload_incidents.py --verify
    python scripts/pipeline/upload_incidents.py --replace --verify   # normaliza IDs existentes

Requiere credenciales de administrador (GOOGLE_APPLICATION_CREDENTIALS).
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

PIPELINE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PIPELINE_DIR.parents[1]
sys.path.insert(0, str(REPO_ROOT / "functions"))

from crime_ml.pipeline import FEATURES, TARGET  # noqa: E402
from crime_ml.validation import (  # noqa: E402
    ValidationError,
    validate_arcgis_incident_row,
    validate_incident_row,
)

CANONICAL_KEYS = [
    "crime_type",
    "day_of_week",
    "district",
    "historical_frequency",
    "hour",
    "latitude",
    "longitude",
    "risk_level",
]
ARCGIS_CANONICAL_KEYS = [
    "crime_type",
    "district",
    "latitude",
    "longitude",
    "macro_category",
    "occurred_year",
    "severity_level",
    "source",
]
ARCGIS_SOURCE = "inei"
COLLECTION = "crime_incidents"


def fnv1a64_hex(text: str) -> str:
    """FNV-1a de 64 bits (paridad exacta con frontend/src/utils/stableId.ts)."""
    h = 0xCBF29CE484222325
    for byte in text.encode("utf-8"):
        h ^= byte
        h = (h * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return format(h, "016x")


def stable_row_id(row: dict) -> str:
    ordered = {key: row[key] for key in CANONICAL_KEYS}
    payload = json.dumps(ordered, ensure_ascii=False, separators=(",", ":"))
    return f"inc_{fnv1a64_hex(payload)}"


def stable_arcgis_row_id(row: dict) -> str:
    """ID determinista para filas del esquema v2 (INEI 2021-2024)."""
    ordered = {key: row.get(key) for key in ARCGIS_CANONICAL_KEYS}
    payload = json.dumps(ordered, ensure_ascii=False, separators=(",", ":"))
    return f"arc_{fnv1a64_hex(payload)}"


def detect_schema(columns) -> str:
    """Detecta el esquema del CSV: 'arcgis' (v2) o 'legacy'."""
    return "arcgis" if {"occurred_year", "severity_level"} <= set(columns) else "legacy"


def normalize_row(raw: dict) -> dict:
    """Misma normalización que hace la interfaz (`toIncident` en DataPage.tsx)."""
    return {
        "crime_type": str(raw["crime_type"]).strip(),
        "hour": int(float(raw["hour"])),
        "day_of_week": str(raw["day_of_week"]).strip().lower(),
        "district": str(raw["district"]).strip().upper(),
        "latitude": float(raw["latitude"]),
        "longitude": float(raw["longitude"]),
        "historical_frequency": int(float(raw["historical_frequency"])),
        "risk_level": str(raw["risk_level"]).strip().lower(),
    }


def normalize_arcgis_row(raw: dict) -> dict:
    """Esquema v2: valida y añade la fuente."""
    cleaned = validate_arcgis_incident_row(raw)
    cleaned["source"] = ARCGIS_SOURCE
    return cleaned


def load_rows(csv_path: Path) -> tuple[list[tuple[str, dict]], list[str], str]:
    """Devuelve ([[doc_id, fila]], errores, esquema) deduplicando por ID."""
    frame = pd.read_csv(csv_path, dtype=str, encoding="utf-8-sig")
    schema = detect_schema(frame.columns)
    rows: list[tuple[str, dict]] = []
    errors: list[str] = []
    seen: set[str] = set()

    for index, raw in enumerate(frame.to_dict(orient="records"), start=2):
        try:
            if schema == "arcgis":
                normalized = normalize_arcgis_row(raw)
                doc_id = stable_arcgis_row_id(normalized)
            else:
                normalized = normalize_row(raw)
                validate_incident_row(normalized, FEATURES, TARGET)
                doc_id = stable_row_id(normalized)
        except (ValidationError, ValueError, KeyError) as exc:
            errors.append(f"Fila {index}: {exc}")
            continue
        if doc_id in seen:
            continue  # contenido idéntico repetido en el archivo
        seen.add(doc_id)
        rows.append((doc_id, normalized))
    return rows, errors, schema


_DB = None


def _get_db():
    global _DB
    if _DB is None:
        from firebase_admin import firestore as admin_firestore
        from firebase_admin import initialize_app

        initialize_app()
        _DB = admin_firestore.client()
    return _DB


def backfill_source(value: str) -> tuple[int, int]:
    """Asigna `source` a los documentos que no lo tengan. Devuelve (revisados, actualizados)."""
    db = _get_db()
    collection = db.collection(COLLECTION)
    checked = 0
    updated = 0
    batch = db.batch()
    pending = 0
    for doc in collection.stream():
        checked += 1
        data = doc.to_dict() or {}
        if data.get("source"):
            continue
        batch.update(doc.reference, {"source": value})
        updated += 1
        pending += 1
        if pending >= 400:
            batch.commit()
            batch = db.batch()
            pending = 0
    if pending:
        batch.commit()
    return checked, updated


def count_by_source(value: str) -> int:
    db = _get_db()
    try:
        return int(db.collection(COLLECTION).where("source", "==", value).count().get()[0][0].value)
    except Exception:
        return -1


def delete_all() -> int:
    db = _get_db()
    collection = db.collection(COLLECTION)
    deleted = 0
    batch = db.batch()
    pending = 0
    for doc in collection.stream():
        batch.delete(doc.reference)
        pending += 1
        deleted += 1
        if pending >= 400:
            batch.commit()
            batch = db.batch()
            pending = 0
    if pending:
        batch.commit()
    return deleted


def upload(rows: list[tuple[str, dict]]) -> int:
    db = _get_db()
    collection = db.collection(COLLECTION)
    batch = db.batch()
    pending = 0
    written = 0
    for doc_id, payload in rows:
        batch.set(collection.document(doc_id), payload)  # upsert idempotente
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
    parser = argparse.ArgumentParser(description="Sube incidentes con IDs deterministas (idempotente).")
    parser.add_argument("--csv", type=Path, default=REPO_ROOT / "crime_incidents_lima_real_1000.csv")
    parser.add_argument("--replace", action="store_true", help="Borra la colección antes de subir (normaliza IDs).")
    parser.add_argument("--verify", action="store_true", help="Cuenta documentos al final.")
    parser.add_argument(
        "--backfill-source",
        metavar="VALOR",
        default=None,
        help="Asigna `source` a los documentos que no lo tengan (p. ej. modalidad) y termina.",
    )
    args = parser.parse_args()

    if args.backfill_source:
        checked, updated = backfill_source(args.backfill_source)
        print(
            f"Backfill: {updated} documentos actualizados de {checked} revisados "
            f"(source='{args.backfill_source}')."
        )
        if args.verify:
            for value in ("inei", "modalidad"):
                print(f"  documentos con source='{value}': {count_by_source(value)}")
            print(f"  total en la colección: {verify_collection()}")
        return 0

    rows, errors, schema = load_rows(args.csv)
    print(
        f"CSV: {args.csv.name} -> {len(rows)} filas válidas (ids únicos), "
        f"{len(errors)} errores de validación (esquema: {schema})."
    )
    for error in errors[:5]:
        print("  ", error)

    if args.replace:
        deleted = delete_all()
        print(f"Reemplazo: {deleted} documentos anteriores eliminados.")
    written = upload(rows)
    print(f"Firestore: {written} documentos escritos con upsert (ID determinista).")

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "csv": args.csv.name,
        "schema": schema,
        "rows": len(rows),
        "errors": errors,
        "collection": COLLECTION,
        "written": written,
    }
    if args.verify:
        total = verify_collection()
        report["collection_count"] = total
        print(f"Verificación: {total} documentos en '{COLLECTION}'.")

    report_path = REPO_ROOT / "data" / "processed" / "incidents_upload_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Reporte: {report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
