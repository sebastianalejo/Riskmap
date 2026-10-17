"""Asigna o revoca el custom claim `admin` en Firebase Authentication.

Uso:
    python scripts/set-admin-claim.py usuario@ejemplo.com
    python scripts/set-admin-claim.py usuario@ejemplo.com --revoke
    python scripts/set-admin-claim.py <uid> [--revoke]

Requiere credenciales de administrador de Google Cloud:
    gcloud auth application-default login
o bien GOOGLE_APPLICATION_CREDENTIALS apuntando a una clave de servicio.

Contra los emuladores locales (ver README §5.6) no hacen falta credenciales; basta con:
    # PowerShell
    $env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"
    # Bash
    FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
El project ID se toma de GOOGLE_CLOUD_PROJECT o del alias `default` de .firebaserc.

Dependencia: firebase-admin (incluida en functions/requirements.txt).

Nota: el claim se aplica al emitirse un ID token nuevo. El usuario debe cerrar
sesión y volver a entrar (o forzar el refresco del token) para que surta efecto.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from firebase_admin import auth, initialize_app


def emulator_project_id() -> str | None:
    """Project ID cuando se trabaja contra el emulador (GOOGLE_CLOUD_PROJECT o .firebaserc)."""
    for var in ("GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"):
        value = os.environ.get(var, "").strip()
        if value:
            return value
    firebaserc = Path(__file__).resolve().parents[1] / ".firebaserc"
    try:
        data = json.loads(firebaserc.read_text(encoding="utf-8"))
    except Exception:
        return None
    project = data.get("projects", {}).get("default")
    return project.strip() if isinstance(project, str) and project.strip() else None


def main() -> int:
    parser = argparse.ArgumentParser(description="Asigna/revoca el claim admin de Firebase Auth.")
    parser.add_argument("usuario", help="UID o correo del usuario")
    parser.add_argument("--revoke", action="store_true", help="elimina el claim admin")
    args = parser.parse_args()

    options: dict[str, str] = {}
    if os.environ.get("FIREBASE_AUTH_EMULATOR_HOST", "").strip():
        project_id = emulator_project_id()
        if project_id:
            options["projectId"] = project_id
        else:
            print(
                "Aviso: modo emulador sin project ID; define GOOGLE_CLOUD_PROJECT "
                "o un alias `default` en .firebaserc.",
                file=sys.stderr,
            )

    initialize_app(options=options or None)

    uid = args.usuario
    if "@" in uid:
        uid = auth.get_user_by_email(uid).uid

    user = auth.get_user(uid)
    claims = dict(user.custom_claims or {})

    if args.revoke:
        claims.pop("admin", None)
        auth.set_custom_user_claims(uid, claims or None)
        print(f"Claim admin revocado a {uid}.")
    else:
        claims["admin"] = True
        auth.set_custom_user_claims(uid, claims)
        print(f"Claim admin asignado a {uid}. El usuario debe volver a iniciar sesión.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
