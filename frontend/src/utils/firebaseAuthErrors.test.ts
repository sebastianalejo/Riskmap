import { describe, expect, it } from 'vitest'
import { friendlyFirebaseLoginError } from './firebaseAuthErrors'

describe('friendlyFirebaseLoginError', () => {
  it('traduce credenciales inválidas al español', () => {
    expect(friendlyFirebaseLoginError({ code: 'auth/invalid-credential' })).toMatch(
      /Correo o contraseña incorrectos/,
    )
  })

  it('extrae el código desde el texto del error de Firebase', () => {
    const err = new Error('Firebase: Error (auth/too-many-requests).')
    expect(friendlyFirebaseLoginError(err)).toMatch(/Demasiados intentos/)
  })

  it('no expone el texto técnico en inglés para códigos desconocidos', () => {
    const err = new Error('Firebase: Error (auth/codigo-desconocido).')
    const message = friendlyFirebaseLoginError(err)
    expect(message).not.toContain('Firebase:')
    expect(message).toMatch(/No se pudo iniciar sesión/)
  })
})
