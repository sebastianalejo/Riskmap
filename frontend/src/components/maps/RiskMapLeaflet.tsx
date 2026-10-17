import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import { useTheme } from '../../context/ThemeContext'
import type { MapPoint } from '../../hooks/useCrimeIncidentsForMap'
import { resolveRiskColors, riskDotColor } from './riskColors'

const LIMA_CENTER: [number, number] = [-12.0464, -77.0428]

function FitIncidentBounds({ points }: { points: MapPoint[] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 14)
      return
    }
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]))
    map.fitBounds(bounds, { padding: [40, 40] })
  }, [map, points])
  return null
}

type Props = {
  points: MapPoint[]
}

export function RiskMapLeaflet({ points }: Props) {
  const { theme } = useTheme()
  // Los colores del canvas (Leaflet) no entienden variables CSS: se resuelven por tema.
  // `theme` dispara el recálculo al cambiar de tema (los valores vienen del CSS).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const colors = useMemo(() => resolveRiskColors(), [theme])

  // OSM no requiere API key. En tema oscuro los tiles se oscurecen con un filtro CSS
  // (ver `index.css`, `.leaflet-tile-pane`).
  const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  const attribution =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

  return (
    <div className="h-full overflow-hidden rounded-xl border border-line-subtle">
      <MapContainer
        center={LIMA_CENTER}
        zoom={12}
        className="z-0 h-full min-h-[320px] w-full"
        scrollWheelZoom
      >
        <FitIncidentBounds points={points} />
        <TileLayer url={tileUrl} attribution={attribution} />
        {points.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lng]}
            radius={p.source === 'inei' ? 8 : 9}
            pathOptions={{
              color: '#ffffff',
              weight: 2,
              fillColor: p.source === 'inei' ? colors.info : riskDotColor(p.riskLevel, colors),
              fillOpacity: 0.9,
            }}
          >
            <Popup>
              <div className="text-xs">
                {p.source === 'inei' && (
                  <p className="mb-1 font-semibold text-info">INEI DataCrime / ArcGIS</p>
                )}
                {p.crimeType && <p className="font-medium">{p.crimeType}</p>}
                {p.district && <p className="text-content-secondary">{p.district}</p>}
                {p.year !== undefined && Number.isFinite(p.year) && (
                  <p className="text-content-secondary">Año: {p.year}</p>
                )}
                {p.source === 'firestore' && p.riskLevel && (
                  <p className="mt-1">
                    Riesgo: <strong>{p.riskLevel}</strong>
                  </p>
                )}
                <p className="font-mono text-[10px] text-content-muted">
                  {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                </p>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  )
}
