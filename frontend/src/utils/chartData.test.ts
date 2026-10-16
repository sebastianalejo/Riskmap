import { describe, expect, it } from 'vitest'
import { RANGE_CONFIG, RANGE_OPTIONS, computeChartData } from './chartData'
import type { PointWithDate } from './simulateDates'

function point(date: Date, riskLevel?: string): PointWithDate {
  return { id: date.toISOString(), lat: -12, lng: -77, riskLevel, date }
}

describe('computeChartData', () => {
  it('agrupa por día en el rango de 7d y calcula el cambio entre mitades', () => {
    const points = [
      point(new Date('2026-01-05T12:00:00'), 'alto'),
      point(new Date('2026-01-06T12:00:00'), 'alto'),
      point(new Date('2026-01-09T12:00:00'), 'alto'),
      point(new Date('2026-01-09T13:00:00'), 'bajo'),
      point(new Date('2026-01-10T13:00:00'), 'alto'),
    ]

    const { chartData, totalChange } = computeChartData(points, '7d')

    expect(chartData).toHaveLength(4) // 05, 06, 09 y 10
    const total = chartData.reduce((sum, bucket) => sum + bucket.alto + bucket.medio + bucket.bajo, 0)
    expect(total).toBe(5)
    expect(totalChange).toBeGreaterThan(0) // la segunda mitad concentra más incidentes
  })

  it('ignora niveles de riesgo desconocidos', () => {
    const { chartData } = computeChartData([point(new Date(), 'desconocido')], '7d')
    const total = chartData.reduce((sum, bucket) => sum + bucket.alto + bucket.medio + bucket.bajo, 0)
    expect(total).toBe(0)
  })

  it('devuelve una serie vacía sin puntos', () => {
    const { chartData, totalChange } = computeChartData([], '1m')
    expect(chartData).toEqual([])
    expect(totalChange).toBe(0)
  })
})

describe('RANGE_OPTIONS / RANGE_CONFIG', () => {
  it('mantienen etiquetas y días consistentes', () => {
    for (const option of RANGE_OPTIONS) {
      expect(RANGE_CONFIG[option.value].label).toBe(option.label)
      expect(RANGE_CONFIG[option.value].days).toBe(option.days)
    }
  })
})
