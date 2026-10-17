/**
 * Agregaciones del módulo «Análisis»: filtros + estadísticas sobre
 * `crime_incidents`. Todas las funciones son puras y trabajan con los campos
 * reales del esquema (sin fechas simuladas).
 */
import Papa from 'papaparse'
import type { AnalysisIncident, AnalysisRiskLevel } from '../hooks/useIncidentsForAnalysis'

export type RiskLevel = AnalysisRiskLevel

export const RISK_LEVELS: RiskLevel[] = ['alto', 'medio', 'bajo']

export const RISK_LABELS: Record<RiskLevel, string> = {
  alto: 'Alto',
  medio: 'Medio',
  bajo: 'Bajo',
}

export const WEEKDAYS = [
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
] as const

export const WEEKDAY_LABELS: Record<string, string> = {
  lunes: 'Lunes',
  martes: 'Martes',
  miércoles: 'Miércoles',
  jueves: 'Jueves',
  viernes: 'Viernes',
  sábado: 'Sábado',
  domingo: 'Domingo',
}

function isWeekday(value: string): value is (typeof WEEKDAYS)[number] {
  return (WEEKDAYS as readonly string[]).includes(value)
}

export const SIN_DISTRITO = 'Sin distrito'
export const SIN_TIPO = 'Sin tipo'

export interface HourRangeOption {
  label: string
  range: [number, number] | null
}

export const HOUR_RANGE_OPTIONS: HourRangeOption[] = [
  { label: 'Todas las horas', range: null },
  { label: 'Madrugada (00–05 h)', range: [0, 5] },
  { label: 'Mañana (06–11 h)', range: [6, 11] },
  { label: 'Tarde (12–17 h)', range: [12, 17] },
  { label: 'Noche (18–23 h)', range: [18, 23] },
]

/** Franja nocturna usada en KPIs, tabla y explicaciones: 22:00–05:59. */
export function isNightHour(hour: number): boolean {
  return hour >= 22 || hour <= 5
}

export interface AnalysisFilters {
  district: string
  crimeType: string
  dayOfWeek: string
  /** Índice dentro de `HOUR_RANGE_OPTIONS` (0 = todas). */
  hourRange: number
  risks: RiskLevel[]
}

export function createDefaultFilters(): AnalysisFilters {
  return {
    district: '',
    crimeType: '',
    dayOfWeek: '',
    hourRange: 0,
    risks: [...RISK_LEVELS],
  }
}

export function countActiveFilters(filters: AnalysisFilters): number {
  let count = 0
  if (filters.district) count++
  if (filters.crimeType) count++
  if (filters.dayOfWeek) count++
  if (filters.hourRange > 0) count++
  if (filters.risks.length < RISK_LEVELS.length) count++
  return count
}

export function applyFilters(
  incidents: AnalysisIncident[],
  filters: AnalysisFilters,
): AnalysisIncident[] {
  const range = HOUR_RANGE_OPTIONS[filters.hourRange]?.range ?? null
  return incidents.filter((incident) => {
    if (filters.district && incident.district !== filters.district) return false
    if (filters.crimeType && incident.crimeType !== filters.crimeType) return false
    if (filters.dayOfWeek && incident.dayOfWeek !== filters.dayOfWeek) return false
    if (range) {
      if (incident.hour === null) return false
      if (incident.hour < range[0] || incident.hour > range[1]) return false
    }
    if (incident.riskLevel) {
      if (filters.risks.length === 0) return false
      if (!filters.risks.includes(incident.riskLevel)) return false
    } else if (filters.risks.length < RISK_LEVELS.length) {
      return false
    }
    return true
  })
}

/* ── Helpers internos ─────────────────────────────────────────────── */

function tally(values: string[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1)
  return map
}

function sortedEntries(map: Map<string, number>): [string, number][] {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, n) => sum + n, 0) / values.length
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/* ── Resumen general ──────────────────────────────────────────────── */

export interface OverviewStats {
  total: number
  districts: number
  riskCounts: Record<RiskLevel, number>
  /** % de riesgo alto sobre registros con nivel de riesgo válido. */
  pctAlto: number
  avgFrequency: number | null
  medianFrequency: number | null
  topCrime: { name: string; count: number } | null
  topDistrict: { name: string; count: number } | null
}

