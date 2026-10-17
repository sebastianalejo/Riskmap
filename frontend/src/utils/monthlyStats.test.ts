import { describe, expect, it } from 'vitest'
import {
  aggregateSeries,
  districtOptions,
  halfPeriodChange,
  MODALITY_LABELS,
  type MonthlyStat,
} from './monthlyStats'

function stat(year: number, month: number, district: string, total: number): MonthlyStat {
  return {
    year,
    month,
    ubigeo: '150122',
    district,
    total,
    porModalidad: { hurto: total, robo: 0 },
  }
}

const ROWS: MonthlyStat[] = [
  stat(2024, 1, 'MIRAFLORES', 10),
  stat(2024, 1, 'SAN ISIDRO', 5),
  stat(2024, 2, 'MIRAFLORES', 20),
  stat(2024, 3, 'MIRAFLORES', 30),
]

describe('aggregateSeries', () => {
  it('suma distritos por mes y ordena cronológicamente', () => {
    const series = aggregateSeries(ROWS)
    expect(series.map((point) => point.key)).toEqual(['2024-01', '2024-02', '2024-03'])
    expect(series[0].total).toBe(15)
    expect(series[2].total).toBe(30)
    expect(series[0].label).toBe('ene 24')
  })

  it('filtra por distrito y aplica la ventana de meses', () => {
    const filtered = aggregateSeries(ROWS, { district: 'MIRAFLORES', months: 2 })
    expect(filtered.map((point) => point.key)).toEqual(['2024-02', '2024-03'])
  })

  it('acumula modalidades en el punto', () => {
    const [first] = aggregateSeries(ROWS)
    expect(first.byModality.hurto).toBe(15)
  })
})

describe('halfPeriodChange', () => {
  it('calcula el cambio entre mitades', () => {
    expect(halfPeriodChange(aggregateSeries(ROWS))).toBeGreaterThan(0)
    expect(halfPeriodChange([])).toBe(0)
    expect(halfPeriodChange(aggregateSeries([stat(2024, 1, 'A', 0)]))).toBe(0)
  })
})

describe('districtOptions y catálogo de modalidades', () => {
  it('lista distritos únicos ordenados', () => {
    expect(districtOptions(ROWS)).toEqual(['MIRAFLORES', 'SAN ISIDRO'])
  })

  it('todas las claves del catálogo tienen etiqueta', () => {
    for (const key of Object.keys(MODALITY_LABELS)) {
      expect(MODALITY_LABELS[key].length).toBeGreaterThan(1)
    }
  })
})
