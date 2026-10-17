import { collection, getDocs, getFirestore, limit, query, where, type QueryConstraint } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { getFirebaseApp } from '../firebase/client'
import { mapIncidentToPoint, type MapPoint } from '../utils/incidentRows'

export type { MapPoint } from '../utils/incidentRows'

/**
 * Tope de documentos por consulta. Firestore rechaza `limit()` mayor que 10 000
 * (`Limit value in the structured query is over the maximum value of 10000`),
 * así que este valor no debe superarse nunca.
 */
export const MAX_DOCS = 10_000

export function useCrimeIncidentsForMap(source?: string) {
  const [points, setPoints] = useState<MapPoint[]>([])
  const [loading, setLoading] = useState(() => getFirebaseApp() !== null)
  const [error, setError] = useState<string | null>(() =>
    getFirebaseApp() ? null : 'Firebase no inicializado',
  )

  useEffect(() => {
    const app = getFirebaseApp()
    if (!app) return

    let cancelled = false
    ;(async () => {
      try {
        const db = getFirestore(app)
        // Filtrado por fuente en el servidor (igualdad: índice automático) para que
        // cada consulta quede por debajo del tope cuando hay filtro.
        const constraints: QueryConstraint[] = source
          ? [where('source', '==', source), limit(MAX_DOCS)]
          : [limit(MAX_DOCS)]
        const snap = await getDocs(query(collection(db, 'crime_incidents'), ...constraints))
        if (cancelled) return
        const list: MapPoint[] = []
        snap.forEach((doc) => {
          const point = mapIncidentToPoint(doc.id, doc.data())
          if (point) list.push(point)
        })
        setPoints(list)
        setError(null)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'No se pudieron cargar los puntos')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [source])

  return { points, loading, error }
}
