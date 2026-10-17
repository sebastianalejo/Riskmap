import { describe, expect, it } from 'vitest'
import { fnv1a64Hex, stableRowId } from './stableId'

// Vectores de paridad compartidos con tests/pipeline/test_upload_incidents.py (Python).
const ROW_1 = {
  crime_type: 'robo agravado',
  hour: 20,
  day_of_week: 'lunes',
  district: 'SAN MARTIN DE PORRES',
  latitude: -11.99769,
  longitude: -77.088301,
  historical_frequency: 1545,
  risk_level: 'alto',
}

const ROW_3 = {
  crime_type: 'hurto',
  hour: 8,
  day_of_week: 'sábado',
  district: 'MIRAFLORES',
  latitude: -12.1219,
  longitude: -77.0297,
  historical_frequency: 140,
  risk_level: 'bajo',
}

describe('stableId (FNV-1a 64)', () => {
  it('coincide con los vectores estándar de FNV-1a', () => {
    expect(fnv1a64Hex('')).toBe('cbf29ce484222325')
    expect(fnv1a64Hex('a')).toBe('af63dc4c8601ec8c')
  })

  it('genera IDs deterministas (paridad con Python)', () => {
    expect(stableRowId(ROW_1)).toBe('inc_ac49d71720e07651')
    expect(stableRowId(ROW_3)).toBe('inc_e3b94f27353cfa45')
  })

  it('es estable aunque cambie el orden de las claves de entrada', () => {
    const reversed = Object.fromEntries(Object.entries(ROW_1).reverse())
    expect(stableRowId(reversed)).toBe(stableRowId(ROW_1))
  })
})
