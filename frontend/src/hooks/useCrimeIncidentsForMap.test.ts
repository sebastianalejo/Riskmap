import { describe, expect, it } from 'vitest'
import { MAX_DOCS } from './useCrimeIncidentsForMap'

describe('MAX_DOCS (tope de consulta del mapa)', () => {
  it('no supera el límite duro de Firestore (10 000)', () => {
    // Regresión: subir este valor rompe la consulta con
    // "Limit value in the structured query is over the maximum value of 10000".
    expect(MAX_DOCS).toBeLessThanOrEqual(10_000)
    expect(MAX_DOCS).toBeGreaterThan(0)
  })
})
