// Valida la configuración web de Firebase antes de compilar/desplegar.
// En CI el archivo se escribe desde el secreto FIREBASE_WEB_CONFIG; si el secreto
// contiene otra cosa (p. ej. un comando), el build falla aquí en vez de publicar
// una app que muestra "La aplicación aún no está configurada".
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const file = resolve(process.argv[2] ?? 'public/firebase-config.json')
const required = ['apiKey', 'authDomain', 'projectId', 'appId']

let config
try {
  config = JSON.parse(readFileSync(file, 'utf8'))
} catch (error) {
  console.error(`ERROR: ${file} no es JSON válido (${error.message}).`)
  console.error(
    'Revisa el secreto FIREBASE_WEB_CONFIG: debe contener el objeto firebaseConfig, no un comando.',
  )
  process.exit(1)
}

const missing = required.filter(
  (key) => typeof config[key] !== 'string' || config[key].trim() === '',
)
if (missing.length > 0) {
  console.error(`ERROR: faltan campos obligatorios en ${file}: ${missing.join(', ')}.`)
  process.exit(1)
}

console.log(`Config web de Firebase válida (projectId: ${config.projectId}).`)
