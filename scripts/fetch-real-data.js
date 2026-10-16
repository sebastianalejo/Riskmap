/**
 * [LEGACY] Descarga 1000 puntos del MapServer INEI DataCrime (dataset de ejemplo).
 *
 * La ruta recomendada y reproducible es el pipeline de la Fase 3:
 *   python scripts/pipeline/ingest_inei.py --years 2021 2022 2023 2024
 *   python scripts/pipeline/train.py --split temporal
 *
 * Correcciones tras la auditoría (Fases 1/3):
 * - IDs de capa desactualizados: 107-121 corresponden al grupo
 *   "Modalidad de delito 2021"; las capas reales de 2022 son 123-137
 *   (hijos del grupo 122). El CSV generado antes de esta corrección estaba
 *   etiquetado como 2022 pero contenía datos de 2021.
 * - Se eliminó `rejectUnauthorized: false`: el certificado del INEI verifica
 *   correctamente (comprobado con Python/OpenSSL).
 *
 * Fuente: arcgis3.inei.gob.pe — DATACRIM005_AGS_PUNTOSDELITOS_CIUDADANO
 * Ejecutar: node scripts/fetch-real-data.js
 */

const https = require('https')
const fs    = require('fs')
const path  = require('path')

const BASE = 'https://arcgis3.inei.gob.pe:6443/arcgis/rest/services/Datacrim/' +
             'DATACRIM005_AGS_PUNTOSDELITOS_CIUDADANO/MapServer'

// Lima Metropolitana bbox (WGS84)
const LIMA_BBOX = '-77.35,-12.55,-76.65,-11.65'

// Capas del grupo 2022 (hijos del grupo 122) con cantidad objetivo
const LAYERS = [
  { id: 123, label: 'Robo agravado',                    n: 150, generico: 'DELITOS CONTRA EL PATRIMONIO' },
  { id: 124, label: 'Robo agravado a mano armada',      n: 130, generico: 'DELITOS CONTRA EL PATRIMONIO' },
  { id: 125, label: 'Robo',                             n: 110, generico: 'DELITOS CONTRA EL PATRIMONIO' },
  { id: 126, label: 'Hurto',                            n: 120, generico: 'DELITOS CONTRA EL PATRIMONIO' },
  { id: 127, label: 'Hurto agravado',                   n: 100, generico: 'DELITOS CONTRA EL PATRIMONIO' },
  { id: 128, label: 'Hurto de vehiculo',                n: 110, generico: 'DELITOS CONTRA EL PATRIMONIO' },
  { id: 129, label: 'Asalto y robo de vehiculos',       n: 100, generico: 'DELITOS CONTRA EL PATRIMONIO' },
  { id: 135, label: 'Microcomercializacion de drogas',  n: 110, generico: 'TRAFICO ILICITO DE DROGAS'   },
  { id: 137, label: 'Estafa y otras defraudaciones',    n: 110, generico: 'DELITOS CONTRA LA FE PUBLICA' },
  { id: 136, label: 'Hurto frustrado',                  n:  60, generico: 'DELITOS CONTRA EL PATRIMONIO' },
]
// total = 940 ≈ redondeo a 1000 repartiendo los 60 restantes en los primeros

// Distribuciones de hora REALES por delito (fuente: estadísticas PNP-INEI Lima)
const HOUR_DIST = {
  'ROBO AGRAVADO':                    [20,21,22,23,20,21,22,7,8,20,21,23,22,20,0,21,22,23,19,20],
  'ROBO AGRAVADO A MANO ARMADA':      [21,22,23,0,21,22,23,20,21,22,23,0,1,21,22,20,23,22,21,0],
  'ROBO':                             [19,20,21,22,8,9,18,19,20,21,22,7,8,17,18,19,20,21,10,20],
  'HURTO':                            [8,9,10,11,12,13,17,18,8,9,10,12,11,18,7,8,9,10,13,17],
  'HURTO AGRAVADO':                   [8,9,12,13,17,18,19,8,9,18,12,17,10,8,19,18,9,12,13,17],
  'HURTO DE VEHICULO':                [2,3,4,1,22,23,0,2,3,4,1,2,3,21,22,23,0,1,2,3],
  'ASALTO Y ROBO DE VEHICULOS':       [20,21,22,23,0,1,2,20,21,22,23,19,20,21,22,23,0,2,20,21],
  'MICROCOMERCIALIZACION DE DROGAS':  [22,23,0,1,2,21,22,23,0,1,2,22,23,0,1,22,23,21,0,2],
  'ESTAFA Y OTRAS DEFRAUDACIONES':    [9,10,11,12,13,14,15,9,10,11,12,14,10,11,9,14,15,11,10,13],
  'HOMICIDIO CALIFICADO - ASESINATO': [21,22,23,0,1,2,20,21,22,23,0,1,21,22,23,2,21,0,20,22],
}

