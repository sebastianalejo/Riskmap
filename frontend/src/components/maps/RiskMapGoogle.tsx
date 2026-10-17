import { GoogleMap, InfoWindow, useJsApiLoader } from '@react-google-maps/api'
import { MarkerClusterer } from '@googlemaps/markerclusterer'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTheme } from '../../context/ThemeContext'
import type { MapPoint } from '../../hooks/useCrimeIncidentsForMap'
import { formatEventTime } from '../../utils/eventTime'
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
  const [map, setMap] = useState<google.maps.Map | null>(null)
  const [selected, setSelected] = useState<MapPoint | null>(null)
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
    (instance: google.maps.Map) => {
      setMap(instance)
      fitBounds(instance, points)
    },
    [fitBounds, points],
  )

  useEffect(() => {
    if (map && isLoaded) fitBounds(map, points)
  }, [map, points, fitBounds, isLoaded])

  // Agrupa los marcadores por zoom (clustering) para que miles de puntos no
  // saturen el DOM de Google Maps. Los clics siguen abriendo el InfoWindow.
  useEffect(() => {
    if (!map || !isLoaded) return

    const markers = points.map((point) => {
      const marker = new google.maps.Marker({
        position: { lat: point.lat, lng: point.lng },
        title: [point.crimeType, point.district].filter(Boolean).join(' · '),
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: point.source === 'inei' ? 8 : 9,
          fillColor: point.source === 'inei' ? colors.info : riskDotColor(point.riskLevel, colors),
          fillOpacity: 0.95,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      })
      marker.addListener('click', () => setSelected(point))
      return marker
    })

    const clusterer = new MarkerClusterer({ map, markers })
    return () => {
      clusterer.setMap(null)
      markers.forEach((marker) => marker.setMap(null))
    }
  }, [map, isLoaded, points, colors])

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

  const selectedPoint =
    selected && points.some((p) => p.id === selected.id) ? selected : null

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
        {selectedPoint && (
          <InfoWindow
            position={{ lat: selectedPoint.lat, lng: selectedPoint.lng }}
            onCloseClick={() => setSelected(null)}
          >
            <div className="text-xs">
              {selectedPoint.source === 'inei' && (
                <p className="mb-1 font-semibold text-info">INEI DataCrime / ArcGIS</p>
              )}
              {selectedPoint.crimeType && <p className="font-medium">{selectedPoint.crimeType}</p>}
              {selectedPoint.district && (
                <p className="text-content-secondary">{selectedPoint.district}</p>
              )}
              {(selectedPoint.year !== undefined ||
                selectedPoint.hour !== undefined ||
                selectedPoint.dayOfWeek) && (
                <p className="text-content-secondary">
                  Fecha y hora:{' '}
                  {formatEventTime({
                    year: selectedPoint.year,
                    dayOfWeek: selectedPoint.dayOfWeek,
                    hour: selectedPoint.hour,
                  })}
                </p>
              )}
              {selectedPoint.source === 'firestore' && selectedPoint.riskLevel && (
                <p className="mt-1">
                  Riesgo: <strong>{selectedPoint.riskLevel}</strong>
                </p>
              )}
              <p className="font-mono text-[10px] text-content-muted">
                {selectedPoint.lat.toFixed(5)}, {selectedPoint.lng.toFixed(5)}
              </p>
            </div>
          </InfoWindow>
        )}
      </GoogleMap>
    </div>
  )
}
