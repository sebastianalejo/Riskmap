import { useEffect, useState, type CSSProperties } from 'react'
import { resolveRiskColors, type ResolvedRiskColors } from '../maps/riskColors'

/**
 * Tema resuelto para Recharts: los atributos SVG (`fill`, `stroke`) no
 * resuelven `var(--…)` de forma fiable, así que aquí se leen los tokens del
 * sistema de diseño como valores concretos y se recalculan al cambiar de tema.
 */
export interface ChartTheme {
  risk: ResolvedRiskColors
  accent: string
  info: string
  grid: string
  axis: string
  text: string
  strong: string
}

const FALLBACK: ChartTheme = {
  risk: { bajo: '#34d399', medio: '#fb923c', alto: '#f87171', unknown: '#6c7a94', info: '#38bdf8' },
  accent: '#2dd4bf',
  info: '#38bdf8',
  grid: 'rgb(148 163 184 / 0.1)',
  axis: '#6c7a94',
  text: '#a6b4cc',
  strong: '#e9eef8',
}

function readChartTheme(): ChartTheme {
  if (typeof document === 'undefined') return FALLBACK
  const cs = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  return {
    risk: resolveRiskColors(),
    accent: read('--accent', FALLBACK.accent),
    info: read('--info', FALLBACK.info),
    grid: read('--grid-line', FALLBACK.grid),
    axis: read('--content-muted', FALLBACK.axis),
    text: read('--content-secondary', FALLBACK.text),
    strong: read('--content-primary', FALLBACK.strong),
  }
}

export function useChartTheme(): ChartTheme {
  const [chartTheme, setChartTheme] = useState<ChartTheme>(readChartTheme)

  // `index.html` fija `data-theme` antes del primer render y el toggle lo
  // cambia en el DOM: el observer recalcula los tokens fuera del render.
  useEffect(() => {
    const observer = new MutationObserver(() => setChartTheme(readChartTheme()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  return chartTheme
}

/** Estilos compartidos del tooltip (CSS real: aquí sí funcionan los tokens). */
export const TOOLTIP_CONTENT_STYLE: CSSProperties = {
  background: 'var(--surface-2)',
  border: '1px solid var(--line-subtle)',
  borderRadius: 12,
  boxShadow: '0 8px 24px rgb(2 6 23 / 0.35)',
  color: 'var(--content-primary)',
  fontSize: 12,
  padding: '8px 12px',
}

export const TOOLTIP_LABEL_STYLE: CSSProperties = {
  color: 'var(--content-primary)',
  fontWeight: 600,
  marginBottom: 4,
}

export const TOOLTIP_ITEM_STYLE: CSSProperties = {
  color: 'var(--content-secondary)',
  padding: 0,
}
