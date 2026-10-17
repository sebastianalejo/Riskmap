import { describe, expect, it } from 'vitest'
import { friendlyUserError } from './adminErrors'

describe('friendlyUserError', () => {
  it('traduce la falta de permisos de Firestore', () => {
    expect(friendlyUserError({ code: 'permission-denied' }, 'fallback')).toMatch(
      /permiso de administrador/,
    )
  })

  it('traduce correo ya registrado', () => {
    expect(friendlyUserError({ code: 'auth/email-already-in-use' }, 'fallback')).toMatch(
      /Ya existe una cuenta/,
    )
  })

  it('traduce la falta de conexión con Firestore', () => {
    expect(friendlyUserError({ code: 'unavailable' }, 'fallback')).toMatch(/Sin conexión/)
  })

  it('usa el mensaje del error para códigos desconocidos', () => {
    expect(friendlyUserError(new Error('algo salió mal'), 'fallback')).toBe('algo salió mal')
  })

  it('usa el fallback cuando no hay mensaje', () => {
    expect(friendlyUserError(null, 'fallback')).toBe('fallback')
  })
})
