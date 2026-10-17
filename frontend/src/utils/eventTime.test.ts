import { describe, expect, it } from 'vitest'
import { formatEventTime, formatHour } from './eventTime'

describe('formatHour', () => {
  it('rellena a dos dígitos y añade los minutos', () => {
    expect(formatHour(0)).toBe('00:00')
    expect(formatHour(9)).toBe('09:00')
    expect(formatHour(22)).toBe('22:00')
  })
})

describe('formatEventTime', () => {
  it('combina año, día y hora (esquema INEI + hora)', () => {
    expect(formatEventTime({ year: 2024, dayOfWeek: 'viernes', hour: 22 })).toBe(
      '2024 · Viernes · 22:00',
    )
  })

  it('muestra solo lo disponible', () => {
    expect(formatEventTime({ year: 2023 })).toBe('2023')
    expect(formatEventTime({ dayOfWeek: 'miércoles', hour: 3 })).toBe('Miércoles · 03:00')
    expect(formatEventTime({ hour: 20 })).toBe('20:00')
  })

  it('acepta valores como texto (filas crudas de CSV/Excel)', () => {
    expect(formatEventTime({ year: '2022', dayOfWeek: 'SÁBADO', hour: '7' })).toBe(
      '2022 · Sábado · 07:00',
    )
  })

  it('devuelve un guion cuando no hay ningún dato temporal', () => {
    expect(formatEventTime({})).toBe('—')
    expect(formatEventTime({ year: null, dayOfWeek: '', hour: undefined })).toBe('—')
    expect(formatEventTime({ year: 'abc', hour: 'xyz' })).toBe('—')
  })
})
