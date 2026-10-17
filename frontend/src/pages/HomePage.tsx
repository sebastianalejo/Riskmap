import {
  AlertCircle,
  BarChart3,
  Database,
  Layers,
  MapPin,
  Radar,
  ShieldAlert,
  Upload,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MonthlyTrendCard } from '../components/charts/MonthlyTrendCard'
import { Card, CardHeader } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty-state'
import { Skeleton } from '../components/ui/skeleton'
import { StatCard } from '../components/ui/stat-card'
import { useAuth } from '../context/AuthContext'
import { useCrimeIncidentsForMap } from '../hooks/useCrimeIncidentsForMap'
import { useCrimeStatsMonthly } from '../hooks/useCrimeStatsMonthly'

const primaryLink =
  'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl bg-accent-strong px-4 text-sm font-semibold text-accent-foreground shadow-glow transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0'

const secondaryLink =
  'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-line-subtle bg-surface-2 px-4 text-sm font-semibold text-content-primary transition hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

const RISK_ROWS = [
  { key: 'alto', label: 'Alto', fill: 'bg-risk-alto' },
  { key: 'medio', label: 'Medio', fill: 'bg-risk-medio' },
  { key: 'bajo', label: 'Bajo', fill: 'bg-risk-bajo' },
] as const

