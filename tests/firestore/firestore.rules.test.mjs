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
import { doc, getDoc, getDocs, collection, setDoc, deleteDoc, updateDoc } from 'firebase/firestore'

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

// Perfiles de cuenta que actúan como fuente de verdad del rol (`users/{uid}`).
const profiles = {
  'user-1': { email: 'user@example.com', displayName: 'Usuario', role: 'user', disabled: false },
  'admin-1': { email: 'admin@example.com', displayName: 'Admin', role: 'admin', disabled: false },
  'disabled-1': { email: 'baja@example.com', displayName: 'Baja', role: 'user', disabled: true },
}

await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  for (const [uid, data] of Object.entries(profiles)) {
    await setDoc(doc(db, 'users', uid), data)
  }
})

const anon = testEnv.unauthenticatedContext()
const user = testEnv.authenticatedContext('user-1') // rol `user` por perfil
const admin = testEnv.authenticatedContext('admin-1') // rol `admin` por perfil
const disabled = testEnv.authenticatedContext('disabled-1') // cuenta deshabilitada
const claimAdmin = testEnv.authenticatedContext('legacy-1', { admin: true }) // solo claim (puente)
const nuevo = testEnv.authenticatedContext('nuevo-1', { email: 'nuevo@example.com' }) // sin perfil aún

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

// ── Incidentes ──────────────────────────────────────────────────────────────
await check('anónimo no puede leer crime_incidents', () =>
  assertFails(getDoc(doc(anon.firestore(), 'crime_incidents/x'))))

await check('usuario autenticado y activo puede leer crime_incidents', () =>
  assertSucceeds(getDoc(doc(user.firestore(), 'crime_incidents/x'))))

await check('usuario deshabilitado no puede leer crime_incidents', () =>
  assertFails(getDoc(doc(disabled.firestore(), 'crime_incidents/x'))))

await check('usuario sin rol admin no puede crear', () =>
  assertFails(setDoc(doc(user.firestore(), 'crime_incidents/a1'), validIncident)))

await check('usuario sin rol admin no puede borrar', () =>
  assertFails(deleteDoc(doc(user.firestore(), 'crime_incidents/x'))))

await check('admin puede crear un incidente válido', () =>
  assertSucceeds(setDoc(doc(admin.firestore(), 'crime_incidents/a1'), validIncident)))

await check('admin puede actualizar un incidente válido', () =>
  assertSucceeds(setDoc(doc(admin.firestore(), 'crime_incidents/a1'), { ...validIncident, risk_level: 'medio' })))

await check('admin puede borrar', () =>
  assertSucceeds(deleteDoc(doc(admin.firestore(), 'crime_incidents/a1'))))

await check('admin por claim (sin perfil) puede crear: puente de migración', () =>
  assertSucceeds(setDoc(doc(claimAdmin.firestore(), 'crime_incidents/a9'), validIncident)))

// Esquema unificado: el núcleo + los campos opcionales del INEI.
const validArcgisIncident = {
  ...validIncident,
  occurred_year: 2024,
  macro_category: 'delitos contra el patrimonio',
  ubigeo: '150122',
  severity_level: 'alta',
  source: 'inei',
}

await check('admin puede crear un incidente del esquema unificado (INEI)', () =>
  assertSucceeds(setDoc(doc(admin.firestore(), 'crime_incidents/arc1'), validArcgisIncident)))

await check('admin no puede crear con occurred_year fuera de rango', () =>
  assertFails(setDoc(doc(admin.firestore(), 'crime_incidents/arc2'), { ...validArcgisIncident, occurred_year: 1800 })))

await check('admin no puede crear con severity_level inválido', () =>
  assertFails(setDoc(doc(admin.firestore(), 'crime_incidents/arc3'), { ...validArcgisIncident, severity_level: 'extremo' })))

await check('admin no puede crear con un campo extra', () =>
  assertFails(setDoc(doc(admin.firestore(), 'crime_incidents/a2'), { ...validIncident, extra: 1 })))

await check('admin no puede crear con risk_level inválido', () =>
  assertFails(setDoc(doc(admin.firestore(), 'crime_incidents/a3'), { ...validIncident, risk_level: 'extremo' })))

