import { useEffect, useRef, useState } from 'react'
import { MODALITY_CSS, MODALITY_SHORT, MODALITY_ORDER, type SeriesPoint } from '../../utils/monthlyStats'

interface Props {
  points: SeriesPoint[]
  height?: number
}

const numberFormat = new Intl.NumberFormat('es-PE')

/** Barras mensuales apiladas por modalidad (serie real de denuncias oficiales). */
export function MonthlyTrendChart({ points, height = 240 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  if (points.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-content-muted">
        No hay datos para mostrar
      </div>
    )
  }

  const margin = { top: 12, right: 12, bottom: 30, left: 46 }
  const width = Math.max(containerWidth, 160)
  const innerW = width - margin.left - margin.right
  const innerH = height - margin.top - margin.bottom

  const maxTotal = Math.max(...points.map((point) => point.total), 1)
  const yTicks = 4
  const yStep = maxTotal / yTicks

  const barGap = 2
  const barW = Math.max(3, (innerW - barGap * (points.length - 1)) / points.length)
  const labelSkip = Math.max(1, Math.ceil(points.length / 12))

  function barHeight(value: number) {
    return (value / maxTotal) * innerH
  }

  return (
    <div ref={containerRef} className="w-full">
      <svg width={width} height={height} className="overflow-visible" role="img" aria-label="Denuncias mensuales por modalidad">
        {/* Rejilla y eje Y */}
        <g>
          {Array.from({ length: yTicks + 1 }, (_, i) => {
            const value = Math.round(i * yStep)
            const y = margin.top + innerH - barHeight(value)
            return (
              <g key={i}>
                <line
                  x1={margin.left}
                  y1={y}
                  x2={margin.left + innerW}
                  y2={y}
                  stroke="var(--grid-line)"
                  strokeWidth={1}
                />
                <text x={margin.left - 6} y={y + 3} textAnchor="end" fill="var(--content-muted)" fontSize={10}>
                  {numberFormat.format(value)}
                </text>
              </g>
            )
          })}
        </g>

        {/* Barras apiladas por modalidad */}
        <g>
          {points.map((point, index) => {
            const x = margin.left + index * (barW + barGap)
            let accumulated = 0
            return (
              <g key={point.key}>
                <title>{`${point.label}: ${numberFormat.format(point.total)} denuncias`}</title>
                {MODALITY_ORDER.map((modality) => {
                  const value = point.byModality[modality] ?? 0
                  if (value <= 0) return null
                  const h = barHeight(value)
                  const y = margin.top + innerH - accumulated - h
                  accumulated += h
                  return (
                    <rect
                      key={modality}
                      x={x}
                      y={y}
                      width={barW}
                      height={Math.max(h, 1)}
                      fill={MODALITY_CSS[modality]}
                    />
                  )
                })}
              </g>
            )
          })}
        </g>

        {/* Etiquetas del eje X */}
        <g>
          {points.map((point, index) => {
            const x = margin.left + index * (barW + barGap) + barW / 2
            const hidden = points.length > 12 && index % labelSkip !== 0 && index !== points.length - 1
            return (
              <text
                key={point.key}
                x={x}
                y={margin.top + innerH + 14}
                textAnchor="end"
                transform={`rotate(-40, ${x}, ${margin.top + innerH + 14})`}
                fill={hidden ? 'transparent' : 'var(--content-muted)'}
                fontSize={10}
                style={{ pointerEvents: 'none' }}
              >
                {point.label}
              </text>
            )
          })}
        </g>
      </svg>

      {/* Leyenda */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {MODALITY_ORDER.map((modality) => (
          <span key={modality} className="inline-flex items-center gap-1.5 text-[11px] text-content-secondary">
            <span className="size-2 rounded-sm" style={{ background: MODALITY_CSS[modality] }} aria-hidden />
            {MODALITY_SHORT[modality]}
          </span>
        ))}
      </div>
    </div>
  )
}
