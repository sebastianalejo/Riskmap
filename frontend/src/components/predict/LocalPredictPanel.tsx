import { AlertCircle, ChevronRight, Loader2, MapPin, Sparkles } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { CRIME_TYPES, DISTRICTS } from '../../data/sampleIncidents'
import { predictLocal, type PredictInput, type PredictResult, type RiskLevel } from '../../ml/localPredict'

const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const

const DISTRICT_OPTIONS = [...DISTRICTS].sort((a, b) => a.name.localeCompare(b.name))

const DEFAULT_DISTRICT = DISTRICTS.find((d) => d.name === 'LA VICTORIA') ?? DISTRICTS[0]

const RISK_CONFIG: Record<RiskLevel, { label: string; bg: string; ring: string; bar: string; text: string }> = {
  bajo:  { label: 'BAJO',  bg: 'bg-risk-bajo-soft',  ring: 'ring-risk-bajo/35',  bar: 'bg-risk-bajo',  text: 'text-risk-bajo' },
  medio: { label: 'MEDIO', bg: 'bg-risk-medio-soft', ring: 'ring-risk-medio/35', bar: 'bg-risk-medio', text: 'text-risk-medio' },
  alto:  { label: 'ALTO',  bg: 'bg-risk-alto-soft',  ring: 'ring-risk-alto/35',  bar: 'bg-risk-alto',  text: 'text-risk-alto' },
}

const inputClass =
  'w-full rounded-xl border border-line-subtle bg-surface-2 px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25'

function RiskBar({ level, pct }: { level: RiskLevel; pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-right text-xs capitalize text-content-muted">{level}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-2 rounded-full transition-all duration-700 ${RISK_CONFIG[level].bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 text-right font-mono text-xs text-content-secondary">{pct}%</span>
    </div>
  )
}

function ConfidenceGauge({ value, level }: { value: number; level: RiskLevel }) {
  const cfg = RISK_CONFIG[level]
  return (
    <div className="text-center">
      <div className={`inline-flex size-24 flex-col items-center justify-center rounded-full ring-4 ${cfg.ring} ${cfg.bg}`}>
        <span className={`font-mono text-2xl font-bold ${cfg.text}`}>{value}%</span>
        <span className="text-[10px] uppercase tracking-wide text-content-muted">confianza</span>
      </div>
    </div>
  )
}

