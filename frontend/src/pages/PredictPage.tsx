import { PredictPanel } from '../components/predict/PredictPanel'

export function PredictPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-content-primary">
          Predicción de riesgo
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-content-secondary">
          Estima el nivel de riesgo de un escenario (<strong>bajo / medio / alto</strong>) y las
          modalidades más probables de un distrito, todo con los datos publicados.
        </p>
      </header>

      <PredictPanel />
    </div>
  )
}
