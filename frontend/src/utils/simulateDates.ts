import type { MapPoint } from '../hooks/useCrimeIncidentsForMap'

export type PointWithDate = MapPoint & { date: Date }

/**
 * Aviso compartido (gráfico y PDF): la fecha de cada punto se genera
 * aleatoriamente para poder dibujar una serie de demostración.
 * NO es la fecha real del incidente.
 */
export const SIMULATED_DATES_NOTICE =
  'Fechas simuladas con fines de demostración: no representan la fecha real de los incidentes.'

/**
 * Asigna fechas aleatorias dentro de los últimos `daysBack` días (solo demo visual).
 * Se usa porque el esquema de datos actual no almacena la fecha del incidente.
 */
export function simulateDates(points: MapPoint[], daysBack: number): PointWithDate[] {
  if (points.length === 0) return []

  // Se usa (daysBack - 1) para que el rango cubra exactamente `daysBack` días de calendario
  // (hoy + días anteriores) y no genere un día extra en el borde.
  const rangeMs = Math.max(daysBack - 1, 1) * 24 * 60 * 60 * 1000
  const endMs = Date.now()

  return points.map((p) => {
    const offset = Math.random() * rangeMs
    const date = new Date(endMs - offset)

    if (typeof p.hour === 'number') {
      date.setHours(p.hour, Math.floor(Math.random() * 60), 0, 0)
    }

    return { ...p, date }
  })
}
