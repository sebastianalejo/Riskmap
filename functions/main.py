"""Firebase Cloud Functions (Gen 2) — predicción y entrenamiento sin Django."""

from __future__ import annotations

import io
import json
import os
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

import joblib
import pandas as pd
from firebase_admin import auth, firestore, initialize_app
from firebase_functions import https_fn, options

from crime_ml import validation
from crime_ml.pipeline import FEATURES, TARGET, CrimeRiskPipelineCore

initialize_app()

INCIDENTS_COLLECTION = os.environ.get("INCIDENTS_COLLECTION", "crime_incidents")

# API pública INEI DataCrime (módulo ciudadano) — mismo backend que https://datacrim.inei.gob.pe/ciudadano/
DATACRIM_API_V1 = "https://datacrim.inei.gob.pe/ciudadano/api/v1/"
# ArcGIS MapServer de puntos de delitos (capas por año/modalidad).
ARCGIS_PUNTOS_CIUDADANO_MS = (
    "https://arcgis3.inei.gob.pe:6443/arcgis/rest/services/Datacrim/"
    "DATACRIM005_AGS_PUNTOSDELITOS_CIUDADANO/MapServer"
)


def _http_get_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": "RiskmapCloudFn/1.0 (INEI proxy)"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8")
        except Exception:
            body = str(e)
        raise ValueError(f"HTTP {e.code}: {body[:800]}") from e
# Modelo .joblib troceado en Firestore (evita usar Firebase Storage / tarjeta).
ML_PARTS_COLLECTION = os.environ.get("ML_PARTS_COLLECTION", "ml_model_parts")
_CHUNK_SIZE = 750_000  # < 1 MiB por campo (límite documento Firestore)

_cors = options.CorsOptions(
    cors_origins=["*"],
    cors_methods=["GET", "POST", "OPTIONS"],
    cors_allow_headers=["Authorization", "Content-Type"],
)


def _json_response(payload: dict[str, Any], status: int = 200) -> https_fn.Response:
    return https_fn.Response(
        json.dumps(payload, default=str),
        status=status,
        headers={"Content-Type": "application/json; charset=utf-8"},
    )


def _verify_user(req: https_fn.Request) -> dict[str, Any] | None:
    auth_header = req.headers.get("Authorization") or ""
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header.split("Bearer ", 1)[1].strip()
    if not token:
        return None
    try:
        return auth.verify_id_token(token)
    except Exception:
        return None


def _clear_ml_parts(db: Any) -> None:
    for doc in db.collection(ML_PARTS_COLLECTION).stream():
        doc.reference.delete()


def _save_model_to_firestore(local_path: Path) -> dict[str, Any]:
    data = local_path.read_bytes()
    db = firestore.client()
    _clear_ml_parts(db)
    chunks = [data[i : i + _CHUNK_SIZE] for i in range(0, len(data), _CHUNK_SIZE)]
    batch = db.batch()
    n_batch = 0
    for i, chunk in enumerate(chunks):
        ref = db.collection(ML_PARTS_COLLECTION).document(str(i))
        batch.set(ref, {"data": chunk})
        n_batch += 1
        if n_batch >= 400:
            batch.commit()
            batch = db.batch()
            n_batch = 0
    meta_ref = db.collection(ML_PARTS_COLLECTION).document("_meta")
    batch.set(meta_ref, {"chunk_count": len(chunks), "bytes": len(data)})
    batch.commit()
    return {"stored_bytes": len(data), "chunks": len(chunks), "store": "firestore"}


def _load_model_from_firestore(dest: Path) -> bool:
    db = firestore.client()
    meta = db.collection(ML_PARTS_COLLECTION).document("_meta").get()
    if not meta.exists:
        return False
    md = meta.to_dict() or {}
    n = int(md.get("chunk_count", 0))
    if n <= 0:
        return False
    parts: list[bytes] = []
    for i in range(n):
        doc = db.collection(ML_PARTS_COLLECTION).document(str(i)).get()
        if not doc.exists:
            return False
        chunk = (doc.to_dict() or {}).get("data")
        if chunk is None:
            return False
        parts.append(chunk if isinstance(chunk, (bytes, bytearray)) else bytes(chunk))
    dest.write_bytes(b"".join(parts))
    return True


