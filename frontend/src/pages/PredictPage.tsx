import { Cpu, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { LocalPredictPanel } from '../components/predict/LocalPredictPanel'
import { ModalityPredictPanel } from '../components/predict/ModalityPredictPanel'

type PredictTab = 'local' | 'modalidad'

const TABS: Array<{ id: PredictTab; label: string; icon: typeof Sparkles }> = [
  { id: 'local', label: 'Estimación local', icon: Sparkles },
  { id: 'modalidad', label: 'Modelo de modalidad', icon: Cpu },
]

export function PredictPage() {
  const [tab, setTab] = useState<PredictTab>('local')

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-content-primary">
            Predicción de riesgo
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-content-secondary">
            Estima el nivel de riesgo de un escenario (<strong>bajo / medio / alto</strong>) o consulta
            el modelo de modalidad desplegado para ver los delitos más probables de una zona.
          </p>
        </div>

        {/* Selector de modo */}
        <div
          role="tablist"
          aria-label="Modo de predicción"
          className="flex flex-wrap gap-1 rounded-xl bg-surface-2 p-1"
        >
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`predict-tab-${id}`}
                aria-selected={active}
                aria-controls={`predict-panel-${id}`}
                onClick={() => setTab(id)}
                className={[
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  active
                    ? 'bg-surface-1 text-accent shadow-sm ring-1 ring-line-subtle'
                    : 'text-content-secondary hover:text-content-primary',
                ].join(' ')}
              >
                <Icon className="size-3.5" aria-hidden />
                {label}
              </button>
            )
          })}
        </div>
      </header>

      {tab === 'local' ? (
        <div role="tabpanel" id="predict-panel-local" aria-labelledby="predict-tab-local">
          <LocalPredictPanel />
        </div>
      ) : (
        <div role="tabpanel" id="predict-panel-modalidad" aria-labelledby="predict-tab-modalidad">
          <ModalityPredictPanel />
        </div>
      )}
    </div>
  )
}
