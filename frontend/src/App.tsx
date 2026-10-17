import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminRoute } from './components/AdminRoute'
import { AppShell } from './components/AppShell'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Skeleton } from './components/ui/skeleton'
import { DataPage } from './pages/DataPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { MapPage } from './pages/MapPage'
import { PredictPage } from './pages/PredictPage'
import { UsersPage } from './pages/UsersPage'

// El módulo de Análisis carga Recharts: se separa en su propio chunk para no
// engordar la carga inicial del resto de la app.
const AnalysisPage = lazy(() =>
  import('./pages/AnalysisPage').then((module) => ({ default: module.AnalysisPage })),
)

function PageFallback() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <Skeleton className="h-80" />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route
            path="analisis"
            element={
              <Suspense fallback={<PageFallback />}>
                <AnalysisPage />
              </Suspense>
            }
          />
          <Route path="prediccion" element={<PredictPage />} />
          <Route path="mapa" element={<MapPage />} />
          <Route path="datos" element={<DataPage />} />

          <Route element={<AdminRoute />}>
            <Route path="usuarios" element={<UsersPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
