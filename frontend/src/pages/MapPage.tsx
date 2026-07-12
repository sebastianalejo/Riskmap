import { Filter, MapPin, RefreshCw, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { RiskMapGoogle } from '../components/maps/RiskMapGoogle'
import { RiskMapLeaflet } from '../components/maps/RiskMapLeaflet'
import { riskDotColor } from '../components/maps/riskColors'
import { CRIME_TYPES, DISTRICTS } from '../data/sampleIncidents'
import { getGoogleMapsApiKey } from '../firebase/client'
import { useCrimeIncidentsForMap, type MapPoint } from '../hooks/useCrimeIncidentsForMap'
import { PdfExportButton } from '../components/PdfExportButton'
import { PdfExportControls } from '../components/PdfExportControls'
import type { TimeRange } from '../utils/chartData'

type RiskLevel = 'bajo' | 'medio' | 'alto'
export type Stats = Record<RiskLevel, number>

const RISK_LEVELS: RiskLevel[] = ['alto', 'medio', 'bajo']
const RISK_LABELS: Record<RiskLevel, string> = { alto: 'Alto', medio: 'Medio', bajo: 'Bajo' }
const RISK_CHIP: Record<RiskLevel, string> = {
  alto:  'bg-red-100 text-red-800 ring-red-300',
  medio: 'bg-orange-100 text-orange-900 ring-orange-300',
  bajo:  'bg-emerald-100 text-emerald-800 ring-emerald-300',
}
const RISK_CHIP_ACTIVE: Record<RiskLevel, string> = {
  alto:  'bg-red-600 text-white ring-red-700',
  medio: 'bg-orange-500 text-white ring-orange-600',
  bajo:  'bg-emerald-600 text-white ring-emerald-700',
}

const CRIME_LABELS = CRIME_TYPES.map((c) => c.type)
const DISTRICT_NAMES = [...DISTRICTS].sort((a, b) => a.name.localeCompare(b.name)).map((d) => d.name)

const HOUR_LABELS = ['Todas', 'Madrugada (0–5)', 'Mañana (6–11)', 'Tarde (12–17)', 'Noche (18–23)']
const HOUR_RANGES: [number, number] | null[] = [null, [0, 5], [6, 11], [12, 17], [18, 23]] as any

function inHourRange(h: number, range: [number, number] | null): boolean {
  if (!range) return true
  return h >= range[0] && h <= range[1]
}

function StatBadge({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-full" style={{ background: color }} />
      <span className="text-xs text-slate-600">{label}</span>
      <span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-mono font-semibold text-slate-700">
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
  const [crimeFilter, setCrimeFilter]     = useState('')
  const [districtFilter, setDistrictFilter] = useState('')
  const [hourRange, setHourRange]         = useState(0) // índice en HOUR_LABELS
  const [filtersOpen, setFiltersOpen]     = useState(true)
  const [range, setRange]                 = useState<TimeRange>('7d')

  function toggleRisk(r: RiskLevel) {
    setActiveRisks((prev) => {
      const next = new Set(prev)
      next.has(r) ? next.delete(r) : next.add(r)
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
    const hr = HOUR_RANGES[hourRange] as [number, number] | null
    return allPoints.filter((p) => {
      if (!activeRisks.has((p.riskLevel ?? '') as RiskLevel) && p.riskLevel) {
        if (!activeRisks.has(p.riskLevel as RiskLevel)) return false
      }
      if (!p.riskLevel && activeRisks.size < 3) return false
      if (crimeFilter && p.crimeType !== crimeFilter) return false
      if (districtFilter && p.district !== districtFilter) return false
      if (!inHourRange((p as any).hour ?? -1, hr) && hr !== null) {
        // hour no siempre está en MapPoint; si falta, no filtramos por hora
        if (typeof (p as any).hour === 'number') return false
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

  return (
    <div className="flex h-full flex-col gap-0 lg:flex-row">

      {/* ── Panel de filtros ──────────────────────────────────── */}
      <aside
        className={[
          'shrink-0 overflow-y-auto border-b border-slate-200 bg-white transition-all lg:border-b-0 lg:border-r',
          filtersOpen ? 'lg:w-72' : 'lg:w-12',
        ].join(' ')}
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          {filtersOpen && (
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Filter className="size-4 text-teal-600" />
              Filtros
            </span>
          )}
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title={filtersOpen ? 'Colapsar' : 'Expandir filtros'}
          >
            {filtersOpen ? <X className="size-4" /> : <Filter className="size-4" />}
          </button>
        </div>

        {filtersOpen && (
          <div className="space-y-5 p-4">

            {/* Nivel de riesgo */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Nivel de riesgo
              </p>
              <div className="flex flex-wrap gap-2">
                {RISK_LEVELS.map((r) => (
                  <button
                    key={r}
                    onClick={() => toggleRisk(r)}
                    className={[
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 transition',
                      activeRisks.has(r) ? RISK_CHIP_ACTIVE[r] : RISK_CHIP[r],
                    ].join(' ')}
                  >
                    <span className="size-2 rounded-full bg-current opacity-80" />
                    {RISK_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>

            {/* Tipo de delito */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Tipo de delito
              </p>
              <select
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                value={crimeFilter}
                onChange={(e) => setCrimeFilter(e.target.value)}
              >
                <option value="">Todos los tipos</option>
                {CRIME_LABELS.map((c) => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>

            {/* Distrito */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Distrito
              </p>
              <select
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                value={districtFilter}
                onChange={(e) => setDistrictFilter(e.target.value)}
              >
                <option value="">Todos los distritos</option>
                {DISTRICT_NAMES.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            {/* Franja horaria */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Franja horaria
              </p>
              <div className="space-y-1">
                {HOUR_LABELS.map((label, i) => (
                  <button
                    key={i}
                    onClick={() => setHourRange(i)}
                    className={[
                      'w-full rounded-lg px-3 py-1.5 text-left text-xs transition',
                      hourRange === i
                        ? 'bg-teal-600 text-white font-medium'
                        : 'text-slate-700 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Reset */}
            {hasFilters && (
              <button
                onClick={resetFilters}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                <RefreshCw className="size-3" />
                Limpiar filtros
              </button>
            )}

            {/* Leyenda */}
            <div className="rounded-xl bg-slate-50 p-3 space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">
                Leyenda
              </p>
              {RISK_LEVELS.map((r) => (
                <StatBadge
                  key={r}
                  color={riskDotColor(r)}
                  label={RISK_LABELS[r]}
                  count={stats[r]}
                />
              ))}
              <div className="border-t border-slate-200 mt-2 pt-2 flex items-center justify-between">
                <span className="text-[11px] text-slate-500">Visibles</span>
                <span className="font-mono text-xs font-bold text-slate-800">{points.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500">Total cargados</span>
                <span className="font-mono text-xs text-slate-500">{allPoints.length}</span>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* ── Mapa ─────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {/* Barra superior */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shrink-0">
          <MapPin className="size-4 shrink-0 text-teal-600" />
          <span className="text-sm font-semibold text-slate-900">Mapa de riesgo criminal</span>
          <span className="text-xs text-slate-400">Lima Metropolitana</span>
          {hasFilters && (
            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] text-teal-700 ring-1 ring-teal-200">
              Filtros activos
            </span>
          )}
          {!loading && points.length > 0 && (
            <PdfExportControls
              points={points}
              allPointsCount={allPoints.length}
              stats={stats}
              crimeFilter={crimeLabel}
              districtFilter={districtLabel}
              hourLabel={hourLabel}
              riskLabels={riskLabels}
              range={range}
              onRangeChange={setRange}
            />
          )}
          <span className="ml-auto font-mono text-xs text-slate-500">
            {loading ? 'Cargando…' : `${points.length} / ${allPoints.length} puntos`}
          </span>
        </div>

        {/* Errores */}
        {error && !loading && (
          <div className="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shrink-0">
            {error}
          </div>
        )}

        {/* Sin datos */}
        {!loading && !error && allPoints.length === 0 && (
          <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shrink-0">
            Sin registros con coordenadas. Ve a <strong>«Importar datos»</strong> y carga los datos de muestra.
          </div>
        )}

        {/* Mapa */}
        <div className="h-[500px] shrink-0">
          {mapsKey
            ? <RiskMapGoogle apiKey={mapsKey} points={points} />
            : <RiskMapLeaflet points={points} />}
        </div>

        {/* Tendencia + Exportar PDF */}
        {!loading && points.length > 0 && (
          <div className="shrink-0 border-t border-slate-200 px-4 py-4">
            <PdfExportButton
              points={points}
              range={range}
            />
          </div>
        )}
      </div>
    </div>
  )
}
