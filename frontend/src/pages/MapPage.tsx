import { Filter, MapPin, RefreshCw, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { MonthlyTrendCard } from '../components/charts/MonthlyTrendCard'
import { RiskMapGoogle } from '../components/maps/RiskMapGoogle'
import { RiskMapLeaflet } from '../components/maps/RiskMapLeaflet'
import { riskVar } from '../components/maps/riskColors'
import { PdfExportControls } from '../components/PdfExportControls'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Select } from '../components/ui/input'
import { CRIME_TYPES, DISTRICTS } from '../data/sampleIncidents'
import { getGoogleMapsApiKey } from '../firebase/client'
import { useCrimeIncidentsForMap, type MapPoint } from '../hooks/useCrimeIncidentsForMap'
import { useCrimeStatsMonthly } from '../hooks/useCrimeStatsMonthly'
import { aggregateSeries } from '../utils/monthlyStats'

type RiskLevel = 'bajo' | 'medio' | 'alto'
export type Stats = Record<RiskLevel, number>

const RISK_LEVELS: RiskLevel[] = ['alto', 'medio', 'bajo']
const RISK_LABELS: Record<RiskLevel, string> = { alto: 'Alto', medio: 'Medio', bajo: 'Bajo' }

const RISK_CHIP_ACTIVE: Record<RiskLevel, string> = {
  alto: 'bg-risk-alto-soft text-risk-alto ring-risk-alto/60',
  medio: 'bg-risk-medio-soft text-risk-medio ring-risk-medio/60',
  bajo: 'bg-risk-bajo-soft text-risk-bajo ring-risk-bajo/60',
}
const RISK_CHIP_IDLE =
  'text-content-muted ring-line-subtle hover:text-content-secondary hover:ring-line-strong'

const CRIME_LABELS = CRIME_TYPES.map((c) => c.type)
const DISTRICT_NAMES = [...DISTRICTS].sort((a, b) => a.name.localeCompare(b.name)).map((d) => d.name)

const HOUR_LABELS = ['Todas', 'Madrugada (0–5)', 'Mañana (6–11)', 'Tarde (12–17)', 'Noche (18–23)']
const HOUR_RANGES: Array<[number, number] | null> = [null, [0, 5], [6, 11], [12, 17], [18, 23]]

function inHourRange(h: number, range: [number, number] | null): boolean {
  if (!range) return true
  return h >= range[0] && h <= range[1]
}

function StatBadge({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-full" style={{ background: color }} aria-hidden />
      <span className="text-xs text-content-secondary">{label}</span>
      <span className="ml-auto rounded-full bg-surface-2 px-1.5 font-mono text-[11px] font-semibold text-content-primary">
        {count}
      </span>
    </div>
  )
}

