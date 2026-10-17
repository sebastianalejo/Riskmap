/**
 * Lectura del dataset estático publicado en Firebase Hosting (`/data`).
 *
 * El frontend ya no consulta `crime_incidents` en cada visita: descarga los JSON
 * una vez, los cachea en memoria y filtra en el navegador. Así no se consumen las
 * 50 000 lecturas diarias de Firestore del plan Spark.
 *
 * El `manifest.json` es la única petición que no se cachea (para detectar una
 * publicación nueva); los archivos con hash se cachean de forma agresiva.
 */

import type { MapPoint, RiskLevel } from '../utils/incidentRows'
import type { MonthlyStat } from '../utils/monthlyStats'

const DATA_BASE = '/data'
const SCHEMA_VERSION = 1

export type AnalysisRiskLevel = RiskLevel

export type AnalysisIncident = {
  id: string
  district: string
  crimeType: string
  /** Año del hecho (`occurred_year`, esquema INEI) o `null` si no lo trae. */
  year: number | null
  /** Hora del hecho (0–23) o `null` si el registro no la trae. */
  hour: number | null
  /** Día de la semana en minúsculas (`lunes`…`domingo`) o `null`. */
  dayOfWeek: string | null
  riskLevel: AnalysisRiskLevel | null
  historicalFrequency: number | null
}

export type PublishedFile = {
  name: string
  bytes: number
  sha256: string
  count: number
}

export type PublishedManifest = {
  schemaVersion: number
  generatedAt: string
  dataset: string
  counts: {
    incidents: number
    mapPoints: number
    analysisRows: number
    monthlyRows: number
    sources: Record<string, number>
  }
  files: {
    map: PublishedFile
    analysis: PublishedFile
    monthly: PublishedFile
    predict: PublishedFile
  }
}

export type PredictStats = {
  riskOrder: RiskLevel[]
  byTypeDistrict: Record<string, [number, number, number]>
  byType: Record<string, [number, number, number]>
  types: string[]
  districts: string[]
}

type MapPayload = { points?: unknown[] }
type AnalysisPayload = { incidents?: unknown[] }
type MonthlyPayload = { modalities?: string[]; rows?: unknown[] }
type PredictPayload = Partial<PredictStats>

function asNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asRisk(value: unknown): RiskLevel | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return text === 'bajo' || text === 'medio' || text === 'alto' ? text : null
}

/** Convierte una fila compacta del mapa en `MapPoint` (o `null` si es inválida). */
export function toMapPoint(row: unknown): MapPoint | null {
  if (!Array.isArray(row) || row.length < 10) return null
  const [id, lat, lng, district, crimeType, riskLevel, source, year, hour, dayOfWeek] = row
  const latNum = asNumber(lat)
  const lngNum = asNumber(lng)
  if (latNum === null || lngNum === null) return null

  return {
    id: String(id),
    lat: latNum,
    lng: lngNum,
    district: asString(district) ?? undefined,
    crimeType: asString(crimeType) ?? undefined,
    riskLevel: asRisk(riskLevel) ?? undefined,
    source: asString(source) ?? undefined,
    year: asNumber(year) ?? undefined,
    hour: asNumber(hour) ?? undefined,
    dayOfWeek: asString(dayOfWeek)?.toLowerCase() ?? undefined,
  }
}

/** Convierte una fila compacta del análisis en `AnalysisIncident`. */
export function toAnalysisIncident(row: unknown): AnalysisIncident | null {
  if (!Array.isArray(row) || row.length < 8) return null
  const [id, district, crimeType, year, hour, dayOfWeek, riskLevel, historicalFrequency] = row
  return {
    id: String(id),
    district: asString(district) ?? 'Sin distrito',
    crimeType: asString(crimeType) ?? 'Sin tipo',
    year: asNumber(year),
    hour: asNumber(hour),
    dayOfWeek: asString(dayOfWeek)?.toLowerCase() ?? null,
    riskLevel: asRisk(riskLevel),
    historicalFrequency: asNumber(historicalFrequency),
  }
}

