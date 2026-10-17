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

from incidents_dataset import (  # noqa: E402
    ARCGIS_CANONICAL_KEYS,
    ARCGIS_SOURCE,
    CANONICAL_KEYS,
    COLLECTION,
    detect_schema,
    fnv1a64_hex,
    load_rows,
    normalize_arcgis_row,
    normalize_row,
    stable_arcgis_row_id,
    stable_row_id,
)

PIPELINE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PIPELINE_DIR.parents[1]


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
