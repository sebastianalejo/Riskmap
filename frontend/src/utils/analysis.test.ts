import { describe, expect, it } from 'vitest'
import {
  applyFilters,
  buildDistrictTable,
  computeOverview,
  countActiveFilters,
  countByCrimeType,
  countByHour,
  countByWeekday,
  createDefaultFilters,
  districtRowsToCsv,
  frequencyByDistrict,
  isNightHour,
  riskByDistrict,
  WEEKDAYS,
} from './analysis'
import type { AnalysisIncident } from '../hooks/useIncidentsForAnalysis'

function incident(overrides: Partial<AnalysisIncident> = {}): AnalysisIncident {
  return {
    id: 'x',
    district: 'MIRAFLORES',
    crimeType: 'hurto',
    year: null,
    hour: 12,
    dayOfWeek: 'lunes',
    riskLevel: 'bajo',
    historicalFrequency: 100,
    ...overrides,
  }
}

describe('applyFilters', () => {
  const data = [
    incident({ id: 'a', district: 'A', crimeType: 'hurto', hour: 3, dayOfWeek: 'lunes', riskLevel: 'alto' }),
    incident({ id: 'b', district: 'B', crimeType: 'robo', hour: 15, dayOfWeek: 'martes', riskLevel: 'bajo' }),
    incident({ id: 'c', district: 'A', crimeType: 'robo', hour: null, dayOfWeek: null, riskLevel: null }),
  ]

  it('devuelve todo con los filtros por defecto', () => {
    expect(applyFilters(data, createDefaultFilters()).map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('filtra por distrito, tipo, día y franja horaria', () => {
    expect(applyFilters(data, { ...createDefaultFilters(), district: 'A' }).map((i) => i.id)).toEqual(['a', 'c'])
    expect(applyFilters(data, { ...createDefaultFilters(), crimeType: 'robo' }).map((i) => i.id)).toEqual(['b', 'c'])
    expect(applyFilters(data, { ...createDefaultFilters(), dayOfWeek: 'martes' }).map((i) => i.id)).toEqual(['b'])
    // Madrugada (00–05): excluye registros sin hora.
    expect(applyFilters(data, { ...createDefaultFilters(), hourRange: 1 }).map((i) => i.id)).toEqual(['a'])
  })

  it('respeta la selección de niveles de riesgo', () => {
    expect(applyFilters(data, { ...createDefaultFilters(), risks: ['alto'] }).map((i) => i.id)).toEqual(['a'])
    // Sin niveles seleccionados se excluye todo (incluidos los sin riesgo al no estar "todos").
    expect(applyFilters(data, { ...createDefaultFilters(), risks: [] })).toEqual([])
  })
})

describe('countActiveFilters', () => {
  it('cuenta cada filtro distinto de su valor por defecto', () => {
    expect(countActiveFilters(createDefaultFilters())).toBe(0)
    expect(countActiveFilters({ ...createDefaultFilters(), district: 'A', risks: ['alto'] })).toBe(2)
    expect(
      countActiveFilters({ ...createDefaultFilters(), hourRange: 2, dayOfWeek: 'lunes' }),
    ).toBe(2)
  })
})

describe('computeOverview', () => {
  const data = [
    incident({ id: '1', district: 'A', crimeType: 'hurto', riskLevel: 'alto', historicalFrequency: 10 }),
    incident({ id: '2', district: 'A', crimeType: 'robo', riskLevel: 'bajo', historicalFrequency: 20 }),
    incident({ id: '3', district: 'B', crimeType: 'robo', riskLevel: 'alto', historicalFrequency: 30 }),
    incident({ id: '4', district: 'B', crimeType: 'robo', riskLevel: 'medio', historicalFrequency: 40 }),
  ]

  it('agrega conteos, porcentajes, frecuencia y líderes', () => {
    const overview = computeOverview(data)
    expect(overview.total).toBe(4)
    expect(overview.districts).toBe(2)
    expect(overview.riskCounts).toEqual({ bajo: 1, medio: 1, alto: 2 })
    expect(overview.pctAlto).toBe(50)
    expect(overview.avgFrequency).toBe(25)
    expect(overview.medianFrequency).toBe(25)
    expect(overview.topCrime).toEqual({ name: 'robo', count: 3 })
    expect(overview.topDistrict).toEqual({ name: 'A', count: 2 })
  })

  it('tolera datasets vacíos', () => {
    const overview = computeOverview([])
    expect(overview.total).toBe(0)
    expect(overview.pctAlto).toBe(0)
    expect(overview.avgFrequency).toBeNull()
    expect(overview.medianFrequency).toBeNull()
    expect(overview.topCrime).toBeNull()
    expect(overview.topDistrict).toBeNull()
  })
})

describe('countByCrimeType / countByHour / countByWeekday', () => {
  it('cuenta tipos de delito con porcentaje y top N', () => {
    const rows = countByCrimeType(
      [incident({ crimeType: 'hurto' }), incident({ crimeType: 'robo' }), incident({ crimeType: 'robo' })],
      1,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ name: 'robo', count: 2, pct: expect.closeTo(200 / 3, 5) })
  })

  it('devuelve 24 horas aunque falten registros', () => {
    const rows = countByHour([incident({ hour: 0 }), incident({ hour: 0 }), incident({ hour: 23 }), incident({ hour: null })])
    expect(rows).toHaveLength(24)
    expect(rows[0].count).toBe(2)
    expect(rows[0].pct).toBeCloseTo(200 / 3, 5)
    expect(rows[23].count).toBe(1)
  })

  it('ordena la semana de lunes a domingo e ignora días desconocidos', () => {
    const rows = countByWeekday([
      incident({ dayOfWeek: 'domingo' }),
      incident({ dayOfWeek: 'lunes' }),
      incident({ dayOfWeek: 'festivo' }),
      incident({ dayOfWeek: null }),
    ])
    expect(rows.map((row) => row.day)).toEqual([...WEEKDAYS])
    expect(rows[0].count).toBe(1) // lunes
    expect(rows[6].count).toBe(1) // domingo
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(2)
  })
})

describe('riskByDistrict / frequencyByDistrict', () => {
  it('compone el riesgo por distrito sobre registros válidos', () => {
    const rows = riskByDistrict([
      incident({ district: 'A', riskLevel: 'alto' }),
      incident({ district: 'A', riskLevel: 'bajo' }),
      incident({ district: 'A', riskLevel: null }),
      incident({ district: 'B', riskLevel: 'alto' }),
    ])
    expect(rows[0].district).toBe('A') // ordenado por total
    expect(rows[0].total).toBe(3)
    expect(rows[0].pctAlto).toBe(50)
    expect(rows[0].pctBajo).toBe(50)
    expect(rows[1].district).toBe('B')
    expect(rows[1].pctAlto).toBe(100)
  })

  it('calcula promedio, mediana y máximo de la frecuencia histórica', () => {
    const rows = frequencyByDistrict(
      [
        incident({ district: 'A', historicalFrequency: 10 }),
        incident({ district: 'A', historicalFrequency: 30 }),
        incident({ district: 'B', historicalFrequency: 40 }),
        incident({ district: 'B', historicalFrequency: 60 }),
        incident({ district: 'B', historicalFrequency: 80 }),
        incident({ district: 'C', historicalFrequency: null }),
      ],
      2,
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ district: 'B', count: 3, avg: 60, median: 60, max: 80 })
    expect(rows[1]).toMatchObject({ district: 'A', count: 2, avg: 20, median: 20, max: 30 })
  })
})

describe('buildDistrictTable / districtRowsToCsv', () => {
  it('calcula % alto, % nocturno, frecuencia y delito principal', () => {
    const rows = buildDistrictTable([
      incident({ district: 'A', hour: 23, riskLevel: 'alto', crimeType: 'hurto' }),
      incident({ district: 'A', hour: 12, riskLevel: 'bajo', crimeType: 'hurto' }),
      incident({ district: 'A', hour: 1, riskLevel: 'alto', crimeType: 'robo' }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].incidents).toBe(3)
    expect(rows[0].pctAlto).toBeCloseTo(200 / 3, 5)
    expect(rows[0].pctNight).toBeCloseTo(200 / 3, 5)
    expect(rows[0].avgFrequency).toBe(100)
    expect(rows[0].topCrime).toBe('hurto')
  })

  it('detecta la franja nocturna 22:00–05:59', () => {
    expect(isNightHour(22)).toBe(true)
    expect(isNightHour(5)).toBe(true)
    expect(isNightHour(0)).toBe(true)
    expect(isNightHour(6)).toBe(false)
    expect(isNightHour(21)).toBe(false)
  })

  it('serializa el CSV con encabezados, comillas y saltos CRLF', () => {
    const csv = districtRowsToCsv([
      {
        district: 'A, B',
        incidents: 12,
        pctAlto: 33.333,
        pctNight: 0,
        avgFrequency: null,
        topCrime: 'robo "x"',
      },
    ])
    expect(csv).toContain('Distrito,Incidentes,% riesgo alto')
    expect(csv).toContain('"A, B"')
    expect(csv).toContain('"robo ""x"""')
    expect(csv).toContain('33.3')
    // Encabezado + una fila.
    expect(csv.split('\r\n')).toHaveLength(2)
  })
})
