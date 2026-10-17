import 'leaflet/dist/leaflet.css'
import { useEffect, useState } from 'react'
import { GeoJSON, MapContainer, TileLayer } from 'react-leaflet'
import type { FeatureCollection, Geometry } from 'geojson'
import type { ChoroplethMetric, DistrictTotals } from '../../utils/districtStats'
import { choroplethColor, districtMetricValue, legendBuckets } from '../../utils/districtStats'
import { MODALITY_SHORT } from '../../utils/monthlyStats'

const LIMA_CENTER: [number, number] = [-12.0464, -77.0428]
const GEOJSON_URL = '/geo/lima_distritos.geojson'
const numberFormat = new Intl.NumberFormat('es-PE')
const METRIC_LABELS: Record<ChoroplethMetric, string> = {
  conteo: 'Denuncias en el periodo',
  tasa: 'Denuncias por 100 000 hab.',
}

type DistrictProperties = { ubigeo: string; district: string; patch?: string }
type DistrictCollection = FeatureCollection<Geometry, DistrictProperties>

let districtsPromise: Promise<DistrictCollection> | null = null

function loadDistricts(): Promise<DistrictCollection> {
  districtsPromise ??= fetch(GEOJSON_URL, { cache: 'force-cache' }).then((response) => {
    if (!response.ok) {
      throw new Error(`No se pudo cargar el GeoJSON de distritos (HTTP ${response.status})`)
    }
    return response.json() as Promise<DistrictCollection>
  })
  return districtsPromise
}

function tooltipHtml(properties: DistrictProperties, info: DistrictTotals | undefined): string {
  if (!info) return `<strong>${properties.district}</strong><br/>Sin datos en el periodo`
  const top = info.topModality ? MODALITY_SHORT[info.topModality] ?? info.topModality : null
  const lines = [`<strong>${properties.district}</strong>`]
  lines.push(`${numberFormat.format(info.total)} denuncias${top ? ` · ${top}` : ''}`)
  if (info.rate != null) lines.push(`${info.rate.toFixed(1)} por 100 000 hab.`)
  if (info.population != null) lines.push(`Población: ${numberFormat.format(info.population)}`)
  if (info.stationsCount) lines.push(`${info.stationsCount} comisarías`)
  return lines.join('<br/>')
}

interface Props {
  districts: DistrictTotals[]
  months: number
  metric: ChoroplethMetric
}

/** Capa coroplética: denuncias oficiales por distrito (conteo o tasa por 100 000). */
export function DistrictChoroplethMap({ districts, months, metric }: Props) {
  const [collection, setCollection] = useState<DistrictCollection | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadDistricts()
      .then((data) => {
        if (!cancelled) setCollection(data)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error al cargar los distritos')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const byUbigeo = new Map(districts.map((item) => [item.ubigeo, item]))
  const max = Math.max(0, ...districts.map((item) => districtMetricValue(item, metric)))

  if (error) {
    return (
      <div className="rounded-xl border border-risk-alto/30 bg-risk-alto-soft px-4 py-3 text-sm text-risk-alto">
        {error}
      </div>
    )
  }

  if (!collection) {
    return (
      <div className="flex h-full min-h-[320px] w-full items-center justify-center rounded-xl border border-line-subtle bg-surface-1 text-sm text-content-secondary">
        Cargando distritos…
      </div>
    )
  }

  return (
    <div className="h-full overflow-hidden rounded-xl border border-line-subtle shadow-inner">
      <MapContainer center={LIMA_CENTER} zoom={11} className="z-0 h-full min-h-[320px] w-full" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <GeoJSON
          key={`${months}-${metric}-${districts.length}`}
          data={collection}
          style={(feature) => {
            const ubigeo = feature?.properties?.ubigeo as string | undefined
            const info = ubigeo ? byUbigeo.get(ubigeo) : undefined
            const value = info ? districtMetricValue(info, metric) : 0
            return {
              color: 'rgb(233 238 248 / 0.35)',
              weight: 0.6,
              fillColor: choroplethColor(value, max),
              fillOpacity: 1,
            }
          }}
          onEachFeature={(feature, layer) => {
            const properties = feature.properties as DistrictProperties
            layer.bindTooltip(tooltipHtml(properties, byUbigeo.get(properties.ubigeo)))
          }}
        />
      </MapContainer>
    </div>
  )
}

/** Leyenda HTML de la escala de la coropleta (se renderiza fuera del mapa). */
export function DistrictLegend({ districts, metric }: { districts: DistrictTotals[]; metric: ChoroplethMetric }) {
  const max = Math.max(0, ...districts.map((item) => districtMetricValue(item, metric)))
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-content-muted">
        {METRIC_LABELS[metric]}
      </span>
      {legendBuckets(max).map((bucket) => (
        <span key={bucket.from} className="inline-flex items-center gap-1.5 text-[11px] text-content-secondary">
          <span className="size-2.5 rounded-sm ring-1 ring-line-subtle" style={{ background: bucket.color }} aria-hidden />
          <span className="font-mono">
            {numberFormat.format(bucket.from)}–{numberFormat.format(bucket.to)}
          </span>
        </span>
      ))}
    </div>
  )
}