export function computeOverview(incidents: AnalysisIncident[]): OverviewStats {
  const riskCounts: Record<RiskLevel, number> = { bajo: 0, medio: 0, alto: 0 }
  const districtCounts = new Map<string, number>()
  const crimeCounts = new Map<string, number>()
  const frequencies: number[] = []

  for (const incident of incidents) {
    if (incident.riskLevel) riskCounts[incident.riskLevel]++
    if (incident.district !== SIN_DISTRITO) {
      districtCounts.set(incident.district, (districtCounts.get(incident.district) ?? 0) + 1)
    }
    if (incident.crimeType !== SIN_TIPO) {
      crimeCounts.set(incident.crimeType, (crimeCounts.get(incident.crimeType) ?? 0) + 1)
    }
    if (incident.historicalFrequency !== null) frequencies.push(incident.historicalFrequency)
  }

  const totalRisks = riskCounts.bajo + riskCounts.medio + riskCounts.alto
  const topCrimeEntry = sortedEntries(crimeCounts)[0]
  const topDistrictEntry = sortedEntries(districtCounts)[0]

  return {
    total: incidents.length,
    districts: districtCounts.size,
    riskCounts,
    pctAlto: totalRisks > 0 ? (riskCounts.alto / totalRisks) * 100 : 0,
    avgFrequency: mean(frequencies),
    medianFrequency: median(frequencies),
    topCrime: topCrimeEntry ? { name: topCrimeEntry[0], count: topCrimeEntry[1] } : null,
    topDistrict: topDistrictEntry
      ? { name: topDistrictEntry[0], count: topDistrictEntry[1] }
      : null,
  }
}

/* ── Distribuciones ───────────────────────────────────────────────── */

export interface CrimeTypeRow {
  name: string
  count: number
  pct: number
}

export function countByCrimeType(incidents: AnalysisIncident[], topN = 10): CrimeTypeRow[] {
  const counts = tally(
    incidents.map((i) => i.crimeType).filter((crimeType) => crimeType !== SIN_TIPO),
  )
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0)
  return sortedEntries(counts)
    .slice(0, topN)
    .map(([name, count]) => ({ name, count, pct: total > 0 ? (count / total) * 100 : 0 }))
}

export interface DistrictRiskRow {
  district: string
  total: number
  alto: number
  medio: number
  bajo: number
  pctAlto: number
  pctMedio: number
  pctBajo: number
}

export function riskByDistrict(incidents: AnalysisIncident[], topN = 10): DistrictRiskRow[] {
  const byDistrict = new Map<string, { total: number; alto: number; medio: number; bajo: number }>()

  for (const incident of incidents) {
    if (incident.district === SIN_DISTRITO) continue
    const row = byDistrict.get(incident.district) ?? { total: 0, alto: 0, medio: 0, bajo: 0 }
    row.total++
    if (incident.riskLevel) row[incident.riskLevel]++
    byDistrict.set(incident.district, row)
  }

  return [...byDistrict.entries()]
    .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0], 'es'))
    .slice(0, topN)
    .map(([district, row]) => {
      const valid = row.alto + row.medio + row.bajo
      const pct = (n: number) => (valid > 0 ? (n / valid) * 100 : 0)
      return {
        district,
        total: row.total,
        alto: row.alto,
        medio: row.medio,
        bajo: row.bajo,
        pctAlto: pct(row.alto),
        pctMedio: pct(row.medio),
        pctBajo: pct(row.bajo),
      }
    })
}

export interface HourRow {
  hour: number
  count: number
  pct: number
}

/** 24 filas (0–23) siempre presentes, para que el gráfico no cambie de escala. */
export function countByHour(incidents: AnalysisIncident[]): HourRow[] {
  const hours = Array.from({ length: 24 }, () => 0)
  let total = 0
  for (const incident of incidents) {
    if (incident.hour === null) continue
    hours[incident.hour]++
    total++
  }
  return hours.map((count, hour) => ({
    hour,
    count,
    pct: total > 0 ? (count / total) * 100 : 0,
  }))
}

export interface WeekdayRow {
  day: string
  label: string
  count: number
  pct: number
}

/** Filas ordenadas lunes → domingo; se ignoran valores fuera del catálogo. */
export function countByWeekday(incidents: AnalysisIncident[]): WeekdayRow[] {
  const counts = new Map<string, number>()
  let total = 0
  for (const incident of incidents) {
    if (!incident.dayOfWeek || !isWeekday(incident.dayOfWeek)) continue
    counts.set(incident.dayOfWeek, (counts.get(incident.dayOfWeek) ?? 0) + 1)
    total++
  }
  return WEEKDAYS.map((day) => {
    const count = counts.get(day) ?? 0
    return {
      day,
      label: WEEKDAY_LABELS[day],
      count,
      pct: total > 0 ? (count / total) * 100 : 0,
    }
  })
}

