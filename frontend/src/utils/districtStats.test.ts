import { describe, expect, it } from 'vitest'
import type { MonthlyStat } from './monthlyStats'
import { aggregateByDistrict, choroplethColor, legendBuckets } from './districtStats'

function stat(year: number, month: number, ubigeo: string, district: string, total: number, porModalidad: Record<string, number>): MonthlyStat {
  return { year, month, ubigeo, district, total, porModalidad }
}

const ROWS: MonthlyStat[] = [
  stat(2024, 1, '150122', 'MIRAFLORES', 10, { hurto: 8, robo: 2 }),
  stat(2024, 2, '150122', 'MIRAFLORES', 20, { hurto: 5, robo: 15 }),
  stat(2024, 1, '150131', 'SAN ISIDRO', 5, { hurto: 5, robo: 0 }),
  stat(2024, 2, '150131', 'SAN ISIDRO', 7, { estafa: 7, robo: 0 }),
]

describe('aggregateByDistrict', () => {
  it('suma por distrito y calcula la modalidad dominante', () => {
    const totals = aggregateByDistrict(ROWS, 0)
    expect(totals).toHaveLength(2)
    const miraflores = totals.find((item) => item.ubigeo === '150122')!
    expect(miraflores.total).toBe(30)
    expect(miraflores.topModality).toBe('robo') // 17 robos vs 13 hurtos
  })

  it('respeta la ventana de meses (últimos N periodos)', () => {
    const totals = aggregateByDistrict(ROWS, 1)
    const miraflores = totals.find((item) => item.ubigeo === '150122')!
    expect(miraflores.total).toBe(20) // solo febrero
  })

  it('devuelve vacío sin filas', () => {
    expect(aggregateByDistrict([], 12)).toEqual([])
  })
})

describe('choroplethColor y leyenda', () => {
  it('escala de 0 a max con alpha creciente', () => {
    expect(choroplethColor(0, 100)).toContain('0.12')
    expect(choroplethColor(100, 100)).toContain('0.90')
    expect(choroplethColor(500, 100)).toBe(choroplethColor(100, 100)) // clamp
  })

  it('genera buckets contiguos que cubren 0..max', () => {
    const buckets = legendBuckets(1000)
    expect(buckets).toHaveLength(5)
    expect(buckets[0].from).toBe(0)
    expect(buckets[4].to).toBe(1000)
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i].from).toBe(buckets[i - 1].to)
    }
  })

  it('maneja max=0', () => {
    expect(legendBuckets(0)).toHaveLength(1)
  })
})
