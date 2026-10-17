import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/** Variante de ProtectedRoute que además exige el rol `admin` (ver AuthContext.isAdmin). */
export function AdminRoute() {
  const { isAdmin, isReady } = useAuth()

  if (!isReady) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-surface-0">
        <div className="flex flex-col items-center gap-3">
          <div
            className="size-10 animate-spin rounded-full border-2 border-accent border-t-transparent"
            aria-hidden
          />
          <p className="text-sm text-content-secondary">Comprobando permisos…</p>
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
