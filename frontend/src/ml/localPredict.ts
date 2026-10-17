import { loadPredictStats, type PredictStats } from '../data/published'
import type { RiskLevel } from '../utils/incidentRows'

export type { RiskLevel }

export type PredictInput = {
  crime_type: string
  hour: number
  day_of_week: string
  district: string
  /** Frecuencia histórica del distrito; si falta se deriva del dataset publicado. */
  historical_frequency?: number
}

export type ModalityPrediction = {
  label: string
  /** Proporción 0–1 sobre la composición histórica del distrito. */
  probability: number
}

export type PredictResult = {
  prediction: RiskLevel
  confidence: number // 0-100
  counts: Record<RiskLevel, number>
  percentages: Record<RiskLevel, number> // 0-100 cada uno
  method: 'dataset' | 'heuristic'
  samples: number
  factors: string[] // explicación
  /** Modalidades más probables (composición histórica del distrito). */
  modalities: ModalityPrediction[]
  /** Frecuencia histórica usada (derivada del dataset o la provista). */
  frequency: number
}

const FALLBACK_ORDER: RiskLevel[] = ['bajo', 'medio', 'alto']
const WEEKEND = ['viernes', 'sábado', 'domingo']

/* ── Agregados del dataset publicado ───────────────────────────── */

function riskOrder(stats: PredictStats): RiskLevel[] {
  return stats.riskOrder.length > 0 ? stats.riskOrder : FALLBACK_ORDER
}

function sumCounts(values: [number, number, number] | undefined): number {
  return values ? values[0] + values[1] + values[2] : 0
}

function districtSuffix(district: string): string {
  return `|${district.trim().toUpperCase()}`
}

/** Total de registros por modalidad dentro de un distrito. */
function districtTypeTotals(stats: PredictStats, district: string): Map<string, number> {
  const suffix = districtSuffix(district)
  const totals = new Map<string, number>()
  for (const [key, values] of Object.entries(stats.byTypeDistrict)) {
    if (!key.endsWith(suffix)) continue
    const type = key.slice(0, key.length - suffix.length)
    totals.set(type, (totals.get(type) ?? 0) + sumCounts(values))
  }
  return totals
}

/** Distribución de riesgo del distrito (sumando sus modalidades). */
function districtAggregate(
  stats: PredictStats,
  district: string,
): Record<RiskLevel, number> & { total: number } {
  const suffix = districtSuffix(district)
  const order = riskOrder(stats)
  const aggregate: Record<RiskLevel, number> & { total: number } = {
    bajo: 0,
    medio: 0,
    alto: 0,
    total: 0,
  }
  for (const [key, values] of Object.entries(stats.byTypeDistrict)) {
    if (!key.endsWith(suffix)) continue
    order.forEach((risk, index) => {
      const value = values[index]
      if (typeof value === 'number') aggregate[risk] += value
    })
    aggregate.total += sumCounts(values)
  }
  return aggregate
}

function globalAverage(stats: PredictStats | null): number {
  if (!stats) return 100
  const totals = Object.values(stats.byType).reduce((sum, value) => sum + sumCounts(value), 0)
  const count = stats.districts.length || 1
  return Math.max(1, Math.round(totals / count))
}

/** Modalidades más probables del distrito (composición histórica). */
export function predictModalitiesFromStats(
  stats: PredictStats,
  district: string,
  topN = 5,
): ModalityPrediction[] {
  let totals = districtTypeTotals(stats, district)
  if (totals.size === 0) {
    // Respaldo global (distrito sin registros propios).
    totals = new Map(Object.entries(stats.byType).map(([type, value]) => [type, sumCounts(value)]))
  }
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0)
  if (total <= 0) return []
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
    .slice(0, topN)
    .map(([label, count]) => ({ label, probability: count / total }))
}

/** Conteos por (tipo, distrito) o, si no hay, por tipo (con coincidencia flexible). */
function countsFromStats(
  stats: PredictStats,
  input: PredictInput,
): Record<RiskLevel, number> | null {
  const type = input.crime_type.trim().toLowerCase()
  const district = input.district.trim().toUpperCase()

  let values: [number, number, number] | undefined = stats.byTypeDistrict[`${type}|${district}`]
  if (!values) {
    const matched =
      stats.types.find((candidate) => candidate === type) ??
      stats.types.find((candidate) => candidate.includes(type) || type.includes(candidate))
    if (matched) values = stats.byType[matched]
  }

  // Último recurso: agrupar por la primera palabra (p. ej. «robo a mano armada» → «robo*»).
  if (!values) {
    const prefix = type.split(/\s+/)[0]
    if (prefix.length >= 4) {
      const matches = stats.types.filter(
        (candidate) => candidate === prefix || candidate.startsWith(`${prefix} `),
      )
      if (matches.length > 0) {
        values = matches.reduce<[number, number, number]>((acc, key) => {
          const counts = stats.byType[key]
          if (!counts) return acc
          return [acc[0] + counts[0], acc[1] + counts[1], acc[2] + counts[2]]
        }, [0, 0, 0])
      }
    }
  }

  if (!values) return null

  const counts: Record<RiskLevel, number> = { bajo: 0, medio: 0, alto: 0 }
  riskOrder(stats).forEach((risk, index) => {
    const value = values?.[index]
    if (typeof value === 'number') counts[risk] = value
  })
  return counts
}

/* ── Heurística de respaldo (sin dataset publicado) ────────────── */

function hourScore(h: number): number {
  if (h >= 22 || h <= 3) return 90
  if (h >= 18 && h < 22) return 70
  if (h >= 4 && h < 7) return 60
  if (h >= 7 && h < 12) return 35
  return 50
}

function freqScore(freq: number): number {
  if (freq >= 300) return 90
  if (freq >= 200) return 75
  if (freq >= 100) return 60
  if (freq >= 50) return 45
  return 30
}

