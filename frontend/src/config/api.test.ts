import { describe, expect, it, vi } from 'vitest'

vi.mock('../firebase/client', () => ({
  getFunctionsOrigin: () => 'https://example.test/functions',
}))

import { resolveApiUrl } from './api'

describe('resolveApiUrl', () => {
  it('mapea las rutas de la app a sus Cloud Functions', () => {
    expect(resolveApiUrl('/prediction/predict/')).toBe('https://example.test/functions/predict_crime')
    expect(resolveApiUrl('/prediction/health/')).toBe('https://example.test/functions/prediction_health')
    expect(resolveApiUrl('/firebase/import-rows/')).toBe('https://example.test/functions/import_incidents')
    expect(resolveApiUrl('/firebase/import-csv/')).toBe('https://example.test/functions/import_csv_dataset')
  })

  it('conserva la query string', () => {
    expect(resolveApiUrl('/prediction/health/?x=1')).toBe(
      'https://example.test/functions/prediction_health?x=1',
    )
  })

  it('lanza un error en rutas no disponibles', () => {
    expect(() => resolveApiUrl('/ruta/desconocida/')).toThrow(/Ruta no disponible/)
  })
})
