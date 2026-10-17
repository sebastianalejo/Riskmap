/**
 * ID determinista de fila para importaciones idempotentes.
 *
 * Reimportar el mismo archivo debe actualizar los mismos documentos, nunca
 * duplicarlos. El algoritmo (FNV-1a de 64 bits sobre un JSON canónico) está
 * replicado exactamente en `scripts/pipeline/upload_incidents.py`; ambas
 * implementaciones están fijadas por pruebas de paridad.
 */

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK_64 = 0xffffffffffffffffn

/** Claves en orden canónico (debe coincidir con la versión de Python). */
export const CANONICAL_KEYS = [
  'crime_type',
  'day_of_week',
  'district',
  'historical_frequency',
  'hour',
  'latitude',
  'longitude',
  'risk_level',
] as const

export function fnv1a64Hex(text: string): string {
  let hash = FNV_OFFSET
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte)
    hash = (hash * FNV_PRIME) & MASK_64
  }
  return hash.toString(16).padStart(16, '0')
}

export function stableRowId(row: Record<string, unknown>): string {
  const ordered: Record<string, unknown> = {}
  for (const key of CANONICAL_KEYS) ordered[key] = row[key]
  return `inc_${fnv1a64Hex(JSON.stringify(ordered))}`
}
