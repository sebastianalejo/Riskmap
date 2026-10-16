import { AlertCircle, ChevronRight, MapPin, Sparkles } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardHeader } from '../components/ui/card'
import { Label, Select } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { useAuth } from '../context/AuthContext'
import { CRIME_TYPES, DISTRICTS } from '../data/sampleIncidents'
import { predictLocal, type PredictInput, type PredictResult, type RiskLevel } from '../ml/localPredict'

const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const

const DISTRICT_OPTIONS = [...DISTRICTS].sort((a, b) => a.name.localeCompare(b.name)).map((d) => d.name)

const RISK_CONFIG: Record<RiskLevel, { label: string; box: string; text: string; bar: string }> = {
  bajo: {
    label: 'BAJO',
    box: 'bg-risk-bajo-soft ring-risk-bajo/40',
    text: 'text-risk-bajo',
    bar: 'bg-risk-bajo',
  },
  medio: {
    label: 'MEDIO',
    box: 'bg-risk-medio-soft ring-risk-medio/40',
    text: 'text-risk-medio',
    bar: 'bg-risk-medio',
  },
  alto: {
    label: 'ALTO',
    box: 'bg-risk-alto-soft ring-risk-alto/40',
    text: 'text-risk-alto',
    bar: 'bg-risk-alto',
  },
}

function RiskBar({ level, pct }: { level: RiskLevel; pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-right text-xs capitalize text-content-secondary">{level}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-2 rounded-full transition-all duration-700 ${RISK_CONFIG[level].bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-9 text-right font-mono text-xs text-content-secondary">{pct}%</span>
    </div>
  )
}

function ConfidenceGauge({ value, level }: { value: number; level: RiskLevel }) {
  const cfg = RISK_CONFIG[level]
  return (
    <div className={`inline-flex size-24 shrink-0 flex-col items-center justify-center rounded-full ring-4 ${cfg.box}`}>
      <span className={`font-mono text-2xl font-bold ${cfg.text}`}>{value}%</span>
      <span className="text-[10px] uppercase tracking-wide text-content-secondary">confianza</span>
    </div>
  )
}

