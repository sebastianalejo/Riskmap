import { collection, getDocs, getFirestore, limit, query, where } from 'firebase/firestore'
import { getFirebaseApp } from '../firebase/client'
import { CRIME_TYPES, DISTRICTS } from '../data/sampleIncidents'
import { riskFromIncident } from '../utils/incidentRows'

export type RiskLevel = 'bajo' | 'medio' | 'alto'

export type PredictInput = {
  crime_type: string
  hour: number
  day_of_week: string
  district: string
  latitude: number
  longitude: number
  historical_frequency: number
}

export type PredictResult = {
  prediction: RiskLevel
  confidence: number                          // 0-100
  counts: Record<RiskLevel, number>
  percentages: Record<RiskLevel, number>      // 0-100 cada uno
  method: 'firestore' | 'heuristic'
  samples: number
  factors: string[]                           // explicación
}

/* ── Puntajes base ─────────────────────────────────────────────── */

function hourScore(h: number): number {
  if (h >= 22 || h <= 3)  return 90
  if (h >= 18 && h < 22)  return 70
  if (h >= 4  && h < 7)   return 60
  if (h >= 7  && h < 12)  return 35
  return 50
}

function freqScore(freq: number): number {
  if (freq >= 300) return 90
  if (freq >= 200) return 75
  if (freq >= 100) return 60
  if (freq >= 50)  return 45
  return 30
}

function districtScore(name: string): number {
  const d = DISTRICTS.find(
    (x) => x.name.toLowerCase() === name.toLowerCase().trim(),
  )
  return d?.risk_base ?? 55
}

function crimeBaseScore(type: string): number {
  const lower = type.toLowerCase()
  const found = CRIME_TYPES.find((c) => lower.includes(c.type))
  if (found) return found.crime_score
  if (/robo|asalto/i.test(lower))   return 80
  if (/hurto/i.test(lower))         return 40
  return 50
}

function scoreToLevel(s: number): RiskLevel {
  if (s >= 68) return 'alto'
  if (s >= 45) return 'medio'
  return 'bajo'
}

function heuristicScore(input: PredictInput): number {
  return (
    crimeBaseScore(input.crime_type) * 0.40 +
    hourScore(input.hour)             * 0.25 +
    freqScore(input.historical_frequency) * 0.20 +
    districtScore(input.district)     * 0.15
  )
}

function buildFactors(input: PredictInput, prediction: RiskLevel): string[] {
  const f: string[] = []
  const hs = hourScore(input.hour)
  if (hs >= 80) f.push(`Hora nocturna (${input.hour}:00) — mayor actividad delictiva`)
  else if (hs <= 40) f.push(`Hora diurna (${input.hour}:00) — menor actividad`)
  else f.push(`Hora vespertina (${input.hour}:00) — actividad moderada`)

  const ds = districtScore(input.district)
  if (ds >= 70) f.push(`${input.district} tiene alta incidencia histórica`)
  else if (ds <= 40) f.push(`${input.district} tiene baja incidencia histórica`)

  const cs = crimeBaseScore(input.crime_type)
  if (cs >= 80) f.push(`«${input.crime_type}» es un delito de alta gravedad`)
  else if (cs <= 35) f.push(`«${input.crime_type}» es un delito de baja gravedad`)

  if (input.historical_frequency >= 200) f.push(`Frecuencia histórica elevada (${input.historical_frequency})`)
  else if (input.historical_frequency < 50) f.push(`Frecuencia histórica baja (${input.historical_frequency})`)

  const dayRisk = ['viernes', 'sábado', 'domingo']
  if (dayRisk.includes(input.day_of_week.toLowerCase()))
    f.push(`${input.day_of_week.charAt(0).toUpperCase() + input.day_of_week.slice(1)} es un día de mayor incidencia`)

  if (prediction === 'alto' && f.length < 2) f.push('Combinación de factores eleva el riesgo a ALTO')
  if (prediction === 'bajo' && f.length < 2) f.push('Combinación de factores mantiene el riesgo BAJO')

  return f
}

function countsToPct(counts: Record<RiskLevel, number>): Record<RiskLevel, number> {
  const total = counts.bajo + counts.medio + counts.alto
  if (total === 0) return { bajo: 0, medio: 0, alto: 0 }
  return {
    bajo:  Math.round((counts.bajo  / total) * 100),
    medio: Math.round((counts.medio / total) * 100),
    alto:  Math.round((counts.alto  / total) * 100),
  }
}

function adjustByHour(
  dominant: RiskLevel,
  h: number,
  freq: number,
): RiskLevel {
  const hs = hourScore(h)
  const fs = freqScore(freq)
  if (dominant === 'medio' && hs >= 82) return 'alto'
  if (dominant === 'alto'  && hs < 38 && fs < 40) return 'medio'
  if (dominant === 'bajo'  && hs >= 80 && fs >= 70) return 'medio'
  return dominant
}

/* ── Predicción principal ──────────────────────────────────────── */

export async function predictLocal(input: PredictInput): Promise<PredictResult> {
  const app = getFirebaseApp()

  if (app) {
    try {
      const db  = getFirestore(app)
      const col = collection(db, 'crime_incidents')

      // 1er intento: tipo + distrito
      let snap = await getDocs(
        query(col, where('crime_type', '==', input.crime_type.trim()),
                   where('district', '==', input.district.trim().toUpperCase()),
                   limit(200)),
      )

      // 2do intento: solo tipo
      if (snap.empty) {
        snap = await getDocs(
          query(col, where('crime_type', '==', input.crime_type.trim()), limit(200)),
        )
      }

      if (!snap.empty) {
        const counts: Record<RiskLevel, number> = { bajo: 0, medio: 0, alto: 0 }
        snap.forEach((doc) => {
          // Acepta el esquema clásico (`risk_level`) y el v2 (`severity_level`).
          const level = riskFromIncident(doc.data() as Record<string, unknown>)
          if (level) counts[level]++
        })

        const total = counts.bajo + counts.medio + counts.alto
        if (total > 0) {
          const dominant = (Object.entries(counts) as [RiskLevel, number][])
            .sort((a, b) => b[1] - a[1])[0][0]
          const adjusted   = adjustByHour(dominant, input.hour, input.historical_frequency)
          const percentages = countsToPct(counts)
          const domPct      = percentages[adjusted]
          const confidence  = Math.min(100, Math.round(domPct * 0.7 + Math.min(total, 50) * 0.6))

          return {
            prediction: adjusted,
            confidence,
            counts,
            percentages,
            method: 'firestore',
            samples: total,
            factors: buildFactors(input, adjusted),
          }
        }
      }
    } catch {
      /* cae a heurística */
    }
  }

  // Heurística pura
  const score     = heuristicScore(input)
  const prediction = scoreToLevel(score)
  const pct        = Math.round(Math.min(score, 100))
  const counts: Record<RiskLevel, number> =
    prediction === 'alto'  ? { bajo: 10, medio: 25, alto: 65 }
    : prediction === 'medio' ? { bajo: 20, medio: 55, alto: 25 }
    :                           { bajo: 65, medio: 25, alto: 10 }

  return {
    prediction,
    confidence: pct,
    counts,
    percentages: countsToPct(counts),
    method: 'heuristic',
    samples: 0,
    factors: buildFactors(input, prediction),
  }
}
