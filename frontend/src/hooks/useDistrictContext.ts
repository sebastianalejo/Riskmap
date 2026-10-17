import { useEffect, useState } from 'react'
import { loadDistrictContext, type DistrictContext } from '../data/published'

/**
 * Contexto por distrito (población proyectada y oferta policial) desde los datos
 * publicados, sin consultas a la base de datos.
 */
export function useDistrictContext() {
  const [rows, setRows] = useState<DistrictContext[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadDistrictContext()
      .then((list) => {
        if (cancelled) return
        setRows(list)
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'No se pudo cargar el contexto por distrito')
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
