import { addDoc, collection, deleteDoc, getDocs, getFirestore } from 'firebase/firestore'
import { CheckCircle2, Loader2, ShieldAlert, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../context/AuthContext'
import type { CrimeIncident } from '../data/sampleIncidents'
import { getFirebaseApp } from '../firebase/client'

const COLLECTION = 'crime_incidents'

const REQUIRED = [
  'crime_type', 'hour', 'day_of_week', 'district',
  'latitude', 'longitude', 'historical_frequency', 'risk_level',
] as const

const DAYS_OF_WEEK = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const
const RISK_LEVELS = ['bajo', 'medio', 'alto'] as const

// Bbox de Lima Metropolitana — debe coincidir con firestore.rules y
// functions/crime_ml/validation.py.
const LAT_MIN = -12.7
const LAT_MAX = -11.5
const LON_MIN = -77.5
const LON_MAX = -76.5

function validateRow(row: Record<string, unknown>): string | null {
  for (const k of REQUIRED) {
    if (row[k] === undefined || row[k] === null || String(row[k]).trim() === '')
      return `Falta el campo "${k}"`
  }

  const crimeType = String(row.crime_type).trim()
  if (crimeType.length > 60) return 'crime_type excede 60 caracteres'

  const district = String(row.district).trim()
  if (district.length > 80) return 'district excede 80 caracteres'

  const day = String(row.day_of_week).trim().toLowerCase()
  if (!(DAYS_OF_WEEK as readonly string[]).includes(day))
    return `day_of_week debe ser uno de: ${DAYS_OF_WEEK.join(', ')}`

  const hour = Number(row.hour)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23)
    return 'hour debe ser un entero entre 0 y 23'

  const latitude = Number(row.latitude)
  if (!Number.isFinite(latitude) || latitude < LAT_MIN || latitude > LAT_MAX)
    return `latitude fuera del rango de Lima Metropolitana (${LAT_MIN} a ${LAT_MAX})`

  const longitude = Number(row.longitude)
  if (!Number.isFinite(longitude) || longitude < LON_MIN || longitude > LON_MAX)
    return `longitude fuera del rango de Lima Metropolitana (${LON_MIN} a ${LON_MAX})`

  const frequency = Number(row.historical_frequency)
  if (!Number.isInteger(frequency) || frequency < 1 || frequency > 1_000_000)
    return 'historical_frequency debe ser un entero ≥ 1'

  const risk = String(row.risk_level).trim().toLowerCase()
  if (!(RISK_LEVELS as readonly string[]).includes(risk))
    return `risk_level debe ser bajo, medio o alto (fila tiene: "${String(row.risk_level)}")`

  return null
}

/** Normaliza la fila a exactamente las 8 columnas del esquema (las reglas exigen hasOnly). */
function toIncident(row: Record<string, unknown>): CrimeIncident {
  return {
    crime_type: String(row.crime_type).trim(),
    hour: Number(row.hour),
    day_of_week: String(row.day_of_week).trim().toLowerCase(),
    district: String(row.district).trim().toUpperCase(),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    historical_frequency: Number(row.historical_frequency),
    risk_level: String(row.risk_level).trim().toLowerCase() as CrimeIncident['risk_level'],
  }
}

async function writeBatch(rows: CrimeIncident[]): Promise<number> {
  const app = getFirebaseApp()
  if (!app) throw new Error('Firebase no inicializado')
  const db  = getFirestore(app)
  const col = collection(db, COLLECTION)
  for (const row of rows) await addDoc(col, row)
  return rows.length
}

async function deleteAll(): Promise<number> {
  const app  = getFirebaseApp()
  if (!app) throw new Error('Firebase no inicializado')
  const db   = getFirestore(app)
  const snap = await getDocs(collection(db, COLLECTION))
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)))
  return snap.size
}

function parseSheet(wb: XLSX.WorkBook): CrimeIncident[] {
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const data  = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false })
  if (data.length === 0) throw new Error('El archivo no contiene filas de datos')
  const rows: CrimeIncident[] = []
  for (let i = 0; i < data.length; i++) {
    const row = { ...data[i] }
    const err = validateRow(row)
    if (err) throw new Error(`Fila ${i + 2}: ${err}`)
    rows.push(toIncident(row))
  }
  return rows
}

const ta =
  'min-h-[120px] w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/25' as const

