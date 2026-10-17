import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MonthlyTrendChart } from './MonthlyTrendChart'
import type { SeriesPoint } from '../../utils/monthlyStats'

function point(index: number, total: number, robo: number, hurto: number): SeriesPoint {
  return {
    key: `2024-${String(index + 1).padStart(2, '0')}`,
    label: `mes ${index + 1}`,
    total,
    byModality: { robo, hurto, otros: total - robo - hurto },
  }
}

describe('MonthlyTrendChart (estructura SSR)', () => {
  it('dibuja una barra apilada por punto con tooltip y leyenda HTML', () => {
    const points = [point(0, 100, 40, 35), point(1, 120, 50, 40), point(2, 90, 30, 35)]

    const html = renderToStaticMarkup(createElement(MonthlyTrendChart, { points }))

    expect(html).toContain('aria-label="Denuncias mensuales por modalidad"')
    // Un tooltip nativo por punto de la serie.
    expect((html.match(/<title>/g) ?? []).length).toBe(3)
    // La leyenda es HTML (fuera del SVG) y nombra las modalidades.
    expect(html.indexOf('Robo')).toBeGreaterThan(html.indexOf('<svg'))
    expect(html).toContain('Violencia')
    // Segmentos: 3 modalidades × 3 puntos, todos con ancho acotado.
    const widths = [...html.matchAll(/<rect[^>]*width="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(widths.length).toBe(9)
    expect(widths.every((w) => w > 0 && w <= 56)).toBe(true)
  })

  it('muestra el estado vacío sin datos', () => {
    const html = renderToStaticMarkup(createElement(MonthlyTrendChart, { points: [] }))
    expect(html).toContain('No hay datos para mostrar')
  })
})
