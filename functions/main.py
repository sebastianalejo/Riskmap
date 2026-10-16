"""Firebase Cloud Functions (Gen 2) — API de datos y ML del proyecto Riskmap.

Contratos principales (Fase 4):
- `predict_crime` sirve el último modelo publicado en Firestore. El contrato de
  entrada depende de las features guardadas con el modelo (por defecto, el
  clasificador de modalidad: `district`, `latitude`, `longitude`) y la respuesta
  incluye las clases más probables.
- `train_model` (solo admin) entrena con Firestore o con `dataset` inline y una
  `task` opcional (features/target/split random-temporal-district).
- `publish_model` (solo admin) publica un artefacto `.joblib` entrenado offline
  con `scripts/pipeline/train.py`.

Infraestructura:
- CORS manual con allowlist (`CORS_ORIGINS`, por defecto solo desarrollo local).
- Logging con `request_id` y duración por petición.
- Verificación de ID tokens con `check_revoked`.
- `enforce_app_check` activable por entorno (`ENFORCE_APP_CHECK=true`).

Nota: las dependencias pesadas (pandas, scikit-learn, firebase-admin) se cargan
de forma diferida porque el descubrimiento de Functions limita el import a ~10 s.
"""

from __future__ import annotations

import functools
import io
import json
import logging
import os
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from firebase_functions import https_fn, options

from crime_ml import artifacts, validation

logger = logging.getLogger("riskmap")

INCIDENTS_COLLECTION = os.environ.get("INCIDENTS_COLLECTION", "crime_incidents")

# API pública INEI DataCrime (módulo ciudadano) — mismo backend que https://datacrim.inei.gob.pe/ciudadano/
DATACRIM_API_V1 = "https://datacrim.inei.gob.pe/ciudadano/api/v1/"
# ArcGIS MapServer de puntos de delitos (capas por año/modalidad).
ARCGIS_PUNTOS_CIUDADANO_MS = (
    "https://arcgis3.inei.gob.pe:6443/arcgis/rest/services/Datacrim/"
    "DATACRIM005_AGS_PUNTOSDELITOS_CIUDADANO/MapServer"
)

# Modelo .joblib versionado por run en Firestore (ver crime_ml/artifacts.py).
ML_PARTS_COLLECTION = os.environ.get("ML_PARTS_COLLECTION", "ml_model_parts")

