import type { MonthlyStat } from './monthlyStats'

export type DistrictTotals = {
  ubigeo: string
  district: string
  total: number
  topModality: string | null
  /** Población proyectada del distrito (si el contexto está publicado). */
  population: number | null
  /** Denuncias por 100 000 habitantes dentro de la ventana (o `null` sin población). */
  rate: number | null
  /** Comisarías del distrito (contexto policial; 0 si no se conoce). */
  stationsCount: number
}

/** Contexto mínimo por distrito que consume la coropleta. */
export type DistrictContextInput = {
  population: number | null
  stationsCount?: number
}

/** Denuncias por 100 000 habitantes (o `null` si no hay población válida). */
export function ratePer100k(total: number, population: number | null | undefined): number | null {
  if (!population || population <= 0) return null
  return (total / population) * 100000
}

/** Métrica de la capa coroplética. */
export type ChoroplethMetric = 'conteo' | 'tasa'

/** Valor de un distrito según la métrica elegida. */
export function districtMetricValue(item: DistrictTotals, metric: ChoroplethMetric): number {
  return metric === 'tasa' ? item.rate ?? 0 : item.total
}

/** Suma la serie mensual por distrito dentro de la ventana de meses (0 = todo). */
export function aggregateByDistrict(
  rows: MonthlyStat[],
  months: number,
  contextByUbigeo?: Map<string, DistrictContextInput>,
): DistrictTotals[] {
  if (rows.length === 0) return []

  const periods = [...new Set(rows.map((row) => row.year * 100 + row.month))].sort((a, b) => a - b)
  const window = months > 0 ? new Set(periods.slice(-months)) : null

  const bucket = new Map<string, { district: string; total: number; byModality: Record<string, number> }>()
  for (const row of rows) {
    const period = row.year * 100 + row.month
    if (window && !window.has(period)) continue
    const entry = bucket.get(row.ubigeo) ?? { district: row.district, total: 0, byModality: {} }
    entry.total += row.total
    for (const [modality, count] of Object.entries(row.porModalidad)) {
      entry.byModality[modality] = (entry.byModality[modality] ?? 0) + count
    }
    bucket.set(row.ubigeo, entry)
  }

  return [...bucket.entries()]
    .map(([ubigeo, entry]) => {
      const top = Object.entries(entry.byModality).sort((a, b) => b[1] - a[1])[0]
      const context = contextByUbigeo?.get(ubigeo)
      const population = context?.population ?? null
      return {
        ubigeo,
        district: entry.district,
        total: entry.total,
        topModality: top ? top[0] : null,
        population,
        rate: ratePer100k(entry.total, population),
        stationsCount: context?.stationsCount ?? 0,
      }
    })
    .sort((a, b) => b.total - a.total)
}

/** Color secuencial (teal) proporcional al total, para la coropleta. */
export function choroplethColor(total: number, max: number): string {
  if (max <= 0) return 'rgba(148, 163, 184, 0.25)'
  const ratio = Math.max(0, Math.min(1, total / max))
  const alpha = 0.12 + ratio * 0.78
  return `rgba(45, 212, 191, ${alpha.toFixed(2)})`
}

export function legendBuckets(max: number, steps = 5): { from: number; to: number; color: string }[] {
  if (max <= 0) return [{ from: 0, to: 0, color: choroplethColor(0, 0) }]
  const buckets = []
  for (let index = 0; index < steps; index++) {
    const from = Math.round((max / steps) * index)
    const to = Math.round((max / steps) * (index + 1))
    buckets.push({ from, to, color: choroplethColor((from + to) / 2, max) })
  }
  return buckets
}
