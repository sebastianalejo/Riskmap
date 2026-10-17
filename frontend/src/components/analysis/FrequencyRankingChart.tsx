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
  formatDecimal,
  formatInt,
  frequencyByDistrict,
  truncateLabel,
  type FrequencyRow,
} from '../../utils/analysis'
import { Card, CardHeader } from '../ui/card'
import {
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
  useChartTheme,
} from './chartTheme'

/** Ranking de frecuencia histórica promedio por distrito. */
export function FrequencyRankingChart({ incidents }: { incidents: AnalysisIncident[] }) {
  const theme = useChartTheme()
  const rows = useMemo(() => frequencyByDistrict(incidents, 15), [incidents])
  const height = Math.max(240, rows.length * 28 + 24)

  return (
    <Card className="p-5">
      <CardHeader
        title="Frecuencia histórica por distrito"
        description="Promedio de frecuencia histórica de cada distrito (top 15). Es la intensidad base de los datos, no un conteo en tiempo real."
      />
      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-content-muted">
          No hay registros con frecuencia histórica para los filtros actuales.
        </p>
      ) : (
        <div className="mt-4" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={theme.grid} horizontal={false} />
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="district"
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
                  const row = item?.payload as FrequencyRow | undefined
                  return [
                    `Promedio ${formatDecimal(Number(value), 0)} · mediana ${formatDecimal(
                      row?.median ?? 0,
                      0,
                    )} · máx. ${formatDecimal(row?.max ?? 0, 0)} · ${formatInt(
                      row?.count ?? 0,
                    )} registros`,
                    name,
                  ]
                }}
              />
              <Bar dataKey="avg" name="Frecuencia promedio" fill={theme.info} radius={[0, 6, 6, 0]} barSize={12}>
                <LabelList
                  dataKey="avg"
                  position="right"
                  fill={theme.text}
                  fontSize={11}
                  formatter={(value) => formatDecimal(Number(value), 0)}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}
