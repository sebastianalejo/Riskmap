import { GoogleMap, Marker, useJsApiLoader } from '@react-google-maps/api'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTheme } from '../../context/ThemeContext'
import type { MapPoint } from '../../hooks/useCrimeIncidentsForMap'
import { resolveRiskColors, riskDotColor } from './riskColors'

const containerStyle = { width: '100%', height: '100%' }
const defaultCenter = { lat: -12.0464, lng: -77.0428 }

/** Estilo nocturno compacto alineado con el tema oscuro de RiskMap. */
const DARK_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#0c1425' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#a6b4cc' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0c1425' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#33415f' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1b2942' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#131e33' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#6c7a94' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#060b17' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#475569' }] },
]

type Props = {
  apiKey: string
  points: MapPoint[]
}

export function RiskMapGoogle({ apiKey, points }: Props) {
  const mapRef = useRef<google.maps.Map | null>(null)
  const { theme } = useTheme()
  // Los colores del canvas (Google Maps) no entienden variables CSS: se resuelven por tema.
  // `theme` dispara el recálculo al cambiar de tema (los valores vienen del CSS).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const colors = useMemo(() => resolveRiskColors(), [theme])

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'riskmap-google-script',
    googleMapsApiKey: apiKey,
    version: 'weekly',
  })

  const fitBounds = useCallback((map: google.maps.Map, pts: MapPoint[]) => {
    if (pts.length === 0) return
    if (pts.length === 1) {
      map.setCenter({ lat: pts[0].lat, lng: pts[0].lng })
      map.setZoom(14)
      return
    }
    const bounds = new google.maps.LatLngBounds()
    pts.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }))
    map.fitBounds(bounds, 48)
  }, [])

  const onLoad = useCallback(
    (map: google.maps.Map) => {
      mapRef.current = map
      fitBounds(map, points)
    },
    [fitBounds, points],
  )

  useEffect(() => {
    const map = mapRef.current
    if (map && isLoaded) fitBounds(map, points)
  }, [points, fitBounds, isLoaded])

  if (loadError) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center rounded-xl border border-risk-alto/30 bg-risk-alto-soft px-4 text-sm text-risk-alto">
        No se pudo cargar Google Maps. Revisa la clave de API y que Maps JavaScript API esté
        activada.
      </div>
    )
  }

  if (!isLoaded) {
    return (
      <div
        className="flex h-full min-h-[320px] w-full items-center justify-center rounded-xl border border-line-subtle bg-surface-1 text-sm text-content-secondary"
        role="status"
      >
        Cargando mapa…
      </div>
    )
  }

  return (
    <div className="h-full overflow-hidden rounded-xl border border-line-subtle">
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={defaultCenter}
        zoom={12}
        onLoad={onLoad}
        options={{
          streetViewControl: false,
          mapTypeControl: true,
          fullscreenControl: true,
          styles: theme === 'dark' ? DARK_MAP_STYLE : undefined,
        }}
      >
        {points.map((p) => (
          <Marker
            key={p.id}
            position={{ lat: p.lat, lng: p.lng }}
            title={[p.crimeType, p.district].filter(Boolean).join(' · ')}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: p.source === 'inei' ? 8 : 9,
              fillColor:
                p.source === 'inei' ? colors.info : riskDotColor(p.riskLevel, colors),
              fillOpacity: 0.95,
              strokeColor: '#ffffff',
              strokeWeight: 2,
            }}
          />
        ))}
      </GoogleMap>
    </div>
  )
}
