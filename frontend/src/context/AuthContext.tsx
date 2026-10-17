import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { getFirebaseApp, getFirebaseAuth } from '../firebase/client'
import { friendlyFirebaseLoginError } from '../utils/firebaseAuthErrors'

type ProfileRole = 'admin' | 'user'

type AuthContextValue = {
  username: string | null
  authToken: string | null
  /** Rol admin según `users/{uid}.role` (o el claim heredado durante la migración). */
  isAdmin: boolean
  isReady: boolean
  /** Mensaje a mostrar en el login (p. ej. cuenta deshabilitada). */
  sessionNotice: string | null
  clearSessionNotice: () => void
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * Crea o actualiza el perfil del propio usuario en `users/{uid}`.
 * El rol solo se fija al crear: las cuentas nuevas entran como `user`, salvo un
 * administrador que aún no tenga perfil (claim heredado), que se registra como `admin`.
 * Nunca se sobrescribe el rol de un perfil existente.
 */
async function upsertOwnProfile(
  db: ReturnType<typeof getFirestore>,
  uid: string,
  email: string | null,
  displayName: string | null,
  isAdmin: boolean,
): Promise<void> {
  const ref = doc(db, 'users', uid)
  const snap = await getDoc(ref)
  if (snap.exists()) {
    // No se toca `email` ni `role`/`disabled`: las reglas solo permiten al propio
    // usuario cambiar su nombre y su último acceso.
    await setDoc(ref, { displayName, lastLoginAt: serverTimestamp() }, { merge: true })
  } else {
    await setDoc(ref, {
      email: email ?? '',
      displayName,
      role: isAdmin ? 'admin' : 'user',
      disabled: false,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    })
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null)
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [claimAdmin, setClaimAdmin] = useState(false)
  const [profileRole, setProfileRole] = useState<ProfileRole | null>(null)
  const [sessionNotice, setSessionNotice] = useState<string | null>(null)
  const noticeRef = useRef<string | null>(null)
  // La configuración de Firebase ya se cargó antes del primer render (ver main.tsx),
  // así que aquí se puede decidir el estado inicial sin setState dentro del efecto.
  const [isReady, setIsReady] = useState(() => !getFirebaseApp())

  const clearSessionNotice = useCallback(() => {
    noticeRef.current = null
    setSessionNotice(null)
  }, [])

  useEffect(() => {
    const auth = getFirebaseAuth()
    if (!auth) return
    let unsubscribeProfile: (() => void) | undefined

    const unsub = onAuthStateChanged(auth, async (user) => {
      unsubscribeProfile?.()
      unsubscribeProfile = undefined

      if (!user) {
        setAuthToken(null)
        setUsername(null)
        setClaimAdmin(false)
        setProfileRole(null)
        setIsReady(true)
        return
      }

      const token = await user.getIdTokenResult()
      setAuthToken(`Bearer ${token.token}`)
      setUsername(user.displayName?.trim() || user.email || user.uid)
      setClaimAdmin(token.claims.admin === true)

      const app = getFirebaseApp()
      if (!app) {
        setIsReady(true)
        return
      }
      const db = getFirestore(app)
      const tokenEmail = typeof token.claims.email === 'string' ? token.claims.email : user.email

      try {
        await upsertOwnProfile(db, user.uid, tokenEmail, user.displayName, token.claims.admin === true)
      } catch {
        /* Sin conexión o sin permiso: se sigue con el claim (puente de migración). */
      }

      unsubscribeProfile = onSnapshot(
        doc(db, 'users', user.uid),
        (snap) => {
          const data = snap.data() as { role?: ProfileRole; disabled?: boolean } | undefined
          setProfileRole(data?.role ?? null)
          setIsReady(true)

          if (data?.disabled === true) {
            noticeRef.current = 'Tu cuenta fue deshabilitada. Contacta a un administrador.'
            setSessionNotice(noticeRef.current)
            void signOut(auth)
          }
        },
        () => setIsReady(true),
      )
    })

    return () => {
      unsubscribeProfile?.()
      unsub()
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const auth = getFirebaseAuth()
    if (!auth)
      throw new Error(
        'Firebase no está configurado. En frontend/public/ crea firebase-config.json con el objeto de tu app web (Consola Firebase) o usa .env.local con VITE_FIREBASE_*; luego npm run build y despliega de nuevo.'
      )
    noticeRef.current = null
    setSessionNotice(null)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch (e) {
      throw new Error(friendlyFirebaseLoginError(e))
    }
  }, [])

  const logout = useCallback(async () => {
    const auth = getFirebaseAuth()
    if (auth) await signOut(auth)
    setUsername(null)
    setAuthToken(null)
    setClaimAdmin(false)
    setProfileRole(null)
    setIsReady(true)
  }, [])

  const isAdmin = profileRole === 'admin' || claimAdmin

  const value = useMemo(
    () => ({
      username,
      authToken,
      isAdmin,
      isReady,
      sessionNotice,
      clearSessionNotice,
      login,
      logout,
    }),
    [username, authToken, isAdmin, isReady, sessionNotice, clearSessionNotice, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de AuthProvider')
  }
  return ctx
}
