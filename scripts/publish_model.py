"""Publica un artefacto .joblib entrenado offline en el endpoint `publish_model`.

Inicia sesión con un usuario de Firebase (email/contraseña), obtiene el ID token
y envía el artefacto en base64 junto con sus features, target y métricas.

Producción:
    python scripts/publish_model.py ^
        --origin https://us-central1-TU_PROYECTO.cloudfunctions.net ^
        --api-key TU_WEB_API_KEY ^
        --email admin@ejemplo.com --password "tu-contraseña" ^
        --artifact models/processed/crime_modality_model.joblib ^
        --metrics models/reports/metrics_temporal.json

Emulador local (ver docs/DEPLOY.md):
    python scripts/publish_model.py ^
        --origin http://127.0.0.1:5001/demo-riskmap/us-central1 ^
        --auth-base http://127.0.0.1:9099 --api-key demo-key ^
        --email admin@ejemplo.com --password secreto123 ^
        --artifact models/processed/crime_modality_model.joblib

El usuario debe tener el claim `admin` (ver scripts/set-admin-claim.py).
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def post_json(url: str, payload: dict, headers: dict[str, str] | None = None, timeout: int = 180) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {exc.code} en {url}: {body[:600]}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"No se pudo conectar a {url}: {exc.reason}") from exc


def sign_in(auth_base: str, api_key: str, email: str, password: str) -> str:
    url = f"{auth_base.rstrip('/')}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={api_key}"
    data = post_json(url, {"email": email, "password": password, "returnSecureToken": True})
    token = data.get("idToken")
    if not token:
        raise SystemExit(f"Respuesta sin idToken: {str(data)[:300]}")
    return token


def main() -> int:
    parser = argparse.ArgumentParser(description="Publica un modelo .joblib entrenado offline.")
    parser.add_argument("--origin", required=True, help="Origen de Cloud Functions (sin barra final).")
    parser.add_argument("--api-key", required=True, help="apiKey web del proyecto (para iniciar sesión).")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument(
        "--auth-base",
        default="https://identitytoolkit.googleapis.com",
        help="Base de Firebase Auth (usar el emulador para pruebas locales).",
    )
    parser.add_argument(
        "--artifact",
        type=Path,
        default=REPO_ROOT / "models" / "processed" / "crime_modality_model.joblib",
    )
    parser.add_argument("--features", default="district,latitude,longitude")
    parser.add_argument("--target", default="crime_type")
    parser.add_argument("--metrics", type=Path, default=None, help="JSON de métricas del pipeline (opcional).")
    args = parser.parse_args()

    if not args.artifact.exists():
        raise SystemExit(f"No existe el artefacto {args.artifact}. Entrena primero con scripts/pipeline/train.py")

    artifact_b64 = base64.b64encode(args.artifact.read_bytes()).decode("ascii")
    features = [item.strip() for item in args.features.split(",") if item.strip()]
    metrics = json.loads(args.metrics.read_text(encoding="utf-8")) if args.metrics else None

    print(f"Iniciando sesión como {args.email} …")
    token = sign_in(args.auth_base, args.api_key, args.email, args.password)

    print(f"Publicando {args.artifact.name} ({len(artifact_b64) // 1024} KB base64) …")
    result = post_json(
        f"{args.origin.rstrip('/')}/publish_model",
        {
            "artifact_b64": artifact_b64,
            "features": features,
            "target": args.target,
            "metrics": metrics,
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    print(json.dumps(result, indent=2, ensure_ascii=False))
    print("\nModelo publicado. Verifica con: GET " f"{args.origin.rstrip('/')}/prediction_health")
    return 0


if __name__ == "__main__":
    sys.exit(main())
