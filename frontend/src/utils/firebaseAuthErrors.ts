/**
 * Firebase Auth a veces lanza errores donde conviene leer el código desde el texto:
 * "Firebase: Error (auth/invalid-credential)."
 */

function extractAuthCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code?: unknown }).code
    if (typeof c === 'string' && c.startsWith('auth/')) return c
  }
  const msg = err instanceof Error ? err.message : String(err)
  const paren = msg.match(/\(auth\/([^)]+)\)/)
  if (paren?.[1]) return `auth/${paren[1]}`
  const loose = msg.match(/auth\/[a-z0-9_-]+/i)
  return loose?.[0] ?? ''
}

/** Mensaje legible para login con correo/contraseña (no exponer el texto en inglés de Firebase). */
export function friendlyFirebaseLoginError(err: unknown): string {
  const code = extractAuthCode(err)

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Correo o contraseña incorrectos, o no existe una cuenta con ese correo.'
    case 'auth/invalid-email':
      return 'El correo electrónico no es válido.'
    case 'auth/user-disabled':
      return 'Esta cuenta está deshabilitada.'
    case 'auth/too-many-requests':
      return 'Demasiados intentos fallidos. Espera unos minutos o restablece la contraseña.'
    case 'auth/network-request-failed':
      return 'Sin conexión o el servidor no respondió. Comprueba tu red.'
    default:
      break
  }

  const msg = err instanceof Error ? err.message : ''
  if (/auth\/invalid-credential|wrong-password|user-not-found/i.test(msg)) {
    return friendlyFirebaseLoginError({ code: 'auth/invalid-credential' })
  }

  if (msg && !/^Firebase:\s*Error\s*\(auth\//i.test(msg)) {
    return msg
  }

  return 'No se pudo iniciar sesión. Revisa tu correo y contraseña.'
}
