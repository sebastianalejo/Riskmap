import { describe, expect, it } from 'vitest'
import { filterPointsBySource } from './useCrimeIncidentsForMap'
import type { MapPoint } from '../utils/incidentRows'

const POINTS: MapPoint[] = [
  { id: 'a', lat: -12.0, lng: -77.0, source: 'inei' },
  { id: 'b', lat: -12.1, lng: -77.1, source: 'modalidad' },
]

describe('filterPointsBySource (filtro en el navegador)', () => {
  it('sin fuente devuelve todos los puntos publicados', () => {
    expect(filterPointsBySource(POINTS)).toHaveLength(2)
  })

  it('filtra por fuente sin consultar Firestore', () => {
    expect(filterPointsBySource(POINTS, 'modalidad').map((p) => p.id)).toEqual(['b'])
    expect(filterPointsBySource(POINTS, 'inei').map((p) => p.id)).toEqual(['a'])
    expect(filterPointsBySource(POINTS, 'otra')).toEqual([])
  })
})
