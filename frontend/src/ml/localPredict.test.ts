import { afterEach, describe, expect, it, vi } from 'vitest'

// `loadPredictStats` se controla por prueba: con dataset → método 'dataset';
// lanzando error → la predicción cae a la heurística.
const { state } = vi.hoisted(() => ({
  state: { stats: null as unknown, fail: false },
}))

vi.mock('../data/published', () => ({
  loadPredictStats: async () => {
    if (state.fail) throw new Error('sin dataset publicado en pruebas')
    return state.stats
  },
}))

import { predictLocal, predictModalitiesFromStats, type PredictInput } from './localPredict'
import type { PredictStats } from '../data/published'

const STATS: PredictStats = {
  riskOrder: ['bajo', 'medio', 'alto'],
  byTypeDistrict: {
    'robo agravado|LA VICTORIA': [0, 5, 15],
    'hurto|LA VICTORIA': [10, 2, 0],
    'estafa|MIRAFLORES': [30, 0, 0],
  },
  byType: {
    'robo agravado': [0, 5, 15],
    hurto: [10, 2, 0],
    estafa: [30, 0, 0],
  },
  types: ['robo agravado', 'hurto', 'estafa'],
  districts: ['LA VICTORIA', 'MIRAFLORES'],
}

const base: PredictInput = {
  crime_type: 'robo agravado',
  hour: 23,
  day_of_week: 'viernes',
  district: 'LA VICTORIA',
}

afterEach(() => {
  state.stats = null
  state.fail = false
})

describe('predictLocal con dataset publicado', () => {
  it('usa los conteos del distrito y devuelve las modalidades más probables', async () => {
    state.stats = STATS
    const result = await predictLocal(base)

    expect(result.method).toBe('dataset')
    expect(result.samples).toBe(20) // 0+5+15 de «robo agravado|LA VICTORIA»
    expect(result.prediction).toBe('alto')
    // Composición del distrito: robo agravado 20 vs hurto 12 → 62.5% / 37.5%
    expect(result.modalities.map((m) => m.label)).toEqual(['robo agravado', 'hurto'])
    expect(result.modalities[0].probability).toBeCloseTo(20 / 32, 5)
    expect(result.modalities[1].probability).toBeCloseTo(12 / 32, 5)
  })

  it('deriva la frecuencia del distrito cuando no se especifica', async () => {
    state.stats = STATS
    const result = await predictLocal({ ...base, historical_frequency: undefined })
    expect(result.frequency).toBe(32) // 20 robo + 12 hurto en LA VICTORIA
  })

  it('cae al ranking global si el distrito no tiene registros', async () => {
    state.stats = STATS
    const result = await predictLocal({ ...base, district: 'DISTRITO INEXISTENTE' })
    const labels = result.modalities.map((m) => m.label)
    expect(labels).toContain('estafa')
    expect(labels).toContain('robo agravado')
  })
})

describe('predictModalitiesFromStats', () => {
  it('normaliza sobre el total del distrito y respeta topN', () => {
    const rows = predictModalitiesFromStats(STATS, 'LA VICTORIA', 1)
    expect(rows).toHaveLength(1)
    expect(rows[0].label).toBe('robo agravado')
    expect(rows[0].probability).toBeCloseTo(20 / 32, 5)
  })
})

describe('predictLocal sin dataset (heurística de respaldo)', () => {
  it('delito violento de noche → riesgo alto', async () => {
    state.fail = true
    const result = await predictLocal({ ...base, crime_type: 'robo a mano armada', historical_frequency: 300 })

    expect(result.method).toBe('heuristic')
    expect(result.prediction).toBe('alto')
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(100)
    expect(result.factors.length).toBeGreaterThan(0)
    expect(result.samples).toBe(0)
    expect(result.modalities).toEqual([])
  })

  it('estafa de mañana con frecuencia baja → riesgo bajo', async () => {
    state.fail = true
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
