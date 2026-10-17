import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadMapPoints, loadPublishedManifest, resetPublishedCache, toAnalysisIncident, toMapPoint, toMonthlyStat } from './published'

describe('toMapPoint (dataset publicado)', () => {
  it('convierte una fila compacta con año, hora y día', () => {
    const point = toMapPoint([
      'arc_1',
      -12.1,
      -77.0,
      'MIRAFLORES',
      'hurto',
      'alto',
      'inei',
      2024,
      22,
      'Viernes',
    ])

    expect(point).toEqual({
      id: 'arc_1',
      lat: -12.1,
      lng: -77.0,
      district: 'MIRAFLORES',
      crimeType: 'hurto',
      riskLevel: 'alto',
      source: 'inei',
      year: 2024,
      hour: 22,
      dayOfWeek: 'viernes',
    })
  })

  it('descarta filas sin coordenadas válidas', () => {
    expect(toMapPoint(['x', 'nope', -77, 'D', 'c', 'alto', 'inei', null, null, null])).toBeNull()
  })
})

describe('toAnalysisIncident (dataset publicado)', () => {
  it('conserva año, hora, día, frecuencia y fuente', () => {
    const incident = toAnalysisIncident([
      'inc_1',
      'COMAS',
      'robo agravado',
      2023,
      3,
      'lunes',
      'alto',
      120,
      'inei',
    ])

    expect(incident).toEqual({
      id: 'inc_1',
      district: 'COMAS',
      crimeType: 'robo agravado',
      year: 2023,
      hour: 3,
      dayOfWeek: 'lunes',
      riskLevel: 'alto',
      historicalFrequency: 120,
      source: 'inei',
    })
  })

  it('deja la fuente en null si la fila no la trae', () => {
    const incident = toAnalysisIncident(['inc_2', 'COMAS', 'hurto', 2023, 3, 'lunes', 'alto', 10])
    expect(incident?.source).toBeNull()
  })
})

describe('toMonthlyStat (dataset publicado)', () => {
  it('mapea porModalidad con el orden publicado', () => {
    const row = toMonthlyStat(
      [2024, 1, '150102', 'ANCON', 176, [1, 0, 34, 49, 14, 0, 78]],
      ['estafa', 'extorsion', 'hurto', 'otros', 'robo', 'secuestro', 'violencia_mujer'],
    )

    expect(row?.porModalidad).toEqual({
      estafa: 1,
      extorsion: 0,
      hurto: 34,
      otros: 49,
      robo: 14,
      secuestro: 0,
      violencia_mujer: 78,
    })
  })
})

const MANIFEST = {
  schemaVersion: 2,
  generatedAt: '2026-01-01T00:00:00Z',
  dataset: 'prueba',
  counts: { incidents: 1, mapPoints: 1, analysisRows: 1, monthlyRows: 0, sources: { inei: 1 } },
  files: {
    map: { name: 'files/incidents-map.abc123.json', bytes: 1, sha256: 'x', count: 1 },
    analysis: { name: 'files/incidents-analysis.abc123.json', bytes: 1, sha256: 'x', count: 1 },
    monthly: { name: 'files/crime-monthly.abc123.json', bytes: 1, sha256: 'x', count: 0 },
    predict: { name: 'files/predict-stats.abc123.json', bytes: 1, sha256: 'x', count: 0 },
  },
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

describe('carga del dataset publicado', () => {
  beforeEach(() => {
    resetPublishedCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('carga y convierte el mapa, y reutiliza la caché en memoria', async () => {
    const row = ['arc_1', -12.1, -77.0, 'MIRAFLORES', 'hurto', 'alto', 'inei', 2024, 22, 'viernes']
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/data/manifest.json')) return jsonResponse(MANIFEST)
      if (url.endsWith(MANIFEST.files.map.name)) return jsonResponse({ points: [row] })
      return new Response('', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = await loadMapPoints()
    expect(first).toEqual([
      {
        id: 'arc_1',
        lat: -12.1,
        lng: -77.0,
        district: 'MIRAFLORES',
        crimeType: 'hurto',
        riskLevel: 'alto',
        source: 'inei',
        year: 2024,
        hour: 22,
        dayOfWeek: 'viernes',
      },
    ])

    const second = await loadMapPoints()
    expect(second).toHaveLength(1)
    // Solo 2 peticiones: manifest + archivo (la segunda carga usa caché).
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falla con un mensaje claro si Hosting devuelve el index.html (archivo ausente)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    )

    await expect(loadPublishedManifest()).rejects.toThrow(/no devolvió JSON/)
  })
})
