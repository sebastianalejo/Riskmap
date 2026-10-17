import { describe, expect, it } from 'vitest'
import { mapIncidentToPoint, riskFromIncident, severityToRisk } from './incidentRows'

describe('severityToRisk y riskFromIncident', () => {
  it('traduce la severidad declarada', () => {
    expect(severityToRisk('alta')).toBe('alto')
    expect(severityToRisk(' MEDIA ')).toBe('medio')
    expect(severityToRisk('desconocida')).toBeUndefined()
    expect(severityToRisk(null)).toBeUndefined()
  })

  it('prioriza risk_level y cae a severity_level', () => {
    expect(riskFromIncident({ risk_level: 'Alto' })).toBe('alto')
    expect(riskFromIncident({ severity_level: 'baja' })).toBe('bajo')
    expect(riskFromIncident({ risk_level: 'extremo', severity_level: 'media' })).toBe('medio')
    expect(riskFromIncident({})).toBeUndefined()
  })
})

describe('mapIncidentToPoint', () => {
  it('mapea una fila legacy con risk_level', () => {
    const point = mapIncidentToPoint('inc_1', {
      latitude: -12.05,
      longitude: -77.05,
      district: 'MIRAFLORES',
      crime_type: 'hurto',
      risk_level: 'alto',
      hour: 20,
    })
    expect(point).toEqual({
      id: 'inc_1',
      lat: -12.05,
      lng: -77.05,
      source: 'firestore',
      district: 'MIRAFLORES',
      crimeType: 'hurto',
      hour: 20,
      riskLevel: 'alto',
      year: undefined,
    })
  })

  it('mapea una fila del esquema v2 (INEI) con año y severidad', () => {
    const point = mapIncidentToPoint('arc_2', {
      latitude: -12.1,
      longitude: -77.0,
      district: 'SURQUILLO',
      crime_type: 'robo agravado',
      severity_level: 'alta',
      occurred_year: 2023,
      source: 'inei',
    })
    expect(point?.riskLevel).toBe('alto')
    expect(point?.year).toBe(2023)
    expect(point?.source).toBe('inei')
    expect(point?.hour).toBeUndefined()
  })

  it('descarta documentos sin coordenadas válidas', () => {
    expect(mapIncidentToPoint('x', { latitude: 'abc', longitude: -77 })).toBeNull()
    expect(mapIncidentToPoint('x', {})).toBeNull()
  })
})