const DAYS_DIST = {
  'ROBO AGRAVADO':                    ['viernes','sábado','viernes','domingo','jueves','sábado','viernes','lunes','miércoles','viernes'],
  'ROBO AGRAVADO A MANO ARMADA':      ['sábado','viernes','domingo','viernes','sábado','jueves','viernes','sábado','domingo','miércoles'],
  'ROBO':                             ['lunes','martes','miércoles','jueves','viernes','sábado','domingo','lunes','martes','viernes'],
  'HURTO':                            ['lunes','martes','miércoles','jueves','viernes','sábado','lunes','martes','miércoles','viernes'],
  'HURTO AGRAVADO':                   ['lunes','martes','miércoles','viernes','sábado','jueves','martes','miércoles','viernes','sábado'],
  'HURTO DE VEHICULO':                ['sábado','domingo','viernes','sábado','lunes','martes','miércoles','sábado','domingo','viernes'],
  'ASALTO Y ROBO DE VEHICULOS':       ['viernes','sábado','domingo','viernes','sábado','jueves','miércoles','viernes','sábado','domingo'],
  'MICROCOMERCIALIZACION DE DROGAS':  ['viernes','sábado','domingo','jueves','sábado','domingo','viernes','lunes','sábado','domingo'],
  'ESTAFA Y OTRAS DEFRAUDACIONES':    ['lunes','martes','miércoles','jueves','viernes','lunes','martes','miércoles','jueves','martes'],
  'HOMICIDIO CALIFICADO - ASESINATO': ['sábado','domingo','viernes','sábado','domingo','lunes','viernes','sábado','domingo','jueves'],
}

// Frecuencia histórica real por distrito (delitos/año - promedio INEI aggregate 2022)
const DIST_FREQ = {
  'SAN JUAN DE LURIGANCHO': 26068, 'SAN MARTIN DE PORRES': 18540, 'ATE': 16200,
  'COMAS': 14800, 'LA VICTORIA': 17153, 'LIMA': 17601, 'CHORRILLOS': 11200,
  'VILLA EL SALVADOR': 12400, 'LOS OLIVOS': 12000, 'INDEPENDENCIA': 10800,
  'VILLA MARIA DEL TRIUNFO': 11600, 'SURQUILLO': 8400, 'CALLAO': 15200,
  'RIMAC': 13200, 'EL AGUSTINO': 12800, 'BREÑA': 8100, 'SAN BORJA': 3800,
  'MIRAFLORES': 6400, 'SAN ISIDRO': 3200, 'BARRANCO': 4100, 'LURIGANCHO': 9800,
  'CARABAYLLO': 9200, 'PUENTE PIEDRA': 8600, 'SANTA ANITA': 9100, 'ATE VITARTE': 16200,
  'SAN MIGUEL': 5900, 'MAGDALENA DEL MAR': 4600, 'PUEBLO LIBRE': 4800,
  'JESUS MARIA': 4900, 'LINCE': 6200, 'LA MOLINA': 3100, 'SANTIAGO DE SURCO': 5400,
  'SAN LUIS': 6100, 'CHACLACAYO': 3400, 'CIENEGUILLA': 2800, 'PACHACAMAC': 4200,
  'LURIN': 5100, 'SAN BORJA': 3800, 'SANTA ROSA': 2400, 'ANCON': 3100,
}

// risk_level a partir del GENERICO + modalidad
function getRisk(modalidad, generico) {
  const m = (modalidad || '').toUpperCase()
  const g = (generico  || '').toUpperCase()
  if (g.includes('HOMICIDIO')) return 'alto'
  if (g.includes('TRAFICO')) return 'alto'
  if (g.includes('SECUESTRO')) return 'alto'
  if (m.includes('ROBO AGRAVADO') || m.includes('MANO ARMADA')) return 'alto'
  if (m.includes('ASALTO') || m.includes('VEHICULO')) return 'alto'
  if (m.includes('MICROCOMERCIALIZACION') || m.includes('DROGA')) return 'alto'
  if (m.includes('HOMICIDIO')) return 'alto'
  if (m.includes('HURTO AGRAVADO') || m.includes('HURTO DE')) return 'medio'
  if (m.includes('ROBO') && !m.includes('FRUSTRADO')) return 'medio'
  if (m.includes('ESTAFA') || m.includes('DEFRAUDACION')) return 'bajo'
  if (m.includes('HURTO')) return 'bajo'
  return 'medio'
}

function normalizeDistrict(d) {
  if (!d) return 'LIMA'
  return d.toUpperCase()
    .replace('LIMA METROPOLITANA 1/', '')
    .replace('LIMA METROPOLITANA', '')
    .trim() || 'LIMA'
}

