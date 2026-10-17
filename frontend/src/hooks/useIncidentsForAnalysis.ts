import { useEffect, useState } from 'react'
import { loadAnalysisIncidents, type AnalysisIncident } from '../data/published'

export type { AnalysisIncident, AnalysisRiskLevel } from '../data/published'

/**
 * Filas del módulo Análisis desde el dataset publicado (`/data`).
 *
 * A diferencia de la versión anterior (que paginaba Firestore), aquí se cargan
 * todos los registros publicados: sin tope de 5 000 ni lecturas por visita.
 */
export function useIncidentsForAnalysis() {
  const [incidents, setIncidents] = useState<AnalysisIncident[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadAnalysisIncidents()
      .then((rows) => {
        if (cancelled) return
        setIncidents(rows)
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'No se pudieron cargar los incidentes')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Se conserva la propiedad por compatibilidad con la firma anterior.
  return { incidents, loading, error, truncated: false }
}
