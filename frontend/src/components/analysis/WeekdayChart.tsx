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
import { countByWeekday, formatInt, formatPercent, type WeekdayRow } from '../../utils/analysis'
import { Card, CardHeader } from '../ui/card'
import {
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
  useChartTheme,
} from './chartTheme'

const WEEKEND = new Set(['sábado', 'domingo'])

/** Distribución por día de la semana (lunes → domingo), fin de semana resaltado. */
export function WeekdayChart({ incidents }: { incidents: AnalysisIncident[] }) {
  const theme = useChartTheme()
  const rows = useMemo(() => countByWeekday(incidents), [incidents])

  return (
    <Card className="p-5">
      <CardHeader
        title="Patrón semanal"
        description="Registros por día de la semana. El fin de semana se muestra con color sólido."
      />

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-content-secondary">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-accent" aria-hidden />
          Sábado y domingo
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-accent/55" aria-hidden />
          Días laborables
        </span>
      </div>

      <div className="mt-4" style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={theme.grid} vertical={false} />
            <XAxis
              dataKey="label"
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
              formatter={(value, name, item) => {
                const row = item?.payload as WeekdayRow | undefined
                return [
                  `${formatInt(Number(value))} registros (${formatPercent(row?.pct ?? 0)})`,
                  name,
                ]
              }}
            />
            <Bar dataKey="count" name="Registros" radius={[4, 4, 0, 0]}>
              {rows.map((row) => (
                <Cell
                  key={row.day}
                  fill={theme.accent}
                  fillOpacity={WEEKEND.has(row.day) ? 1 : 0.55}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}