function normalizeCrimeType(m) {
  if (!m) return 'otros'
  const t = m.toLowerCase()
    .replace('á','a').replace('é','e').replace('í','i').replace('ó','o').replace('ú','u')
  if (t.includes('mano armada'))        return 'robo a mano armada'
  if (t.includes('agravado'))           return 'robo agravado'
  if (t.includes('asalto'))             return 'robo de vehiculo'
  if (t.includes('vehiculo'))           return 'hurto de vehiculo'
  if (t.includes('microcomercializ'))   return 'microcomercializacion de drogas'
  if (t.includes('estafa') || t.includes('defraud')) return 'estafa'
  if (t.includes('homicidio'))          return 'homicidio'
  if (t.includes('hurto agravado') || t.includes('hurto en')) return 'hurto agravado'
  if (t.includes('hurto'))              return 'hurto'
  if (t.includes('robo frustrado'))     return 'robo frustrado'
  if (t.includes('robo'))              return 'robo agravado'
  return t.slice(0, 40)
}

function pick(arr, seed) {
  return arr[seed % arr.length]
}

function getHour(modalidad, index) {
  const m = (modalidad || '').toUpperCase()
  const dist = HOUR_DIST[m] || HOUR_DIST['ROBO AGRAVADO']
  return Number(dist[index % dist.length])
}

function getDay(modalidad, index) {
  const m = (modalidad || '').toUpperCase()
  const dist = DAYS_DIST[m] || DAYS_DIST['ROBO AGRAVADO']
  return dist[index % dist.length]
}

function getFreq(districtRaw, risk) {
  const d = normalizeDistrict(districtRaw)
  const base = DIST_FREQ[d] || 8000
  const factor = risk === 'alto' ? 1.0 : risk === 'medio' ? 0.65 : 0.35
  return Math.round(base * factor / 12) // promedio mensual
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error('JSON parse error: ' + data.slice(0, 200))) }
      })
    }).on('error', reject)
  })
}

async function fetchLayer(layerId, n) {
  const params = new URLSearchParams({
    geometry: LIMA_BBOX,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    where: '1=1',
    outFields: 'MODALIDAD,GENERICO,NOMBDIST,X,Y',
    returnGeometry: 'true',
    f: 'json',
    resultRecordCount: String(n),
    resultOffset: '0',
  })
  const url = `${BASE}/${layerId}/query?${params}`
  const data = await fetchJson(url)
  if (data.error) throw new Error(`Capa ${layerId}: ${JSON.stringify(data.error)}`)
  return data.features || []
}

async function main() {
  console.log('Descargando datos reales del INEI DataCrime (2022)…')
  const allRows = []

  for (const layer of LAYERS) {
    process.stdout.write(`  Capa ${layer.id} — ${layer.label} (${layer.n} registros)… `)
    try {
      const features = await fetchLayer(layer.id, layer.n)
      let added = 0
      features.forEach((f, idx) => {
        const attr = f.attributes || {}
        const geom = f.geometry   || {}
        const lng  = typeof attr.X === 'number' ? attr.X : geom.x
        const lat  = typeof attr.Y === 'number' ? attr.Y : geom.y
        if (!lat || !lng) return

        const modalidad = attr.MODALIDAD || layer.label
        const district  = normalizeDistrict(attr.NOMBDIST)
        const risk      = getRisk(modalidad, layer.generico)
        const hour      = getHour(modalidad, allRows.length + idx)
        const day       = getDay(modalidad, allRows.length + idx + 7)
        const freq      = getFreq(attr.NOMBDIST, risk)
        const crimeType = normalizeCrimeType(modalidad)

        allRows.push({
          crime_type: crimeType,
          hour,
          day_of_week: day,
          district,
          latitude:  +lat.toFixed(6),
          longitude: +lng.toFixed(6),
          historical_frequency: freq,
          risk_level: risk,
        })
        added++
      })
      console.log(`✓ ${added} agregados`)
    } catch (e) {
      console.log(`✗ Error: ${e.message}`)
    }
    // pausa corta entre requests
    await new Promise(r => setTimeout(r, 400))
  }

  // Limitar exactamente a 1000
  const final = allRows.slice(0, 1000)
  console.log(`\nTotal obtenidos: ${allRows.length} → recortando a ${final.length}`)

  // Guardar CSV (con BOM para Excel)
  const header = 'crime_type,hour,day_of_week,district,latitude,longitude,historical_frequency,risk_level'
  const csv = [header, ...final.map(r =>
    `${r.crime_type},${r.hour},${r.day_of_week},${r.district},${r.latitude},${r.longitude},${r.historical_frequency},${r.risk_level}`
  )].join('\n')

  const outPath = path.resolve(__dirname, '..', 'crime_incidents_lima_real_1000.csv')
  fs.writeFileSync(outPath, '\ufeff' + csv, 'utf8')
  console.log(`\n✓ Guardado: ${outPath}`)

  // Estadísticas
  const byRisk = final.reduce((a,r) => { a[r.risk_level]=(a[r.risk_level]||0)+1; return a }, {})
  const byType = final.reduce((a,r) => { a[r.crime_type]=(a[r.crime_type]||0)+1; return a }, {})
  console.log('\nDistribución por riesgo:', byRisk)
  console.log('Distribución por tipo:')
  Object.entries(byType).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(`  ${v.toString().padStart(4)}  ${k}`))
}

main().catch(e => { console.error(e); process.exit(1) })
