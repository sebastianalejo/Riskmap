import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const { state } = vi.hoisted(() => ({ state: { isAdmin: false } }))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    username: 'persona',
    authToken: 'Bearer test',
    isAdmin: state.isAdmin,
    isReady: true,
    login: async () => undefined,
    logout: async () => undefined,
  }),
}))

vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: () => undefined }),
}))

import { AppShell } from './AppShell'

function render(): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AppShell)))
}

describe('AppShell (navegación por rol)', () => {
  it('oculta la sección de Administración a las cuentas sin rol admin', () => {
    state.isAdmin = false
    const html = render()

    expect(html).not.toContain('Administración')
    expect(html).not.toContain('href="/datos"')
    expect(html).not.toContain('href="/usuarios"')
  })

  it('muestra Importar datos y Usuarios solo a las cuentas admin', () => {
    state.isAdmin = true
    const html = render()

    expect(html).toContain('Administración')
    expect(html).toContain('Importar datos')
    expect(html).toContain('href="/datos"')
    expect(html).toContain('Usuarios')
    expect(html).toContain('href="/usuarios"')
  })
})
