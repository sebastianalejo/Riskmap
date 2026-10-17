/**
 * Agregación de la serie mensual real de denuncias oficiales y catálogo de
 * modalidades para los gráficos y el PDF.
 */

export type MonthlyStat = {
  year: number
  month: number
  ubigeo: string
  district: string
  total: number
  porModalidad: Record<string, number>
}

export const MODALITY_ORDER = [
  'robo',
  'hurto',
  'estafa',
  'extorsion',
  'secuestro',
  'violencia_mujer',
  'otros',
] as const

export const MODALITY_LABELS: Record<string, string> = {
  robo: 'Robo',
  hurto: 'Hurto',
  estafa: 'Estafa',
  extorsion: 'Extorsión',
  secuestro: 'Secuestro',
  violencia_mujer: 'Violencia (mujer y grupo familiar)',
  otros: 'Otros',
}

/** Etiquetas cortas (leyendas compactas en gráfico y PDF). */
export const MODALITY_SHORT: Record<string, string> = {
  robo: 'Robo',
  hurto: 'Hurto',
  estafa: 'Estafa',
  extorsion: 'Extorsión',
  secuestro: 'Secuestro',
  violencia_mujer: 'Violencia',
  otros: 'Otros',
}

/** Paleta para SVG (variables del sistema de diseño). */
export const MODALITY_CSS: Record<string, string> = {
  robo: 'var(--risk-alto)',
  hurto: 'var(--accent-strong)',
  estafa: 'var(--info)',
  extorsion: 'var(--risk-medio)',
  secuestro: 'var(--content-secondary)',
  violencia_mujer: 'var(--risk-bajo)',
  otros: 'rgb(148 163 184 / 0.6)',
}

/** Paleta RGB para el PDF (jsPDF no usa variables CSS). */
export const MODALITY_RGB: Record<string, [number, number, number]> = {
  robo: [248, 113, 113],
  hurto: [20, 184, 166],
  estafa: [56, 189, 248],
  extorsion: [251, 146, 60],
  secuestro: [166, 180, 204],
  violencia_mujer: [52, 211, 153],
  otros: [148, 163, 184],
}

export const MONTH_OPTIONS = [
  { value: 12, label: '12 meses' },
  { value: 24, label: '24 meses' },
  { value: 48, label: '48 meses' },
  { value: 0, label: 'Todo el histórico' },
] as const

const MONTH_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export type SeriesPoint = {
  key: string // "2024-06"
  label: string // "jun 24"
  total: number
  byModality: Record<string, number>
}

export function aggregateSeries(
  rows: MonthlyStat[],
  options: { district?: string | null; months?: number } = {},
): SeriesPoint[] {
  const filtered = options.district ? rows.filter((row) => row.district === options.district) : rows
  const buckets = new Map<string, SeriesPoint>()

  for (const row of filtered) {
    const key = `${row.year}-${String(row.month).padStart(2, '0')}`
    let point = buckets.get(key)
    if (!point) {
      point = { key, label: `${MONTH_ABBR[row.month - 1]} ${String(row.year).slice(2)}`, total: 0, byModality: {} }
      buckets.set(key, point)
    }
    point.total += row.total
    for (const [modality, count] of Object.entries(row.porModalidad)) {
      point.byModality[modality] = (point.byModality[modality] ?? 0) + count
    }
  }

  const series = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key))
  const months = options.months ?? 0
  return months > 0 && series.length > months ? series.slice(-months) : series
}

/** Cambio porcentual entre la primera y la segunda mitad de la serie. */
export function halfPeriodChange(series: SeriesPoint[]): number {
  if (series.length < 2) return 0
  const half = Math.floor(series.length / 2)
  const sum = (points: SeriesPoint[]) => points.reduce((total, point) => total + point.total, 0)
  const first = sum(series.slice(0, half))
  const second = sum(series.slice(half))
  return first > 0 ? ((second - first) / first) * 100 : 0
}

export function districtOptions(rows: MonthlyStat[]): string[] {
  return [...new Set(rows.map((row) => row.district))].sort((a, b) => a.localeCompare(b))
}
