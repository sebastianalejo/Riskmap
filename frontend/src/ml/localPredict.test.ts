import { describe, expect, it, vi } from 'vitest'

// Sin dataset publicado en las pruebas: `predictLocal` debe caer a la heurística.
vi.mock('../data/published', () => ({
  loadPredictStats: async () => {
    throw new Error('sin dataset publicado en pruebas')
  },
}))

import { predictLocal, type PredictInput } from './localPredict'

const base: PredictInput = {
  crime_type: 'robo a mano armada',
  hour: 23,
  day_of_week: 'viernes',
  district: 'LA VICTORIA',
  latitude: -12.071,
  longitude: -77.02,
  historical_frequency: 300,
}

describe('predictLocal (heurística, sin dataset publicado)', () => {
  it('delito violento de noche con frecuencia alta → riesgo alto', async () => {
    const result = await predictLocal(base)

    expect(result.method).toBe('heuristic')
    expect(result.prediction).toBe('alto')
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(100)
    expect(result.factors.length).toBeGreaterThan(0)
    expect(result.samples).toBe(0)
  })

  it('estafa de mañana con frecuencia baja → riesgo bajo', async () => {
    const result = await predictLocal({
      ...base,
      crime_type: 'estafa',
      hour: 10,
      historical_frequency: 10,
      district: 'MIRAFLORES',
    })

    expect(result.prediction).toBe('bajo')
    expect(result.method).toBe('heuristic')
  })
})
