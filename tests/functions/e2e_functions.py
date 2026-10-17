"""Pruebas end-to-end de la API de Functions contra los emuladores de Firebase.

Verifica: CORS, autenticación, permisos admin, entrenamiento inline, publicación
de artefacto, predicción con probabilidades, importación validada, creación de
cuentas (solo admin), health y revocación de tokens.

Uso (desde la raíz del repositorio; requiere Java):

    firebase emulators:exec --only auth,firestore,functions --project demo-riskmap ^
        "python tests/functions/e2e_functions.py"

No toca ningún proyecto real (todo ocurre contra los emuladores con projectId
`demo-riskmap`).
"""

from __future__ import annotations

import base64
import io
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

PROJECT = "demo-riskmap"
AUTH = "http://127.0.0.1:9099"
FUNCTIONS = f"http://127.0.0.1:5001/{PROJECT}/us-central1"
API_KEY = "demo-api-key"

ADMIN_EMAIL = "admin-e2e@example.com"
ADMIN_PASSWORD = "secreto-admin-123"
USER_EMAIL = "usuario-e2e@example.com"
USER_PASSWORD = "secreto-user-123"

ALLOWED_ORIGIN = "http://localhost:5173"
FORBIDDEN_ORIGIN = "https://evil.example"

REPO_ROOT = Path(__file__).resolve().parents[2]

results: list[tuple[bool, str]] = []


def request(
    method: str,
    url: str,
    payload: dict | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 120,
) -> tuple[int, dict[str, str], str]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", **(headers or {})},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, dict(response.headers), response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read().decode("utf-8", errors="replace")


def check(name: str, fn) -> None:
    try:
        fn()
        results.append((True, name))
        print(f"ok   {name}")
    except AssertionError as exc:
        results.append((False, name))
        print(f"FAIL {name}\n     {exc}")
    except Exception as exc:  # noqa: BLE001
        results.append((False, name))
        print(f"FAIL {name}\n     {type(exc).__name__}: {exc}")


def auth_url(path: str) -> str:
    return f"{AUTH}/identitytoolkit.googleapis.com/v1/{path}?key={API_KEY}"


def sign_up(email: str, password: str) -> dict:
    status, _, body = request("POST", auth_url("accounts:signUp"), {"email": email, "password": password, "returnSecureToken": True})
    assert status == 200, f"signUp {status}: {body[:300]}"
    return json.loads(body)


def sign_in(email: str, password: str) -> str:
    status, _, body = request("POST", auth_url("accounts:signInWithPassword"), {"email": email, "password": password, "returnSecureToken": True})
    assert status == 200, f"signIn {status}: {body[:300]}"
    return json.loads(body)["idToken"]


def set_admin(local_id: str) -> None:
    status, _, body = request(
        "POST",
        auth_url("accounts:update"),
        {"localId": local_id, "customAttributes": json.dumps({"admin": True})},
        headers={"Authorization": "Bearer owner"},
    )
    assert status == 200, f"set claims {status}: {body[:300]}"


def set_disabled(local_id: str, disabled: bool) -> None:
    status, _, body = request(
        "POST",
        auth_url("accounts:update"),
        {"localId": local_id, "disableUser": disabled},
        headers={"Authorization": "Bearer owner"},
    )
    assert status == 200, f"disable {status}: {body[:300]}"


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def make_inline_dataset() -> list[dict]:
    """Dataset pequeño con el esquema del modelo de modalidad (3 distritos × 3 modalidades)."""
    rows = []
    districts = [("DISTRITO A", -12.05, -77.05), ("DISTRITO B", -12.10, -77.00), ("DISTRITO C", -12.15, -76.95)]
    modalities = ["hurto", "robo agravado", "estafa"]
    for i in range(60):
        district, lat, lon = districts[i % 3]
        rows.append(
            {
                "occurred_year": 2021 + (i % 4),
                "district": district,
                "latitude": round(lat + (i % 7) * 0.001, 6),
                "longitude": round(lon + (i % 5) * 0.001, 6),
                "crime_type": modalities[i % 3],
            }
        )
    return rows


