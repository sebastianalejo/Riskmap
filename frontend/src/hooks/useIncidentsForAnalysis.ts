import {
  collection,
  documentId,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  startAfter,
  type DocumentSnapshot,
  type QueryConstraint,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { getFirebaseApp } from '../firebase/client'

export type AnalysisRiskLevel = 'bajo' | 'medio' | 'alto'

export type AnalysisIncident = {
  id: string
  district: string
  crimeType: string
  /** Hora del hecho (0–23) o `null` si el registro no la trae. */
  hour: number | null
  /** Día de la semana en minúsculas (`lunes`…`domingo`) o `null`. */
  dayOfWeek: string | null
  riskLevel: AnalysisRiskLevel | null
  historicalFrequency: number | null
}

/** Tope de documentos analizados (se pagina hasta `ANALYSIS_MAX_DOCS`). */
export const ANALYSIS_MAX_DOCS = 5000

const PAGE_SIZE = 1000

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s.length > 0 ? s : null
}

function risk(v: unknown): AnalysisRiskLevel | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return s === 'bajo' || s === 'medio' || s === 'alto' ? s : null
}

function parseIncident(id: string, data: Record<string, unknown>): AnalysisIncident {
  const rawHour = num(data.hour)
  return {
    id,
    district: str(data.district) ?? 'Sin distrito',
    crimeType: str(data.crime_type) ?? 'Sin tipo',
    hour: rawHour !== null && rawHour >= 0 && rawHour <= 23 ? Math.trunc(rawHour) : null,
    dayOfWeek: str(data.day_of_week)?.toLowerCase() ?? null,
    riskLevel: risk(data.risk_level) ?? risk(data.riskLevel),
    historicalFrequency: num(data.historical_frequency),
  }
}

/**
 * Lectura completa (paginada) de `crime_incidents` con los 8 campos del esquema
 * para el módulo de análisis. A diferencia de `useCrimeIncidentsForMap`, conserva
 * `day_of_week`, `hour` y `historical_frequency`, y carga hasta `ANALYSIS_MAX_DOCS`.
 */
export function useIncidentsForAnalysis() {
  const [incidents, setIncidents] = useState<AnalysisIncident[]>([])
  const [loading, setLoading] = useState(() => getFirebaseApp() !== null)
  const [error, setError] = useState<string | null>(() =>
    getFirebaseApp() ? null : 'Firebase no inicializado',
  )
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    const app = getFirebaseApp()
    if (!app) return

    let cancelled = false
    ;(async () => {
      try {
        const col = collection(getFirestore(app), 'crime_incidents')
        const list: AnalysisIncident[] = []
        let cursor: DocumentSnapshot | null = null

        while (list.length < ANALYSIS_MAX_DOCS) {
          const pageSize = Math.min(PAGE_SIZE, ANALYSIS_MAX_DOCS - list.length)
          const constraints: QueryConstraint[] = [orderBy(documentId())]
          if (cursor) constraints.push(startAfter(cursor))
          constraints.push(limit(pageSize))

          const snap = await getDocs(query(col, ...constraints))
          if (cancelled) return
          snap.forEach((doc) => list.push(parseIncident(doc.id, doc.data())))
          if (snap.size < pageSize) break

          cursor = snap.docs[snap.docs.length - 1] ?? null
          if (!cursor) break

          if (list.length >= ANALYSIS_MAX_DOCS) {
            // Sonda: ¿la colección tiene más documentos que el tope analizado?
            const probe = await getDocs(
              query(col, orderBy(documentId()), startAfter(cursor), limit(1)),
            )
            if (!cancelled) setTruncated(!probe.empty)
            break
          }
        }

        if (!cancelled) {
          setIncidents(list)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'No se pudieron cargar los incidentes')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return { incidents, loading, error, truncated }
}
