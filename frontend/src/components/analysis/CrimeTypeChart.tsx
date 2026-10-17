import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AnalysisIncident } from '../../hooks/useIncidentsForAnalysis'
import {
  countByCrimeType,
  formatInt,
  formatPercent,
  truncateLabel,
  type CrimeTypeRow,
} from '../../utils/analysis'
import { Card, CardHeader } from '../ui/card'
import {
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
  useChartTheme,
} from './chartTheme'

/** Top de tipos de delito (barras horizontales). */
export function CrimeTypeChart({ incidents }: { incidents: AnalysisIncident[] }) {
  const theme = useChartTheme()
  const rows = useMemo(() => countByCrimeType(incidents, 10), [incidents])
  const height = Math.max(240, rows.length * 30 + 24)

  return (
    <Card className="p-5">
      <CardHeader
        title="Tipos de delito más frecuentes"
        description="Top 10 por número de registros; el porcentaje se calcula sobre el total filtrado con tipo válido."
      />
      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-content-muted">
          No hay registros con tipo de delito para los filtros actuales.
        </p>
      ) : (
        <div className="mt-4" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={theme.grid} horizontal={false} />
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={176}
                tickLine={false}
                axisLine={false}
                tick={{ fill: theme.text, fontSize: 11 }}
                tickFormatter={(value: string) => truncateLabel(value, 26)}
              />
              <Tooltip
                cursor={{ fill: 'var(--surface-2)' }}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                formatter={(value, name, item) => {
                  const row = item?.payload as CrimeTypeRow | undefined
                  return [
                    `${formatInt(Number(value))} registros (${formatPercent(row?.pct ?? 0)})`,
                    name,
                  ]
                }}
              />
              <Bar dataKey="count" name="Registros" fill={theme.accent} radius={[0, 6, 6, 0]} barSize={14}>
                <LabelList
                  dataKey="count"
                  position="right"
                  fill={theme.text}
                  fontSize={11}
                  formatter={(value) => formatInt(Number(value))}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}
