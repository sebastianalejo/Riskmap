"""Asigna o revoca el rol `admin` de una cuenta (Firebase Auth + Firestore).

Desde la migración a roles en Firestore, este script actúa como **bootstrap**: la
aplicación gestiona los roles desde la sección *Usuarios* (colección `users`), pero
la primera cuenta administradora (o una recuperación de emergencia) se resuelve aquí,
escribiendo tanto el claim `admin` como `users/{uid}.role = 'admin'`.

Uso:
    python scripts/set-admin-claim.py usuario@ejemplo.com
    python scripts/set-admin-claim.py usuario@ejemplo.com --revoke
    python scripts/set-admin-claim.py <uid> [--revoke]
    python scripts/set-admin-claim.py --list

Requiere credenciales de administrador de Google Cloud:
    gcloud auth application-default login
o bien GOOGLE_APPLICATION_CREDENTIALS apuntando a una clave de servicio.

Contra los emuladores locales (ver README §5.6) no hacen falta credenciales; basta con:
    # PowerShell
    $env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"
    $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
    # Bash
    FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
El project ID se toma de GOOGLE_CLOUD_PROJECT o del alias `default` de .firebaserc.

Dependencia: firebase-admin (incluida en functions/requirements.txt).

Nota: el claim se aplica al emitirse un ID token nuevo. El usuario debe cerrar
sesión y volver a entrar (o forzar el refresco del token) para que surta efecto;
el rol en Firestore, en cambio, se refleja al instante.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from firebase_admin import auth, firestore, initialize_app


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


def set_firestore_role(uid: str, role: str) -> None:
    """Crea o actualiza el perfil `users/{uid}` con el rol indicado (bypassa reglas)."""
    db = firestore.client()
    ref = db.collection("users").document(uid)
    snapshot = ref.get()
    payload: dict[str, object] = {"role": role}
    if not snapshot.exists:
        user = auth.get_user(uid)
        payload.update(
            {
                "email": user.email or "",
                "displayName": user.display_name,
                "disabled": False,
                "createdAt": firestore.SERVER_TIMESTAMP,
            }
        )
    ref.set(payload, merge=True)


def list_roles() -> int:
    """Muestra las cuentas con su rol, leído de `users`."""
    db = firestore.client()
    rows: list[tuple[str, str, str, bool]] = []
    for doc in db.collection("users").stream():
        data = doc.to_dict() or {}
        rows.append(
            (
                doc.id,
                str(data.get("email") or ""),
                str(data.get("role") or "user"),
                bool(data.get("disabled")),
            )
        )
    if not rows:
        print("No hay perfiles en la colección `users`.")
        return 0
    rows.sort(key=lambda row: (row[2] != "admin", row[1]))
    print(f"{'UID':<32} {'ROL':<6} {'ESTADO':<13} CORREO")
    for uid, email, role, disabled in rows:
        estado = "deshabilitada" if disabled else "activa"
        print(f"{uid:<32} {role:<6} {estado:<13} {email}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Asigna/revoca el rol admin de Firebase Auth y Firestore.")
    parser.add_argument("usuario", nargs="?", help="UID o correo del usuario")
    parser.add_argument("--revoke", action="store_true", help="elimina el rol admin")
    parser.add_argument("--list", action="store_true", dest="list_roles", help="lista los roles existentes")
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

    if args.list_roles:
        return list_roles()

    if not args.usuario:
        parser.error("indica un UID o correo, o usa --list")

    uid = args.usuario
    if "@" in uid:
        uid = auth.get_user_by_email(uid).uid

    user = auth.get_user(uid)
    claims = dict(user.custom_claims or {})

    if args.revoke:
        claims.pop("admin", None)
        auth.set_custom_user_claims(uid, claims or None)
        set_firestore_role(uid, "user")
        print(f"Rol admin revocado a {uid} (claim y users/{uid}.role = 'user').")
    else:
        claims["admin"] = True
        auth.set_custom_user_claims(uid, claims)
        set_firestore_role(uid, "admin")
        print(f"Rol admin asignado a {uid} (claim y users/{uid}.role = 'admin').")
        print("El rol en Firestore surte efecto al instante; el claim, al renovar el token.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
