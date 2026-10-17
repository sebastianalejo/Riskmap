import { useMemo, useState } from 'react'
import { Loader2, TrendingDown, TrendingUp } from 'lucide-react'
import { MonthlyTrendChart } from './MonthlyTrendChart'
import {
  aggregateSeries,
  districtOptions,
  halfPeriodChange,
  MODALITY_SHORT,
  MONTH_OPTIONS,
  type MonthlyStat,
} from '../../utils/monthlyStats'

const numberFormat = new Intl.NumberFormat('es-PE')

interface Props {
  rows: MonthlyStat[]
  loading: boolean
  error: string | null
  months: number
  onChangeMonths: (months: number) => void
}

/**
 * Tendencia mensual real de denuncias (SIDPOL/MININTER), independiente de los
 * datos importados a `crime_incidents`.
 */
export function MonthlyTrendCard({ rows, loading, error, months, onChangeMonths }: Props) {
  const [district, setDistrict] = useState('')

  const districts = useMemo(() => districtOptions(rows), [rows])
  const series = useMemo(
    () => aggregateSeries(rows, { district: district || null, months }),
    [rows, district, months],
  )
  const change = useMemo(() => halfPeriodChange(series), [series])
  const trendUp = change >= 0
  const periodLabel = MONTH_OPTIONS.find((option) => option.value === months)?.label ?? ''

  return (
    <section className="rounded-2xl border border-line-subtle bg-surface-1 p-5 shadow-card">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-content-primary">Tendencia mensual — denuncias reales (SIDPOL)</h2>
          <p className="mt-0.5 text-xs text-content-muted">
            Lima Metropolitana y Callao · serie oficial del MININTER (2018 – hoy)
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {series.length > 1 && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] font-medium ring-1 ${
                trendUp
                  ? 'bg-risk-alto-soft text-risk-alto ring-risk-alto/30'
                  : 'bg-risk-bajo-soft text-risk-bajo ring-risk-bajo/30'
              }`}
              title="Variación entre la primera y la segunda mitad del periodo visible"
            >
              {trendUp ? <TrendingUp className="size-3" aria-hidden /> : <TrendingDown className="size-3" aria-hidden />}
              {trendUp ? '+' : ''}
              {change.toFixed(0)}%
            </span>
          )}
          <select
            value={district}
            onChange={(event) => setDistrict(event.target.value)}
            aria-label="Filtrar tendencia por distrito"
            className="h-8 rounded-xl border border-line-subtle bg-surface-2 px-2.5 text-xs text-content-primary outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/25"
          >
            <option value="">Todos los distritos</option>
            {districts.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={months}
            onChange={(event) => onChangeMonths(Number(event.target.value))}
            aria-label="Periodo de la tendencia"
            className="h-8 rounded-xl border border-line-subtle bg-surface-2 px-2.5 text-xs text-content-primary outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/25"
          >
            {MONTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && (
        <div className="flex h-48 items-center justify-center gap-2 text-sm text-content-secondary">
          <Loader2 className="size-4 animate-spin text-accent" aria-hidden />
          Cargando serie SIDPOL…
        </div>
      )}

      {!loading && error && (
        <p className="rounded-xl border border-risk-alto/30 bg-risk-alto-soft px-4 py-3 text-sm text-risk-alto">
          No se pudo cargar la serie SIDPOL: {error}
        </p>
      )}

      {!loading && !error && <MonthlyTrendChart points={series} />}

      {!loading && !error && series.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line-subtle pt-3">
          <p className="text-[11px] text-content-muted">
            {periodLabel} · {series[0].label} – {series[series.length - 1].label} ·{' '}
            {district || 'todos los distritos'} ·{' '}
            {MODALITY_SHORT.robo} + {MODALITY_SHORT.hurto} + resto por mes
          </p>
          <p className="font-mono text-xs text-content-primary">
            {numberFormat.format(series[series.length - 1].total)} denuncias en el último mes
          </p>
        </div>
      )}
    </section>
  )
}
