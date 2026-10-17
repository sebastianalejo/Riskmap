import { ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AnalysisIncident } from '../../hooks/useIncidentsForAnalysis'
import { RISK_LABELS, WEEKDAYS, formatInt, type RiskLevel } from '../../utils/analysis'
import { formatEventTime } from '../../utils/eventTime'
import { sourceLabel } from '../../utils/incidentRows'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardHeader } from '../ui/card'

type SortKey = 'district' | 'crimeType' | 'eventTime' | 'riskLevel' | 'historicalFrequency' | 'source'
type SortDir = 'asc' | 'desc'

interface Column {
  key: SortKey
  label: string
  numeric: boolean
  title: string
}

const COLUMNS: Column[] = [
  { key: 'district', label: 'Distrito', numeric: false, title: 'Distrito del hecho' },
  { key: 'crimeType', label: 'Tipo', numeric: false, title: 'Tipo de delito' },
  {
    key: 'eventTime',
    label: 'Fecha y hora',
    numeric: false,
    title: 'Año, día de la semana y hora del hecho',
  },
  { key: 'riskLevel', label: 'Riesgo', numeric: false, title: 'Nivel de riesgo del registro' },
  {
    key: 'historicalFrequency',
    label: 'Frecuencia',
    numeric: true,
    title: 'Frecuencia histórica del registro',
  },
  { key: 'source', label: 'Fuente', numeric: false, title: 'Origen del registro' },
]

const RISK_RANK: Record<RiskLevel, number> = { bajo: 0, medio: 1, alto: 2 }

function weekdayIndex(day: string | null): number {
  if (!day) return -1
  return (WEEKDAYS as readonly string[]).indexOf(day)
}

function compareRows(a: AnalysisIncident, b: AnalysisIncident, key: SortKey): number {
  if (key === 'district') return a.district.localeCompare(b.district, 'es')
  if (key === 'crimeType') return a.crimeType.localeCompare(b.crimeType, 'es')
  if (key === 'source') return (a.source ?? '').localeCompare(b.source ?? '', 'es')
  if (key === 'riskLevel') {
    return (a.riskLevel ? RISK_RANK[a.riskLevel] : -1) - (b.riskLevel ? RISK_RANK[b.riskLevel] : -1)
  }
  if (key === 'historicalFrequency') {
    return (a.historicalFrequency ?? -1) - (b.historicalFrequency ?? -1)
  }
  // eventTime: orden cronológico por año → día de la semana → hora.
  return (
    (a.year ?? -1) - (b.year ?? -1) ||
    weekdayIndex(a.dayOfWeek) - weekdayIndex(b.dayOfWeek) ||
    (a.hour ?? -1) - (b.hour ?? -1)
  )
}

const PAGE_SIZE = 50

/** Tabla por evento con su fecha y hora (año, día y hora disponibles). */
export function IncidentTable({ incidents }: { incidents: AnalysisIncident[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('eventTime')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)

  const rows = useMemo(() => {
    const factor = sortDir === 'asc' ? 1 : -1
    return [...incidents].sort((a, b) => compareRows(a, b, sortKey) * factor)
  }, [incidents, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  function toggleSort(key: SortKey) {
    setPage(0)
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir(key === 'district' || key === 'crimeType' || key === 'eventTime' || key === 'source' ? 'asc' : 'desc')
  }

  return (
    <Card className="p-5">
      <CardHeader
        title="Eventos con fecha y hora"
        description="Cada registro con su año, día de la semana y hora. Haz clic en una columna para reordenar."
      />

      <div className="mt-4 overflow-auto rounded-xl border border-line-subtle">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface-1">
            <tr>
              {COLUMNS.map((column) => {
                const active = column.key === sortKey
                return (
                  <th
                    key={column.key}
                    scope="col"
                    title={column.title}
                    aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={[
                      'border-b border-line-subtle px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide',
                      column.numeric ? 'text-right' : 'text-left',
                      active ? 'text-accent' : 'text-content-muted',
                    ].join(' ')}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className={[
                        'inline-flex items-center gap-1 transition hover:text-content-primary',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        column.numeric ? 'flex-row-reverse' : '',
                      ].join(' ')}
                    >
                      {column.label}
                      {active ? (
                        sortDir === 'asc' ? (
                          <ChevronUp className="size-3.5" aria-hidden />
                        ) : (
                          <ChevronDown className="size-3.5" aria-hidden />
                        )
                      ) : (
                        <ArrowUpDown className="size-3.5 opacity-60" aria-hidden />
                      )}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-sm text-content-muted">
                  Sin eventos para los filtros actuales.
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr key={row.id} className="border-b border-line-subtle last:border-0 hover:bg-surface-2">
                  <td className="px-3 py-2 font-medium text-content-primary">{row.district}</td>
                  <td className="px-3 py-2 text-content-secondary">{row.crimeType}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-content-primary">
                    {formatEventTime({ year: row.year, dayOfWeek: row.dayOfWeek, hour: row.hour })}
                  </td>
                  <td className="px-3 py-2">
                    {row.riskLevel ? (
                      <Badge tone={row.riskLevel}>{RISK_LABELS[row.riskLevel]}</Badge>
                    ) : (
                      <span className="text-content-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-content-primary">
                    {row.historicalFrequency === null ? '—' : formatInt(row.historicalFrequency)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-content-secondary">
                    {sourceLabel(row.source ?? undefined)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-content-muted">
          {rows.length === 0
            ? 'Sin eventos.'
            : `Mostrando ${formatInt(safePage * PAGE_SIZE + 1)}–${formatInt(
                safePage * PAGE_SIZE + pageRows.length,
              )} de ${formatInt(rows.length)} evento(s).`}
        </p>
        {pageCount > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
            >
              <ChevronLeft className="size-3.5" aria-hidden />
              Anterior
            </Button>
            <span className="font-mono text-xs text-content-secondary">
              {safePage + 1} / {pageCount}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
            >
              Siguiente
              <ChevronRight className="size-3.5" aria-hidden />
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}