export function PredictPage() {
  const { authToken } = useAuth()

  const [crimeType, setCrimeType] = useState(CRIME_TYPES[0].type)
  const [hour, setHour] = useState(22)
  const [day, setDay] = useState<(typeof DAYS)[number]>('viernes')
  const [district, setDistrict] = useState(DISTRICTS[7].name) // LA VICTORIA
  const [latitude, setLatitude] = useState(DISTRICTS[7].lat)
  const [longitude, setLongitude] = useState(DISTRICTS[7].lng)
  const [frequency, setFrequency] = useState(270)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PredictResult | null>(null)

  function handleDistrictChange(name: string) {
    setDistrict(name)
    const d = DISTRICTS.find((x) => x.name === name)
    if (d) {
      setLatitude(d.lat)
      setLongitude(d.lng)
      setFrequency(d.base_freq)
    }
  }

  const payload = useMemo<PredictInput>(
    () => ({
      crime_type: crimeType,
      hour: Number(hour),
      day_of_week: day,
      district: district.toUpperCase(),
      latitude: Number(latitude),
      longitude: Number(longitude),
      historical_frequency: Number(frequency),
    }),
    [crimeType, hour, day, district, latitude, longitude, frequency],
  )

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!authToken) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      setResult(await predictLocal(payload))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al calcular la predicción')
    } finally {
      setLoading(false)
    }
  }

  const cfg = result ? RISK_CONFIG[result.prediction] : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-content-primary">
          Predicción de riesgo
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-content-secondary">
          Elige un escenario y obtén el nivel de riesgo estimado (<strong>bajo / medio / alto</strong>)
          junto con la distribución de los registros similares en Firestore.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ── Formulario ─────────────────────────────────────────── */}
        <Card className="p-6 lg:col-span-3">
          <CardHeader
            title="Escenario"
            description="Parámetros del incidente a evaluar."
          />
          <form onSubmit={submit} className="mt-5 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="predict-crime">Tipo de delito</Label>
                <Select
                  id="predict-crime"
                  value={crimeType}
                  onChange={(e) => setCrimeType(e.target.value)}
                >
                  {CRIME_TYPES.map((c) => (
                    <option key={c.type} value={c.type}>
                      {c.type.charAt(0).toUpperCase() + c.type.slice(1)}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="predict-hour">Hora (0–23)</Label>
                <div className="flex items-center gap-3">
                  <input
                    id="predict-hour"
                    type="range"
                    min={0}
                    max={23}
                    className="flex-1 accent-[var(--accent)]"
                    value={hour}
                    onChange={(e) => setHour(Number(e.target.value))}
                  />
                  <span className="w-14 rounded-lg border border-line-subtle bg-surface-2 py-1 text-center font-mono text-sm text-content-primary">
                    {String(hour).padStart(2, '0')}:00
                  </span>
                </div>
              </div>

              <div>
                <Label htmlFor="predict-day">Día</Label>
                <Select
                  id="predict-day"
                  value={day}
                  onChange={(e) => setDay(e.target.value as typeof day)}
                >
                  {DAYS.map((d) => (
                    <option key={d} value={d}>
                      {d.charAt(0).toUpperCase() + d.slice(1)}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="predict-district" className="flex items-center gap-1">
                  <MapPin className="size-3.5 text-accent" aria-hidden />
                  Distrito
                </Label>
                <Select
                  id="predict-district"
                  value={district}
                  onChange={(e) => handleDistrictChange(e.target.value)}
                >
                  {DISTRICT_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 font-mono text-xs text-content-muted">
                  {latitude.toFixed(5)}, {longitude.toFixed(5)}
                </p>
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="predict-frequency">
                  Frecuencia histórica — <span className="font-mono text-accent">{frequency}</span>
                </Label>
                <input
                  id="predict-frequency"
                  type="range"
                  min={1}
                  max={500}
                  className="w-full accent-[var(--accent)]"
                  value={frequency}
                  onChange={(e) => setFrequency(Number(e.target.value))}
                />
                <div className="mt-0.5 flex justify-between text-[10px] text-content-muted">
                  <span>1 (baja)</span>
                  <span>500 (muy alta)</span>
                </div>
              </div>
            </div>

            {error && (
              <div
                className="flex items-start gap-2 rounded-xl border border-risk-alto/30 bg-risk-alto-soft px-3 py-2 text-sm text-risk-alto"
                role="alert"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {error}
              </div>
            )}

            <Button type="submit" size="lg" loading={loading} disabled={!authToken} className="w-full sm:w-auto sm:px-10">
              {!loading && <Sparkles className="size-4" aria-hidden />}
              {loading ? 'Calculando…' : 'Predecir riesgo'}
            </Button>
          </form>
        </Card>

        {/* ── Resultado ──────────────────────────────────────────── */}
        <aside className="space-y-4 lg:col-span-2">
          <Card className="p-5">
            <CardHeader
              title="Resultado"
              description="Nivel estimado y distribución de registros similares."
            />

            <div className="mt-5">
              {!result && !loading && (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <div className="flex size-11 items-center justify-center rounded-xl bg-surface-2 text-content-muted">
                    <Sparkles className="size-5" aria-hidden />
                  </div>
                  <p className="max-w-[220px] text-sm text-content-secondary">
                    Completa el escenario y pulsa «Predecir riesgo».
                  </p>
                </div>
              )}

              {loading && (
                <div className="space-y-4" role="status" aria-label="Calculando predicción">
                  <Skeleton className="h-24" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3" />
                  <Skeleton className="h-3" />
                  <Skeleton className="h-3" />
                </div>
              )}

              {result && cfg && (
                <div className="space-y-5">
                  {/* Nivel predicho */}
                  <div className={`flex items-center justify-between gap-4 rounded-xl px-4 py-3 ring-1 ${cfg.box}`}>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-content-secondary">
                        Nivel estimado
                      </p>
                      <p className={`text-xl font-bold ${cfg.text}`}>Riesgo {cfg.label}</p>
                    </div>
                    <ConfidenceGauge value={result.confidence} level={result.prediction} />
                  </div>

                  {/* Barras distribución */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-medium text-content-secondary">Distribución</p>
                      <Badge tone="neutral">{result.samples} registros</Badge>
                    </div>
                    <div className="space-y-1.5">
                      {(['alto', 'medio', 'bajo'] as RiskLevel[]).map((l) => (
                        <RiskBar key={l} level={l} pct={result.percentages[l]} />
                      ))}
                    </div>
                  </div>

                  {/* Factores */}
                  <div>
                    <p className="mb-2 text-xs font-medium text-content-secondary">
                      Factores detectados
                    </p>
                    <ul className="space-y-1">
                      {result.factors.map((f, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-content-primary">
                          <ChevronRight className="mt-0.5 size-3 shrink-0 text-accent" aria-hidden />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Método */}
                  <p className="border-t border-line-subtle pt-3 text-[11px] text-content-muted">
                    {result.method === 'firestore'
                      ? `Basado en ${result.samples} registros de Firestore (tipo + distrito).`
                      : 'Heurística local: carga datos en «Importar datos» para mayor precisión.'}
                  </p>
                </div>
              )}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  )
}
