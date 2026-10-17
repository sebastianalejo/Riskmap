/**
 * Formato temporal de un incidente («evento») usando únicamente los campos
 * reales del dataset: `occurred_year` (INEI), `day_of_week` y `hour`.
 *
 * El pipeline no publica la fecha exacta del hecho, así que nunca se inventa
 * un día/mes: solo se combinan los campos disponibles.
 */

/** Valores aceptados para año/hora: pueden llegar como número o como texto. */
type Numish = number | string | null | undefined

function toNumber(value: Numish): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** Hora en formato `HH:00` (el dataset solo guarda la hora, no los minutos). */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

export interface EventTimeParts {
  year?: Numish
  dayOfWeek?: string | null
  hour?: Numish
}

/**
 * Combina año, día de semana y hora en un texto legible:
 * `2024 · Viernes · 22:00`, `2024`, `Viernes · 22:00` o `—` si no hay nada.
 */
export function formatEventTime({ year, dayOfWeek, hour }: EventTimeParts): string {
  const parts: string[] = []

  const yearNum = toNumber(year)
  if (yearNum !== null) parts.push(String(yearNum))

  const day = typeof dayOfWeek === 'string' ? dayOfWeek.trim() : ''
  if (day) parts.push(capitalize(day.toLowerCase()))

  const hourNum = toNumber(hour)
  if (hourNum !== null) parts.push(formatHour(hourNum))

  return parts.length > 0 ? parts.join(' · ') : '—'
}
