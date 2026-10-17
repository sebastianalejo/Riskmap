import { collection, getDocs, getFirestore, limit, query, where } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { getFirebaseApp } from '../firebase/client'
import type { MonthlyStat } from '../utils/monthlyStats'

const COLLECTION = 'crime_stats_monthly'
const MAX_DOCS = 8000

/** Lee la serie mensual real (SIDPOL/MININTER) publicada por el pipeline offline. */
export function useCrimeStatsMonthly() {
  const app = getFirebaseApp()
  const [rows, setRows] = useState<MonthlyStat[]>([])
  const [loading, setLoading] = useState(() => Boolean(app))
  const [error, setError] = useState<string | null>(() => (app ? null : 'Firebase no inicializado'))

  useEffect(() => {
    if (!app) return
    let cancelled = false

    void (async () => {
      try {
        const db = getFirestore(app)
        const snapshot = await getDocs(
          query(collection(db, COLLECTION), where('scope', '==', 'LIMA'), limit(MAX_DOCS)),
        )
        if (cancelled) return

        const list: MonthlyStat[] = []
        snapshot.forEach((docSnapshot) => {
          const data = docSnapshot.data()
          const year = Number(data.year)
          const month = Number(data.month)
          if (!Number.isFinite(year) || !Number.isFinite(month)) return
          const modalidades =
            data.por_modalidad && typeof data.por_modalidad === 'object'
              ? (data.por_modalidad as Record<string, number>)
              : {}
          list.push({
            year,
            month,
            ubigeo: typeof data.ubigeo === 'string' ? data.ubigeo : '',
            district: typeof data.district === 'string' ? data.district : 'SIN DISTRITO',
            total: Number(data.total) || 0,
            porModalidad: modalidades,
          })
        })
        setRows(list)
        setError(null)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'No se pudo cargar la serie SIDPOL')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [app])

  return { rows, loading, error }
}
