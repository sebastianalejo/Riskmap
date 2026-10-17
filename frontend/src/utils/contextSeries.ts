import type { ContextSeriesRow } from '../data/published'

export type IneiDimension = 'delitos' | 'tasa' | 'roboVehiculos' | 'detenidos'

export type IneiYearRow = { year: number } & Record<IneiDimension, number | null>

const INEI_DIMENSIONS: Record<string, IneiDimension> = {
  delitos: 'delitos',
  tasa_delitos: 'tasa',
  robo_vehiculos: 'roboVehiculos',
  detenidos: 'detenidos',
}

/** Pivota las series del INEI (Lima Metropolitana) a una fila por año. */
export function pivotIneiSeries(rows: ContextSeriesRow[]): IneiYearRow[] {
  const byYear = new Map<number, IneiYearRow>()
  for (const row of rows) {
    if (row.category !== 'inei' || row.year === null) continue
    const dimension = INEI_DIMENSIONS[row.dimension]
    if (!dimension) continue
    const entry =
      byYear.get(row.year) ??
      ({ year: row.year, delitos: null, tasa: null, roboVehiculos: null, detenidos: null } as IneiYearRow)
    entry[dimension] = row.value
    byYear.set(row.year, entry)
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year)
}

/** Suma las denuncias del MPFN por año (todos los distritos fiscales de Lima/Callao). */
export function mpfnByYear(rows: ContextSeriesRow[]): { year: number; total: number }[] {
  const map = new Map<number, number>()
  for (const row of rows) {
    if (row.category !== 'mpfn' || row.year === null || row.value === null) continue
    map.set(row.year, (map.get(row.year) ?? 0) + row.value)
  }
  return [...map.entries()]
    .map(([year, total]) => ({ year, total }))
    .sort((a, b) => a.year - b.year)
}
