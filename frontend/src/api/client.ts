import { resolveApiUrl } from '../config/api'
import { getFirebaseAuth } from '../firebase/client'

function formatErrorDetail(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim()) {
    const trimmed = body.trimStart()
    // Respuestas HTML (p. ej. un 404 de un origen sin Functions desplegadas): no mostrar el documento.
    if (trimmed.startsWith('<')) return fallback
    return body.length > 400 ? `${body.slice(0, 400)}…` : body
  }
  if (body && typeof body === 'object' && 'detail' in body) {
    const d = (body as { detail: unknown }).detail
    if (typeof d === 'string') return d
    if (Array.isArray(d)) return d.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('; ')
  }
  if (body && typeof body === 'object') {
    try {
      return JSON.stringify(body)
    } catch {
      /* ignore */
    }
  }
  return fallback
}

export class ApiError extends Error {
  status: number
  body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

async function resolveAuthorizationHeader(stored: string | null): Promise<string | null> {
  const auth = getFirebaseAuth()
  if (auth?.currentUser) {
    const token = await auth.currentUser.getIdToken()
    return `Bearer ${token}`
  }
  return stored
}

function joinUrl(path: string): string {
  if (path.startsWith('http')) return path
  return resolveApiUrl(path)
}

export async function apiFetch(
  path: string,
  init: RequestInit & { authToken?: string | null; parseJson?: boolean } = {},
): Promise<unknown> {
  const { authToken, parseJson = true, headers, ...rest } = init
  const h = new Headers(headers)
  const authHeader = await resolveAuthorizationHeader(authToken ?? null)
  if (authHeader) {
    h.set('Authorization', authHeader)
  }
  if (!h.has('Accept')) {
    h.set('Accept', 'application/json')
  }

  const url = joinUrl(path)
  const res = await fetch(url, { ...rest, headers: h })

  if (res.status === 204) {
    return null
  }

  const contentType = res.headers.get('content-type') ?? ''
  const isJson = contentType.includes('application/json')

  let body: unknown
  if (parseJson && isJson) {
    try {
      body = await res.json()
    } catch {
      body = null
    }
  } else if (!parseJson) {
    body = await res.text()
  } else {
    body = await res.text()
  }

  if (!res.ok) {
    const detail = formatErrorDetail(body, res.statusText)
    throw new ApiError(detail || 'Error en la solicitud', res.status, body)
  }

  return body
}