def _model_exists_in_firestore() -> bool:
    db = firestore.client()
    meta = db.collection(ML_PARTS_COLLECTION).document("_meta").get()
    return bool(meta.exists)


def _firestore_rows() -> list[dict[str, Any]]:
    db = firestore.client()
    snap = db.collection(INCIDENTS_COLLECTION).stream()
    rows: list[dict[str, Any]] = []
    for doc in snap:
        data = doc.to_dict()
        if data:
            rows.append(data)
    return rows


@https_fn.on_request(cors=_cors)
def prediction_health(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response("", status=204)

    if req.method != "GET":
        return _json_response({"detail": "Usa GET"}, status=405)

    exists = _model_exists_in_firestore()

    loadable = False
    model_error: str | None = None
    local_path = Path(tempfile.gettempdir()) / CrimeRiskPipelineCore.model_filename

    if exists:
        try:
            if _load_model_from_firestore(local_path):
                joblib.load(local_path)
                loadable = True
            else:
                model_error = "No se pudieron leer los trozos del modelo en Firestore."
        except Exception as exc:
            model_error = str(exc)
            loadable = False

    status_ok = exists and loadable
    return _json_response(
        {
            "status": "ok" if status_ok else "not_ready",
            "model_exists": exists,
            "model_loadable": loadable,
            "model_path": f"firestore/{ML_PARTS_COLLECTION}",
            "model_error": model_error,
            "backend": "firebase",
            "store": "firestore",
        },
        status=200,
    )


@https_fn.on_request(cors=_cors)
def predict_crime(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response("", status=204)

    user = _verify_user(req)
    if not user:
        return _json_response({"detail": "Se requiere Firebase ID token (Authorization: Bearer)."}, status=401)

    if req.method == "GET":
        return _json_response(
            {
                "detail": "Usa POST para predecir.",
                "required_fields": {
                    "crime_type": "str",
                    "hour": "int (0-23)",
                    "day_of_week": "str",
                    "district": "str",
                    "latitude": "float",
                    "longitude": "float",
                    "historical_frequency": "int (>=1)",
                },
            },
            status=200,
        )

    if req.method != "POST":
        return _json_response({"detail": "Método no permitido"}, status=405)

    try:
        body = req.get_json(silent=True) or {}
    except Exception:
        return _json_response({"detail": "JSON inválido"}, status=400)

    if not isinstance(body, dict):
        return _json_response({"detail": "El cuerpo debe ser un objeto JSON."}, status=400)

    try:
        features = validation.validate_predict_payload(body, FEATURES)
    except validation.ValidationError as exc:
        return _json_response({"detail": str(exc)}, status=400)
    local_path = Path(tempfile.gettempdir()) / CrimeRiskPipelineCore.model_filename

    if not _model_exists_in_firestore():
        return _json_response({"detail": "Modelo no entrenado (Firestore vacío)."}, status=400)

    try:
        if not _load_model_from_firestore(local_path):
            return _json_response({"detail": "No se pudo reconstruir el modelo desde Firestore."}, status=500)
        prediction = CrimeRiskPipelineCore.predict(features, local_path)
    except FileNotFoundError as exc:
        return _json_response({"detail": str(exc)}, status=400)
    except Exception as exc:
        return _json_response({"detail": str(exc)}, status=500)

    return _json_response(
        {
            "prediction": prediction,
            "target": TARGET,
            "classes": ["bajo", "medio", "alto"],
        },
        status=200,
    )


@https_fn.on_request(cors=_cors)
def train_model(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response("", status=204)

    user = _verify_user(req)
    if not user:
        return _json_response({"detail": "Se requiere Firebase ID token."}, status=401)

    if req.method == "GET":
        return _json_response(
            {
                "detail": "POST para entrenar. Opcional: test_size, dataset (array de filas), o usar solo Firestore.",
                "collection": INCIDENTS_COLLECTION,
                "optional_fields": {"test_size": "float 0.05–0.45", "dataset": "array de objetos con columnas del modelo"},
            },
            status=200,
        )

    if req.method != "POST":
        return _json_response({"detail": "Método no permitido"}, status=405)

    try:
        body = req.get_json(silent=True) or {}
    except Exception:
        return _json_response({"detail": "JSON inválido"}, status=400)

    if not isinstance(body, dict):
        return _json_response({"detail": "El cuerpo debe ser un objeto JSON."}, status=400)

    try:
        test_size = validation.parse_test_size(body.get("test_size", 0.2))
    except validation.ValidationError as exc:
        return _json_response({"detail": str(exc)}, status=400)

    rows: list[dict[str, Any]] | None = body.get("dataset")
    if rows is not None:
        try:
            rows = validation.validate_dataset_rows(rows)
        except validation.ValidationError as exc:
            return _json_response({"detail": str(exc)}, status=400)
        data = pd.DataFrame(rows)
    else:
        rows_fs = _firestore_rows()
        if not rows_fs:
            return _json_response(
                {
                    "detail": "No hay datos: envía dataset en el POST o pobla la colección Firestore.",
                },
                status=400,
            )
        data = pd.DataFrame(rows_fs)

    local_path = Path(tempfile.gettempdir()) / CrimeRiskPipelineCore.model_filename

    try:
        result = CrimeRiskPipelineCore.train_from_dataframe(data, test_size=test_size, artifact_path=local_path)
    except ValueError as exc:
        return _json_response({"detail": str(exc)}, status=400)

    fs_meta = _save_model_to_firestore(local_path)
    result["store"] = fs_meta.get("store")
    result["stored_bytes"] = fs_meta.get("stored_bytes")
    result["chunks"] = fs_meta.get("chunks")
    result["backend"] = "firebase"
    return _json_response(result, status=200)


@https_fn.on_request(cors=_cors)
def import_incidents(req: https_fn.Request) -> https_fn.Response:
    """Carga filas en Firestore (mismo esquema que CrimeIncident). Útil antes de entrenar sin dataset inline."""
    if req.method == "OPTIONS":
        return https_fn.Response("", status=204)

    user = _verify_user(req)
    if not user:
        return _json_response({"detail": "Se requiere Firebase ID token."}, status=401)

    if req.method != "POST":
        return _json_response({"detail": "Usa POST"}, status=405)

    try:
        body = req.get_json(silent=True) or {}
    except Exception:
        return _json_response({"detail": "JSON inválido"}, status=400)

    if not isinstance(body, dict):
        return _json_response({"detail": "El cuerpo debe ser un objeto JSON."}, status=400)

    try:
        rows = validation.validate_import_rows(body.get("rows"))
    except validation.ValidationError as exc:
        return _json_response({"detail": str(exc)}, status=400)

    db = firestore.client()
    batch = db.batch()
    count = 0
    total_written = 0

    for row in rows:
        missing = [k for k in FEATURES + [TARGET] if k not in row]
        if missing:
            return _json_response({"detail": f"Fila incompleta, faltan: {missing}", "row_sample": row}, status=400)

        doc_id = str(row.get("incident_id") or uuid.uuid4())
        ref = db.collection(INCIDENTS_COLLECTION).document(doc_id)
        batch.set(ref, {k: row[k] for k in FEATURES + [TARGET]})
        count += 1
        total_written += 1

        if count >= 400:
            batch.commit()
            batch = db.batch()
            count = 0

    if count > 0:
        batch.commit()

    return _json_response({"written": total_written, "collection": INCIDENTS_COLLECTION}, status=200)


@https_fn.on_request(cors=_cors)
def import_csv_dataset(req: https_fn.Request) -> https_fn.Response:
    """POST multipart/form-data con campo 'file' (CSV) — inserta en Firestore."""
    if req.method == "OPTIONS":
        return https_fn.Response("", status=204)

    user = _verify_user(req)
    if not user:
        return _json_response({"detail": "Se requiere Firebase ID token."}, status=401)

    if req.method != "POST":
        return _json_response({"detail": "Usa POST multipart"}, status=405)

    # Gen2 puede exponer el cuerpo como stream; simplificamos con JSON base64 opcional
    try:
        body = req.get_json(silent=True) or {}
    except Exception:
        body = {}

    if not isinstance(body, dict):
        body = {}

    try:
        csv_text = validation.validate_csv_text(body.get("csv_text"))
    except validation.ValidationError as exc:
        return _json_response({"detail": str(exc)}, status=400)

    try:
        data = pd.read_csv(io.StringIO(csv_text))
    except Exception as exc:
        return _json_response({"detail": f"CSV inválido: {exc}"}, status=400)

    missing = set(FEATURES + [TARGET]) - set(data.columns)
    if missing:
        return _json_response({"detail": f"Faltan columnas: {sorted(missing)}"}, status=400)

    if len(data) > validation.MAX_ROWS_IMPORT:
        return _json_response(
            {"detail": f"El CSV excede el máximo de {validation.MAX_ROWS_IMPORT} filas."},
            status=400,
        )

    rows = data.to_dict(orient="records")
    db = firestore.client()
    batch = db.batch()
    count = 0
    total = 0
    for i, row in enumerate(rows):
        doc_id = str(row.get("incident_id") or f"csv_{i}")
        ref = db.collection(INCIDENTS_COLLECTION).document(doc_id)
        payload = {k: row[k] for k in FEATURES + [TARGET]}
        batch.set(ref, payload)
        count += 1
        total += 1
        if count >= 400:
            batch.commit()
            batch = db.batch()
            count = 0
    if count > 0:
        batch.commit()

    return _json_response({"written": total, "collection": INCIDENTS_COLLECTION}, status=200)


@https_fn.on_request(cors=_cors)
def inei_datacrim_aggregate(req: https_fn.Request) -> https_fn.Response:
    """Proxy GET → INEI `delitos/aggregate/{ubigeo}/` (serie anual de cantidades por distrito)."""
    if req.method == "OPTIONS":
        return https_fn.Response("", status=204)

    user = _verify_user(req)
    if not user:
        return _json_response({"detail": "Se requiere Firebase ID token."}, status=401)

    if req.method != "GET":
        return _json_response({"detail": "Usa GET"}, status=405)

    ubigeo = (req.args.get("ubigeo") or "").strip()
    if len(ubigeo) != 6 or not ubigeo.isdigit():
        return _json_response({"detail": "Parámetro ubigeo requerido (6 dígitos, ej. 150101 Lima Cercado)."}, status=400)

    url = f"{DATACRIM_API_V1}delitos/aggregate/{urllib.parse.quote(ubigeo, safe='')}/"
    try:
        data = _http_get_json(url)
    except ValueError as exc:
        return _json_response({"detail": str(exc)}, status=502)

    return https_fn.Response(
        json.dumps(data, default=str),
        status=200,
        headers={"Content-Type": "application/json; charset=utf-8"},
    )


@https_fn.on_request(cors=_cors)
def inei_arcgis_points(req: https_fn.Request) -> https_fn.Response:
    """Proxy GET → consulta ArcGIS /layer/query con sobre espacial (evita bloqueos CORS del navegador)."""
    if req.method == "OPTIONS":
        return https_fn.Response("", status=204)

    user = _verify_user(req)
    if not user:
        return _json_response({"detail": "Se requiere Firebase ID token."}, status=401)

    if req.method != "GET":
        return _json_response({"detail": "Usa GET"}, status=405)

    # Capa por defecto 107 ≈ modalidad 2022 «Robo agravado» (ver MapServer INEI).
    try:
        layer = validation.validate_layer(req.args.get("layer") or "107")
        xmin, ymin, xmax, ymax = validation.validate_bbox(
            req.args.get("xmin"),
            req.args.get("ymin"),
            req.args.get("xmax"),
            req.args.get("ymax"),
        )
    except validation.ValidationError as exc:
        return _json_response({"detail": str(exc)}, status=400)
    lim = validation.parse_limit(req.args.get("limit") or "400")

    params = {
        "geometry": f"{xmin},{ymin},{xmax},{ymax}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "where": "1=1",
        # Todas las columnas (varían por año/capa del MapServer).
        "outFields": "*",
        "returnGeometry": "true",
        "f": "json",
        "resultRecordCount": str(lim),
    }
    qs = urllib.parse.urlencode(params)
    url = f"{ARCGIS_PUNTOS_CIUDADANO_MS}/{layer}/query?{qs}"
    try:
        data = _http_get_json(url)
    except ValueError as exc:
        return _json_response({"detail": str(exc)}, status=502)

    return https_fn.Response(
        json.dumps(data, default=str),
        status=200,
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
