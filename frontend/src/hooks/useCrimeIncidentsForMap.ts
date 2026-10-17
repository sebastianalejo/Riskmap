import { useEffect, useMemo, useState } from 'react'
import { loadMapPoints } from '../data/published'
import type { MapPoint } from '../utils/incidentRows'

export type { MapPoint } from '../utils/incidentRows'

/** Filtra los puntos publicados por fuente (`source` vacío = todas). */
export function filterPointsBySource(points: MapPoint[], source?: string): MapPoint[] {
  if (!source) return points
  return points.filter((point) => point.source === source)
}

/**
 * Puntos del mapa desde el dataset publicado (`/data`). Se descarga una sola vez
 * y el filtro por fuente se aplica en el navegador: no hay lecturas de Firestore.
 */
export function useCrimeIncidentsForMap(source?: string) {
  const [allPoints, setAllPoints] = useState<MapPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadMapPoints()
      .then((points) => {
        if (cancelled) return
        setAllPoints(points)
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'No se pudieron cargar los puntos')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const points = useMemo(() => filterPointsBySource(allPoints, source), [allPoints, source])

  return { points, loading, error }
}
