import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { IncidentTrendChart } from './IncidentTrendChart'
import type { PointWithDate } from '../utils/simulateDates'

function dayOffset(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(15, 0, 0, 0)
  return d
}

function point(id: number, riskLevel: 'bajo' | 'medio' | 'alto', daysAgo: number): PointWithDate {
  return { id: String(id), lat: -12, lng: -77, riskLevel, date: dayOffset(daysAgo) }
}

describe('IncidentTrendChart (estructura SSR)', () => {
  it('dibuja leyenda HTML, una barra por día, ticks enteros y anchos acotados', () => {
    // 7 días × 10 incidentes (todos "alto") => total 10 por día.
    const points: PointWithDate[] = []
    for (let day = 0; day < 7; day++) {
      for (let i = 0; i < 10; i++) points.push(point(day * 10 + i, 'alto', day))
    }

    const html = renderToStaticMarkup(
      createElement(IncidentTrendChart, { points, range: '7d' }),
    )

    // La leyenda vive fuera del SVG (fila HTML antes del gráfico).
    expect(html).toContain('aria-label="Niveles de riesgo"')
    expect(html.indexOf('Niveles de riesgo')).toBeLessThan(html.indexOf('<svg'))

    // Una barra por día con tooltip nativo.
    expect((html.match(/<title>/g) ?? []).length).toBe(7)

    // Eje Y con ticks enteros: 0, 5 y 10 (sin decimales).
    const ticks = [...html.matchAll(/<text[^>]*>(\d+)<\/text>/g)].map((m) => m[1])
    expect(ticks).toContain('0')
    expect(ticks).toContain('5')
    expect(ticks).toContain('10')
    expect(html).not.toMatch(/>\d+\.\d+<\/text>/)

    // Barras con ancho acotado (<= 56 px) y nunca negativas.
    const barWidths = [...html.matchAll(/<rect[^>]*width="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(barWidths.length).toBeGreaterThan(0)
    expect(barWidths.every((w) => w > 0 && w <= 56)).toBe(true)
  })

  it('muestra el estado vacío sin datos', () => {
    const html = renderToStaticMarkup(
      createElement(IncidentTrendChart, { points: [], range: '7d' }),
    )
    expect(html).toContain('No hay datos para mostrar')
  })
})
