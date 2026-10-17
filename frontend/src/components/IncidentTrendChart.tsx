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

const BAR_KEYS: Array<'bajo' | 'medio' | 'alto'> = ['bajo', 'medio', 'alto']

const BAR_CLASS: Record<'bajo' | 'medio' | 'alto', string> = {
  bajo: 'fill-risk-bajo',
  medio: 'fill-risk-medio',
  alto: 'fill-risk-alto',
}

const DOT_CLASS: Record<'bajo' | 'medio' | 'alto', string> = {
  bajo: 'bg-risk-bajo',
  medio: 'bg-risk-medio',
  alto: 'bg-risk-alto',
}

const BAR_LABELS: Record<'bajo' | 'medio' | 'alto', string> = {
  bajo: 'Bajo',
  medio: 'Medio',
  alto: 'Alto',
}

/** Paso "bonito" para el eje Y (1 / 2 / 5 × 10^n): ticks siempre enteros para conteos. */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const base = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / base
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return mult * base
}

function formatTick(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

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

  const margin = { top: 26, right: 12, bottom: 30, left: 44 }
  const width = Math.max(containerWidth, 100)
  const innerW = width - margin.left - margin.right

  // Escala Y con pasos redondos (0 / 50 / 100 / 150 / 200 en vez de 38 / 76 / 114).
  const maxTotal = Math.max(...chartData.map((d) => d.bajo + d.medio + d.alto), 1)
  const yStep = Math.max(1, niceStep(maxTotal / 4))
  const yMax = Math.max(yStep, Math.ceil(maxTotal / yStep) * yStep)
  const tickCount = Math.round(yMax / yStep)

  // Barras con ancho máximo y grupo centrado (sin bloques estirados a lo ancho).
  const barCount = chartData.length
  const barGap = Math.min(10, Math.max(4, Math.round(innerW / barCount / 6)))
  const barW = Math.min(56, Math.max(6, (innerW - barGap * (barCount - 1)) / barCount))
  const groupW = barW * barCount + barGap * (barCount - 1)
  const startX = margin.left + Math.max(0, (innerW - groupW) / 2)

  const rotateLabels = barCount > 10 || barW < 26
  const innerH = height - margin.top - (rotateLabels ? 40 : margin.bottom)

  const trendUp = totalChange >= 0

  function toX(i: number) {
    return startX + i * (barW + barGap)
  }

  function barHeight(val: number) {
    return (val / yMax) * innerH
  }

  return (
    <div className="space-y-3">
      {/* Cabecera: rango + leyenda + tendencia */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-content-secondary">
          Últimos {RANGE_CONFIG[range].label.toLowerCase()}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <ul className="flex items-center gap-3" aria-label="Niveles de riesgo">
            {BAR_KEYS.map((key) => (
              <li key={key} className="flex items-center gap-1.5">
                <span className={`size-2.5 rounded-[3px] ${DOT_CLASS[key]}`} aria-hidden />
                <span className="text-[11px] text-content-secondary">{BAR_LABELS[key]}</span>
              </li>
            ))}
          </ul>
          <Badge tone={trendUp ? 'alto' : 'bajo'}>
            {trendUp ? '↑ +' : '↓ '}
            {Math.abs(totalChange).toFixed(0)}%
          </Badge>
        </div>
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
          {/* Rejilla y eje Y */}
          <g>
            {Array.from({ length: tickCount + 1 }, (_, i) => {
              const val = i * yStep
              const y = margin.top + innerH - barHeight(val)
              return (
                <g key={i}>
                  <line
                    x1={margin.left}
                    y1={y}
                    x2={margin.left + innerW}
                    y2={y}
                    className={i === 0 ? 'stroke-line-strong' : 'stroke-grid-line'}
                    strokeWidth={1}
                  />
                  <text
                    x={margin.left - 8}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-content-muted font-mono"
                    fontSize={10}
                  >
                    {formatTick(val)}
                  </text>
                </g>
              )
            })}
          </g>

          {/* Barras apiladas (con tooltip nativo) */}
          {chartData.map((d, i) => {
            const x = toX(i)
            const total = d.bajo + d.medio + d.alto
            if (total === 0) return null
            const visibleKeys = BAR_KEYS.filter((key) => d[key] > 0)
            let acc = 0
            return (
              <g key={i}>
                <title>
                  {`${d.name} — Bajo ${d.bajo} · Medio ${d.medio} · Alto ${d.alto} (total ${total})`}
                </title>
                {visibleKeys.map((key, idx) => {
                  const h = barHeight(d[key])
                  const y = margin.top + innerH - acc - h
                  acc += h
                  const isTop = idx === visibleKeys.length - 1
                  return (
                    <rect
                      key={key}
                      x={x}
                      y={y}
                      width={barW}
                      height={Math.max(h, 1)}
                      className={BAR_CLASS[key]}
                      rx={isTop ? 2 : 0}
                      ry={isTop ? 2 : 0}
                    />
                  )
                })}
                {barW >= 20 && (
                  <text
                    x={x + barW / 2}
                    y={Math.max(12, margin.top + innerH - barHeight(total) - 7)}
                    textAnchor="middle"
                    className="fill-content-secondary font-mono"
                    fontSize={9}
                    style={{ pointerEvents: 'none' }}
                  >
                    {total}
                  </text>
                )}
              </g>
            )
          })}

          {/* Etiquetas X (horizontales con pocas barras; rotadas con muchas) */}
          <g>
            {chartData.map((d, i) => {
              const cx = toX(i) + barW / 2
              const y = margin.top + innerH + (rotateLabels ? 14 : 18)
              const skip = barCount > 26 && i % Math.ceil(barCount / 26) !== 0
              if (skip) return null
              return rotateLabels ? (
                <text
                  key={i}
                  x={cx}
                  y={y}
                  textAnchor="end"
                  transform={`rotate(-40, ${cx}, ${y})`}
                  className="fill-content-muted"
                  fontSize={10}
                  style={{ pointerEvents: 'none' }}
                >
                  {d.name}
                </text>
              ) : (
                <text
                  key={i}
                  x={cx}
                  y={y}
                  textAnchor="middle"
                  className="fill-content-muted"
                  fontSize={10}
                  style={{ pointerEvents: 'none' }}
                >
                  {d.name}
                </text>
              )
            })}
          </g>
        </svg>
      </div>
    </div>
  )
}