export function LocalPredictPanel() {
  const [crimeType, setCrimeType] = useState(CRIME_TYPES[0].type)
  const [hour, setHour] = useState(22)
  const [day, setDay] = useState<(typeof DAYS)[number]>('viernes')
  const [district, setDistrict] = useState(DEFAULT_DISTRICT.name)
  const [latitude, setLatitude]   = useState(DEFAULT_DISTRICT.lat)
  const [longitude, setLongitude] = useState(DEFAULT_DISTRICT.lng)
  const [frequency, setFrequency] = useState(DEFAULT_DISTRICT.base_freq)

  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [result, setResult]   = useState<PredictResult | null>(null)

  function handleDistrictChange(name: string) {
    setDistrict(name)
    const d = DISTRICTS.find((x) => x.name === name)
    if (d) { setLatitude(d.lat); setLongitude(d.lng); setFrequency(d.base_freq) }
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
    setLoading(true); setError(null); setResult(null)
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
      <div className="flex gap-2 rounded-2xl border border-info/35 bg-info-soft px-4 py-3 text-sm text-info">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          Estimación <strong>local</strong> (sin Cloud Functions): cuenta etiquetas de Firestore y aplica una
          heurística ponderada. No es el modelo de ML; úsala solo como respaldo o referencia.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-5">

        {/* ── Formulario ─────────────────────────────────────────── */}
        <form
          onSubmit={submit}
          className="space-y-5 rounded-2xl border border-line-subtle bg-surface-1 p-6 shadow-card lg:col-span-3"
        >
          <div className="grid gap-4 sm:grid-cols-2">

            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-muted">Tipo de delito</span>
              <select className={inputClass} value={crimeType} onChange={(e) => setCrimeType(e.target.value)}>
                {CRIME_TYPES.map((c) => (
                  <option key={c.type} value={c.type}>
                    {c.type.charAt(0).toUpperCase() + c.type.slice(1)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-muted">Hora (0–23)</span>
              <div className="flex items-center gap-3">
                <input
                  type="range" min={0} max={23}
                  className="flex-1 accent-accent"
                  value={hour}
                  onChange={(e) => setHour(Number(e.target.value))}
                />
                <span className="w-14 rounded-lg border border-line-subtle bg-surface-2 py-1 text-center font-mono text-sm text-content-primary">
                  {String(hour).padStart(2, '0')}:00
                </span>
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-muted">Día</span>
              <select className={inputClass} value={day} onChange={(e) => setDay(e.target.value as typeof day)}>
                {DAYS.map((d) => (
                  <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                ))}
              </select>
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-content-muted">
                <MapPin className="size-3.5 text-accent" aria-hidden />
                Distrito
              </span>
              <select className={inputClass} value={district} onChange={(e) => handleDistrictChange(e.target.value)}>
                {DISTRICT_OPTIONS.map((d) => (
                  <option key={d.name} value={d.name}>{d.name}</option>
                ))}
              </select>
              <p className="mt-1 font-mono text-xs text-content-muted">
                {latitude.toFixed(5)}, {longitude.toFixed(5)}
              </p>
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-content-muted">
                <span>Frecuencia histórica</span>
                <span className="font-mono text-accent">{frequency}</span>
              </span>
              <input
                type="range" min={1} max={500}
                className="w-full accent-accent"
                value={frequency}
                onChange={(e) => setFrequency(Number(e.target.value))}
              />
              <div className="mt-0.5 flex justify-between text-[10px] text-content-muted">
                <span>1 (baja)</span><span>500 (muy alta)</span>
              </div>
            </label>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-risk-alto/35 bg-risk-alto-soft px-3 py-2 text-sm text-risk-alto" role="alert">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent-strong py-3 text-sm font-semibold text-accent-foreground shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-10"
          >
            {loading
              ? <Loader2 className="size-4 animate-spin" />
              : <Sparkles className="size-4" />}
            {loading ? 'Calculando…' : 'Estimar riesgo (local)'}
          </button>
        </form>

        {/* ── Resultado ──────────────────────────────────────────── */}
        <aside className="space-y-4 lg:col-span-2">

          <div className="rounded-2xl border border-line-subtle bg-surface-1 p-5 shadow-card">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-content-muted">Resultado</p>

            {!result && !loading && (
              <p className="text-sm text-content-muted">
                Completa el formulario y pulsa «Estimar riesgo (local)».
              </p>
            )}

            {loading && (
              <div className="flex items-center gap-2 text-sm text-content-secondary">
                <Loader2 className="size-4 animate-spin text-accent" aria-hidden />
                Consultando registros en Firestore…
              </div>
            )}

            {result && cfg && (
              <div className="space-y-5">
                {/* Nivel estimado */}
                <div className={`flex items-center justify-between rounded-xl px-4 py-3 ring-1 ${cfg.bg} ${cfg.ring}`}>
                  <span className={`text-xl font-bold ${cfg.text}`}>
                    Riesgo {cfg.label}
                  </span>
                  <ConfidenceGauge value={result.confidence} level={result.prediction} />
                </div>

                {/* Barras distribución */}
                <div>
                  <p className="mb-2 text-xs font-medium text-content-muted">Distribución en {result.samples} registro(s)</p>
                  <div className="space-y-1.5">
                    {(['alto', 'medio', 'bajo'] as RiskLevel[]).map((l) => (
                      <RiskBar key={l} level={l} pct={result.percentages[l]} />
                    ))}
                  </div>
                </div>

                {/* Factores */}
                <div>
                  <p className="mb-2 text-xs font-medium text-content-muted">Factores detectados</p>
                  <ul className="space-y-1">
                    {result.factors.map((f, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-content-secondary">
                        <ChevronRight className="mt-0.5 size-3 shrink-0 text-accent" aria-hidden />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Método */}
                <p className="text-[11px] text-content-muted">
                  {result.method === 'firestore'
                    ? `Basado en ${result.samples} registros de Firestore (tipo + distrito)`
                    : 'Heurística (sin datos suficientes; un administrador puede importar registros para mayor precisión)'}
                </p>
              </div>
            )}
          </div>

          {/* JSON del escenario */}
          <details className="rounded-2xl border border-dashed border-line-subtle bg-surface-2/50 p-4 text-xs text-content-secondary">
            <summary className="cursor-pointer font-semibold text-content-secondary select-none">
              Ver escenario JSON
            </summary>
            <pre className="mt-2 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-content-secondary ring-1 ring-line-subtle">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </details>
        </aside>
      </div>
    </div>
  )
}