/** Convierte una fila compacta de la serie mensual en `MonthlyStat`. */
export function toMonthlyStat(row: unknown, modalities: string[]): MonthlyStat | null {
  if (!Array.isArray(row) || row.length < 6) return null
  const [year, month, ubigeo, district, total, counts] = row
  const yearNum = asNumber(year)
  const monthNum = asNumber(month)
  if (yearNum === null || monthNum === null || !Array.isArray(counts)) return null

  const porModalidad: Record<string, number> = {}
  modalities.forEach((modality, index) => {
    const value = asNumber(counts[index])
    if (value !== null) porModalidad[modality] = value
  })

  return {
    year: yearNum,
    month: monthNum,
    ubigeo: asString(ubigeo) ?? '',
    district: asString(district) ?? 'SIN DISTRITO',
    total: asNumber(total) ?? 0,
    porModalidad,
  }
}

async function fetchJson<T>(path: string, cache: RequestCache): Promise<T> {
  const response = await fetch(`${DATA_BASE}/${path}`, { cache })
  if (!response.ok) {
    throw new Error(`No se pudo cargar ${path} (HTTP ${response.status})`)
  }
  // Si falta el archivo, el rewrite de Hosting devuelve index.html con 200.
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) {
    throw new Error(`El dataset publicado no está disponible (${path} no devolvió JSON)`)
  }
  return (await response.json()) as T
}

let manifestPromise: Promise<PublishedManifest> | null = null

/** Carga el manifest (sin caché) y valida la versión del esquema. */
export function loadPublishedManifest(): Promise<PublishedManifest> {
  if (!manifestPromise) {
    manifestPromise = fetchJson<PublishedManifest>('manifest.json', 'no-cache').then((manifest) => {
      if (manifest.schemaVersion !== SCHEMA_VERSION) {
        throw new Error(
          `El dataset publicado usa un esquema distinto (${manifest.schemaVersion} ≠ ${SCHEMA_VERSION}); vuelve a ejecutar el pipeline.`,
        )
      }
      return manifest
    })
    manifestPromise.catch(() => {
      manifestPromise = null
    })
  }
  return manifestPromise
}

const filePromises = new Map<string, Promise<unknown>>()

function loadFile<T>(name: string): Promise<T> {
  const cached = filePromises.get(name) as Promise<T> | undefined
  if (cached) return cached
  const promise = fetchJson<T>(name, 'force-cache')
  filePromises.set(name, promise)
  promise.catch(() => filePromises.delete(name))
  return promise
}

async function loadDataset(key: keyof PublishedManifest['files']): Promise<unknown> {
  const manifest = await loadPublishedManifest()
  const file = manifest.files[key]
  if (!file?.name) throw new Error(`El manifest no declara el archivo «${key}»`)
  return loadFile(file.name)
}

/** Puntos del mapa publicados (todas las fuentes). */
export async function loadMapPoints(): Promise<MapPoint[]> {
  const payload = (await loadDataset('map')) as MapPayload
  return (payload.points ?? []).map(toMapPoint).filter((point): point is MapPoint => point !== null)
}

/** Filas del módulo Análisis publicadas. */
export async function loadAnalysisIncidents(): Promise<AnalysisIncident[]> {
  const payload = (await loadDataset('analysis')) as AnalysisPayload
  return (payload.incidents ?? [])
    .map(toAnalysisIncident)
    .filter((incident): incident is AnalysisIncident => incident !== null)
}

/** Serie mensual real SIDPOL/MININTER publicada. */
export async function loadMonthlyStats(): Promise<MonthlyStat[]> {
  const payload = (await loadDataset('monthly')) as MonthlyPayload
  const modalities = payload.modalities ?? []
  return (payload.rows ?? [])
    .map((row) => toMonthlyStat(row, modalities))
    .filter((row): row is MonthlyStat => row !== null)
}

/** Conteos precalculados para la estimación local de riesgo. */
export async function loadPredictStats(): Promise<PredictStats> {
  const payload = (await loadDataset('predict')) as PredictPayload
  return {
    riskOrder: payload.riskOrder ?? ['bajo', 'medio', 'alto'],
    byTypeDistrict: payload.byTypeDistrict ?? {},
    byType: payload.byType ?? {},
    types: payload.types ?? [],
    districts: payload.districts ?? [],
  }
}

/** Reinicia las cachés en memoria (solo pruebas). */
export function resetPublishedCache(): void {
  manifestPromise = null
  filePromises.clear()
}
