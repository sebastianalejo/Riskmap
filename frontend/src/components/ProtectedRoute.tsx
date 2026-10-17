import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function ProtectedRoute() {
  const { authToken, isReady } = useAuth()
  const location = useLocation()

  if (!isReady) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-surface-0">
        <div className="flex flex-col items-center gap-3">
          <div
            className="size-10 animate-spin rounded-full border-2 border-accent border-t-transparent"
            aria-hidden
          />
          <p className="text-sm text-content-secondary">Cargando sesión…</p>
        </div>
      </div>
    )
  }

  if (!authToken) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}
