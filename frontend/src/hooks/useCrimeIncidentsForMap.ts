import { collection, getDocs, getFirestore, limit, query } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { getFirebaseApp } from '../firebase/client'

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

const MAX_DOCS = 2500

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function useCrimeIncidentsForMap() {
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
        const q = query(collection(db, 'crime_incidents'), limit(MAX_DOCS))
        const snap = await getDocs(q)
        if (cancelled) return
        const list: MapPoint[] = []
        snap.forEach((doc) => {
          const d = doc.data()
          const lat = num(d.latitude)
          const lng = num(d.longitude)
          if (lat === null || lng === null) return
          list.push({
            id: doc.id,
            lat,
            lng,
            source: 'firestore',
            district: typeof d.district === 'string' ? d.district : undefined,
            crimeType: typeof d.crime_type === 'string' ? d.crime_type : undefined,
            hour: typeof d.hour === 'number' ? d.hour : undefined,
            riskLevel:
              typeof d.risk_level === 'string'
                ? d.risk_level
                : typeof d.riskLevel === 'string'
                  ? d.riskLevel
                  : undefined,
          })
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
  }, [])

  return { points, loading, error }
}
