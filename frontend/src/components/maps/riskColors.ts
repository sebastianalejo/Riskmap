/**
 * Colores de riesgo (bajo / medio / alto).
 *
 * - `riskVar` devuelve una referencia CSS (`var(--risk-…)`) para elementos del DOM o SVG:
 *   se adapta automáticamente al tema claro/oscuro sin re-render.
 * - `resolveRiskColors` resuelve los valores concretos del tema actual; es necesario para
 *   Leaflet y Google Maps, que no entienden variables CSS. Llamar una vez por render.
 */

export type RiskLevelName = 'bajo' | 'medio' | 'alto'

export interface ResolvedRiskColors {
  bajo: string
  medio: string
  alto: string
  unknown: string
  info: string
}

const FALLBACKS: ResolvedRiskColors = {
  bajo: '#34d399',
  medio: '#fb923c',
  alto: '#f87171',
  unknown: '#6c7a94',
  info: '#38bdf8',
}

const LEVELS: readonly RiskLevelName[] = ['bajo', 'medio', 'alto']

export function isRiskLevel(value: unknown): value is RiskLevelName {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value.toLowerCase())
}

/** Referencia CSS al color del nivel (se adapta al tema activo). */
export function riskVar(level?: string): string {
  const l = level?.toLowerCase()
  if (isRiskLevel(l)) return `var(--risk-${l})`
  return 'var(--content-muted)'
}

/** Valores resueltos del tema actual (para canvas / mapas). */
export function resolveRiskColors(): ResolvedRiskColors {
  if (typeof document === 'undefined') return FALLBACKS
  const cs = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  return {
    bajo: read('--risk-bajo', FALLBACKS.bajo),
    medio: read('--risk-medio', FALLBACKS.medio),
    alto: read('--risk-alto', FALLBACKS.alto),
    unknown: read('--content-muted', FALLBACKS.unknown),
    info: read('--info', FALLBACKS.info),
  }
}

/** Color resuelto para un nivel concreto (usa `colors` de `resolveRiskColors`). */
export function riskDotColor(level: string | undefined, colors: ResolvedRiskColors): string {
  const l = level?.toLowerCase()
  if (isRiskLevel(l)) return colors[l]
  return colors.unknown
}
