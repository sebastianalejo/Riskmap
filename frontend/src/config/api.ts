import { getFunctionsOrigin } from '../firebase/client'

/** URLs de Cloud Functions — no desplegadas en plan Spark. Archivo conservado por si se activa Blaze. */

const FN_MAP: Record<string, string> = {
  '/prediction/health/': 'prediction_health',
  '/prediction/predict/': 'predict_crime',
  '/prediction/train/': 'train_model',
}

export const paths = {
  importIncidents: '/firebase/import-rows/',
  importCsv: '/firebase/import-csv/',
  // Solo para el backend en Blaze: el panel gestiona cuentas y roles vía Firestore.
  createUser: '/admin/create-user/',
  listUsers: '/admin/list-users/',
} as const

const EXTRA_FN: Record<string, string> = {
  [paths.importIncidents]: 'import_incidents',
  [paths.importCsv]: 'import_csv_dataset',
  [paths.createUser]: 'create_user',
  [paths.listUsers]: 'list_users',
}

export function resolveApiUrl(path: string): string {
  const raw = path.startsWith('/') ? path : `/${path}`
  const [pathOnly, queryPart] = raw.split('?')
  const q = queryPart !== undefined ? `?${queryPart}` : ''
  const origin = getFunctionsOrigin()
  if (!origin) throw new Error('Cloud Functions no configuradas.')
  const fnName = FN_MAP[pathOnly] ?? EXTRA_FN[pathOnly]
  if (!fnName) throw new Error(`Ruta no disponible en Functions: ${pathOnly}`)
  return `${origin}/${fnName}${q}`
}
