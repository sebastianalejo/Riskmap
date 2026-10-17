import { describe, expect, it } from 'vitest'
import { mapAdminUser, sortUsersByCreatedAtDesc, toMillis, type AdminUser } from './adminUsers'

function user(partial: Partial<AdminUser> & { uid: string }): AdminUser {
  return {
    email: null,
    displayName: null,
    role: 'user',
    disabled: false,
    createdAt: null,
    lastSignInAt: null,
    ...partial,
  }
}

describe('toMillis', () => {
  it('convierte un Timestamp de Firestore', () => {
    expect(toMillis({ toMillis: () => 1700000000000 })).toBe(1700000000000)
  })

  it('acepta números y descarta valores ausentes', () => {
    expect(toMillis(123)).toBe(123)
    expect(toMillis(null)).toBeNull()
    expect(toMillis('123')).toBeNull()
  })
})

describe('mapAdminUser', () => {
  it('normaliza rol, estado y fechas', () => {
    const mapped = mapAdminUser('u1', {
      email: 'a@b.com',
      displayName: 'Ana',
      role: 'admin',
      disabled: true,
      createdAt: { toMillis: () => 1000 },
      lastLoginAt: { toMillis: () => 2000 },
    })
    expect(mapped).toEqual({
      uid: 'u1',
      email: 'a@b.com',
      displayName: 'Ana',
      role: 'admin',
      disabled: true,
      createdAt: 1000,
      lastSignInAt: 2000,
    })
  })

  it('aplica valores por defecto ante datos incompletos', () => {
    expect(mapAdminUser('u2', {})).toEqual({
      uid: 'u2',
      email: null,
      displayName: null,
      role: 'user',
      disabled: false,
      createdAt: null,
      lastSignInAt: null,
    })
  })

  it('trata cualquier rol distinto de admin como user', () => {
    expect(mapAdminUser('u3', { role: 'superadmin' }).role).toBe('user')
  })
})

describe('sortUsersByCreatedAtDesc', () => {
  it('ordena de la más reciente a la más antigua sin mutar la entrada', () => {
    const users = [
      user({ uid: 'a', createdAt: 100 }),
      user({ uid: 'b', createdAt: 300 }),
      user({ uid: 'c', createdAt: null }),
    ]
    const sorted = sortUsersByCreatedAtDesc(users)
    expect(sorted.map((u) => u.uid)).toEqual(['b', 'a', 'c'])
    expect(users.map((u) => u.uid)).toEqual(['a', 'b', 'c'])
  })
})
