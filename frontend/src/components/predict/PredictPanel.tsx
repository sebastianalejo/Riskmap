import { AlertCircle, ChevronRight, Cpu, Loader2, MapPin, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { loadPredictStats, type PredictStats } from '../../data/published'
import { predictLocal, type PredictResult, type RiskLevel } from '../../ml/localPredict'

const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const

const RISK_CONFIG: Record<RiskLevel, { label: string; bg: string; ring: string; bar: string; text: string }> = {
  bajo:  { label: 'BAJO',  bg: 'bg-risk-bajo-soft',  ring: 'ring-risk-bajo/35',  bar: 'bg-risk-bajo',  text: 'text-risk-bajo' },
  medio: { label: 'MEDIO', bg: 'bg-risk-medio-soft', ring: 'ring-risk-medio/35', bar: 'bg-risk-medio', text: 'text-risk-medio' },
  alto:  { label: 'ALTO',  bg: 'bg-risk-alto-soft',  ring: 'ring-risk-alto/35',  bar: 'bg-risk-alto',  text: 'text-risk-alto' },
}

const inputClass =
  'w-full rounded-xl border border-line-subtle bg-surface-2 px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-60'

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

export function PredictPanel() {
  const [stats, setStats] = useState<PredictStats | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)

  const [crimeType, setCrimeType] = useState('')
  const [hour, setHour] = useState(22)
  const [day, setDay] = useState<(typeof DAYS)[number]>('viernes')
  const [district, setDistrict] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PredictResult | null>(null)

  useEffect(() => {
    let cancelled = false
    loadPredictStats()
      .then((loaded) => {
        if (cancelled) return
        setStats(loaded)
        setDistrict(loaded.districts[0] ?? '')
        setCrimeType(loaded.types[0] ?? '')
      })
      .catch((e) => {
        if (cancelled) return
        setStatsError(e instanceof Error ? e.message : 'No se pudieron cargar los datos publicados')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const districtOptions = useMemo(
    () => (stats ? [...stats.districts].sort((a, b) => a.localeCompare(b, 'es')) : []),
    [stats],
  )
  const typeOptions = useMemo(
    () => (stats ? [...stats.types].sort((a, b) => a.localeCompare(b, 'es')) : []),
    [stats],
  )

  const ready = stats !== null && district !== '' && crimeType !== ''

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      setResult(
        await predictLocal({
          crime_type: crimeType,
          hour: Number(hour),
          day_of_week: day,
          district,
        }),
      )
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
          Predicción <strong>local</strong>: se calcula en el navegador con los datos publicados. El
          nivel de riesgo usa un cálculo aproximado; las modalidades reflejan la{' '}
          <strong>composición histórica</strong> del distrito, no las probabilidades del modelo
          principal.
        </p>
      </div>

      {statsError && (
        <div className="flex items-start gap-3 rounded-2xl border border-risk-alto/30 bg-risk-alto-soft px-4 py-3 text-sm text-risk-alto" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{statsError}</span>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-5">
        {/* ── Formulario ─────────────────────────────────────────── */}
        <form
          onSubmit={submit}
          className="space-y-5 rounded-2xl border border-line-subtle bg-surface-1 p-6 shadow-card lg:col-span-3"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-content-muted">
                <MapPin className="size-3.5 text-accent" aria-hidden />
                Distrito
              </span>
              <select
                className={inputClass}
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                disabled={!ready}
              >
                {districtOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-muted">
                Tipo de delito
              </span>
              <select
                className={inputClass}
                value={crimeType}
                onChange={(e) => setCrimeType(e.target.value)}
                disabled={!ready}
              >
                {typeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-muted">
                Hora (0–23)
              </span>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={23}
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
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-muted">
                Día
              </span>
              <select
                className={inputClass}
                value={day}
                onChange={(e) => setDay(e.target.value as typeof day)}
                disabled={!ready}
              >
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </option>
                ))}
              </select>
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
            disabled={loading || !ready}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent-strong py-3 text-sm font-semibold text-accent-foreground shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-10"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {loading ? 'Calculando…' : 'Predecir'}
          </button>
        </form>

        {/* ── Resultado ──────────────────────────────────────────── */}
        <aside className="space-y-4 lg:col-span-2">
          <div className="rounded-2xl border border-line-subtle bg-surface-1 p-5 shadow-card">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-content-muted">Resultado</p>

            {!result && !loading && (
              <p className="text-sm text-content-muted">
                Elige distrito, tipo y hora, y pulsa «Predecir».
              </p>
            )}

            {loading && (
              <div className="flex items-center gap-2 text-sm text-content-secondary">
                <Loader2 className="size-4 animate-spin text-accent" aria-hidden />
                Calculando la predicción…
              </div>
            )}

            {result && cfg && (
              <div className="space-y-5">
                <div className={`flex items-center justify-between rounded-xl px-4 py-3 ring-1 ${cfg.bg} ${cfg.ring}`}>
                  <span className={`text-xl font-bold ${cfg.text}`}>Riesgo {cfg.label}</span>
                  <ConfidenceGauge value={result.confidence} level={result.prediction} />
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium text-content-muted">
                    Distribución en {result.samples} registro(s)
                  </p>
                  <div className="space-y-1.5">
                    {(['alto', 'medio', 'bajo'] as RiskLevel[]).map((l) => (
                      <RiskBar key={l} level={l} pct={result.percentages[l]} />
                    ))}
                  </div>
                </div>

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

                <p className="text-[11px] text-content-muted">
                  {result.method === 'dataset'
                    ? `Nivel de riesgo basado en ${result.samples} registro(s) publicados (tipo de delito + distrito).`
                    : 'Estimación aproximada (no hay datos suficientes).'}
                </p>
              </div>
            )}
          </div>

          {/* Modalidades más probables */}
          {result && result.modalities.length > 0 && (
            <div className="rounded-2xl border border-line-subtle bg-surface-1 p-5 shadow-card">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-content-muted">
                <Cpu className="size-3.5 text-accent" aria-hidden />
                Modalidades más probables
              </p>
              <p className="mb-3 text-[11px] text-content-muted">
                Composición histórica de {district} (datos oficiales 2021–2025).
              </p>
              <div className="space-y-2.5">
                {result.modalities.map((item) => (
                  <div key={item.label} className="flex items-center gap-3">
                    <span className="w-36 truncate text-xs capitalize text-content-secondary" title={item.label}>
                      {item.label}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-1.5 rounded-full bg-accent-strong transition-all duration-500"
                        style={{ width: `${Math.max(2, item.probability * 100)}%` }}
                      />
                    </div>
                    <span className="w-12 text-right font-mono text-xs text-content-primary">
                      {(item.probability * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
