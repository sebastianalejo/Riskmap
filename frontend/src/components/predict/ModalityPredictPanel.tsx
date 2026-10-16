import { AlertCircle, Loader2, MapPin, Sparkles } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { predictModality, type PredictionsResponse } from '../../api/prediction'
import { DISTRICTS } from '../../data/sampleIncidents'

const DISTRICT_NAMES = [...DISTRICTS].sort((a, b) => a.name.localeCompare(b.name))

function friendlyPredictError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('Cloud Functions no configuradas')) {
    return 'Las Cloud Functions no están configuradas en este build. Usa la pestaña «Estimación local» o define VITE_FIREBASE_FUNCTIONS_ORIGIN.'
  }
  if (message.includes('no entrenado')) {
    return 'Todavía no hay un modelo publicado. Un administrador puede entrenarlo o publicar el artefacto del pipeline (ver docs/DEPLOY.md).'
  }
  if (message.includes('Se requiere Firebase ID token')) {
    return 'Tu sesión expiró: vuelve a iniciar sesión para consultar el modelo.'
  }
  return message
}

export function ModalityPredictPanel() {
  const [district, setDistrict] = useState(DISTRICT_NAMES[0].name)
  const [latitude, setLatitude] = useState(DISTRICT_NAMES[0].lat)
  const [longitude, setLongitude] = useState(DISTRICT_NAMES[0].lng)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PredictionsResponse | null>(null)

  const payload = useMemo(
    () => ({ district: district.toUpperCase(), latitude, longitude }),
    [district, latitude, longitude],
  )

  function handleDistrictChange(name: string) {
    setDistrict(name)
    const found = DISTRICTS.find((item) => item.name === name)
    if (found) {
      setLatitude(found.lat)
      setLongitude(found.lng)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      setResult(await predictModality(payload))
    } catch (err) {
      setError(friendlyPredictError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-5">
      {/* Formulario */}
      <form
        onSubmit={submit}
        className="space-y-5 rounded-2xl border border-line-subtle bg-surface-1 p-6 shadow-card lg:col-span-3"
      >
        <label className="block">
          <span className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-content-muted">
            <MapPin className="size-3.5 text-accent" aria-hidden />
            Distrito
          </span>
          <select
            className="w-full rounded-xl border border-line-subtle bg-surface-2 px-3 py-2.5 text-sm text-content-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
            value={district}
            onChange={(event) => handleDistrictChange(event.target.value)}
          >
            {DISTRICT_NAMES.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
          <p className="mt-1 font-mono text-xs text-content-muted">
            {latitude.toFixed(5)}, {longitude.toFixed(5)}
          </p>
        </label>

        <div className="rounded-xl border border-line-subtle bg-surface-2/60 px-4 py-3 text-xs leading-relaxed text-content-secondary">
          Clasificador experimental de modalidad delictiva (datos INEI 2021–2024). Estima qué tipo de
          delito es más frecuente en la zona, <strong className="text-content-primary">no el nivel de riesgo</strong>.
          En validación aleatoria acierta ~21% (15 clases) y no generaliza a distritos no vistos;
          interpreta el resultado con cautela (ver MODEL_CARD).
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
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {loading ? 'Consultando modelo…' : 'Predecir modalidades'}
        </button>
      </form>

      {/* Resultado */}
      <aside className="space-y-4 lg:col-span-2">
        <div className="rounded-2xl border border-line-subtle bg-surface-1 p-5 shadow-card">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-content-muted">Resultado</p>

          {!result && !loading && (
            <p className="text-sm text-content-muted">
              Elige un distrito y consulta las modalidades más probables para su zona.
            </p>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-content-secondary">
              <Loader2 className="size-4 animate-spin text-accent" aria-hidden />
              Ejecutando el modelo…
            </div>
          )}

          {result && (
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                Modalidades más probables
                {result.model_run && (
                  <span className="ml-2 font-mono text-[11px] font-normal normal-case text-content-muted">
                    run {result.model_run.slice(0, 8)}
                  </span>
                )}
              </p>
              <div className="space-y-2.5">
                {result.predictions.map((item) => (
                  <div key={item.label} className="flex items-center gap-3">
                    <span className="w-44 truncate text-sm capitalize text-content-secondary" title={item.label}>
                      {item.label}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-1.5 rounded-full bg-accent-strong transition-all duration-500"
                        style={{ width: `${Math.max(2, item.probability * 100)}%` }}
                      />
                    </div>
                    <span className="w-14 text-right font-mono text-xs text-content-primary">
                      {(item.probability * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
              {result.disclaimer && (
                <p className="text-[11px] leading-snug text-content-muted">{result.disclaimer}</p>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
