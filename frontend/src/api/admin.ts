import {
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore'
import { deleteApp, initializeApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  getAuth,
  sendPasswordResetEmail,
  signOut as signOutAuth,
  updateProfile,
} from 'firebase/auth'
import { getFirebaseApp, getFirebaseAuth } from '../firebase/client'
import { mapAdminUser, sortUsersByCreatedAtDesc, type AdminUser, type UserRole } from '../utils/adminUsers'

export type { AdminUser, UserRole } from '../utils/adminUsers'

export interface CreateUserInput {
  email: string
  password: string
  displayName?: string
}

function firestore(): Firestore {
  const app = getFirebaseApp()
  if (!app) throw new Error('Firebase no está configurado.')
  return getFirestore(app)
}

function currentUid(): string {
  const uid = getFirebaseAuth()?.currentUser?.uid
  if (!uid) throw new Error('Se requiere una sesión iniciada.')
  return uid
}

/** Escucha la colección `users` en vivo (solo admin). Devuelve la función para dejar de escuchar. */
export function subscribeUsers(
  onData: (users: AdminUser[]) => void,
  onError: (error: unknown) => void,
): () => void {
  return onSnapshot(
    collection(firestore(), 'users'),
    (snap) => {
      onData(sortUsersByCreatedAtDesc(snap.docs.map((d) => mapAdminUser(d.id, d.data()))))
    },
    onError,
  )
}

/**
 * Crea una cuenta de Firebase Auth sin cerrar la sesión del administrador, usando una
 * instancia secundaria de la app. Luego registra el perfil en `users/{uid}` con rol `user`.
 */
export async function createUser(input: CreateUserInput): Promise<AdminUser> {
  const app = getFirebaseApp()
  if (!app) throw new Error('Firebase no está configurado.')
  const email = input.email.trim()
  const displayName = input.displayName?.trim() || null

  const secondary = initializeApp(app.options, `create-user-${Date.now()}`)
  let uid: string
  try {
    const secondaryAuth = getAuth(secondary)
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, input.password)
    uid = cred.user.uid
    if (displayName) {
      try {
        await updateProfile(cred.user, { displayName })
      } catch {
        /* el nombre es opcional: la cuenta ya está creada */
      }
    }
    await signOutAuth(secondaryAuth)
  } finally {
    await deleteApp(secondary).catch(() => undefined)
  }

  const db = firestore()
  await setDoc(doc(db, 'users', uid), {
    email,
    displayName,
    role: 'user',
    disabled: false,
    createdAt: serverTimestamp(),
    lastLoginAt: null,
    updatedAt: serverTimestamp(),
    updatedBy: currentUid(),
  })

  return {
    uid,
    email,
    displayName,
    role: 'user',
    disabled: false,
    createdAt: null,
    lastSignInAt: null,
  }
}

/** Cambia el rol de una cuenta (`admin` / `user`). */
export async function setUserRole(uid: string, role: UserRole): Promise<void> {
  const ref = doc(firestore(), 'users', uid)
  const snapshot = await getDoc(ref)
  const payload: DocumentData = { role, updatedAt: serverTimestamp(), updatedBy: currentUid() }
  if (snapshot.exists()) {
    await updateDoc(ref, payload)
  } else {
    await setDoc(ref, {
      ...payload,
      email: '',
      displayName: null,
      disabled: false,
      createdAt: serverTimestamp(),
    })
  }
}

/** Habilita o deshabilita (baja lógica) una cuenta. */
export async function setUserDisabled(uid: string, disabled: boolean): Promise<void> {
  await updateDoc(doc(firestore(), 'users', uid), {
    disabled,
    updatedAt: serverTimestamp(),
    updatedBy: currentUid(),
  })
}

/** Actualiza el nombre visible de una cuenta. */
export async function updateUserName(uid: string, displayName: string): Promise<void> {
  await updateDoc(doc(firestore(), 'users', uid), {
    displayName: displayName.trim(),
    updatedAt: serverTimestamp(),
    updatedBy: currentUid(),
  })
}

/** Envía el correo de restablecimiento de contraseña (SDK cliente, sin Cloud Functions). */
export async function sendPasswordReset(email: string): Promise<void> {
  const auth = getFirebaseAuth()
  if (!auth) throw new Error('Firebase no está configurado.')
  await sendPasswordResetEmail(auth, email.trim())
}

/** UID de la sesión actual (para evitar acciones destructivas sobre uno mismo). */
export function currentAdminUid(): string | null {
  return getFirebaseAuth()?.currentUser?.uid ?? null
}