export function HomePage() {
  const { isAdmin } = useAuth()
  const { points, loading, error } = useCrimeIncidentsForMap()
  const { rows: monthlyRows, loading: monthlyLoading, error: monthlyError } = useCrimeStatsMonthly()
  const [months, setMonths] = useState(24)

  const stats = useMemo(() => {
    const counts = { bajo: 0, medio: 0, alto: 0 }
    const byDistrict = new Map<string, number>()
    const crimeTypes = new Set<string>()

    for (const p of points) {
      const r = p.riskLevel?.toLowerCase()
      if (r === 'bajo' || r === 'medio' || r === 'alto') counts[r]++
      const d = p.district?.trim()
      if (d) byDistrict.set(d, (byDistrict.get(d) ?? 0) + 1)
      const c = p.crimeType?.trim()
      if (c) crimeTypes.add(c.toLowerCase())
    }

    const topDistricts = [...byDistrict.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    const total = points.length
    const pctAlto = total > 0 ? Math.round((counts.alto / total) * 100) : 0

    return {
      ...counts,
      total,
      pctAlto,
      topDistricts,
      districts: byDistrict.size,
      crimeTypes: crimeTypes.size,
      critical: topDistricts[0] ?? null,
    }
  }, [points])

  const topMax = stats.topDistricts[0]?.[1] ?? 1

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-content-primary">Resumen</h1>
          <p className="mt-1 max-w-2xl text-sm text-content-secondary">
            Panel operativo conectado a Firestore (
            <span className="font-mono text-xs">crime_incidents</span>). Incidentes cargados,
            niveles de riesgo y tendencia de Lima Metropolitana.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/mapa" className={primaryLink}>
            Ver mapa
          </Link>
          <Link to="/analisis" className={secondaryLink}>
            <BarChart3 className="size-4" aria-hidden />
            Ver análisis
          </Link>
          {isAdmin && (
            <Link to="/datos" className={secondaryLink}>
              <Upload className="size-4" aria-hidden />
              Importar datos
            </Link>
          )}
        </div>
      </header>

      {error && (
        <div
          className="flex items-start gap-3 rounded-2xl border border-risk-alto/30 bg-risk-alto-soft px-4 py-3 text-sm text-risk-alto"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-80 lg:col-span-2" />
            <div className="space-y-4">
              <Skeleton className="h-36" />
              <Skeleton className="h-40" />
            </div>
          </div>
        </div>
      ) : points.length === 0 ? (
        <>
          <EmptyState
            icon={Radar}
            title="Sin registros todavía"
            description={
              isAdmin
                ? 'Importa un archivo CSV/Excel o pega JSON para ver los KPIs, el mapa de riesgo y la distribución. La tendencia de abajo ya usa datos reales del SIDPOL.'
                : 'Aún no hay datos cargados. Pide a un administrador que importe los registros para ver los KPIs, el mapa de riesgo y la distribución. La tendencia de abajo ya usa datos reales del SIDPOL.'
            }
            action={
              isAdmin ? (
                <Link to="/datos" className={primaryLink}>
                  <Upload className="size-4" aria-hidden />
                  Importar datos
                </Link>
              ) : undefined
            }
          />
          <MonthlyTrendCard
            rows={monthlyRows}
            loading={monthlyLoading}
            error={monthlyError}
            months={months}
            onChangeMonths={setMonths}
          />
        </>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Incidentes cargados"
              value={stats.total.toLocaleString('es-PE')}
              icon={Database}
              tone="accent"
              hint={`${stats.districts} distrito(s) con registros`}
            />
            <StatCard
              label="Riesgo alto"
              value={`${stats.pctAlto}%`}
              icon={ShieldAlert}
              tone="alto"
              hint={`${stats.alto} punto(s) marcados como alto`}
            />
            <StatCard
              label="Distrito más crítico"
              value={stats.critical ? stats.critical[0] : '—'}
              valueClassName="text-lg"
              icon={MapPin}
              tone="medio"
              hint={stats.critical ? `${stats.critical[1]} incidente(s) registrados` : 'Sin distritos'}
            />
            <StatCard
              label="Tipos de delito"
              value={stats.crimeTypes}
              icon={Layers}
              tone="info"
              hint="Categorías distintas identificadas"
            />
          </div>

          {/* Tendencia real (SIDPOL) + distribución */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <MonthlyTrendCard
                rows={monthlyRows}
                loading={monthlyLoading}
                error={monthlyError}
                months={months}
                onChangeMonths={setMonths}
              />
            </div>

            <div className="space-y-4">
              <Card className="p-5">
                <CardHeader
                  title="Distribución por riesgo"
                  description={`Sobre ${stats.total.toLocaleString('es-PE')} registros`}
                />
                <div className="mt-4 space-y-3">
                  {RISK_ROWS.map(({ key, label, fill }) => {
                    const count = stats[key]
                    const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0
                    return (
                      <div key={key} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-content-secondary">{label}</span>
                          <span className="font-mono text-content-primary">
                            {count} · {pct}%
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${fill}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>

              <Card className="p-5">
                <CardHeader title="Top distritos" description="Por número de incidentes" />
                <ul className="mt-4 space-y-2.5">
                  {stats.topDistricts.map(([name, count]) => (
                    <li key={name} className="flex items-center gap-3">
                      <span className="w-36 truncate text-xs text-content-secondary" title={name}>
                        {name}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${(count / topMax) * 100}%` }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right font-mono text-xs text-content-primary">
                        {count}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>

          {/* Estado del sistema */}
          <Card className="p-5">
            <CardHeader
              title="Estado del sistema"
              description="Servicios disponibles desde este navegador."
            />
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div className="flex items-center gap-2.5 rounded-xl bg-surface-2 px-3 py-2.5">
                <span className="size-2 rounded-full bg-risk-bajo" aria-hidden />
                <span className="text-content-secondary">Firestore</span>
                <span className="ml-auto font-mono text-xs text-content-primary">
                  {stats.total.toLocaleString('es-PE')} docs
                </span>
              </div>
              <div className="flex items-center gap-2.5 rounded-xl bg-surface-2 px-3 py-2.5">
                <span className="size-2 rounded-full bg-risk-medio" aria-hidden />
                <span className="text-content-secondary">Cloud Functions</span>
                <span className="ml-auto text-xs text-content-muted">no desplegadas</span>
              </div>
              <div className="flex items-center gap-2.5 rounded-xl bg-surface-2 px-3 py-2.5">
                <span className="size-2 rounded-full bg-info" aria-hidden />
                <span className="text-content-secondary">Predicción</span>
                <span className="ml-auto text-xs text-content-muted">local + heurística</span>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
