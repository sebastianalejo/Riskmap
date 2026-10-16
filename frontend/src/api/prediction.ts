import { apiFetch } from './client'

/** Contrato de `predict_crime` (Fase 4): modalidad más probable según el contexto espacial. */
export type ModalityPrediction = {
  label: string
  probability: number
}

export type PredictionsResponse = {
  predictions: ModalityPrediction[]
  target: string
  model_run: string | null
  sklearn_version?: string
  disclaimer?: string
}

export type ModalityPredictInput = {
  district: string
  latitude: number
  longitude: number
}

/** Llama a la Cloud Function de predicción con el ID token de Firebase. */
export async function predictModality(input: ModalityPredictInput): Promise<PredictionsResponse> {
  const body = await apiFetch('/prediction/predict/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return body as PredictionsResponse
}
