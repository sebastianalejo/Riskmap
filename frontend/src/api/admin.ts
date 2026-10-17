import { paths } from '../config/api'
import { apiFetch } from './client'

export interface CreatedUser {
  uid: string
  email: string | null
  displayName: string | null
}

export interface CreateUserInput {
  email: string
  password: string
  displayName?: string
}

export interface AdminUser {
  uid: string
  email: string | null
  displayName: string | null
  /** `admin` cuando la cuenta tiene el claim; `user` en caso contrario. */
  role: 'admin' | 'user'
  disabled: boolean
  emailVerified: boolean
  /** Milisegundos Unix o null si no está disponible. */
  createdAt: number | null
  /** Milisegundos Unix o null si nunca inició sesión. */
  lastSignInAt: number | null
}

/** Llama a la Cloud Function `create_user` (solo admin) con el ID token de la sesión actual. */
export async function createUser(input: CreateUserInput): Promise<CreatedUser> {
  const body = await apiFetch(paths.createUser, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return body as CreatedUser
}

/** Lista las cuentas de Firebase Auth con su rol (solo admin). */
export async function listUsers(): Promise<AdminUser[]> {
  const body = await apiFetch(paths.listUsers, { method: 'GET' })
  return (body as { users: AdminUser[] }).users
}
