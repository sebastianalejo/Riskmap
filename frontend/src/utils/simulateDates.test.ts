import { describe, expect, it } from 'vitest'
import { SIMULATED_DATES_NOTICE, simulateDates } from './simulateDates'

describe('simulateDates', () => {
  it('genera fechas dentro de la ventana pedida y respeta la hora del punto', () => {
    const before = Date.now()
    const points = [{ id: 'a', lat: -12.05, lng: -77.05, hour: 7 }]

    const [result] = simulateDates(points, 7)

    const ms = result.date.getTime()
    expect(ms).toBeLessThanOrEqual(Date.now())
    expect(ms).toBeGreaterThanOrEqual(before - 7 * 24 * 60 * 60 * 1000 - 1000)
    expect(result.date.getHours()).toBe(7)
  })

  it('la ventana de 7 días no genera un octavo día', () => {
    const points = Array.from({ length: 400 }, (_, i) => ({ id: String(i), lat: -12, lng: -77 }))
    const days = new Set(
      simulateDates(points, 7).map((p) => `${p.date.getFullYear()}-${p.date.getMonth()}-${p.date.getDate()}`),
    )
    expect(days.size).toBeLessThanOrEqual(7)
  })

  it('devuelve una lista vacía sin puntos', () => {
    expect(simulateDates([], 30)).toEqual([])
  })

  it('expone un aviso explícito de simulación para la UI y el PDF', () => {
    expect(SIMULATED_DATES_NOTICE).toMatch(/simulad/i)
    expect(SIMULATED_DATES_NOTICE).toMatch(/no representan/i)
  })
})
