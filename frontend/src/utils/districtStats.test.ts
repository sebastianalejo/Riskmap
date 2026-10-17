import { describe, expect, it } from 'vitest'
import type { MonthlyStat } from './monthlyStats'
import {
  aggregateByDistrict,
  choroplethColor,
  districtMetricValue,
  legendBuckets,
  ratePer100k,
} from './districtStats'

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

  it('calcula la tasa por 100 000 con la población del contexto', () => {
    const context = new Map([
      ['150122', { population: 100000, stationsCount: 4 }],
      ['150131', { population: 50000, stationsCount: 2 }],
    ])
    const totals = aggregateByDistrict(ROWS, 0, context)
    const miraflores = totals.find((item) => item.ubigeo === '150122')!
    expect(miraflores.population).toBe(100000)
    expect(miraflores.rate).toBeCloseTo(30, 6) // 30 / 100000 * 100000
    expect(miraflores.stationsCount).toBe(4)
    const sanIsidro = totals.find((item) => item.ubigeo === '150131')!
    expect(sanIsidro.rate).toBeCloseTo(24, 6) // 12 / 50000 * 100000
  })

  it('deja la tasa en null sin población', () => {
    const totals = aggregateByDistrict(ROWS, 0)
    expect(totals.find((item) => item.ubigeo === '150122')!.rate).toBeNull()
  })
})

describe('ratePer100k y districtMetricValue', () => {
  it('ratePer100k evita división por cero', () => {
    expect(ratePer100k(10, 0)).toBeNull()
    expect(ratePer100k(10, null)).toBeNull()
    expect(ratePer100k(50, 100000)).toBeCloseTo(50, 6)
  })

  it('districtMetricValue alterna entre conteo y tasa', () => {
    const item = {
      ubigeo: 'x',
      district: 'X',
      total: 30,
      topModality: null,
      population: 100000,
      rate: 30,
      stationsCount: 0,
    }
    expect(districtMetricValue(item, 'conteo')).toBe(30)
    expect(districtMetricValue(item, 'tasa')).toBe(30)
    expect(districtMetricValue({ ...item, rate: null }, 'tasa')).toBe(0)
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
