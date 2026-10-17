/** Traduce los errores de Firebase (Firestore y Auth) de la sección Usuarios. */
export function friendlyUserError(err: unknown, fallback: string): string {
  const code = (err as { code?: string })?.code ?? ''
  switch (code) {
    case 'permission-denied':
      return 'Tu cuenta no tiene permiso de administrador para esta operación.'
    case 'unauthenticated':
      return 'Tu sesión expiró. Vuelve a iniciar sesión y reinténtalo.'
    case 'unavailable':
      return 'Sin conexión con Firestore. Revisa tu red e inténtalo de nuevo.'
    case 'auth/email-already-in-use':
      return 'Ya existe una cuenta con ese correo.'
    case 'auth/weak-password':
      return 'La contraseña es demasiado débil (mínimo 6 caracteres).'
    case 'auth/invalid-email':
      return 'El correo electrónico no es válido.'
    case 'auth/too-many-requests':
      return 'Demasiados intentos seguidos. Espera un momento y reinténtalo.'
    default:
      return err instanceof Error ? err.message : fallback
  }
}