export function DataPage() {
  const { isAdmin } = useAuth()
  const [rowsJson, setRowsJson]           = useState('')
  const [loading, setLoading]             = useState(false)
  const [fileLoading, setFileLoading]     = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError]                 = useState<string | null>(null)
  const [success, setSuccess]             = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => { setError(null); setSuccess(null) }

  /* ── Subir Excel / CSV ── */
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    reset()
    if (!isAdmin) {
      setError('Tu cuenta no tiene el permiso admin necesario para importar datos.')
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    setFileLoading(true)
    try {
      const buf  = await file.arrayBuffer()
      const wb   = XLSX.read(buf, { type: 'array' })
      const rows = parseSheet(wb)
      const n    = await writeBatch(rows)
      setSuccess(`✓ ${n} registro(s) de «${file.name}» guardados en Firestore.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al procesar el archivo')
    } finally {
      setFileLoading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /* ── Borrar todos ── */
  const onDelete = async () => {
    if (!isAdmin) {
      setError('Tu cuenta no tiene el permiso admin necesario para borrar datos.')
      return
    }
    if (!confirmDelete) { setConfirmDelete(true); return }
    reset()
    setDeleteLoading(true)
    setConfirmDelete(false)
    try {
      const n = await deleteAll()
      setSuccess(`✓ ${n} registro(s) eliminados de Firestore.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al borrar')
    } finally {
      setDeleteLoading(false)
    }
  }

  /* ── JSON manual ── */
  const onImportRows = async (e: React.FormEvent) => {
    e.preventDefault()
    reset()
    if (!isAdmin) {
      setError('Tu cuenta no tiene el permiso admin necesario para importar datos.')
      return
    }
    setLoading(true)
    try {
      let parsed: unknown
      try { parsed = JSON.parse(rowsJson) } catch { throw new Error('JSON inválido') }
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Debe ser un array no vacío')
      const rows = parsed as Record<string, unknown>[]
      for (const row of rows) {
        const err = validateRow(row)
        if (err) throw new Error(err)
      }
      const n = await writeBatch(rows.map(toIncident))
      setSuccess(`✓ ${n} registro(s) guardados en Firestore.`)
      setRowsJson('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8">

      {/* Encabezado */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Datos en Firestore</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Colección{' '}
          <code className="rounded bg-slate-100 px-1 font-mono text-xs">crime_incidents</code>.
          Columnas requeridas:{' '}
          <span className="font-mono text-xs">
            crime_type, hour, day_of_week, district, latitude, longitude,
            historical_frequency, risk_level
          </span>.
        </p>
      </div>

      {/* Aviso de solo lectura para cuentas sin claim admin */}
      {!isAdmin && (
        <div className="flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Modo lectura: tu cuenta no tiene el permiso <code className="font-mono text-xs">admin</code> que
            exigen las reglas de Firestore para importar o borrar registros. Pide a un administrador que
            asigne el claim (ver <span className="font-mono text-xs">scripts/set-admin-claim.py</span>).
          </p>
        </div>
      )}

      {/* Acciones principales */}
      {isAdmin && (
        <div className="grid gap-4 sm:grid-cols-2">

          {/* Subir Excel / CSV */}
          <div className="rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50/80 to-white p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-600 text-white shadow-sm">
                <Upload className="size-5" aria-hidden />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Subir Excel o CSV</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Acepta <strong>.xlsx</strong>, <strong>.xls</strong> y <strong>.csv</strong>.
                  La primera fila debe ser el encabezado con los nombres de columna exactos.
                </p>
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={onFileChange}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={fileLoading}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {fileLoading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {fileLoading ? 'Procesando…' : 'Elegir archivo'}
            </button>
          </div>

          {/* Borrar registros */}
          <div className="rounded-2xl border border-red-100 bg-red-50/60 p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">
                <Trash2 className="size-5" aria-hidden />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-red-900">Borrar registros</h2>
                <p className="mt-1 text-xs text-red-700">
                  Elimina <strong>todos</strong> los documentos de{' '}
                  <code className="font-mono text-[11px]">crime_incidents</code> en Firestore.
                  Esta acción no se puede deshacer.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onDelete}
              disabled={deleteLoading}
              className={[
                'mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition disabled:opacity-60',
                confirmDelete
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'border border-red-300 bg-white text-red-700 hover:bg-red-50',
              ].join(' ')}
            >
              {deleteLoading ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {deleteLoading
                ? 'Borrando…'
                : confirmDelete
                  ? '¿Confirmar? Pulsa de nuevo'
                  : 'Borrar todos los registros'}
            </button>
            {confirmDelete && (
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="mt-1 w-full text-center text-xs text-red-500 hover:underline"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}

      {/* Mensajes */}
      {error && (
        <div className="flex gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          <Trash2 className="mt-0.5 size-4 shrink-0 text-red-400" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          {success}
        </div>
      )}

      {/* JSON manual (colapsado) */}
      {isAdmin && (
        <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer select-none text-sm font-semibold text-slate-900">
            Importar filas JSON manualmente
          </summary>
          <form onSubmit={onImportRows} className="mt-4 space-y-3">
            <p className="text-xs text-slate-500">
              Pega un array JSON con los campos requeridos.
            </p>
            <textarea
              className={ta}
              value={rowsJson}
              onChange={(e) => setRowsJson(e.target.value)}
              placeholder={`[\n  {\n    "crime_type": "robo agravado",\n    "hour": 22,\n    "day_of_week": "viernes",\n    "district": "MIRAFLORES",\n    "latitude": -12.1219,\n    "longitude": -77.0297,\n    "historical_frequency": 140,\n    "risk_level": "alto"\n  }\n]`}
            />
            <button
              type="submit"
              disabled={loading || !rowsJson.trim()}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? 'Guardando…' : 'Guardar en Firestore'}
            </button>
          </form>
        </details>
      )}

    </div>
  )
}
