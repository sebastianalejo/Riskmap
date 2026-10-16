"""Pruebas de `crime_ml/artifacts.py` (Fase 2) con un doble de Firestore."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from fake_firestore import FakeFirestore

COLLECTION = "ml_model_parts"
T0 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


def test_save_y_load_roundtrip(artifacts, tmp_path):
    db = FakeFirestore()
    data = b"modelo-de-prueba" * 3

    meta = artifacts.save_artifact(db, data, collection=COLLECTION, run_id="run1", chunk_size=10)
    assert meta["run_id"] == "run1"
    assert meta["chunks"] == 5
    assert meta["bytes"] == len(data)

    dest = tmp_path / "model.joblib"
    loaded = artifacts.load_artifact(db, dest, collection=COLLECTION)
    assert loaded is not None
    assert loaded["layout"] == "run"
    assert loaded["run_id"] == "run1"
    assert dest.read_bytes() == data


def test_puntero_apunta_al_run_nuevo(artifacts):
    db = FakeFirestore()
    artifacts.save_artifact(db, b"a" * 20, collection=COLLECTION, run_id="run1", chunk_size=10)
    artifacts.save_artifact(db, b"b" * 30, collection=COLLECTION, run_id="run2", chunk_size=10)

    pointer = db.collection(COLLECTION).document("_meta").get().to_dict()
    assert pointer is not None and pointer["current_run"] == "run2"
    assert pointer["chunk_count"] == 3


def test_run_anterior_se_limpia(artifacts):
    db = FakeFirestore()
    artifacts.save_artifact(db, b"a" * 20, collection=COLLECTION, run_id="run1", chunk_size=10)
    artifacts.save_artifact(db, b"b" * 30, collection=COLLECTION, run_id="run2", chunk_size=10)

    assert not db.collection(COLLECTION).document("run1").get().exists
    assert not db.collection(COLLECTION).document("run1").collection("chunks").document("0").get().exists
    assert db.collection(COLLECTION).document("run2").get().exists
    assert db.collection(COLLECTION).document("run2").collection("chunks").document("2").get().exists


def test_trozos_legados_se_limpian(artifacts):
    db = FakeFirestore()
    db.collection(COLLECTION).document("0").set({"data": b"viejo"})
    db.collection(COLLECTION).document("1").set({"data": b"viejo"})
    db.collection(COLLECTION).document("_meta").set({"chunk_count": 2, "bytes": 10})

    artifacts.save_artifact(db, b"nuevo", collection=COLLECTION, run_id="runN", chunk_size=8)

    assert not db.collection(COLLECTION).document("0").get().exists
    assert not db.collection(COLLECTION).document("1").get().exists


def test_metadata_del_run_se_guarda(artifacts, tmp_path):
    db = FakeFirestore()
    artifacts.save_artifact(
        db,
        b"x" * 5,
        collection=COLLECTION,
        run_id="run1",
        metadata={"metrics": {"accuracy": 0.9}, "trained_by": "uid-1"},
    )

    run_doc = db.collection(COLLECTION).document("run1").get().to_dict()
    assert run_doc is not None
    assert run_doc["metrics"] == {"accuracy": 0.9}
    assert run_doc["trained_by"] == "uid-1"
    assert "created_at" in run_doc

    loaded = artifacts.load_artifact(db, tmp_path / "m.bin", collection=COLLECTION)
    assert loaded is not None
    assert loaded["saved_at"] == run_doc["created_at"]


def test_load_layout_legado(artifacts, tmp_path):
    db = FakeFirestore()
    db.collection(COLLECTION).document("0").set({"data": b"AB"})
    db.collection(COLLECTION).document("1").set({"data": b"CD"})
    db.collection(COLLECTION).document("_meta").set({"chunk_count": 2, "bytes": 4})

    dest = tmp_path / "m.bin"
    loaded = artifacts.load_artifact(db, dest, collection=COLLECTION)
    assert loaded is not None
    assert loaded["layout"] == "legacy"
    assert loaded["run_id"] is None
    assert dest.read_bytes() == b"ABCD"


def test_load_incompleto_devuelve_none(artifacts, tmp_path):
    db = FakeFirestore()
    db.collection(COLLECTION).document("_meta").set({"chunk_count": 2, "bytes": 4})
    db.collection(COLLECTION).document("0").set({"data": b"AB"})
    # falta el trozo 1

    assert artifacts.load_artifact(db, tmp_path / "m.bin", collection=COLLECTION) is None


def test_load_sin_meta_devuelve_none(artifacts, tmp_path):
    db = FakeFirestore()
    assert artifacts.load_artifact(db, tmp_path / "m.bin", collection=COLLECTION) is None


def test_artifact_exists(artifacts):
    db = FakeFirestore()
    assert artifacts.artifact_exists(db, collection=COLLECTION) is False

    db.collection(COLLECTION).document("_meta").set({"chunk_count": 1, "bytes": 1})
    assert artifacts.artifact_exists(db, collection=COLLECTION) is True

    db2 = FakeFirestore()
    artifacts.save_artifact(db2, b"x", collection=COLLECTION, run_id="r")
    assert artifacts.artifact_exists(db2, collection=COLLECTION) is True


def test_lotes_respetan_limite_de_bytes(artifacts):
    db = FakeFirestore()
    # 30 bytes en trozos de 10 con límite de 15 por lote → grupos [10, 10] + [10] = 2 commits.
    artifacts.save_artifact(db, b"0" * 30, collection=COLLECTION, chunk_size=10, max_batch_bytes=15)
    assert db.batch_commits == 2


def test_lote_unico_si_cabe(artifacts):
    db = FakeFirestore()
    artifacts.save_artifact(db, b"0" * 30, collection=COLLECTION, chunk_size=10, max_batch_bytes=10_000)
    assert db.batch_commits == 1


def test_artefacto_vacio_rechazado(artifacts):
    db = FakeFirestore()
    with pytest.raises(artifacts.ArtifactError):
        artifacts.save_artifact(db, b"", collection=COLLECTION)


# ── candado de entrenamiento ─────────────────────────────────────────────────


def test_lock_bloquea_concurrencia(artifacts):
    db = FakeFirestore()
    artifacts.acquire_training_lock(db, collection=COLLECTION, now=T0)

    with pytest.raises(artifacts.TrainingInProgress):
        artifacts.acquire_training_lock(db, collection=COLLECTION, now=T0 + timedelta(minutes=5))

    artifacts.release_training_lock(db, collection=COLLECTION)
    artifacts.acquire_training_lock(db, collection=COLLECTION, now=T0 + timedelta(minutes=6))


def test_lock_abandonado_se_reemplaza(artifacts):
    db = FakeFirestore()
    artifacts.acquire_training_lock(db, collection=COLLECTION, now=T0)

    # Dos horas después, el candado viejo se considera abandonado.
    stamp = artifacts.acquire_training_lock(db, collection=COLLECTION, now=T0 + timedelta(hours=2))
    assert stamp == (T0 + timedelta(hours=2)).isoformat()


def test_lock_corrupto_se_reemplaza(artifacts):
    db = FakeFirestore()
    db.collection(COLLECTION).document("_training_lock").set({"started_at": "no-es-fecha"})
    artifacts.acquire_training_lock(db, collection=COLLECTION, now=T0)  # no debe lanzar


def test_lock_no_interfiere_con_el_artefacto(artifacts, tmp_path):
    db = FakeFirestore()
    artifacts.save_artifact(db, b"datos", collection=COLLECTION, run_id="run1")
    artifacts.acquire_training_lock(db, collection=COLLECTION, now=T0)

    loaded = artifacts.load_artifact(db, tmp_path / "m.bin", collection=COLLECTION)
    assert loaded is not None and loaded["run_id"] == "run1"
