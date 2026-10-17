import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AnalysisIncident } from '../../hooks/useIncidentsForAnalysis'
import {
  buildDistrictTable,
  formatDecimal,
  formatInt,
  formatPercent,
  type DistrictTableRow,
} from '../../utils/analysis'
import { Card, CardHeader } from '../ui/card'

type SortKey = 'district' | 'incidents' | 'pctAlto' | 'pctNight' | 'avgFrequency' | 'topCrime'
type SortDir = 'asc' | 'desc'

interface Column {
  key: SortKey
  label: string
  numeric: boolean
  title: string
}

const COLUMNS: Column[] = [
  { key: 'district', label: 'Distrito', numeric: false, title: 'Nombre del distrito' },
  { key: 'incidents', label: 'Incidentes', numeric: true, title: 'Registros del distrito tras aplicar los filtros' },
  { key: 'pctAlto', label: '% alto', numeric: true, title: 'Porcentaje de registros con nivel de riesgo alto' },
  { key: 'pctNight', label: '% nocturno', numeric: true, title: 'Porcentaje de registros entre 22:00 y 05:59' },
  { key: 'avgFrequency', label: 'Frec. promedio', numeric: true, title: 'Promedio del campo historical_frequency' },
  { key: 'topCrime', label: 'Delito principal', numeric: false, title: 'Tipo de delito más registrado en el distrito' },
]

function compareRows(a: DistrictTableRow, b: DistrictTableRow, key: SortKey): number {
  if (key === 'district') return a.district.localeCompare(b.district, 'es')
  if (key === 'topCrime') return (a.topCrime ?? '').localeCompare(b.topCrime ?? '', 'es')
  if (key === 'avgFrequency') return (a.avgFrequency ?? -1) - (b.avgFrequency ?? -1)
  return a[key] - b[key]
}

/** Tabla comparativa por distrito, ordenable por cualquier columna. */
export function DistrictTable({ incidents }: { incidents: AnalysisIncident[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('incidents')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const rows = useMemo(() => {
    const factor = sortDir === 'asc' ? 1 : -1
    return [...buildDistrictTable(incidents)].sort((a, b) => compareRows(a, b, sortKey) * factor)
  }, [incidents, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir(key === 'district' || key === 'topCrime' ? 'asc' : 'desc')
  }

  return (
    <Card className="p-5">
      <CardHeader
        title="Comparación entre distritos"
        description="Detalle por distrito con los filtros aplicados. Haz clic en una columna para reordenar."
      />

      <div className="mt-4 max-h-[560px] overflow-auto rounded-xl border border-line-subtle">
        <table className="w-full min-w-[780px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface-1">
            <tr>
              {COLUMNS.map((column) => {
                const active = column.key === sortKey
                return (
                  <th
                    key={column.key}
                    scope="col"
                    title={column.title}
                    aria-sort={
                      active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
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
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-sm text-content-muted">
                  Sin distritos para los filtros actuales.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.district} className="border-b border-line-subtle last:border-0 hover:bg-surface-2">
                  <td className="px-3 py-2 font-medium text-content-primary">{row.district}</td>
                  <td className="px-3 py-2 text-right font-mono text-content-primary">
                    {formatInt(row.incidents)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-content-primary">
                    {formatPercent(row.pctAlto)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-content-primary">
                    {formatPercent(row.pctNight)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-content-primary">
                    {row.avgFrequency === null ? '—' : formatDecimal(row.avgFrequency, 0)}
                  </td>
                  <td className="px-3 py-2 text-content-secondary">{row.topCrime ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-content-muted">
        «% alto» se calcula sobre registros con nivel de riesgo; «% nocturno», entre 22:00 y 05:59;
        la frecuencia promedio usa <span className="font-mono">historical_frequency</span>. Cada
        columna está definida en «Cómo leer este panel», al final de la página.
      </p>
    </Card>
  )
}
