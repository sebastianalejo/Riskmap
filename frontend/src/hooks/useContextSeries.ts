import { useEffect, useState } from 'react'
import { loadContextSeries, type ContextSeriesRow } from '../data/published'

/** Series de contexto (INEI / MPFN) desde los datos publicados. */
export function useContextSeries() {
  const [rows, setRows] = useState<ContextSeriesRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadContextSeries()
      .then((list) => {
        if (cancelled) return
        setRows(list)
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'No se pudieron cargar las series de contexto')
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
