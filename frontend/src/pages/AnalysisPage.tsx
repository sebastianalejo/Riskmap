import {
  AlertCircle,
  BarChart3,
  Building2,
  Database,
  Info,
  Layers,
  MapPin,
  ShieldAlert,
  TrendingUp,
  Upload,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnalysisExportButtons } from '../components/analysis/AnalysisExportButtons'
import { AnalysisFiltersPanel } from '../components/analysis/AnalysisFiltersPanel'
import { CrimeTypeChart } from '../components/analysis/CrimeTypeChart'
import { DistrictTable } from '../components/analysis/DistrictTable'
import { FrequencyRankingChart } from '../components/analysis/FrequencyRankingChart'
import { HourPatternChart } from '../components/analysis/HourPatternChart'
import { HowToReadPanel } from '../components/analysis/HowToReadPanel'
import { IncidentTable } from '../components/analysis/IncidentTable'
import { RiskCompositionChart } from '../components/analysis/RiskCompositionChart'
import { WeekdayChart } from '../components/analysis/WeekdayChart'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty-state'
import { Skeleton } from '../components/ui/skeleton'
import { StatCard } from '../components/ui/stat-card'
import { useAuth } from '../context/AuthContext'
import { useIncidentsForAnalysis } from '../hooks/useIncidentsForAnalysis'
import {
  SIN_DISTRITO,
  SIN_TIPO,
  applyFilters,
  computeOverview,
  createDefaultFilters,
  formatDecimal,
  formatInt,
  formatPercent,
  uniqueValues,
  type AnalysisFilters,
} from '../utils/analysis'

const primaryLink =
  'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl bg-accent-strong px-4 text-sm font-semibold text-accent-foreground shadow-glow transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0'

export function AnalysisPage() {
  const { isAdmin } = useAuth()
  const { incidents, loading, error } = useIncidentsForAnalysis()
  const [filters, setFilters] = useState<AnalysisFilters>(createDefaultFilters)

  const districts = useMemo(
    () => uniqueValues(incidents.map((i) => i.district).filter((d) => d !== SIN_DISTRITO)),
    [incidents],
  )
  const crimeTypes = useMemo(
    () => uniqueValues(incidents.map((i) => i.crimeType).filter((t) => t !== SIN_TIPO)),
    [incidents],
  )

  const filtered = useMemo(() => applyFilters(incidents, filters), [incidents, filters])
  const overview = useMemo(() => computeOverview(filtered), [filtered])

  const sharePct = incidents.length > 0 ? (overview.total / incidents.length) * 100 : 0

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-content-primary">
            Análisis de datos
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-content-secondary">
            Vista analista del dataset publicado (
            <span className="font-mono text-xs">crime_incidents</span>):
            composición por distrito, patrones por hora y día de la semana, y frecuencia histórica.
            Solo campos reales del dataset, sin fechas simuladas.
          </p>
        </div>
        {!loading && !error && incidents.length > 0 && (
          <AnalysisExportButtons incidents={filtered} filters={filters} />
        )}
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Skeleton className="h-80" />
            <Skeleton className="h-80" />
          </div>
          <Skeleton className="h-72" />
        </div>
      ) : incidents.length === 0 ? (
        <>
          <EmptyState
            icon={BarChart3}
            title="Sin datos para analizar"
            description={
              isAdmin
                ? 'Importa un archivo CSV/Excel o pega JSON en «Importar datos» para explorar la composición por distrito, los patrones horarios y la frecuencia histórica.'
                : 'Aún no hay datos cargados. Pide a un administrador que importe los registros para explorar la composición por distrito, los patrones horarios y la frecuencia histórica.'
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
          <HowToReadPanel />
        </>
      ) : (
        <>
          <AnalysisFiltersPanel
            filters={filters}
            districts={districts}
            crimeTypes={crimeTypes}
            onChange={setFilters}
          />

          {filtered.length === 0 ? (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div className="flex items-start gap-3">
                <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
                <p className="text-sm text-content-secondary">
                  Ningún registro cumple los filtros actuales. Ajusta la selección o límpiala para
                  ver el análisis completo.
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setFilters(createDefaultFilters())}>
                Limpiar filtros
              </Button>
            </Card>
          ) : (
            <>
              {/* KPIs */}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <StatCard
                  label="Incidentes analizados"
                  value={formatInt(overview.total)}
                  icon={Database}
                  tone="accent"
                  hint={
                    overview.total === incidents.length
                      ? '100 % de los registros cargados'
                      : `${formatPercent(sharePct, 0)} de ${formatInt(incidents.length)} cargados`
                  }
                />
                <StatCard
                  label="Distritos con datos"
                  value={formatInt(overview.districts)}
                  icon={Building2}
                  tone="info"
                  hint={`de ${formatInt(districts.length)} distrito(s) presentes en el dataset`}
                />
                <StatCard
                  label="Riesgo alto"
                  value={formatPercent(overview.pctAlto)}
                  icon={ShieldAlert}
                  tone="alto"
                  hint={`${formatInt(overview.riskCounts.alto)} registro(s) marcados como alto`}
                />
                <StatCard
                  label="Frecuencia histórica promedio"
                  value={overview.avgFrequency === null ? '—' : formatDecimal(overview.avgFrequency, 0)}
                  icon={TrendingUp}
                  tone="neutral"
                  hint={
                    overview.medianFrequency === null
                      ? 'Sin registros con frecuencia'
                      : `Mediana: ${formatDecimal(overview.medianFrequency, 0)}`
                  }
                />
                <StatCard
                  label="Delito más frecuente"
                  value={overview.topCrime?.name ?? '—'}
                  valueClassName="text-lg"
                  icon={Layers}
                  tone="neutral"
                  hint={
                    overview.topCrime
                      ? `${formatInt(overview.topCrime.count)} registro(s)`
                      : 'Sin datos'
                  }
                />
                <StatCard
                  label="Distrito más crítico"
                  value={overview.topDistrict?.name ?? '—'}
                  valueClassName="text-lg"
                  icon={MapPin}
                  tone="medio"
                  hint={
                    overview.topDistrict
                      ? `${formatInt(overview.topDistrict.count)} registro(s)`
                      : 'Sin datos'
                  }
                />
              </div>

              {/* Distribuciones comparadas */}
              <div className="grid gap-4 xl:grid-cols-2">
                <CrimeTypeChart incidents={filtered} />
                <RiskCompositionChart incidents={filtered} />
              </div>

              {/* Patrones temporales (hora y día) */}
              <div className="grid gap-4 xl:grid-cols-3">
                <div className="xl:col-span-2">
                  <HourPatternChart incidents={filtered} />
                </div>
                <WeekdayChart incidents={filtered} />
              </div>

              {/* Frecuencia histórica */}
              <FrequencyRankingChart incidents={filtered} />

              {/* Tabla comparativa */}
              <DistrictTable incidents={filtered} />

              {/* Detalle por evento (fecha y hora) */}
              <IncidentTable incidents={filtered} />
            </>
          )}

          <HowToReadPanel />
        </>
      )}
    </div>
  )
}
