/**
 * Pruebas de firestore.rules (Fase 1) sobre el emulador local.
 *
 * Uso (desde la raíz del repo, con Java instalado):
 *   firebase emulators:exec --only firestore --project demo-riskmap "node tests/firestore/firestore.rules.test.mjs"
 *
 * No toca ningún proyecto real: se ejecuta contra el emulador con projectId `demo-riskmap`.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore'

const here = dirname(fileURLToPath(import.meta.url))
const rules = readFileSync(join(here, '..', '..', 'firestore.rules'), 'utf8')

const validIncident = {
  crime_type: 'robo agravado',
  hour: 22,
  day_of_week: 'viernes',
  district: 'LA VICTORIA',
  latitude: -12.071,
  longitude: -77.0201,
  historical_frequency: 270,
  risk_level: 'alto',
}

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-riskmap',
  firestore: { rules, host: '127.0.0.1', port: 8080 },
})

const anon = testEnv.unauthenticatedContext()
const user = testEnv.authenticatedContext('user-1') // sin claim admin
const admin = testEnv.authenticatedContext('admin-1', { admin: true })

const results = []
let passed = 0

async function check(name, fn) {
  try {
    await fn()
    passed++
    results.push(`ok   ${name}`)
  } catch (error) {
    results.push(`FAIL ${name}\n     ${error.message ?? error}`)
    process.exitCode = 1
  }
}

await check('anónimo no puede leer crime_incidents', () =>
  assertFails(getDoc(doc(anon.firestore(), 'crime_incidents/x'))))

await check('usuario autenticado puede leer crime_incidents', () =>
  assertSucceeds(getDoc(doc(user.firestore(), 'crime_incidents/x'))))

await check('usuario sin claim no puede crear', () =>
  assertFails(setDoc(doc(user.firestore(), 'crime_incidents/a1'), validIncident)))

await check('usuario sin claim no puede borrar', () =>
  assertFails(deleteDoc(doc(user.firestore(), 'crime_incidents/x'))))

await check('admin puede crear un incidente válido', () =>
  assertSucceeds(setDoc(doc(admin.firestore(), 'crime_incidents/a1'), validIncident)))

await check('admin puede actualizar un incidente válido', () =>
  assertSucceeds(setDoc(doc(admin.firestore(), 'crime_incidents/a1'), { ...validIncident, risk_level: 'medio' })))

await check('admin puede borrar', () =>
  assertSucceeds(deleteDoc(doc(admin.firestore(), 'crime_incidents/a1'))))

await check('admin no puede crear con un campo extra', () =>
  assertFails(setDoc(doc(admin.firestore(), 'crime_incidents/a2'), { ...validIncident, extra: 1 })))

await check('admin no puede crear con risk_level inválido', () =>
  assertFails(setDoc(doc(admin.firestore(), 'crime_incidents/a3'), { ...validIncident, risk_level: 'extremo' })))

await check('admin no puede crear con hour fuera de rango', () =>
  assertFails(setDoc(doc(admin.firestore(), 'crime_incidents/a4'), { ...validIncident, hour: 25 })))

await check('admin no puede crear con coordenadas fuera de Lima', () =>
  assertFails(setDoc(doc(admin.firestore(), 'crime_incidents/a5'), { ...validIncident, latitude: 40.4 })))

await check('nadie escribe ml_model_parts (ni con claim admin)', () =>
  assertFails(setDoc(doc(admin.firestore(), 'ml_model_parts/0'), { data: 'x' })))

await check('nadie lee colecciones no listadas', () =>
  assertFails(getDoc(doc(user.firestore(), 'otros_datos/x'))))

console.log(results.join('\n'))
console.log(`\n${passed}/${results.length} pruebas de reglas OK`)

await testEnv.cleanup()
