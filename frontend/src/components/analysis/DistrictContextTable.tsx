import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useCrimeStatsMonthly } from '../../hooks/useCrimeStatsMonthly'
import { useDistrictContext } from '../../hooks/useDistrictContext'
import { aggregateByDistrict, type DistrictTotals } from '../../utils/districtStats'
import { formatDecimal, formatInt } from '../../utils/analysis'
import { Card, CardHeader } from '../ui/card'

const MONTHS = 24

type SortKey = 'district' | 'total' | 'population' | 'rate' | 'stationsCount'
type SortDir = 'asc' | 'desc'

const COLUMNS: { key: SortKey; label: string; numeric: boolean; title: string }[] = [
  { key: 'district', label: 'Distrito', numeric: false, title: 'Nombre del distrito' },
  { key: 'population', label: 'Población', numeric: true, title: 'Población proyectada del INEI (último año disponible)' },
  { key: 'stationsCount', label: 'Comisarías', numeric: true, title: 'Comisarías básicas en el distrito (2019)' },
  { key: 'total', label: `Denuncias (${MONTHS} m)`, numeric: true, title: 'Denuncias oficiales registradas en los últimos meses' },
  { key: 'rate', label: 'Tasa /100k', numeric: true, title: 'Denuncias por 100 000 habitantes en el periodo' },
]

function compareRows(a: DistrictTotals, b: DistrictTotals, key: SortKey): number {
  if (key === 'district') return a.district.localeCompare(b.district, 'es')
  if (key === 'population') return (a.population ?? -1) - (b.population ?? -1)
  if (key === 'rate') return (a.rate ?? -1) - (b.rate ?? -1)
  if (key === 'stationsCount') return a.stationsCount - b.stationsCount
  return a.total - b.total
}

/** Contexto oficial por distrito: población, comisarías y tasa de denuncias por 100 000. */
export function DistrictContextTable() {
  const { rows: monthlyRows, loading: monthlyLoading } = useCrimeStatsMonthly()
  const { rows: contextRows, loading: contextLoading } = useDistrictContext()
  const [sortKey, setSortKey] = useState<SortKey>('rate')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const contextByUbigeo = useMemo(
    () =>
      new Map(
        contextRows.map((item) => [
          item.ubigeo,
          { population: item.population, stationsCount: item.stationsCount },
        ]),
      ),
    [contextRows],
  )

  const rows = useMemo(() => {
    const factor = sortDir === 'asc' ? 1 : -1
    return [...aggregateByDistrict(monthlyRows, MONTHS, contextByUbigeo)].sort(
      (a, b) => compareRows(a, b, sortKey) * factor,
    )
  }, [monthlyRows, contextByUbigeo, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir(key === 'district' ? 'asc' : 'desc')
  }

  const loading = monthlyLoading || contextLoading

  return (
    <Card className="p-5">
      <CardHeader
        title="Contexto por distrito"
        description="Población proyectada (INEI) y comisarías, con las denuncias oficiales del periodo y su tasa por 100 000 habitantes. Haz clic en una columna para reordenar."
      />

      <div className="mt-4 max-h-[520px] overflow-auto rounded-xl border border-line-subtle">
        <table className="w-full min-w-[640px] border-collapse text-sm">
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
            {loading ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-sm text-content-muted">
                  Cargando contexto…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-sm text-content-muted">
                  Sin contexto publicado. Ejecuta la ingesta de población y oferta policial.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.ubigeo} className="border-b border-line-subtle last:border-0 hover:bg-surface-2">
                  <td className="px-3 py-2 font-medium text-content-primary">{row.district}</td>
                  <td className="px-3 py-2 text-right font-mono text-content-primary">
                    {row.population === null ? '—' : formatInt(row.population)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-content-primary">
                    {formatInt(row.stationsCount)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-content-primary">{formatInt(row.total)}</td>
                  <td className="px-3 py-2 text-right font-mono text-content-primary">
                    {row.rate === null ? '—' : formatDecimal(row.rate, 1)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-content-muted">
        La tasa usa la población proyectada del INEI y las denuncias oficiales de los últimos {MONTHS} meses;
        es un indicador de contexto (registros policiales), no una medición de victimización.
      </p>
    </Card>
  )
}
