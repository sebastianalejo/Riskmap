import { useEffect, useState } from 'react'
import { loadMonthlyStats } from '../data/published'
import type { MonthlyStat } from '../utils/monthlyStats'

/**
 * Serie mensual real de denuncias oficiales desde los datos publicados,
 * sin consultas a la base de datos.
 */
export function useCrimeStatsMonthly() {
  const [rows, setRows] = useState<MonthlyStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadMonthlyStats()
      .then((list) => {
        if (cancelled) return
        setRows(list)
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'No se pudo cargar la serie de denuncias')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { rows, loading, error }
}
