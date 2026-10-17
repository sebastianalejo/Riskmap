import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PredictPage } from './PredictPage'

describe('PredictPage (una sola pestaña, sin Cloud Functions)', () => {
  it('renderiza el encabezado y un único panel de predicción', () => {
    const html = renderToStaticMarkup(createElement(PredictPage))

    expect(html).toContain('Predicción de riesgo')
    expect(html).toContain('composición histórica')
    // Ya no existen las dos pestañas ni la que dependía de Cloud Functions.
    expect(html).not.toContain('Modelo de modalidad')
    expect(html).not.toContain('Estimación local')
    expect(html).not.toContain('role="tab"')
  })
})