function crimeBaseScore(type: string): number {
  const lower = type.toLowerCase()
  if (/homicidio|asesinato|secuestro|violacion|arma|extorsion|droga/.test(lower)) return 85
  if (/robo|asalto/.test(lower)) return 75
  if (/hurto|lesion|violencia/.test(lower)) return 50
  if (/estafa|defraud|acoso|microcomercializacion/.test(lower)) return 30
  return 50
}

function scoreToLevel(score: number): RiskLevel {
  if (score >= 68) return 'alto'
  if (score >= 45) return 'medio'
  return 'bajo'
}

function heuristicScore(input: PredictInput, frequency: number): number {
  return (
    crimeBaseScore(input.crime_type) * 0.45 +
    hourScore(input.hour) * 0.3 +
    freqScore(frequency) * 0.25
  )
}

/* ── Explicación ───────────────────────────────────────────────── */

function buildFactors(
  input: PredictInput,
  prediction: RiskLevel,
  frequency: number,
  stats: PredictStats | null,
): string[] {
  const factors: string[] = []

  const hs = hourScore(input.hour)
  if (hs >= 80) factors.push(`Hora nocturna (${input.hour}:00) — mayor actividad delictiva`)
  else if (hs <= 40) factors.push(`Hora diurna (${input.hour}:00) — menor actividad`)
  else factors.push(`Hora vespertina (${input.hour}:00) — actividad moderada`)

  if (stats) {
    const aggregate = districtAggregate(stats, input.district)
    const share = aggregate.total > 0 ? aggregate.alto / aggregate.total : 0
    if (share >= 0.4) factors.push(`${input.district} concentra una proporción alta de riesgo alto`)
    else if (share > 0 && share <= 0.15)
      factors.push(`${input.district} tiene baja proporción de riesgo alto`)
  }

  const cs = crimeBaseScore(input.crime_type)
  if (cs >= 80) factors.push(`«${input.crime_type}» es una modalidad de alta gravedad`)
  else if (cs <= 35) factors.push(`«${input.crime_type}» es una modalidad de baja gravedad`)

  if (frequency >= 200) factors.push(`Frecuencia histórica elevada (${frequency})`)
  else if (frequency < 50) factors.push(`Frecuencia histórica baja (${frequency})`)

  if (WEEKEND.includes(input.day_of_week.toLowerCase()))
    factors.push(
      `${input.day_of_week.charAt(0).toUpperCase() + input.day_of_week.slice(1)} es un día de mayor incidencia`,
    )

  if (prediction === 'alto' && factors.length < 2)
    factors.push('Combinación de factores eleva el riesgo a ALTO')
  if (prediction === 'bajo' && factors.length < 2)
    factors.push('Combinación de factores mantiene el riesgo BAJO')

  return factors
}

function countsToPct(counts: Record<RiskLevel, number>): Record<RiskLevel, number> {
  const total = counts.bajo + counts.medio + counts.alto
  if (total === 0) return { bajo: 0, medio: 0, alto: 0 }
  return {
    bajo: Math.round((counts.bajo / total) * 100),
    medio: Math.round((counts.medio / total) * 100),
    alto: Math.round((counts.alto / total) * 100),
  }
}

function adjustByHour(dominant: RiskLevel, h: number, freq: number): RiskLevel {
  const hs = hourScore(h)
  const fs = freqScore(freq)
  if (dominant === 'medio' && hs >= 82) return 'alto'
  if (dominant === 'alto' && hs < 38 && fs < 40) return 'medio'
  if (dominant === 'bajo' && hs >= 80 && fs >= 70) return 'medio'
  return dominant
}

/* ── Predicción principal ──────────────────────────────────────── */

export async function predictLocal(input: PredictInput): Promise<PredictResult> {
  let stats: PredictStats | null = null
  try {
    stats = await loadPredictStats()
  } catch {
    stats = null
  }

  const modalities = stats ? predictModalitiesFromStats(stats, input.district) : []
  const aggregate = stats ? districtAggregate(stats, input.district) : null
  const frequency =
    input.historical_frequency ??
    (aggregate && aggregate.total > 0 ? aggregate.total : globalAverage(stats))

  if (stats) {
    const counts = countsFromStats(stats, input)
    if (counts) {
      const total = counts.bajo + counts.medio + counts.alto
      if (total > 0) {
        const dominant = (Object.entries(counts) as [RiskLevel, number][]).sort(
          (a, b) => b[1] - a[1],
        )[0][0]
        const adjusted = adjustByHour(dominant, input.hour, frequency)
        const percentages = countsToPct(counts)
        const confidence = Math.min(
          100,
          Math.round(percentages[adjusted] * 0.7 + Math.min(total, 50) * 0.6),
        )

        return {
          prediction: adjusted,
          confidence,
          counts,
          percentages,
          method: 'dataset',
          samples: total,
          factors: buildFactors(input, adjusted, frequency, stats),
          modalities,
          frequency,
        }
      }
    }
  }

  // Heurística pura (sin dataset publicado)
  const score = heuristicScore(input, frequency)
  const prediction = scoreToLevel(score)
  const pct = Math.round(Math.min(score, 100))
  const counts: Record<RiskLevel, number> =
    prediction === 'alto'
      ? { bajo: 10, medio: 25, alto: 65 }
      : prediction === 'medio'
        ? { bajo: 20, medio: 55, alto: 25 }
        : { bajo: 65, medio: 25, alto: 10 }

  return {
    prediction,
    confidence: pct,
    counts,
    percentages: countsToPct(counts),
    method: 'heuristic',
    samples: 0,
    factors: buildFactors(input, prediction, frequency, stats),
    modalities,
    frequency,
  }
}