# ── CORS (allowlist por entorno; sin comodín por defecto) ────────────────────
DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173,http://localhost:5174,http://localhost:5000,"
    "http://127.0.0.1:5173,http://127.0.0.1:5174"
)
_cors_origins = [
    origin.strip()
    for origin in os.environ.get("CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",")
    if origin.strip()
]
_CORS_ALLOW_METHODS = "GET, POST, OPTIONS"
_CORS_ALLOW_HEADERS = "Authorization, Content-Type, X-Request-Id"

# App Check: se activa explícitamente por entorno tras registrar la app web.
_ENFORCE_APP_CHECK = os.environ.get("ENFORCE_APP_CHECK", "false").strip().lower() == "true"


# ── Carga diferida (el descubrimiento de Functions limita el import a ~10 s) ─
_admin_cache: dict[str, Any] = {}
_ml_cache: dict[str, Any] = {}


def _admin() -> dict[str, Any]:
    """Inicializa firebase-admin una sola vez y devuelve {auth, firestore}."""
    if not _admin_cache:
        from firebase_admin import auth, firestore, initialize_app

        initialize_app()
        _admin_cache.update({"auth": auth, "firestore": firestore})
    return _admin_cache


def _firestore():
    return _admin()["firestore"].client()


def _joblib():
    if "joblib" not in _ml_cache:
        import joblib

        _ml_cache["joblib"] = joblib
    return _ml_cache["joblib"]


def _ml() -> dict[str, Any]:
    """Importa pandas y el pipeline de ML solo cuando se usan."""
    if "pd" not in _ml_cache:
        import pandas as pd

        from crime_ml.pipeline import FEATURES, TARGET, CrimeRiskPipelineCore

        _ml_cache.update({"pd": pd, "features": FEATURES, "target": TARGET, "core": CrimeRiskPipelineCore})
    return _ml_cache


def _sklearn_version() -> str:
    try:
        from importlib.metadata import version

        return version("scikit-learn")
    except Exception:
        return "desconocida"


def _cors_headers(req: https_fn.Request) -> dict[str, str]:
    origin = req.headers.get("Origin")
    if not origin:
        return {}
    if "*" in _cors_origins:
        allowed = "*"
    elif origin in _cors_origins:
        allowed = origin
    else:
        return {}
    return {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Methods": _CORS_ALLOW_METHODS,
        "Access-Control-Allow-Headers": _CORS_ALLOW_HEADERS,
        "Access-Control-Max-Age": "3600",
        "Vary": "Origin",
    }


def _instrument(name: str):
    """Envuelve un handler: CORS, request_id, logging y 500 genérico controlado."""

    def decorator(handler):
        @functools.wraps(handler)
        def wrapper(req: https_fn.Request) -> https_fn.Response:
            request_id = (req.headers.get("X-Request-Id") or uuid.uuid4().hex[:12]).strip()
            started = time.perf_counter()
            try:
                response = handler(req)
            except Exception:
                logger.exception("request_error name=%s request_id=%s", name, request_id)
                response = _json_response(
                    {"detail": "Error interno del servidor.", "request_id": request_id},
                    status=500,
                )
            for header, value in {**_cors_headers(req), "X-Request-Id": request_id}.items():
                response.headers[header] = value
            logger.info(
                "request_end name=%s status=%s duration_ms=%.1f request_id=%s",
                name,
                getattr(response, "status_code", "?"),
                (time.perf_counter() - started) * 1000,
                request_id,
            )
            return response

        return wrapper

    return decorator


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
        return _admin()["auth"].verify_id_token(token, check_revoked=True)
    except Exception:
        return None


def _require_admin(req: https_fn.Request) -> tuple[dict[str, Any] | None, https_fn.Response | None]:
    """Exige token válido y claim `admin`; devuelve (usuario, respuesta_de_error)."""
    user = _verify_user(req)
    if not user:
        return None, _json_response({"detail": "Se requiere Firebase ID token."}, status=401)
    if user.get("admin") is not True:
        return None, _json_response(
            {"detail": "Se requiere el permiso admin (custom claim) para esta operación."},
            status=403,
        )
    return user, None


def _model_artifact() -> tuple[Path, dict[str, Any] | None]:
    """Descarga el modelo publicado a un archivo temporal. Devuelve (ruta, metadatos)."""
    db = _firestore()
    if not artifacts.artifact_exists(db, collection=ML_PARTS_COLLECTION):
        return Path(""), None
    local_path = Path(tempfile.gettempdir()) / f"riskmap_{uuid.uuid4().hex}.joblib"
    meta = artifacts.load_artifact(db, local_path, collection=ML_PARTS_COLLECTION)
    if meta is None:
        return Path(""), None
    return local_path, meta


def _firestore_rows() -> list[dict[str, Any]]:
    db = _firestore()
    snap = db.collection(INCIDENTS_COLLECTION).stream()
    rows: list[dict[str, Any]] = []
    for doc in snap:
        data = doc.to_dict()
        if data:
            rows.append(data)
    return rows


@https_fn.on_request(enforce_app_check=_ENFORCE_APP_CHECK)
@_instrument("prediction_health")
def prediction_health(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response("", status=204)

    if req.method != "GET":
        return _json_response({"detail": "Usa GET"}, status=405)

    db = _firestore()
    exists = artifacts.artifact_exists(db, collection=ML_PARTS_COLLECTION)

    loadable = False
    model_error: str | None = None
    model_run: str | None = None
    model_target: str | None = None
    model_features: list[str] | None = None
    model_saved_at: str | None = None
    local_path = Path(tempfile.gettempdir()) / f"riskmap_{uuid.uuid4().hex}.joblib"

    if exists:
        try:
            meta = artifacts.load_artifact(db, local_path, collection=ML_PARTS_COLLECTION)
            if meta is None:
                model_error = "No se pudieron leer los trozos del modelo en Firestore."
            else:
                _joblib().load(local_path)
                loadable = True
                metadata = meta.get("metadata") or {}
                model_run = meta.get("run_id")
                model_target = metadata.get("target")
                model_features = metadata.get("features")
                model_saved_at = meta.get("saved_at")
        except Exception as exc:
            model_error = str(exc)
            loadable = False
        finally:
            local_path.unlink(missing_ok=True)

    status_ok = exists and loadable
    return _json_response(
        {
            "status": "ok" if status_ok else "not_ready",
            "model_exists": exists,
            "model_loadable": loadable,
            "model_path": f"firestore/{ML_PARTS_COLLECTION}",
            "model_run": model_run,
            "model_target": model_target,
            "model_features": model_features,
            "model_saved_at": model_saved_at,
            "model_error": model_error,
            "backend": "firebase",
            "store": "firestore",
        },
        status=200,
    )


@https_fn.on_request(enforce_app_check=_ENFORCE_APP_CHECK)
@_instrument("predict_crime")
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
                "example_body": {"district": "LA VICTORIA", "latitude": -12.071, "longitude": -77.02},
                "note": "El contrato exacto depende de las features del modelo publicado; consulta prediction_health.",
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

    local_path, meta = _model_artifact()
    if meta is None:
        return _json_response({"detail": "Modelo no entrenado (Firestore vacío)."}, status=400)

    metadata = meta.get("metadata") or {}
    features = metadata.get("features") or list(_ml()["features"])
    target = metadata.get("target") or _ml()["target"]

    try:
        cleaned = validation.validate_predict_payload(body, features)
    except validation.ValidationError as exc:
        return _json_response(
            {"detail": str(exc), "model_features": features},
            status=400,
        )

    try:
        ranked = _ml()["core"].predict_proba(cleaned, local_path, top_k=5)
    except FileNotFoundError as exc:
        return _json_response({"detail": str(exc)}, status=400)
    except Exception as exc:
        logger.exception("predict_failed run_id=%s", meta.get("run_id"))
        return _json_response({"detail": f"No se pudo ejecutar el modelo: {exc}"}, status=500)
    finally:
        local_path.unlink(missing_ok=True)

    return _json_response(
        {
            "predictions": [
                {"label": label, "probability": round(probability, 4)} for label, probability in ranked
            ],
            "target": target,
            "model_run": meta.get("run_id"),
            "sklearn_version": metadata.get("sklearn_version"),
            "disclaimer": (
                "Clasificador experimental de modalidad delictiva (datos INEI 2021-2024). "
                "No representa riesgo real ni probabilidad de victimización; ver MODEL_CARD."
            ),
        },
        status=200,
    )


@https_fn.on_request(
    enforce_app_check=_ENFORCE_APP_CHECK,
    memory=options.MemoryOption.GB_1,
    timeout_sec=300,
)
@_instrument("train_model")
def train_model(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response("", status=204)

    user, error = _require_admin(req)
    if error:
        return error
    assert user is not None  # _require_admin devuelve usuario cuando no hay error

    if req.method == "GET":
        return _json_response(
            {
                "detail": "POST para entrenar (requiere claim admin).",
                "optional_fields": {
                    "test_size": "float en (0,1); la API exige 0.05-0.45",
                    "dataset": "array de objetos con las columnas del modelo",
                    "task": {
                        "features": ["district", "latitude", "longitude"],
                        "target": "crime_type",
                        "split": "random | temporal | district",
                        "time_column": "columna temporal (split temporal)",
                        "group_column": "columna de grupos (split district)",
                    },
                },
                "collection": INCIDENTS_COLLECTION,
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
        task = validation.parse_task(body.get("task"))
    except validation.ValidationError as exc:
        return _json_response({"detail": str(exc)}, status=400)

    ml = _ml()
    rows: list[dict[str, Any]] | None = body.get("dataset")
    if rows is not None:
        try:
            rows = validation.validate_dataset_rows(rows)
        except validation.ValidationError as exc:
            return _json_response({"detail": str(exc)}, status=400)
        data = ml["pd"].DataFrame(rows)
    else:
        rows_fs = _firestore_rows()
        if not rows_fs:
            return _json_response(
                {
                    "detail": "No hay datos: envía dataset en el POST o pobla la colección Firestore.",
                },
                status=400,
            )
        data = ml["pd"].DataFrame(rows_fs)

    local_path = Path(tempfile.gettempdir()) / f"{ml['core'].model_filename}"
    db = _firestore()

    try:
        artifacts.acquire_training_lock(db, collection=ML_PARTS_COLLECTION)
    except artifacts.TrainingInProgress as exc:
        return _json_response(
            {"detail": f"Ya hay un entrenamiento en curso (iniciado en {exc.started_at})."},
            status=409,
        )

    try:
        try:
            result = ml["core"].train_from_dataframe(
                data,
                test_size=test_size,
                artifact_path=local_path,
                features=(task or {}).get("features"),
                target=(task or {}).get("target"),
                split=(task or {}).get("split", "random"),
                time_column=(task or {}).get("time_column"),
                group_column=(task or {}).get("group_column"),
            )
        except ValueError as exc:
            return _json_response({"detail": str(exc)}, status=400)

        fs_meta = artifacts.save_artifact(
            db,
            local_path.read_bytes(),
            collection=ML_PARTS_COLLECTION,
            metadata={
                "features": (task or {}).get("features") or list(ml["features"]),
                "target": (task or {}).get("target") or ml["target"],
                "split": result.get("split"),
                "split_info": result.get("split_info"),
                "metrics": artifacts.firestore_safe(result.get("metrics")),
                "train_size": result.get("train_size"),
                "test_size": result.get("test_size"),
                "feature_importances_top": (result.get("feature_importances") or {}).get("top", [])[:10],
                "trained_by": user.get("uid"),
                "sklearn_version": _sklearn_version(),
                "source": "train_model",
            },
        )
    finally:
        artifacts.release_training_lock(db, collection=ML_PARTS_COLLECTION)

    result["store"] = fs_meta.get("store")
    result["stored_bytes"] = fs_meta.get("bytes")
    result["chunks"] = fs_meta.get("chunks")
    result["model_run"] = fs_meta.get("run_id")
    result["backend"] = "firebase"
    return _json_response(result, status=200)


@https_fn.on_request(
    enforce_app_check=_ENFORCE_APP_CHECK,
    memory=options.MemoryOption.GB_1,
    timeout_sec=300,
)
@_instrument("publish_model")
def publish_model(req: https_fn.Request) -> https_fn.Response:
    """Publica un artefacto .joblib entrenado offline (pipeline de la Fase 3)."""
    if req.method == "OPTIONS":
        return https_fn.Response("", status=204)

    user, error = _require_admin(req)
    if error:
        return error
    assert user is not None

    if req.method == "GET":
        return _json_response(
            {
                "detail": "POST para publicar un modelo entrenado offline (requiere claim admin).",
                "required_fields": {
                    "artifact_b64": "contenido base64 del .joblib (máx. 15 MB)",
                    "features": ["district", "latitude", "longitude"],
                    "target": "crime_type",
                },
                "optional_fields": {"metrics": "objeto JSON con métricas del entrenamiento offline"},
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
        features = validation.validate_feature_list(body.get("features"))
        target = validation.validate_identifier(body.get("target"))
        artifact_bytes = validation.decode_artifact_b64(body.get("artifact_b64"))
    except validation.ValidationError as exc:
        return _json_response({"detail": str(exc)}, status=400)

    # Validación del artefacto: debe cargar y exponer clases.
    tmp_path = Path(tempfile.gettempdir()) / f"publish_{uuid.uuid4().hex}.joblib"
    tmp_path.write_bytes(artifact_bytes)
    try:
        pipeline = _joblib().load(tmp_path)
        model_step = pipeline.named_steps.get("model") if hasattr(pipeline, "named_steps") else None
        if model_step is None or not hasattr(model_step, "classes_"):
            return _json_response(
                {"detail": "El artefacto no parece un Pipeline compatible (falta el paso 'model' con clases)."},
                status=400,
            )
        classes = [str(class_name) for class_name in model_step.classes_]
    except Exception as exc:
        return _json_response(
            {"detail": f"El artefacto no es un .joblib válido: {type(exc).__name__}"},
            status=400,
        )
    finally:
        tmp_path.unlink(missing_ok=True)

    metrics = body.get("metrics") if isinstance(body.get("metrics"), dict) else None
    db = _firestore()
    fs_meta = artifacts.save_artifact(
        db,
        artifact_bytes,
        collection=ML_PARTS_COLLECTION,
        metadata={
            "features": features,
            "target": target,
            "classes": classes,
            "metrics": artifacts.firestore_safe(metrics) if metrics else None,
            "trained_by": user.get("uid"),
            "published_by": user.get("uid"),
            "sklearn_runtime": _sklearn_version(),
            "source": "publish_model",
        },
    )

    return _json_response(
        {
            "published": True,
            "model_run": fs_meta.get("run_id"),
            "stored_bytes": fs_meta.get("bytes"),
            "chunks": fs_meta.get("chunks"),
            "features": features,
            "target": target,
            "classes": classes,
        },
        status=200,
    )


@https_fn.on_request(enforce_app_check=_ENFORCE_APP_CHECK)
@_instrument("import_incidents")
def import_incidents(req: https_fn.Request) -> https_fn.Response:
    """Carga filas en Firestore (mismo esquema que CrimeIncident). Útil antes de entrenar sin dataset inline."""
    if req.method == "OPTIONS":
        return https_fn.Response("", status=204)

    _admin_user, error = _require_admin(req)
    if error:
        return error

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

    ml = _ml()
    db = _firestore()
    batch = db.batch()
    count = 0
    total_written = 0

    for i, row in enumerate(rows):
        try:
            cleaned = validation.validate_incident_row(row, ml["features"], ml["target"])
        except validation.ValidationError as exc:
            return _json_response({"detail": f"Fila {i}: {exc}"}, status=400)

        doc_id = str(row.get("incident_id") or uuid.uuid4())
        ref = db.collection(INCIDENTS_COLLECTION).document(doc_id)
        batch.set(ref, cleaned)
        count += 1
        total_written += 1

        if count >= 400:
            batch.commit()
            batch = db.batch()
            count = 0

    if count > 0:
        batch.commit()

    return _json_response({"written": total_written, "collection": INCIDENTS_COLLECTION}, status=200)


@https_fn.on_request(enforce_app_check=_ENFORCE_APP_CHECK)
@_instrument("import_csv_dataset")
def import_csv_dataset(req: https_fn.Request) -> https_fn.Response:
    """POST con JSON { csv_text } — inserta un CSV en Firestore (valida fila por fila)."""
    if req.method == "OPTIONS":
        return https_fn.Response("", status=204)

    _admin_user, error = _require_admin(req)
    if error:
        return error

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

    ml = _ml()
    try:
        data = ml["pd"].read_csv(io.StringIO(csv_text))
    except Exception as exc:
        return _json_response({"detail": f"CSV inválido: {exc}"}, status=400)

    missing = set(ml["features"] + [ml["target"]]) - set(data.columns)
    if missing:
        return _json_response({"detail": f"Faltan columnas: {sorted(missing)}"}, status=400)

    if len(data) > validation.MAX_ROWS_IMPORT:
        return _json_response(
            {"detail": f"El CSV excede el máximo de {validation.MAX_ROWS_IMPORT} filas."},
            status=400,
        )

    raw_rows = data.to_dict(orient="records")
    cleaned_rows: list[dict[str, Any]] = []
    doc_ids: list[str] = []
    for i, row in enumerate(raw_rows):
        try:
            cleaned_rows.append(validation.validate_incident_row(row, ml["features"], ml["target"]))
        except validation.ValidationError as exc:
            return _json_response({"detail": f"Fila {i + 2} del CSV: {exc}"}, status=400)
        doc_ids.append(str(row.get("incident_id") or f"csv_{i}"))

    db = _firestore()
    batch = db.batch()
    count = 0
    total = 0
    for i, row in enumerate(cleaned_rows):
        ref = db.collection(INCIDENTS_COLLECTION).document(doc_ids[i])
        batch.set(ref, row)
        count += 1
        total += 1
        if count >= 400:
            batch.commit()
            batch = db.batch()
            count = 0
    if count > 0:
        batch.commit()

    return _json_response({"written": total, "collection": INCIDENTS_COLLECTION}, status=200)


@https_fn.on_request(enforce_app_check=_ENFORCE_APP_CHECK)
@_instrument("inei_datacrim_aggregate")
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


@https_fn.on_request(enforce_app_check=_ENFORCE_APP_CHECK)
@_instrument("inei_arcgis_points")
def inei_arcgis_points(req: https_fn.Request) -> https_fn.Response:
    """Proxy GET → consulta ArcGIS /layer/query con sobre espacial (evita bloqueos CORS del navegador)."""
    if req.method == "OPTIONS":
        return https_fn.Response("", status=204)

    user = _verify_user(req)
    if not user:
        return _json_response({"detail": "Se requiere Firebase ID token."}, status=401)

    if req.method != "GET":
        return _json_response({"detail": "Usa GET"}, status=405)

    # Capa por defecto 107 ≈ modalidad 2021 «Robo agravado» (ver MapServer INEI).
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
