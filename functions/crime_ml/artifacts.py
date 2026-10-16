"""Almacenamiento versionado del artefacto ML en Firestore (Fase 2).

Motivación (hallazgo SEC-4 de la auditoría): el esquema anterior borraba todos
los trozos antes de escribir los nuevos, de modo que un `predict_crime`
concurrente podía leer un artefacto mezclado o quedarse sin modelo. Aquí el
cambio de modelo es atómico:

Layout nuevo (un "run" por entrenamiento):

    <colección>/_meta                    → puntero {current_run, bytes, chunk_count, updated_at}
    <colección>/_training_lock           → candado de entrenamiento en curso
    <colección>/<run_id>                 → metadatos del run (métricas, fecha, autor, versión de sklearn)
    <colección>/<run_id>/chunks/<i>      → trozos binarios del .joblib

Guardar escribe primero todos los trozos del run nuevo y, solo al final, una
única escritura actualiza el puntero: los lectores ven íntegro el run viejo o
el nuevo, nunca una mezcla. La limpieza de runs anteriores es best-effort.

Layout legado (solo lectura, compatibilidad con artefactos ya desplegados):
    <colección>/<i> + <colección>/_meta {chunk_count, bytes}

Sin dependencias de Firebase para poder probarse con un doble (`functions/tests/fake_firestore.py`).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_CHUNK_SIZE = 750_000  # < 1 MiB por documento (límite de Firestore)
MAX_BATCH_BYTES = 8_000_000   # margen bajo el límite de ~10 MiB por commit
MAX_BATCH_OPS = 400           # margen bajo el límite de 500 operaciones por batch
META_DOC = "_meta"
LOCK_DOC = "_training_lock"
STALE_LOCK_SECONDS = 3600     # un candado más viejo que esto se considera abandonado


class ArtifactError(RuntimeError):
    """Error al guardar o cargar el artefacto."""


class TrainingInProgress(ArtifactError):
    """Ya hay un entrenamiento en curso (o un candado reciente)."""

    def __init__(self, started_at: str | None) -> None:
        super().__init__(f"Entrenamiento en curso desde {started_at or 'una fecha desconocida'}.")
        self.started_at = started_at


def split_chunks(data: bytes, chunk_size: int = DEFAULT_CHUNK_SIZE) -> list[bytes]:
    """Divide el artefacto en trozos de tamaño `chunk_size`."""
    if chunk_size <= 0:
        raise ValueError("chunk_size debe ser positivo")
    return [data[i : i + chunk_size] for i in range(0, len(data), chunk_size)]


def _write_chunks(db: Any, collection: str, run_id: str, chunks: list[bytes], max_batch_bytes: int) -> None:
    """Escribe los trozos en lotes acotados por bytes y operaciones."""
    col = db.collection(collection)
    batch = db.batch()
    pending_bytes = 0
    pending_ops = 0
    for i, chunk in enumerate(chunks):
        ref = col.document(run_id).collection("chunks").document(str(i))
        batch.set(ref, {"data": chunk})
        pending_bytes += len(chunk)
        pending_ops += 1
        if pending_bytes >= max_batch_bytes or pending_ops >= MAX_BATCH_OPS:
            batch.commit()
            batch = db.batch()
            pending_bytes = 0
            pending_ops = 0
    if pending_ops:
        batch.commit()


def _cleanup_others(db: Any, collection: str, keep_run_id: str) -> None:
    """Elimina (best-effort) runs anteriores y trozos del layout legado."""
    try:
        col = db.collection(collection)
        for doc in list(col.stream()):
            if doc.id in (META_DOC, LOCK_DOC, keep_run_id):
                continue
            if doc.id.isdigit():  # trozo del layout legado
                doc.reference.delete()
                continue
            data = doc.to_dict() or {}
            chunk_count = int(data.get("chunk_count", 0))
            for i in range(chunk_count):
                doc.reference.collection("chunks").document(str(i)).delete()
            doc.reference.delete()
    except Exception:  # pragma: no cover - la limpieza nunca debe tumbar un guardado correcto
        logger.warning("No se pudieron limpiar runs anteriores de %s", collection, exc_info=True)


def save_artifact(
    db: Any,
    data: bytes,
    *,
    collection: str,
    run_id: str | None = None,
    metadata: dict[str, Any] | None = None,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    max_batch_bytes: int = MAX_BATCH_BYTES,
) -> dict[str, Any]:
    """Guarda el artefacto con swap atómico del puntero.

    Devuelve {run_id, bytes, chunks, saved_at, store}.
    """
    if not data:
        raise ArtifactError("El artefacto está vacío.")

    run_id = run_id or uuid.uuid4().hex
    chunks = split_chunks(data, chunk_size)
    saved_at = datetime.now(timezone.utc).isoformat()

    _write_chunks(db, collection, run_id, chunks, max_batch_bytes)

    col = db.collection(collection)
    col.document(run_id).set(
        {
            "bytes": len(data),
            "chunk_count": len(chunks),
            "created_at": saved_at,
            **(metadata or {}),
        }
    )

    # Única escritura que hace visible el run nuevo (swap atómico).
    col.document(META_DOC).set(
        {"current_run": run_id, "bytes": len(data), "chunk_count": len(chunks), "updated_at": saved_at}
    )

    _cleanup_others(db, collection, keep_run_id=run_id)

    return {"run_id": run_id, "bytes": len(data), "chunks": len(chunks), "saved_at": saved_at, "store": "firestore"}


def load_artifact(db: Any, dest: Path, *, collection: str) -> dict[str, Any] | None:
    """Reconstruye el artefacto en `dest` desde Firestore.

    Devuelve metadatos ({layout, run_id, chunk_count, bytes, saved_at}) o None
    si no hay modelo o está incompleto.
    """
    col = db.collection(collection)
    meta_doc = col.document(META_DOC).get()
    if not meta_doc.exists:
        return None
    meta = meta_doc.to_dict() or {}

    run_id = meta.get("current_run")
    if run_id:
        run_doc = col.document(run_id).get()
        if not run_doc.exists:
            return None
        run_meta = run_doc.to_dict() or {}
        chunk_count = int(run_meta.get("chunk_count", 0))
        if chunk_count <= 0:
            return None
        parts: list[bytes] = []
        for i in range(chunk_count):
            chunk_doc = col.document(run_id).collection("chunks").document(str(i)).get()
            if not chunk_doc.exists:
                return None
            chunk = (chunk_doc.to_dict() or {}).get("data")
            if chunk is None:
                return None
            parts.append(chunk if isinstance(chunk, (bytes, bytearray)) else bytes(chunk))
        dest.write_bytes(b"".join(parts))
        return {
            "layout": "run",
            "run_id": run_id,
            "chunk_count": chunk_count,
            "bytes": run_meta.get("bytes"),
            "saved_at": run_meta.get("created_at"),
        }

    # ── Layout legado (artefactos guardados antes de la Fase 2) ──────────────
    legacy_count = int(meta.get("chunk_count", 0))
    if legacy_count <= 0:
        return None
    legacy_parts: list[bytes] = []
    for i in range(legacy_count):
        doc = col.document(str(i)).get()
        if not doc.exists:
            return None
        chunk = (doc.to_dict() or {}).get("data")
        if chunk is None:
            return None
        legacy_parts.append(chunk if isinstance(chunk, (bytes, bytearray)) else bytes(chunk))
    dest.write_bytes(b"".join(legacy_parts))
    return {
        "layout": "legacy",
        "run_id": None,
        "chunk_count": legacy_count,
        "bytes": meta.get("bytes"),
        "saved_at": None,
    }


def artifact_exists(db: Any, *, collection: str) -> bool:
    """True si hay un artefacto (layout nuevo o legado) publicado en Firestore."""
    meta_doc = db.collection(collection).document(META_DOC).get()
    if not meta_doc.exists:
        return False
    meta = meta_doc.to_dict() or {}
    return bool(meta.get("current_run")) or int(meta.get("chunk_count", 0)) > 0


def _utcnow(now: datetime | None) -> datetime:
    if now is None:
        return datetime.now(timezone.utc)
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc)
    return now


def _parse_iso(text: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)


def acquire_training_lock(
    db: Any,
    *,
    collection: str,
    stale_seconds: int = STALE_LOCK_SECONDS,
    now: datetime | None = None,
) -> str:
    """Intenta tomar el candado de entrenamiento; lanza TrainingInProgress si está ocupado.

    Un candado más viejo que `stale_seconds` se considera abandonado (p. ej. una
    invocación que murió por timeout) y se puede reemplazar.
    """
    ref = db.collection(collection).document(LOCK_DOC)
    stamp = _utcnow(now).isoformat()
    try:
        ref.create({"started_at": stamp})
        return stamp
    except Exception as exc:  # AlreadyExists u otro error de creación
        snap = ref.get()
        data = (snap.to_dict() or {}) if snap.exists else {}
        started_raw = data.get("started_at")
        started = _parse_iso(started_raw) if isinstance(started_raw, str) else None
        if started is None or (_utcnow(now) - started) > timedelta(seconds=stale_seconds):
            # Candado antiguo, corrupto o desaparecido a mitad de camino: se reemplaza.
            ref.set({"started_at": stamp})
            return stamp
        raise TrainingInProgress(started_raw) from exc


def release_training_lock(db: Any, *, collection: str) -> None:
    """Libera el candado de entrenamiento (best-effort)."""
    try:
        db.collection(collection).document(LOCK_DOC).delete()
    except Exception:  # pragma: no cover
        logger.warning("No se pudo liberar el candado de entrenamiento de %s", collection, exc_info=True)
