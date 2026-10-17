import { collection, deleteDoc, doc, getDocs, getFirestore, setDoc } from 'firebase/firestore'
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  ShieldAlert,
  Table2,
  Trash2,
  Upload,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Button } from '../components/ui/button'
import { Card, CardHeader } from '../components/ui/card'
import { Label, Textarea } from '../components/ui/input'
import { Modal } from '../components/ui/modal'
import { useToast } from '../components/ui/toast'
import { useAuth } from '../context/AuthContext'
import type { CrimeIncident } from '../data/sampleIncidents'
import { getFirebaseApp } from '../firebase/client'
import { stableRowId } from '../utils/stableId'

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

interface ParsedRow {
  /** Número de fila en la hoja (1 = encabezado). */
  line: number
  incident: CrimeIncident | null
  error: string | null
  raw: Record<string, unknown>
}

interface PreviewFile {
  name: string
  rows: ParsedRow[]
}

function parseSheet(wb: XLSX.WorkBook): ParsedRow[] {
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false })
  if (data.length === 0) throw new Error('El archivo no contiene filas de datos')
  return data.map((row, i) => {
    const validationError = validateRow(row)
    return {
      line: i + 2,
      incident: validationError ? null : toIncident(row),
      error: validationError,
      raw: row,
    }
  })
}

async function writeBatch(
  rows: CrimeIncident[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const app = getFirebaseApp()
  if (!app) throw new Error('Firebase no inicializado')
  const db = getFirestore(app)
  const col = collection(db, COLLECTION)
  // ID determinista por contenido (utils/stableId.ts): reimportar el mismo
  // archivo actualiza los mismos documentos en lugar de duplicarlos.
  const unique = new Map(rows.map((row) => [stableRowId(row as unknown as Record<string, unknown>), row]))
  let done = 0
  for (const [docId, row] of unique) {
    await setDoc(doc(col, docId), row)
    done++
    onProgress?.(done, unique.size)
  }
  return done
}

async function deleteAll(): Promise<number> {
  const app = getFirebaseApp()
  if (!app) throw new Error('Firebase no inicializado')
  const db = getFirestore(app)
  const snap = await getDocs(collection(db, COLLECTION))
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)))
  return snap.size
}

