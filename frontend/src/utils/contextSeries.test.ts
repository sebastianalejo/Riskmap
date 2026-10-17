import { describe, expect, it } from 'vitest'
import type { ContextSeriesRow } from '../data/published'
import { mpfnByYear, pivotIneiSeries } from './contextSeries'

const ROWS: ContextSeriesRow[] = [
  { category: 'inei', dimension: 'delitos', year: 2024, value: 166422, unit: 'casos' },
  { category: 'inei', dimension: 'tasa_delitos', year: 2024, value: 161.69, unit: 'por_10_000_hab' },
  { category: 'inei', dimension: 'robo_vehiculos', year: 2024, value: 7175, unit: 'casos' },
  { category: 'inei', dimension: 'detenidos', year: 2024, value: 46621, unit: 'casos' },
  { category: 'inei', dimension: 'delitos', year: 2023, value: 186361, unit: 'casos' },
  { category: 'mpfn', dimension: 'LIMA CENTRO', year: 2024, value: 100, unit: 'casos' },
  { category: 'mpfn', dimension: 'LIMA SUR', year: 2024, value: 50, unit: 'casos' },
  { category: 'mpfn', dimension: 'LIMA CENTRO', year: 2023, value: 80, unit: 'casos' },
]

describe('pivotIneiSeries', () => {
  it('pivota por año y ordena ascendente', () => {
    const rows = pivotIneiSeries(ROWS)
    expect(rows.map((row) => row.year)).toEqual([2023, 2024])
    const latest = rows[1]
    expect(latest.delitos).toBe(166422)
    expect(latest.tasa).toBeCloseTo(161.69, 2)
    expect(latest.roboVehiculos).toBe(7175)
    expect(latest.detenidos).toBe(46621)
    // Serie ausente ese año queda en null.
    expect(rows[0].tasa).toBeNull()
  })
})

describe('mpfnByYear', () => {
  it('suma los distritos fiscales por año', () => {
    expect(mpfnByYear(ROWS)).toEqual([
      { year: 2023, total: 80 },
      { year: 2024, total: 150 },
    ])
  })
})
