"""Doble de prueba mínimo del cliente de Firestore.

Implementa solo lo que usa `crime_ml/artifacts.py`:
  collection().document().get()/set()/delete()/create()/collection().stream() y batch().

Los documentos se almacenan por (ruta_de_colección, id), de modo que las
subcolecciones (p. ej. `<run>/chunks/0`) conviven con los documentos raíz.
"""

from __future__ import annotations

from typing import Any


class FakeAlreadyExists(Exception):
    """Equivalente a google.api_core.exceptions.AlreadyExists en `create()`."""


class FakeDocument:
    """Sirve a la vez de referencia (`set/delete/create`) y de snapshot (`get/to_dict/exists`)."""

    def __init__(self, db: FakeFirestore, collection_path: str, doc_id: str) -> None:
        self._db = db
        self._collection_path = collection_path
        self._doc_id = doc_id

    # ── snapshot ────────────────────────────────────────────────────────────
    @property
    def id(self) -> str:
        return self._doc_id

    @property
    def reference(self) -> FakeDocument:
        return self

    @property
    def exists(self) -> bool:
        return (self._collection_path, self._doc_id) in self._db.docs

    def to_dict(self) -> dict[str, Any] | None:
        data = self._db.docs.get((self._collection_path, self._doc_id))
        return dict(data) if data is not None else None

    def get(self) -> FakeDocument:
        return self

    # ── referencia ──────────────────────────────────────────────────────────
    def set(self, data: dict[str, Any]) -> None:
        self._db.docs[(self._collection_path, self._doc_id)] = dict(data)

    def delete(self) -> None:
        self._db.docs.pop((self._collection_path, self._doc_id), None)

    def create(self, data: dict[str, Any]) -> None:
        if self.exists:
            raise FakeAlreadyExists(f"Documento existente: {self._collection_path}/{self._doc_id}")
        self.set(data)

    def collection(self, name: str) -> FakeCollection:
        return FakeCollection(self._db, f"{self._collection_path}/{self._doc_id}/{name}")


class FakeCollection:
    def __init__(self, db: FakeFirestore, path: str) -> None:
        self._db = db
        self._path = path

    def document(self, doc_id: str) -> FakeDocument:
        return FakeDocument(self._db, self._path, str(doc_id))

    def stream(self) -> list[FakeDocument]:
        keys = sorted(
            (path, doc_id) for (path, doc_id) in self._db.docs if path == self._path
        )
        return [FakeDocument(self._db, path, doc_id) for (path, doc_id) in keys]


class FakeBatch:
    def __init__(self, db: FakeFirestore) -> None:
        self._db = db
        self._ops: list[tuple[str, FakeDocument, dict[str, Any] | None]] = []

    def set(self, ref: FakeDocument, data: dict[str, Any]) -> None:
        self._ops.append(("set", ref, data))

    def delete(self, ref: FakeDocument) -> None:
        self._ops.append(("delete", ref, None))

    def commit(self) -> None:
        for op, ref, data in self._ops:
            if op == "set" and data is not None:
                ref.set(data)
            else:
                ref.delete()
        self._ops.clear()
        self._db.batch_commits += 1


class FakeFirestore:
    def __init__(self) -> None:
        self.docs: dict[tuple[str, str], dict[str, Any]] = {}
        self.batch_commits = 0

    def collection(self, name: str) -> FakeCollection:
        return FakeCollection(self, name)

    def batch(self) -> FakeBatch:
        return FakeBatch(self)