function downloadTemplate() {
  const headers = REQUIRED.join(',')
  const example = 'robo agravado,22,viernes,MIRAFLORES,-12.1219,-77.0297,140,alto'
  const blob = new Blob([`${headers}\n${example}\n`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'plantilla-incidentes.csv'
  a.click()
  URL.revokeObjectURL(url)
}

const PREVIEW_LIMIT = 8

export function DataPage() {
  const { isAdmin } = useAuth()
  const { toast } = useToast()

  const [rowsJson, setRowsJson] = useState('')
  const [jsonLoading, setJsonLoading] = useState(false)
  const [fileLoading, setFileLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewFile | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const previewStats = useMemo(() => {
    if (!preview) return null
    const valid = preview.rows.filter((r) => r.incident).length
    return { valid, invalid: preview.rows.length - valid, total: preview.rows.length }
  }, [preview])

  const reset = () => setError(null)

  /* ── Subir Excel / CSV (parseo + vista previa) ── */
  const handleFile = async (file: File) => {
    reset()
    if (!isAdmin) {
      setError('Tu cuenta no tiene el permiso admin necesario para importar datos.')
      return
    }
    setFileLoading(true)
    setPreview(null)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const rows = parseSheet(wb)
      setPreview({ name: file.name, rows })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al procesar el archivo'
      setError(msg)
      toast({ variant: 'error', title: 'No se pudo leer el archivo', description: msg })
    } finally {
      setFileLoading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void handleFile(file)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }

  /* ── Importar filas válidas de la vista previa ── */
  const confirmImport = async () => {
    if (!preview) return
    const valid = preview.rows.flatMap((r) => (r.incident ? [r.incident] : []))
    if (valid.length === 0) {
      setError('El archivo no tiene filas válidas para importar.')
      return
    }
    reset()
    setImporting(true)
    setProgress({ done: 0, total: valid.length })
    try {
      const n = await writeBatch(valid, (done, total) => setProgress({ done, total }))
      toast({
        variant: 'success',
        title: `${n} registro(s) importados`,
        description: `Guardados en Firestore desde «${preview.name}».`,
      })
      setPreview(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al guardar'
      setError(msg)
      toast({ variant: 'error', title: 'No se pudo importar', description: msg })
    } finally {
      setImporting(false)
      setProgress(null)
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
    setJsonLoading(true)
    try {
      let parsed: unknown
      try {
        parsed = JSON.parse(rowsJson)
      } catch {
        throw new Error('JSON inválido')
      }
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Debe ser un array no vacío')
      const rows = parsed as Record<string, unknown>[]
      for (const row of rows) {
        const err = validateRow(row)
        if (err) throw new Error(err)
      }
      const incidents = rows.map(toIncident)
      setProgress({ done: 0, total: incidents.length })
      const n = await writeBatch(incidents, (done, total) => setProgress({ done, total }))
      toast({ variant: 'success', title: `${n} registro(s) guardados en Firestore` })
      setRowsJson('')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al guardar'
      setError(msg)
      toast({ variant: 'error', title: 'No se pudo importar el JSON', description: msg })
    } finally {
      setJsonLoading(false)
      setProgress(null)
    }
  }

  /* ── Borrar todos ── */
  const handleDelete = async () => {
    if (!isAdmin) {
      setError('Tu cuenta no tiene el permiso admin necesario para borrar datos.')
      return
    }
    setDeleteLoading(true)
    try {
      const n = await deleteAll()
      toast({ variant: 'success', title: `${n} registro(s) eliminados de Firestore` })
      setDeleteOpen(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al borrar'
      setError(msg)
      toast({ variant: 'error', title: 'No se pudo borrar', description: msg })
    } finally {
      setDeleteLoading(false)
    }
  }

  const progressPct = progress && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0

  const previewRows = preview ? preview.rows.slice(0, PREVIEW_LIMIT) : []

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-content-primary">
            Datos en Firestore
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-content-secondary">
            Colección <code className="rounded bg-surface-2 px-1 font-mono text-xs">crime_incidents</code>.
            Columnas requeridas:{' '}
            <span className="font-mono text-xs">
              crime_type, hour, day_of_week, district, latitude, longitude, historical_frequency,
              risk_level
            </span>
            . Reimportar el mismo archivo <strong className="text-content-primary">actualiza</strong> los
            registros existentes (ID determinista por contenido), nunca los duplica.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={downloadTemplate}>
          <FileSpreadsheet className="size-3.5" aria-hidden />
          Descargar plantilla CSV
        </Button>
      </div>

      {/* Aviso de solo lectura para cuentas sin claim admin */}
      {!isAdmin && (
        <div className="flex gap-2 rounded-2xl border border-risk-medio/30 bg-risk-medio-soft px-4 py-3 text-sm text-risk-medio">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Modo lectura: tu cuenta no tiene el permiso{' '}
            <code className="font-mono text-xs">admin</code> que exigen las reglas de Firestore
            para importar o borrar registros. Pide a un administrador que asigne el claim (ver{' '}
            <span className="font-mono text-xs">scripts/set-admin-claim.py</span>).
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="flex gap-2 rounded-2xl border border-risk-alto/30 bg-risk-alto-soft px-4 py-3 text-sm text-risk-alto"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </div>
      )}

      {isAdmin && (
        <>
          {/* Subir archivo */}
          <Card className="p-6">
            <CardHeader
              title="Subir Excel o CSV"
              description="Acepta .xlsx, .xls y .csv. La primera fila debe tener los encabezados exactos."
            />
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={onFileChange}
            />
            <div
              role="button"
              tabIndex={0}
              aria-label="Subir archivo: arrastra o haz clic para elegir"
              onClick={() => !fileLoading && !importing && fileRef.current?.click()}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !fileLoading && !importing) {
                  e.preventDefault()
                  fileRef.current?.click()
                }
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={[
                'mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-8 text-center transition',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                dragOver
                  ? 'border-accent bg-accent-soft'
                  : 'border-line-strong bg-surface-2/40 hover:border-accent/50 hover:bg-surface-2',
              ].join(' ')}
            >
              <div className="flex size-11 items-center justify-center rounded-xl bg-surface-2 text-accent">
                {fileLoading ? (
                  <Loader2 className="size-5 animate-spin" aria-hidden />
                ) : (
                  <Upload className="size-5" aria-hidden />
                )}
              </div>
              <p className="text-sm font-medium text-content-primary">
                {fileLoading
                  ? 'Procesando archivo…'
                  : 'Arrastra tu CSV o Excel aquí, o haz clic para elegirlo'}
              </p>
              <p className="text-xs text-content-muted">.xlsx · .xls · .csv</p>
            </div>

            {/* Progreso de importación */}
            {progress && (
              <div className="mt-4" role="status" aria-label="Progreso de importación">
                <div className="flex items-center justify-between text-xs text-content-secondary">
                  <span>Importando registros…</span>
                  <span className="font-mono">
                    {progress.done}/{progress.total}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-200"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}
          </Card>

          {/* Vista previa con validación */}
          {preview && previewStats && (
            <Card className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <CardHeader
                  title="Previsualización"
                  description={
                    <>
                      <span className="font-mono text-xs">{preview.name}</span> ·{' '}
                      <span className="text-risk-bajo">{previewStats.valid} válidas</span>
                      {previewStats.invalid > 0 && (
                        <>
                          {' '}
                          · <span className="text-risk-alto">{previewStats.invalid} con error</span>
                        </>
                      )}
                    </>
                  }
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPreview(null)}
                    disabled={importing}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    onClick={confirmImport}
                    loading={importing}
                    disabled={previewStats.valid === 0}
                  >
                    {!importing && <CheckCircle2 className="size-3.5" aria-hidden />}
                    Importar {previewStats.valid} fila(s) válidas
                  </Button>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto rounded-xl border border-line-subtle">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead className="bg-surface-2 text-[10px] uppercase tracking-wide text-content-muted">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Fila</th>
                      <th className="px-3 py-2 font-semibold">Tipo</th>
                      <th className="px-3 py-2 font-semibold">Hora</th>
                      <th className="px-3 py-2 font-semibold">Distrito</th>
                      <th className="px-3 py-2 font-semibold">Riesgo</th>
                      <th className="px-3 py-2 font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r) => (
                      <tr
                        key={r.line}
                        className={[
                          'border-t border-line-subtle',
                          r.error ? 'bg-risk-alto-soft/60' : 'hover:bg-surface-2/60',
                        ].join(' ')}
                      >
                        <td className="px-3 py-2 font-mono text-content-muted">{r.line}</td>
                        <td className="max-w-[180px] truncate px-3 py-2 text-content-primary">
                          {String(r.raw.crime_type ?? '—')}
                        </td>
                        <td className="px-3 py-2 font-mono text-content-secondary">
                          {String(r.raw.hour ?? '—')}
                        </td>
                        <td className="max-w-[160px] truncate px-3 py-2 text-content-secondary">
                          {String(r.raw.district ?? '—')}
                        </td>
                        <td className="px-3 py-2 capitalize text-content-secondary">
                          {String(r.raw.risk_level ?? '—')}
                        </td>
                        <td className="px-3 py-2">
                          {r.error ? (
                            <span className="text-risk-alto">{r.error}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-risk-bajo">
                              <CheckCircle2 className="size-3" aria-hidden />
                              Válida
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.rows.length > PREVIEW_LIMIT && (
                  <p className="border-t border-line-subtle bg-surface-2/60 px-3 py-2 text-[11px] text-content-muted">
                    … y {preview.rows.length - PREVIEW_LIMIT} fila(s) más (se importarán todas las
                    válidas).
                  </p>
                )}
              </div>
            </Card>
          )}

          {/* Zona de peligro */}
          <div className="rounded-2xl border border-risk-alto/30 bg-surface-1 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-risk-alto-soft text-risk-alto">
                  <Trash2 className="size-5" aria-hidden />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-content-primary">
                    Borrar todos los registros
                  </h2>
                  <p className="mt-1 max-w-xl text-[13px] text-content-secondary">
                    Elimina <strong>todos</strong> los documentos de{' '}
                    <code className="font-mono text-[11px]">crime_incidents</code> en Firestore.
                    Esta acción no se puede deshacer.
                  </p>
                </div>
              </div>
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="size-4" aria-hidden />
                Borrar todos
              </Button>
            </div>
          </div>

          {/* JSON manual */}
          <Card className="p-6">
            <CardHeader
              title="Importar filas JSON manualmente"
              description="Pega un array JSON con los campos requeridos y guárdalo en Firestore."
            />
            <form onSubmit={onImportRows} className="mt-4 space-y-3">
              <Label htmlFor="json-rows">Array JSON de filas</Label>
              <Textarea
                id="json-rows"
                rows={8}
                value={rowsJson}
                onChange={(e) => setRowsJson(e.target.value)}
                placeholder={`[\n  {\n    "crime_type": "robo agravado",\n    "hour": 22,\n    "day_of_week": "viernes",\n    "district": "MIRAFLORES",\n    "latitude": -12.1219,\n    "longitude": -77.0297,\n    "historical_frequency": 140,\n    "risk_level": "alto"\n  }\n]`}
              />
              <Button type="submit" loading={jsonLoading} disabled={!rowsJson.trim()}>
                {jsonLoading ? 'Guardando…' : 'Guardar en Firestore'}
              </Button>
            </form>
          </Card>
        </>
      )}

      {/* No hay tabla ni vista de datos para no-admin más allá del aviso */}
      {!isAdmin && (
        <Card className="flex items-center gap-3 p-5 text-sm text-content-secondary">
          <Table2 className="size-4 shrink-0 text-content-muted" aria-hidden />
          Pide el permiso admin para importar, previsualizar archivos y borrar registros.
        </Card>
      )}

      {/* Modal de confirmación de borrado */}
      <Modal
        open={deleteOpen}
        onClose={() => (deleteLoading ? undefined : setDeleteOpen(false))}
        dismissible={!deleteLoading}
        title="¿Eliminar todos los registros?"
        description="Esta acción no se puede deshacer."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteLoading}
            >
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleDelete} loading={deleteLoading}>
              {deleteLoading ? 'Borrando…' : 'Eliminar todo'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-content-secondary">
          Se eliminarán todos los documentos de la colección{' '}
          <code className="rounded bg-surface-2 px-1 font-mono text-xs">crime_incidents</code> en
          Firestore. Si tu cuenta no tiene el claim admin, la operación fallará.
        </p>
      </Modal>
    </div>
  )
}