def make_tiny_artifact_b64() -> str:
    """Pipeline mínimo entrenado en este intérprete para probar `publish_model`."""
    import joblib
    import pandas as pd
    from sklearn.compose import ColumnTransformer
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder

    frame = pd.DataFrame(
        {
            "district": ["DISTRITO A"] * 20 + ["DISTRITO B"] * 20,
            "latitude": [-12.05] * 20 + [-12.15] * 20,
            "longitude": [-77.05] * 20 + [-76.95] * 20,
            "crime_type": ["hurto", "robo agravado"] * 20,
        }
    )
    pipeline = Pipeline(
        steps=[
            (
                "preprocessor",
                ColumnTransformer(
                    transformers=[
                        ("cat", OneHotEncoder(handle_unknown="ignore"), ["district"]),
                        ("num", "passthrough", ["latitude", "longitude"]),
                    ]
                ),
            ),
            ("model", RandomForestClassifier(n_estimators=5, random_state=0)),
        ]
    )
    pipeline.fit(frame[["district", "latitude", "longitude"]], frame["crime_type"])
    buffer = io.BytesIO()
    joblib.dump(pipeline, buffer)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def main() -> int:
    admin = sign_up(ADMIN_EMAIL, ADMIN_PASSWORD)
    set_admin(admin["localId"])
    admin_token = sign_in(ADMIN_EMAIL, ADMIN_PASSWORD)

    user = sign_up(USER_EMAIL, USER_PASSWORD)
    user_token = sign_in(USER_EMAIL, USER_PASSWORD)

    # ── Health y autenticación ───────────────────────────────────────────────
    def health_not_ready():
        status, _, body = request("GET", f"{FUNCTIONS}/prediction_health")
        data = json.loads(body)
        assert status == 200, f"{status}: {body[:200]}"
        assert data["model_exists"] is False, f"esperaba sin modelo: {data}"
        assert data["status"] == "not_ready"

    check("health público sin modelo (not_ready)", health_not_ready)

    def predict_without_token():
        status, _, body = request("POST", f"{FUNCTIONS}/predict_crime", {"district": "A", "latitude": -12.0, "longitude": -77.0})
        assert status == 401, f"{status}: {body[:200]}"

    check("predict sin token → 401", predict_without_token)

    def predict_user_without_model():
        status, _, body = request(
            "POST",
            f"{FUNCTIONS}/predict_crime",
            {"district": "DISTRITO A", "latitude": -12.05, "longitude": -77.05},
            bearer(user_token),
        )
        assert status == 400, f"{status}: {body[:200]}"
        assert "no entrenado" in body.lower(), body[:200]

    check("predict con usuario y sin modelo → 400", predict_user_without_model)

    # ── Permisos ─────────────────────────────────────────────────────────────
    def train_as_user_forbidden():
        status, _, body = request("POST", f"{FUNCTIONS}/train_model", {"dataset": make_inline_dataset()}, bearer(user_token))
        assert status == 403, f"{status}: {body[:200]}"

    check("train_model como usuario no-admin → 403", train_as_user_forbidden)

    def publish_as_user_forbidden():
        status, _, body = request(
            "POST",
            f"{FUNCTIONS}/publish_model",
            {"artifact_b64": "x", "features": ["district"], "target": "crime_type"},
            bearer(user_token),
        )
        assert status == 403, f"{status}: {body[:200]}"

    check("publish_model como usuario no-admin → 403", publish_as_user_forbidden)

    # ── Entrenamiento como admin ─────────────────────────────────────────────
    train_run: dict = {}

    def train_as_admin():
        status, _, body = request(
            "POST",
            f"{FUNCTIONS}/train_model",
            {
                "test_size": 0.25,
                "dataset": make_inline_dataset(),
                "task": {"features": ["district", "latitude", "longitude"], "target": "crime_type", "split": "random"},
            },
            bearer(admin_token),
            timeout=240,
        )
        assert status == 200, f"{status}: {body[:400]}"
        data = json.loads(body)
        assert data["model_run"], data
        assert "metrics" in data and "accuracy" in data["metrics"], data
        assert data["chunks"] >= 1
        train_run.update(data)

    check("train_model como admin (dataset inline) → 200", train_as_admin)

    def predict_with_model():
        status, _, body = request(
            "POST",
            f"{FUNCTIONS}/predict_crime",
            {"district": "DISTRITO A", "latitude": -12.05, "longitude": -77.05},
            bearer(user_token),
        )
        assert status == 200, f"{status}: {body[:300]}"
        data = json.loads(body)
        predictions = data["predictions"]
        assert data["target"] == "crime_type", data
        assert data["model_run"] == train_run.get("model_run"), data
        assert 1 <= len(predictions) <= 5
        probabilities = [item["probability"] for item in predictions]
        assert probabilities == sorted(probabilities, reverse=True), predictions
        assert all(0 <= p <= 1 for p in probabilities)
        assert all({"label", "probability"} <= set(item) for item in predictions)

    check("predict con modelo → top-5 con probabilidades", predict_with_model)

    def predict_wrong_shape():
        status, _, body = request(
            "POST",
            f"{FUNCTIONS}/predict_crime",
            {"crime_type": "robo agravado", "hour": 22, "district": "DISTRITO A"},
            bearer(user_token),
        )
        assert status == 400, f"{status}: {body[:200]}"
        assert "Faltan campos" in body, body[:200]

    check("predict con payload de otro esquema → 400", predict_wrong_shape)

    def health_ready():
        status, _, body = request("GET", f"{FUNCTIONS}/prediction_health")
        data = json.loads(body)
        assert status == 200 and data["status"] == "ok", data
        assert data["model_loadable"] is True
        assert data["model_run"] == train_run.get("model_run"), data
        assert data["model_target"] == "crime_type"
        assert data["model_features"] == ["district", "latitude", "longitude"]

    check("health con modelo entrenado (ok)", health_ready)

    # ── Importación validada ─────────────────────────────────────────────────
    valid_row = {
        "crime_type": "robo agravado",
        "hour": 22,
        "day_of_week": "viernes",
        "district": "LA VICTORIA",
        "latitude": -12.071,
        "longitude": -77.0201,
        "historical_frequency": 270,
        "risk_level": "alto",
    }

    def import_valid():
        status, _, body = request("POST", f"{FUNCTIONS}/import_incidents", {"rows": [valid_row, valid_row]}, bearer(admin_token))
        assert status == 200 and json.loads(body)["written"] == 2, f"{status}: {body[:200]}"

    check("import_incidents admin (2 filas válidas) → 200", import_valid)

    def import_invalid():
        bad = dict(valid_row, risk_level="extremo")
        status, _, body = request("POST", f"{FUNCTIONS}/import_incidents", {"rows": [bad]}, bearer(admin_token))
        assert status == 400, f"{status}: {body[:200]}"

    check("import_incidents fila inválida → 400", import_invalid)

    # ── Publicación de artefacto offline ─────────────────────────────────────
    publish_run: dict = {}

    def publish_artifact():
        status, _, body = request(
            "POST",
            f"{FUNCTIONS}/publish_model",
            {
                "artifact_b64": make_tiny_artifact_b64(),
                "features": ["district", "latitude", "longitude"],
                "target": "crime_type",
                "metrics": {"origen": "e2e"},
            },
            bearer(admin_token),
            timeout=240,
        )
        assert status == 200, f"{status}: {body[:400]}"
        data = json.loads(body)
        assert data["published"] is True and data["model_run"]
        assert set(data["classes"]) == {"hurto", "robo agravado"}, data
        publish_run.update(data)

    check("publish_model admin (artefacto offline) → 200", publish_artifact)

    def predict_with_published():
        status, _, body = request(
            "POST",
            f"{FUNCTIONS}/predict_crime",
            {"district": "DISTRITO A", "latitude": -12.05, "longitude": -77.05},
            bearer(user_token),
        )
        assert status == 200, f"{status}: {body[:300]}"
        data = json.loads(body)
        assert data["model_run"] == publish_run.get("model_run"), data
        labels = {item["label"] for item in data["predictions"]}
        assert labels == {"hurto", "robo agravado"}, data

    check("predict tras publicar artefacto → clases del artefacto", predict_with_published)

    def publish_invalid_artifact():
        status, _, body = request(
            "POST",
            f"{FUNCTIONS}/publish_model",
            {
                "artifact_b64": base64.b64encode(b"no soy un joblib").decode("ascii"),
                "features": ["district", "latitude", "longitude"],
                "target": "crime_type",
            },
            bearer(admin_token),
        )
        assert status == 400, f"{status}: {body[:200]}"

    check("publish_model con artefacto inválido → 400", publish_invalid_artifact)

    # ── create_user (solo admin) ─────────────────────────────────────────────
    def create_user_without_token():
        status, _, body = request(
            "POST",
            f"{FUNCTIONS}/create_user",
            {"email": "nuevo-sin-token@example.com", "password": "secreto-123"},
        )
        assert status == 401, f"{status}: {body[:200]}"

    check("create_user sin token → 401", create_user_without_token)

    def create_user_as_user_forbidden():
        status, _, body = request(
            "POST",
            f"{FUNCTIONS}/create_user",
            {"email": "nuevo-prohibido@example.com", "password": "secreto-123"},
            bearer(user_token),
        )
        assert status == 403, f"{status}: {body[:200]}"

    check("create_user como usuario no-admin → 403", create_user_as_user_forbidden)

    created_email = "cuenta-nueva-e2e@example.com"
    created_password = "secreto-nueva-123"

    def create_user_as_admin():
        status, _, body = request(
            "POST",
            f"{FUNCTIONS}/create_user",
            {"email": created_email, "password": created_password, "displayName": "Cuenta E2E"},
            bearer(admin_token),
        )
        assert status == 201, f"{status}: {body[:300]}"
        data = json.loads(body)
        assert data["uid"], data
        assert data["email"] == created_email, data
        assert data["displayName"] == "Cuenta E2E", data

    check("create_user como admin → 201", create_user_as_admin)

    def created_user_can_login():
        token = sign_in(created_email, created_password)
        assert token, "sin idToken"

    check("la cuenta creada puede iniciar sesión", created_user_can_login)

    def create_user_duplicate():
        status, _, body = request(
            "POST",
            f"{FUNCTIONS}/create_user",
            {"email": created_email, "password": created_password},
            bearer(admin_token),
        )
        assert status == 409, f"{status}: {body[:200]}"

    check("create_user con correo duplicado → 409", create_user_duplicate)

    def create_user_short_password():
        status, _, body = request(
            "POST",
            f"{FUNCTIONS}/create_user",
            {"email": "otra-cuenta-e2e@example.com", "password": "123"},
            bearer(admin_token),
        )
        assert status == 400, f"{status}: {body[:200]}"

    check("create_user con contraseña corta → 400", create_user_short_password)

    # ── list_users (solo admin) ──────────────────────────────────────────────
    def list_users_without_token():
        status, _, body = request("GET", f"{FUNCTIONS}/list_users")
        assert status == 401, f"{status}: {body[:200]}"

    check("list_users sin token → 401", list_users_without_token)

    def list_users_as_user_forbidden():
        status, _, body = request("GET", f"{FUNCTIONS}/list_users", headers=bearer(user_token))
        assert status == 403, f"{status}: {body[:200]}"

    check("list_users como usuario no-admin → 403", list_users_as_user_forbidden)

    def list_users_as_admin():
        status, _, body = request("GET", f"{FUNCTIONS}/list_users", headers=bearer(admin_token))
        assert status == 200, f"{status}: {body[:300]}"
        data = json.loads(body)
        by_email = {u["email"]: u for u in data["users"]}
        admin_row = by_email.get(ADMIN_EMAIL, {})
        assert admin_row.get("role") == "admin", admin_row
        assert by_email.get(USER_EMAIL, {}).get("role") == "user", by_email.get(USER_EMAIL)
        created_row = by_email.get(created_email, {})
        assert created_row.get("role") == "user", created_row
        assert created_row.get("displayName") == "Cuenta E2E", created_row
        assert created_row.get("disabled") is False, created_row
        assert created_row.get("createdAt"), created_row

    check("list_users como admin → 200 con roles y estado", list_users_as_admin)

    # ── CORS ─────────────────────────────────────────────────────────────────
    def cors_allowed():
        status, headers, _ = request(
            "OPTIONS",
            f"{FUNCTIONS}/predict_crime",
            headers={
                "Origin": ALLOWED_ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        assert status in (200, 204), str(status)
        lowered = {key.lower(): value for key, value in headers.items()}
        assert lowered.get("access-control-allow-origin") == ALLOWED_ORIGIN, lowered
        assert "authorization" in lowered.get("access-control-allow-headers", "").lower(), lowered

    check("CORS preflight desde origen permitido", cors_allowed)

    def cors_forbidden():
        status, headers, _ = request(
            "OPTIONS",
            f"{FUNCTIONS}/predict_crime",
            headers={"Origin": FORBIDDEN_ORIGIN, "Access-Control-Request-Method": "POST"},
        )
        lowered = {key.lower(): value for key, value in headers.items()}
        assert lowered.get("access-control-allow-origin") != FORBIDDEN_ORIGIN, lowered

    check("CORS preflight desde origen no permitido (sin ACAO)", cors_forbidden)

    # ── Revocación de tokens ─────────────────────────────────────────────────
    def revoked_token_rejected():
        set_disabled(user["localId"], True)
        try:
            status, _, body = request(
                "POST",
                f"{FUNCTIONS}/predict_crime",
                {"district": "DISTRITO A", "latitude": -12.05, "longitude": -77.05},
                bearer(user_token),
            )
            assert status == 401, f"{status}: {body[:200]}"
        finally:
            set_disabled(user["localId"], False)

    check("token de usuario deshabilitado → 401 (check_revoked)", revoked_token_rejected)

    total = len(results)
    passed = sum(1 for ok, _ in results if ok)
    print(f"\n{passed}/{total} comprobaciones end-to-end OK")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
