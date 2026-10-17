export type RiskLevel = 'bajo' | 'medio' | 'alto'

export type MapPoint = {
  id: string
  lat: number
  lng: number
  district?: string
  crimeType?: string
  riskLevel?: string
  source?: 'firestore' | 'inei'
  year?: number
  hour?: number
}

const SEVERITY_TO_RISK: Record<string, RiskLevel> = { baja: 'bajo', media: 'medio', alta: 'alto' }
const RISK_VALUES = new Set<string>(['bajo', 'medio', 'alto'])

function num(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Convierte la severidad declarada (dataset INEI, esquema v2) al nivel de riesgo del mapa. */
export function severityToRisk(value: unknown): RiskLevel | undefined {
  if (typeof value !== 'string') return undefined
  return SEVERITY_TO_RISK[value.trim().toLowerCase()]
}

/** Nivel de riesgo de un documento: `risk_level`/`riskLevel` o, si falta, `severity_level`. */
export function riskFromIncident(data: Record<string, unknown>): RiskLevel | undefined {
  const raw = data.risk_level ?? data.riskLevel
  if (typeof raw === 'string' && RISK_VALUES.has(raw.trim().toLowerCase())) {
    return raw.trim().toLowerCase() as RiskLevel
  }
  return severityToRisk(data.severity_level)
}

/** Mapea un documento de `crime_incidents` a un punto del mapa (o null sin coordenadas). */
export function mapIncidentToPoint(id: string, data: Record<string, unknown>): MapPoint | null {
  const lat = num(data.latitude)
  const lng = num(data.longitude)
  if (lat === null || lng === null) return null

  const year = num(data.occurred_year)
  return {
    id,
    lat,
    lng,
    source: data.source === 'inei' ? 'inei' : 'firestore',
    district: typeof data.district === 'string' ? data.district : undefined,
    crimeType: typeof data.crime_type === 'string' ? data.crime_type : undefined,
    hour: typeof data.hour === 'number' ? data.hour : undefined,
    riskLevel: riskFromIncident(data),
    year: year === null ? undefined : year,
  }
}
