import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app'
import { getAuth } from 'firebase/auth'

let _app: FirebaseApp | null = null
let _runtimeOptions: FirebaseOptions | null = null
let _runtimeFunctionsOrigin: string | undefined
let _mapsApiKey: string | undefined
let _runtimeAppCheckSiteKey: string | undefined
let _appCheckReady = false

/**
 * Misma forma que el objeto `firebaseConfig` de la consola, más opcional `functionsOrigin`, `mapsApiKey` y `appCheckSiteKey`.
 * Si falta `functionsOrigin`, se usa `https://us-central1-<projectId>.cloudfunctions.net`.
 */
type RuntimeConfigFile = FirebaseOptions & {
  functionsOrigin?: string
  mapsApiKey?: string
  appCheckSiteKey?: string
}

function optionsFromEnv(): FirebaseOptions | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY?.trim()
  if (!apiKey) return null
  return {
    apiKey,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
  }
}

function effectiveOptions(): FirebaseOptions | null {
  return optionsFromEnv() ?? _runtimeOptions
}

/**
 * Si no hay VITE_FIREBASE_* en el build, intenta `/firebase-config.json` (archivo en `public/`).
 * Debe ejecutarse antes de renderizar React (ver `main.tsx`).
 */
export async function loadFirebaseRuntimeConfig(): Promise<void> {
  let raw: Partial<RuntimeConfigFile> | null = null
  try {
    const r = await fetch('/firebase-config.json', { cache: 'no-store' })
    if (r.ok) raw = await r.json()
  } catch {
    /* sin archivo */
  }
  if (raw && typeof raw.mapsApiKey === 'string' && raw.mapsApiKey.trim()) {
    _mapsApiKey = raw.mapsApiKey.trim()
  }
  if (raw && typeof raw.appCheckSiteKey === 'string' && raw.appCheckSiteKey.trim()) {
    _runtimeAppCheckSiteKey = raw.appCheckSiteKey.trim()
  }

  if (optionsFromEnv()) return

  if (!raw || typeof raw.apiKey !== 'string' || !raw.apiKey.trim()) return
  _runtimeOptions = {
    apiKey: raw.apiKey.trim(),
    authDomain: String(raw.authDomain ?? ''),
    projectId: String(raw.projectId ?? ''),
    storageBucket: String(raw.storageBucket ?? ''),
    messagingSenderId: String(raw.messagingSenderId ?? ''),
    appId: String(raw.appId ?? ''),
  }
  if (typeof raw.functionsOrigin === 'string' && raw.functionsOrigin.trim()) {
    _runtimeFunctionsOrigin = raw.functionsOrigin.trim()
  }
}

/** Google Maps JavaScript API (Mapa de riesgo). Env o `mapsApiKey` en firebase-config.json. */
export function getGoogleMapsApiKey(): string | undefined {
  const fromEnv = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
  if (fromEnv) return fromEnv
  return _mapsApiKey
}

/** Clave de sitio de App Check (reCAPTCHA v3). Env o `appCheckSiteKey` en firebase-config.json. */
export function getAppCheckSiteKey(): string | undefined {
  const fromEnv = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY?.trim()
  if (fromEnv) return fromEnv
  return _runtimeAppCheckSiteKey
}

/**
 * Inicializa App Check solo si hay clave de sitio configurada (opcional).
 * Debe llamarse antes de renderizar React (ver main.tsx).
 */
export function initAppCheck(): void {
  if (_appCheckReady) return
  const app = getFirebaseApp()
  const siteKey = getAppCheckSiteKey()
  if (!app || !siteKey) return
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    })
    _appCheckReady = true
  } catch {
    /* ya inicializado o entorno sin reCAPTCHA */
  }
}

/** Origen de Cloud Functions (env, JSON o derivado del projectId). */
export function getFunctionsOrigin(): string | undefined {
  const fromEnv = import.meta.env.VITE_FIREBASE_FUNCTIONS_ORIGIN?.replace(/\/$/, '').trim()
  if (fromEnv) return fromEnv
  const fromJson = _runtimeFunctionsOrigin?.replace(/\/$/, '').trim()
  if (fromJson) return fromJson
  const pid = effectiveOptions()?.projectId?.trim()
  if (pid) return `https://us-central1-${pid}.cloudfunctions.net`
  return undefined
}

export function getFirebaseApp(): FirebaseApp | null {
  const opts = effectiveOptions()
  if (!opts?.apiKey) return null
  if (_app) return _app
  _app = getApps().length ? getApps()[0]! : initializeApp(opts)
  return _app
}

export function getFirebaseAuth() {
  const app = getFirebaseApp()
  if (!app) return null
  return getAuth(app)
}
