import { useMemo } from 'react'
import { useContextSeries } from '../../hooks/useContextSeries'
import { formatDecimal, formatInt } from '../../utils/analysis'
import { mpfnByYear, pivotIneiSeries } from '../../utils/contextSeries'
import { Card, CardHeader } from '../ui/card'

const INEI_YEARS = 8
const MPFN_YEARS = 7

function value(value: number | null, digits = 0): string {
  return value === null ? '—' : digits > 0 ? formatDecimal(value, digits) : formatInt(value)
}

/**
 * Series de contexto: cifras oficiales de Lima Metropolitana (INEI) y denuncias ante el
 * Ministerio Público (MPFN). Sirven de contraste externo para los datos distritales.
 */
export function ContextSeriesPanel() {
  const { rows, loading, error } = useContextSeries()

  const inei = useMemo(() => pivotIneiSeries(rows).slice(-INEI_YEARS), [rows])
  const mpfn = useMemo(() => mpfnByYear(rows).slice(-MPFN_YEARS), [rows])

  return (
    <Card className="p-5">
      <CardHeader
        title="Series de contexto"
        description="Cifras oficiales agregadas para Lima Metropolitana: denuncias y tasa (INEI) y delitos ante el Ministerio Público (MPFN). Sirven de contraste, no son datos por distrito."
      />

      {loading ? (
        <p className="mt-4 text-sm text-content-muted">Cargando series…</p>
      ) : error ? (
        <p className="mt-4 text-sm text-risk-alto">{error}</p>
      ) : (
        <div className="mt-4 grid gap-6 xl:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
              INEI · Lima Metropolitana
            </h3>
            <div className="overflow-auto rounded-xl border border-line-subtle">
              <table className="w-full min-w-[420px] border-collapse text-sm">
                <thead className="bg-surface-1">
                  <tr>
                    {['Año', 'Delitos', 'Tasa /10k', 'Robo veh.', 'Detenidos'].map((label, index) => (
                      <th
                        key={label}
                        scope="col"
                        className={[
                          'border-b border-line-subtle px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-content-muted',
                          index === 0 ? 'text-left' : 'text-right',
                        ].join(' ')}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inei.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-5 text-center text-sm text-content-muted">
                        Sin datos publicados.
                      </td>
                    </tr>
                  ) : (
                    inei.map((row) => (
                      <tr key={row.year} className="border-b border-line-subtle last:border-0 hover:bg-surface-2">
                        <td className="px-3 py-2 font-mono text-content-primary">{row.year}</td>
                        <td className="px-3 py-2 text-right font-mono text-content-primary">{value(row.delitos)}</td>
                        <td className="px-3 py-2 text-right font-mono text-content-primary">{value(row.tasa, 1)}</td>
                        <td className="px-3 py-2 text-right font-mono text-content-primary">
                          {value(row.roboVehiculos)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-content-primary">{value(row.detenidos)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
              MPFN · Lima Metropolitana y Callao
            </h3>
            <div className="overflow-auto rounded-xl border border-line-subtle">
              <table className="w-full min-w-[280px] border-collapse text-sm">
                <thead className="bg-surface-1">
                  <tr>
                    {['Año', 'Denuncias'].map((label, index) => (
                      <th
                        key={label}
                        scope="col"
                        className={[
                          'border-b border-line-subtle px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-content-muted',
                          index === 0 ? 'text-left' : 'text-right',
                        ].join(' ')}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mpfn.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="px-3 py-5 text-center text-sm text-content-muted">
                        Sin datos publicados.
                      </td>
                    </tr>
                  ) : (
                    mpfn.map((row) => (
                      <tr key={row.year} className="border-b border-line-subtle last:border-0 hover:bg-surface-2">
                        <td className="px-3 py-2 font-mono text-content-primary">{row.year}</td>
                        <td className="px-3 py-2 text-right font-mono text-content-primary">
                          {formatInt(row.total)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-content-muted">
              Delitos denunciados ante el Ministerio Público (grano agregado por distrito fiscal).
            </p>
          </div>
        </div>
      )}
    </Card>
  )
}