export interface FrequencyRow {
  district: string
  count: number
  avg: number
  median: number
  max: number
}

export function frequencyByDistrict(
  incidents: AnalysisIncident[],
  topN?: number,
): FrequencyRow[] {
  const byDistrict = new Map<string, number[]>()
  for (const incident of incidents) {
    if (incident.district === SIN_DISTRITO) continue
    if (incident.historicalFrequency === null) continue
    const list = byDistrict.get(incident.district) ?? []
    list.push(incident.historicalFrequency)
    byDistrict.set(incident.district, list)
  }

  const rows = [...byDistrict.entries()].map(([district, values]) => ({
    district,
    count: values.length,
    avg: mean(values) ?? 0,
    median: median(values) ?? 0,
    max: Math.max(...values),
  }))
  rows.sort((a, b) => b.avg - a.avg || a.district.localeCompare(b.district, 'es'))
  return topN === undefined ? rows : rows.slice(0, topN)
}

/* ── Tabla comparativa y CSV ──────────────────────────────────────── */

export interface DistrictTableRow {
  district: string
  incidents: number
  /** % de riesgo alto sobre registros con riesgo válido del distrito. */
  pctAlto: number
  /** % de registros entre 22:00 y 05:59 sobre registros con hora válida. */
  pctNight: number
  avgFrequency: number | null
  topCrime: string | null
}

export function buildDistrictTable(incidents: AnalysisIncident[]): DistrictTableRow[] {
  interface Acc {
    incidents: number
    alto: number
    risks: number
    night: number
    hours: number
    frequencies: number[]
    crimes: Map<string, number>
  }

  const byDistrict = new Map<string, Acc>()
  for (const incident of incidents) {
    if (incident.district === SIN_DISTRITO) continue
    const acc: Acc = byDistrict.get(incident.district) ?? {
      incidents: 0,
      alto: 0,
      risks: 0,
      night: 0,
      hours: 0,
      frequencies: [],
      crimes: new Map(),
    }
    acc.incidents++
    if (incident.riskLevel) {
      acc.risks++
      if (incident.riskLevel === 'alto') acc.alto++
    }
    if (incident.hour !== null) {
      acc.hours++
      if (isNightHour(incident.hour)) acc.night++
    }
    if (incident.historicalFrequency !== null) acc.frequencies.push(incident.historicalFrequency)
    if (incident.crimeType !== SIN_TIPO) {
      acc.crimes.set(incident.crimeType, (acc.crimes.get(incident.crimeType) ?? 0) + 1)
    }
    byDistrict.set(incident.district, acc)
  }

  return [...byDistrict.entries()]
    .map(([district, acc]) => {
      const topCrimeEntry = sortedEntries(acc.crimes)[0]
      return {
        district,
        incidents: acc.incidents,
        pctAlto: acc.risks > 0 ? (acc.alto / acc.risks) * 100 : 0,
        pctNight: acc.hours > 0 ? (acc.night / acc.hours) * 100 : 0,
        avgFrequency: mean(acc.frequencies),
        topCrime: topCrimeEntry ? topCrimeEntry[0] : null,
      }
    })
    .sort((a, b) => b.incidents - a.incidents || a.district.localeCompare(b.district, 'es'))
}

/** CSV (sin BOM; la descarga lo añade) de la tabla comparativa de distritos. */
export function districtRowsToCsv(rows: DistrictTableRow[]): string {
  return Papa.unparse(
    rows.map((row) => ({
      Distrito: row.district,
      Incidentes: row.incidents,
      '% riesgo alto': Number(row.pctAlto.toFixed(1)),
      '% nocturno (22-05 h)': Number(row.pctNight.toFixed(1)),
      'Frecuencia histórica promedio':
        row.avgFrequency === null ? '' : Number(row.avgFrequency.toFixed(1)),
      'Delito principal': row.topCrime ?? '',
    })),
    { newline: '\r\n' },
  )
}

/* ── Formato ──────────────────────────────────────────────────────── */

export function uniqueValues(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'es'))
}

export function formatInt(value: number): string {
  return value.toLocaleString('es-PE')
}

export function formatDecimal(value: number, digits = 1): string {
  return value.toLocaleString('es-PE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatPercent(value: number, digits = 1): string {
  return `${formatDecimal(value, digits)} %`
}

export function truncateLabel(value: string, max = 24): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