export function MapPage() {
  const mapsKey = getGoogleMapsApiKey()
  const { points: allPoints, loading, error } = useCrimeIncidentsForMap()

  // ── Filtros ────────────────────────────────────────────────────
  const [activeRisks, setActiveRisks] = useState<Set<RiskLevel>>(new Set(RISK_LEVELS))
  const [crimeFilter, setCrimeFilter] = useState('')
  const [districtFilter, setDistrictFilter] = useState('')
  const [hourRange, setHourRange] = useState(0) // índice en HOUR_LABELS
  // En escritorio los filtros se muestran abiertos; en móvil parten colapsados
  // para no empujar el mapa fuera de la pantalla.
  const [filtersOpen, setFiltersOpen] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches,
  )
  const [months, setMonths] = useState(24)
  const { rows: monthlyRows, loading: monthlyLoading, error: monthlyError } = useCrimeStatsMonthly()

  function toggleRisk(r: RiskLevel) {
    setActiveRisks((prev) => {
      const next = new Set(prev)
      if (next.has(r)) next.delete(r)
      else next.add(r)
      return next
    })
  }

  function resetFilters() {
    setActiveRisks(new Set(RISK_LEVELS))
    setCrimeFilter('')
    setDistrictFilter('')
    setHourRange(0)
  }

  const hasFilters = activeRisks.size < 3 || crimeFilter || districtFilter || hourRange > 0

  // ── Puntos filtrados ───────────────────────────────────────────
  const points: MapPoint[] = useMemo(() => {
    const hr = HOUR_RANGES[hourRange]
    return allPoints.filter((p) => {
      if (!activeRisks.has((p.riskLevel ?? '') as RiskLevel) && p.riskLevel) {
        if (!activeRisks.has(p.riskLevel as RiskLevel)) return false
      }
      if (!p.riskLevel && activeRisks.size < 3) return false
      if (crimeFilter && p.crimeType !== crimeFilter) return false
      if (districtFilter && p.district !== districtFilter) return false
      if (!inHourRange(p.hour ?? -1, hr) && hr !== null) {
        // hour no siempre está en MapPoint; si falta, no filtramos por hora
        if (typeof p.hour === 'number') return false
      }
      return true
    })
  }, [allPoints, activeRisks, crimeFilter, districtFilter, hourRange])

  // ── Estadísticas ──────────────────────────────────────────────
  const stats: Stats = useMemo(() => {
    const s = { bajo: 0, medio: 0, alto: 0 }
    points.forEach((p) => {
      const r = p.riskLevel?.toLowerCase() as RiskLevel
      if (r && s[r] !== undefined) s[r]++
    })
    return s
  }, [points])

  // ── Etiquetas para filtros ─────────────────────────────────────
  const riskLabels = [...activeRisks].sort().join(', ')
  const hourLabel = HOUR_LABELS[hourRange]
  const crimeLabel = crimeFilter
  const districtLabel = districtFilter
  const monthlySeries = useMemo(
    () => aggregateSeries(monthlyRows, { months }),
    [monthlyRows, months],
  )

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* ── Panel de filtros ──────────────────────────────────── */}
      <aside
        className={[
          'shrink-0 overflow-y-auto border-b border-line-subtle bg-surface-1 transition-all lg:border-b-0 lg:border-r',
          'lg:sticky lg:top-0 lg:max-h-svh lg:self-start',
          filtersOpen ? 'lg:w-72' : 'lg:w-12',
        ].join(' ')}
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-line-subtle px-4 py-3">
          {filtersOpen && (
            <span className="flex items-center gap-2 text-sm font-semibold text-content-primary">
              <Filter className="size-4 text-accent" aria-hidden />
              Filtros
            </span>
          )}
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className="rounded-lg p-1 text-content-muted transition hover:bg-surface-2 hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-expanded={filtersOpen}
            aria-label={filtersOpen ? 'Colapsar filtros' : 'Expandir filtros'}
            title={filtersOpen ? 'Colapsar filtros' : 'Expandir filtros'}
          >
            {filtersOpen ? <X className="size-4" aria-hidden /> : <Filter className="size-4" aria-hidden />}
          </button>
        </div>

        {filtersOpen && (
          <div className="space-y-5 p-4">
            {/* Nivel de riesgo */}
            <fieldset>
              <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
                Nivel de riesgo
              </legend>
              <div className="flex flex-wrap gap-2">
                {RISK_LEVELS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleRisk(r)}
                    aria-pressed={activeRisks.has(r)}
                    className={[
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 transition',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface-1',
                      activeRisks.has(r) ? RISK_CHIP_ACTIVE[r] : RISK_CHIP_IDLE,
                    ].join(' ')}
                  >
                    <span className="size-2 rounded-full" style={{ background: riskVar(r) }} aria-hidden />
                    {RISK_LABELS[r]}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Tipo de delito */}
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
                Tipo de delito
              </p>
              <Select
                className="py-1.5 text-xs"
                value={crimeFilter}
                onChange={(e) => setCrimeFilter(e.target.value)}
                aria-label="Filtrar por tipo de delito"
              >
                <option value="">Todos los tipos</option>
                {CRIME_LABELS.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </Select>
            </div>

            {/* Distrito */}
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
                Distrito
              </p>
              <Select
                className="py-1.5 text-xs"
                value={districtFilter}
                onChange={(e) => setDistrictFilter(e.target.value)}
                aria-label="Filtrar por distrito"
              >
                <option value="">Todos los distritos</option>
                {DISTRICT_NAMES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </div>

            {/* Franja horaria */}
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
                Franja horaria
              </p>
              <div className="space-y-1">
                {HOUR_LABELS.map((label, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setHourRange(i)}
                    aria-pressed={hourRange === i}
                    className={[
                      'w-full rounded-lg px-3 py-1.5 text-left text-xs transition',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      hourRange === i
                        ? 'bg-accent-soft font-medium text-accent'
                        : 'text-content-secondary hover:bg-surface-2 hover:text-content-primary',
                    ].join(' ')}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Reset */}
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="w-full justify-center">
                <RefreshCw className="size-3" aria-hidden />
                Limpiar filtros
              </Button>
            )}

            {/* Leyenda */}
            <div className="space-y-1.5 rounded-xl bg-surface-2 p-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
                Leyenda
              </p>
              {RISK_LEVELS.map((r) => (
                <StatBadge key={r} color={riskVar(r)} label={RISK_LABELS[r]} count={stats[r]} />
              ))}
              <div className="mt-2 flex items-center justify-between border-t border-line-subtle pt-2">
                <span className="text-[11px] text-content-secondary">Visibles</span>
                <span className="font-mono text-xs font-bold text-content-primary">
                  {points.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-content-secondary">Total cargados</span>
                <span className="font-mono text-xs text-content-muted">{allPoints.length}</span>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* ── Mapa ─────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line-subtle bg-surface-1 px-4 py-2.5">
          <MapPin className="size-4 shrink-0 text-accent" aria-hidden />
          <span className="text-sm font-semibold text-content-primary">Mapa de riesgo criminal</span>
          <span className="text-xs text-content-muted">Lima Metropolitana</span>
          {hasFilters && <Badge tone="accent">Filtros activos</Badge>}
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {!loading && points.length > 0 && (
              <PdfExportControls
                points={points}
                allPointsCount={allPoints.length}
                stats={stats}
                crimeFilter={crimeLabel}
                districtFilter={districtLabel}
                hourLabel={hourLabel}
                riskLabels={riskLabels}
                months={months}
                onMonthsChange={setMonths}
                series={monthlySeries}
              />
            )}
            <span className="font-mono text-xs text-content-secondary">
              {loading ? 'Cargando…' : `${points.length} / ${allPoints.length} puntos`}
            </span>
          </div>
        </div>

        {/* Errores */}
        {error && !loading && (
          <div className="m-4 rounded-xl border border-risk-alto/30 bg-risk-alto-soft px-4 py-3 text-sm text-risk-alto">
            {error}
          </div>
        )}

        {/* Sin datos */}
        {!loading && !error && allPoints.length === 0 && (
          <div className="m-4 rounded-xl border border-risk-medio/30 bg-risk-medio-soft px-4 py-3 text-sm text-risk-medio">
            Sin registros con coordenadas. Ve a <strong>«Importar datos»</strong> y carga los datos
            de muestra.
          </div>
        )}

        {/* Mapa */}
        <div className="h-[min(65vh,560px)] shrink-0 p-4 pb-0">
          {mapsKey ? (
            <RiskMapGoogle apiKey={mapsKey} points={points} />
          ) : (
            <RiskMapLeaflet points={points} />
          )}
        </div>

        {/* Tendencia real (SIDPOL/MININTER) */}
        <div className="shrink-0 px-4 py-4">
          <MonthlyTrendCard
            rows={monthlyRows}
            loading={monthlyLoading}
            error={monthlyError}
            months={months}
            onChangeMonths={setMonths}
          />
        </div>
      </div>
    </div>
  )
}
