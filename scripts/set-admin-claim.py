"""Asigna o revoca el custom claim `admin` en Firebase Authentication.

Uso:
    python scripts/set-admin-claim.py usuario@ejemplo.com
    python scripts/set-admin-claim.py usuario@ejemplo.com --revoke
    python scripts/set-admin-claim.py <uid> [--revoke]

Requiere credenciales de administrador de Google Cloud:
    gcloud auth application-default login
o bien GOOGLE_APPLICATION_CREDENTIALS apuntando a una clave de servicio.

Dependencia: firebase-admin (incluida en functions/requirements.txt).

Nota: el claim se aplica al emitirse un ID token nuevo. El usuario debe cerrar
sesión y volver a entrar (o forzar el refresco del token) para que surta efecto.
"""

from __future__ import annotations

import argparse
import sys

from firebase_admin import auth, initialize_app


def main() -> int:
    parser = argparse.ArgumentParser(description="Asigna/revoca el claim admin de Firebase Auth.")
    parser.add_argument("usuario", help="UID o correo del usuario")
    parser.add_argument("--revoke", action="store_true", help="elimina el claim admin")
    args = parser.parse_args()

    initialize_app()

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
