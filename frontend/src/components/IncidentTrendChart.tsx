import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from './ui/badge'
import { computeChartData, RANGE_CONFIG } from '../utils/chartData'
import { SIMULATED_DATES_NOTICE } from '../utils/simulateDates'
import type { PointWithDate } from '../utils/simulateDates'
import type { TimeRange } from '../utils/chartData'

export type { TimeRange }

interface Props {
  points: PointWithDate[]
  range: TimeRange
  height?: number
}

const BAR_CLASS: Record<'bajo' | 'medio' | 'alto', string> = {
  bajo: 'fill-risk-bajo',
  medio: 'fill-risk-medio',
  alto: 'fill-risk-alto',
}

const BAR_KEYS: Array<'bajo' | 'medio' | 'alto'> = ['bajo', 'medio', 'alto']
const BAR_LABELS: Record<string, string> = { bajo: 'Bajo', medio: 'Medio', alto: 'Alto' }

export function IncidentTrendChart({ points, range, height = 240 }: Props) {
  const { chartData, totalChange } = useMemo(() => computeChartData(points, range), [points, range])
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (chartData.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-content-muted">
        No hay datos para mostrar
      </div>
    )
  }

  const margin = { top: 10, right: 10, bottom: 28, left: 36 }
  const width = Math.max(containerWidth, 100)
  const innerW = width - margin.left - margin.right
  const innerH = height - margin.top - margin.bottom

  const maxTotal = Math.max(...chartData.map((d) => d.bajo + d.medio + d.alto), 1)
  const yTicks = 4
  const yStep = Math.ceil(maxTotal / yTicks)

  const barGap = 3
  const barCount = chartData.length
  const totalGaps = (barCount - 1) * barGap
  const barW = Math.max(4, (innerW - totalGaps) / barCount)

  const trendUp = totalChange >= 0

  function toX(i: number) {
    return margin.left + i * (barW + barGap)
  }

  function barHeight(val: number) {
    return (val / maxTotal) * innerH
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-content-secondary">
          Últimos {RANGE_CONFIG[range].label.toLowerCase()}
        </span>
        <Badge tone={trendUp ? 'alto' : 'bajo'}>
          {trendUp ? '↑ +' : '↓ '}
          {Math.abs(totalChange).toFixed(0)}%
        </Badge>
      </div>

      <p className="text-[11px] leading-snug text-content-muted" role="note">
        {SIMULATED_DATES_NOTICE}
      </p>

      <div ref={containerRef} className="w-full">
        <svg
          width={width}
          height={height}
          className="overflow-visible"
          role="img"
          aria-label={`Tendencia de incidentes por nivel de riesgo en los últimos ${RANGE_CONFIG[range].label.toLowerCase()}`}
        >
          <g>
            {Array.from({ length: yTicks + 1 }, (_, i) => {
              const val = i * yStep
              const y = margin.top + innerH - barHeight(val)
              return (
                <g key={i}>
                  <line
                    x1={margin.left}
                    y1={y}
                    x2={margin.left + innerW}
                    y2={y}
                    className="stroke-grid-line"
                    strokeWidth={1}
                  />
                  <text
                    x={margin.left - 6}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-content-muted"
                    fontSize={10}
                  >
                    {val}
                  </text>
                </g>
              )
            })}
          </g>

          <g>
            {chartData.map((d, i) => {
              const x = toX(i)
              let accumulated = 0
              return (
                <g key={i}>
                  {BAR_KEYS.map((key) => {
                    const val = d[key]
                    if (val === 0) return null
                    const h = barHeight(val)
                    const y = margin.top + innerH - accumulated - h
                    accumulated += h
                    return (
                      <rect
                        key={key}
                        x={x}
                        y={y}
                        width={barW}
                        height={Math.max(h, 1)}
                        className={BAR_CLASS[key]}
                        rx={key === 'alto' && i === barCount - 1 ? 2 : 0}
                        ry={key === 'alto' && i === barCount - 1 ? 2 : 0}
                      />
                    )
                  })}
                </g>
              )
            })}
          </g>

          <g>
            {chartData.map((d, i) => {
              const x = toX(i)
              const skip = barCount > 12 && i % Math.ceil(barCount / 12) !== 0
              return (
                <text
                  key={i}
                  x={x + barW / 2}
                  y={margin.top + innerH + 16}
                  textAnchor="end"
                  transform={`rotate(-40, ${x + barW / 2}, ${margin.top + innerH + 16})`}
                  className={skip ? 'fill-transparent' : 'fill-content-muted'}
                  fontSize={10}
                  style={{ pointerEvents: 'none' }}
                >
                  {d.name}
                </text>
              )
            })}
          </g>

          <g>
            {chartData.map((d, i) => {
              const total = d.bajo + d.medio + d.alto
              const x = toX(i)
              const y = margin.top + innerH - barHeight(total) - 14
              if (total === 0 || barW < 16) return null
              return (
                <text
                  key={i}
                  x={x + barW / 2}
                  y={y}
                  textAnchor="middle"
                  className="fill-content-secondary"
                  fontSize={9}
                  style={{ pointerEvents: 'none' }}
                >
                  {total}
                </text>
              )
            })}
          </g>

          <g>
            {BAR_KEYS.map((key, i) => (
              <g key={key} transform={`translate(${margin.left + 12 + i * 80}, 2)`}>
                <rect x={0} y={0} width={10} height={10} rx={2} className={BAR_CLASS[key]} />
                <text x={14} y={9} className="fill-content-secondary" fontSize={11}>
                  {BAR_LABELS[key]}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>
    </div>
  )
}
