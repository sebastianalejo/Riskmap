import type { DocumentData, Timestamp } from 'firebase/firestore'

export type UserRole = 'admin' | 'user'

export interface AdminUser {
  uid: string
  email: string | null
  displayName: string | null
  role: UserRole
  disabled: boolean
  /** Milisegundos Unix o null si no está disponible. */
  createdAt: number | null
  /** Milisegundos Unix o null si nunca inició sesión. */
  lastSignInAt: number | null
}

/** Convierte un `Timestamp` de Firestore (o un número) a milisegundos Unix. */
export function toMillis(value: unknown): number | null {
  if (value && typeof (value as Timestamp).toMillis === 'function') {
    return (value as Timestamp).toMillis()
  }
  if (typeof value === 'number') return value
  return null
}

/** Normaliza un documento de `users/{uid}` al modelo que usa la UI. */
export function mapAdminUser(uid: string, data: DocumentData): AdminUser {
  return {
    uid,
    email: typeof data.email === 'string' ? data.email : null,
    displayName: typeof data.displayName === 'string' ? data.displayName : null,
    role: data.role === 'admin' ? 'admin' : 'user',
    disabled: data.disabled === true,
    createdAt: toMillis(data.createdAt),
    lastSignInAt: toMillis(data.lastLoginAt),
  }
}

/** Ordena las cuentas de la más reciente a la más antigua. */
export function sortUsersByCreatedAtDesc(users: AdminUser[]): AdminUser[] {
  return [...users].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}
