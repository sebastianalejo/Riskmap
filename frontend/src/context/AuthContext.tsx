import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { getFirebaseApp, getFirebaseAuth } from '../firebase/client'
import { friendlyFirebaseLoginError } from '../utils/firebaseAuthErrors'

type AuthContextValue = {
  username: string | null
  authToken: string | null
  /** Claim `admin` del ID token (ver firestore.rules y scripts/set-admin-claim.py). */
  isAdmin: boolean
  isReady: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null)
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  // La configuración de Firebase ya se cargó antes del primer render (ver main.tsx),
  // así que aquí se puede decidir el estado inicial sin setState dentro del efecto.
  const [isReady, setIsReady] = useState(() => !getFirebaseApp())

  useEffect(() => {
    const auth = getFirebaseAuth()
    if (!auth) return
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const token = await user.getIdTokenResult()
        setAuthToken(`Bearer ${token.token}`)
        setUsername(user.displayName?.trim() || user.email || user.uid)
        setIsAdmin(token.claims.admin === true)
      } else {
        setAuthToken(null)
        setUsername(null)
        setIsAdmin(false)
      }
      setIsReady(true)
    })
    return () => unsub()
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const auth = getFirebaseAuth()
    if (!auth)
      throw new Error(
        'Firebase no está configurado. En frontend/public/ crea firebase-config.json con el objeto de tu app web (Consola Firebase) o usa .env.local con VITE_FIREBASE_*; luego npm run build y despliega de nuevo.'
      )
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
    setIsAdmin(false)
  }, [])

  const value = useMemo(
    () => ({
      username,
      authToken,
      isAdmin,
      isReady,
      login,
      logout,
    }),
    [username, authToken, isAdmin, isReady, login, logout],
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
