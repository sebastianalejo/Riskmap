import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const { state, DATA } = vi.hoisted(() => {
  const DATA = [
    {
      id: '1',
      district: 'MIRAFLORES',
      crimeType: 'hurto',
      hour: 23,
      dayOfWeek: 'viernes',
      riskLevel: 'alto',
      historicalFrequency: 120,
    },
    {
      id: '2',
      district: 'MIRAFLORES',
      crimeType: 'robo agravado',
      hour: 14,
      dayOfWeek: 'sábado',
      riskLevel: 'medio',
      historicalFrequency: 150,
    },
    {
      id: '3',
      district: 'COMAS',
      crimeType: 'hurto',
      hour: 3,
      dayOfWeek: 'lunes',
      riskLevel: 'alto',
      historicalFrequency: 230,
    },
  ]
  return { state: { incidents: DATA as typeof DATA | [] }, DATA }
})

vi.mock('../hooks/useIncidentsForAnalysis', () => ({
  ANALYSIS_MAX_DOCS: 5000,
  useIncidentsForAnalysis: () => ({
    incidents: state.incidents,
    loading: false,
    error: null,
    truncated: false,
  }),
}))

vi.mock('../components/ui/toast', () => ({
  useToast: () => ({ toast: () => 0, dismiss: () => undefined }),
}))

import { AnalysisPage } from './AnalysisPage'

function render(): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AnalysisPage)))
}

describe('AnalysisPage (estructura SSR)', () => {
  it('renderiza KPIs, gráficos, tabla comparativa y panel metodológico con datos', () => {
    state.incidents = DATA
    const html = render()

    expect(html).toContain('Análisis de datos')
    // KPIs
    expect(html).toContain('Incidentes analizados')
    expect(html).toContain('Frecuencia histórica promedio')
    // Tarjetas de todos los gráficos
    expect(html).toContain('Tipos de delito más frecuentes')
    expect(html).toContain('Composición de riesgo por distrito')
    expect(html).toContain('Patrón horario')
    expect(html).toContain('Patrón semanal')
    expect(html).toContain('Frecuencia histórica por distrito')
    // Tabla y detalle por distrito
    expect(html).toContain('Comparación entre distritos')
    expect(html).toContain('MIRAFLORES')
    expect(html).toContain('COMAS')
    // Exportaciones y metodología
    expect(html).toContain('CSV')
    expect(html).toContain('PDF')
    expect(html).toContain('Cómo leer este panel')
    expect(html).toContain('historical_frequency')
  })

  it('muestra el estado vacío (sin registros) manteniendo la metodología', () => {
    state.incidents = []
    const html = render()

    expect(html).toContain('Sin datos para analizar')
    expect(html).toContain('Cómo leer este panel')
    expect(html).not.toContain('Comparación entre distritos')
  })
})
