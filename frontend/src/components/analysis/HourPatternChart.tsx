import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AnalysisIncident } from '../../hooks/useIncidentsForAnalysis'
import { countByHour, formatInt, formatPercent, isNightHour, type HourRow } from '../../utils/analysis'
import { Card, CardHeader } from '../ui/card'
import {
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
  useChartTheme,
} from './chartTheme'

/** Distribución por hora del día (0–23) con la franja nocturna resaltada. */
export function HourPatternChart({ incidents }: { incidents: AnalysisIncident[] }) {
  const theme = useChartTheme()
  const rows = useMemo(() => countByHour(incidents), [incidents])

  return (
    <Card className="p-5">
      <CardHeader
        title="Patrón horario"
        description="Registros por hora del hecho (0–23). La franja nocturna (22:00–05:59) se muestra con color sólido."
      />

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-content-secondary">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-accent" aria-hidden />
          Nocturno (22:00–05:59)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-accent/35" aria-hidden />
          Resto del día
        </span>
      </div>

      <div className="mt-4" style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={theme.grid} vertical={false} />
            <XAxis
              dataKey="hour"
              interval={1}
              tickLine={false}
              axisLine={false}
              tick={{ fill: theme.axis, fontSize: 10 }}
            />
            <YAxis
              width={36}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: theme.axis, fontSize: 10 }}
            />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              labelFormatter={(hour) => {
                const h = String(Number(hour)).padStart(2, '0')
                return `Hora ${h}:00–${h}:59`
              }}
              formatter={(value, name, item) => {
                const row = item?.payload as HourRow | undefined
                return [
                  `${formatInt(Number(value))} registros (${formatPercent(row?.pct ?? 0)})`,
                  name,
                ]
              }}
            />
            <Bar dataKey="count" name="Registros" radius={[4, 4, 0, 0]}>
              {rows.map((row) => (
                <Cell
                  key={row.hour}
                  fill={theme.accent}
                  fillOpacity={isNightHour(row.hour) ? 1 : 0.35}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}
