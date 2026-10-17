import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AnalysisIncident } from '../../hooks/useIncidentsForAnalysis'
import {
  RISK_LABELS,
  RISK_LEVELS,
  formatInt,
  formatPercent,
  riskByDistrict,
  truncateLabel,
  type DistrictRiskRow,
} from '../../utils/analysis'
import { Card, CardHeader } from '../ui/card'
import {
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
  useChartTheme,
} from './chartTheme'

/** Composición de riesgo (100 %) por distrito, apilada alto/medio/bajo. */
export function RiskCompositionChart({ incidents }: { incidents: AnalysisIncident[] }) {
  const theme = useChartTheme()
  const rows = useMemo(() => riskByDistrict(incidents, 10), [incidents])
  const height = Math.max(240, rows.length * 34 + 24)

  return (
    <Card className="p-5">
      <CardHeader
        title="Composición de riesgo por distrito"
        description="Los 10 distritos con más registros; cada barra suma 100 % de los registros con nivel de riesgo válido."
      />

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-content-secondary">
        {RISK_LEVELS.map((level) => (
          <span key={level} className="inline-flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-full"
              style={{ background: `var(--risk-${level})` }}
              aria-hidden
            />
            {RISK_LABELS[level]}
          </span>
        ))}
        <span className="text-content-muted">· barras al 100 % por distrito</span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-content-muted">
          No hay distritos con datos para los filtros actuales.
        </p>
      ) : (
        <div className="mt-4" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={theme.grid} horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(value: number) => `${value} %`}
                tickLine={false}
                axisLine={false}
                tick={{ fill: theme.axis, fontSize: 10 }}
              />
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
                  const row = item?.payload as DistrictRiskRow | undefined
                  const count =
                    name === 'Alto' ? row?.alto : name === 'Medio' ? row?.medio : row?.bajo
                  return [
                    `${formatInt(count ?? 0)} registros (${formatPercent(Number(value))})`,
                    name,
                  ]
                }}
              />
              <Bar dataKey="pctAlto" name="Alto" stackId="risk" fill={theme.risk.alto} barSize={16} />
              <Bar dataKey="pctMedio" name="Medio" stackId="risk" fill={theme.risk.medio} barSize={16} />
              <Bar
                dataKey="pctBajo"
                name="Bajo"
                stackId="risk"
                fill={theme.risk.bajo}
                radius={[0, 6, 6, 0]}
                barSize={16}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}