await check('admin no puede crear con hour fuera de rango', () =>
  assertFails(setDoc(doc(admin.firestore(), 'crime_incidents/a4'), { ...validIncident, hour: 25 })))

await check('admin no puede crear con coordenadas fuera de Lima', () =>
  assertFails(setDoc(doc(admin.firestore(), 'crime_incidents/a5'), { ...validIncident, latitude: 40.4 })))

await check('nadie escribe ml_model_parts (ni con rol admin)', () =>
  assertFails(setDoc(doc(admin.firestore(), 'ml_model_parts/0'), { data: 'x' })))

await check('usuario autenticado puede leer crime_stats_monthly', () =>
  assertSucceeds(getDoc(doc(user.firestore(), 'crime_stats_monthly/2024-06-150122'))))

await check('usuario deshabilitado no lee crime_stats_monthly', () =>
  assertFails(getDoc(doc(disabled.firestore(), 'crime_stats_monthly/2024-06-150122'))))

await check('nadie escribe crime_stats_monthly (ni con rol admin)', () =>
  assertFails(setDoc(doc(admin.firestore(), 'crime_stats_monthly/2024-06-150122'), { total: 1 })))

await check('anónimo no puede leer crime_stats_monthly', () =>
  assertFails(getDoc(doc(anon.firestore(), 'crime_stats_monthly/2024-06-150122'))))

await check('nadie lee colecciones no listadas', () =>
  assertFails(getDoc(doc(user.firestore(), 'otros_datos/x'))))

// ── Perfiles de cuenta (roles) ──────────────────────────────────────────────
await check('anónimo no puede leer perfiles', () =>
  assertFails(getDoc(doc(anon.firestore(), 'users/user-1'))))

await check('un usuario lee su propio perfil', () =>
  assertSucceeds(getDoc(doc(user.firestore(), 'users/user-1'))))

await check('un usuario no lee el perfil de otro', () =>
  assertFails(getDoc(doc(user.firestore(), 'users/admin-1'))))

await check('un admin lee perfiles de otros', () =>
  assertSucceeds(getDoc(doc(admin.firestore(), 'users/user-1'))))

await check('un admin puede listar la colección users', () =>
  assertSucceeds(getDocs(collection(admin.firestore(), 'users'))))

await check('un usuario no puede listar la colección users', () =>
  assertFails(getDocs(collection(user.firestore(), 'users'))))

await check('un usuario no puede autoasignarse rol admin al crear su perfil', () =>
  assertFails(
    setDoc(doc(nuevo.firestore(), 'users/nuevo-1'), { email: 'nuevo@example.com', role: 'admin' }),
  ))

await check('un usuario puede crear su perfil como rol user', () =>
  assertSucceeds(
    setDoc(doc(nuevo.firestore(), 'users/nuevo-1'), { email: 'nuevo@example.com', role: 'user' }),
  ))

await check('un usuario no puede cambiar su propio rol', () =>
  assertFails(updateDoc(doc(user.firestore(), 'users/user-1'), { role: 'admin' })))

await check('un usuario no puede deshabilitarse por sí mismo', () =>
  assertFails(updateDoc(doc(user.firestore(), 'users/user-1'), { disabled: true })))

await check('un usuario puede actualizar su nombre', () =>
  assertSucceeds(updateDoc(doc(user.firestore(), 'users/user-1'), { displayName: 'Nombre nuevo' })))

await check('un admin puede cambiar el rol de otra cuenta', () =>
  assertSucceeds(updateDoc(doc(admin.firestore(), 'users/disabled-1'), { role: 'admin' })))

await check('un admin no puede quitarse a sí mismo el rol admin', () =>
  assertFails(updateDoc(doc(admin.firestore(), 'users/admin-1'), { role: 'user' })))

await check('un admin no puede borrar su propia cuenta', () =>
  assertFails(deleteDoc(doc(admin.firestore(), 'users/admin-1'))))

await check('un usuario no puede borrar cuentas', () =>
  assertFails(deleteDoc(doc(user.firestore(), 'users/admin-1'))))

console.log(results.join('\n'))
console.log(`\n${passed}/${results.length} pruebas de reglas OK`)

await testEnv.cleanup()
