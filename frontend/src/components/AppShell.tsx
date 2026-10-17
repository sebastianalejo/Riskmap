import {
  BarChart3,
  Database,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  Radar,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button } from './ui/button'
import { ThemeToggle } from './ui/theme-toggle'

const items = [
  { to: '/', label: 'Resumen', icon: LayoutDashboard },
  { to: '/analisis', label: 'Análisis', icon: BarChart3 },
  { to: '/prediccion', label: 'Predicción', icon: Sparkles },
  { to: '/mapa', label: 'Mapa de riesgo', icon: Map },
] as const

const adminItems = [
  { to: '/datos', label: 'Importar datos', icon: Database },
  { to: '/usuarios', label: 'Usuarios', icon: Users },
] as const

function NavItem({
  to,
  label,
  icon: Icon,
  onNavigate,
}: {
  to: string
  label: string
  icon: LucideIcon
  onNavigate: () => void
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        [
          'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          isActive
            ? 'bg-accent-soft text-accent'
            : 'text-content-secondary hover:bg-surface-2 hover:text-content-primary',
        ].join(' ')
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent"
              aria-hidden
            />
          )}
          <Icon className="size-4 shrink-0 opacity-90" aria-hidden />
          {label}
        </>
      )}
    </NavLink>
  )
}

export function AppShell({ children }: { children?: ReactNode }) {
  const { isAdmin, username, logout } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleLogout = () => {
    void (async () => {
      await logout()
      navigate('/login', { replace: true })
    })()
  }

  const initial = (username ?? '?').trim().charAt(0).toUpperCase() || '?'

  const sidebar = (
    <div className="flex h-full flex-col border-r border-line-subtle bg-surface-1">
      {/* Marca */}
      <div className="flex items-center gap-3 border-b border-line-subtle px-5 py-4">
        <div className="shadow-glow flex size-10 items-center justify-center rounded-xl bg-accent-strong text-accent-foreground">
          <Radar className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-content-primary">RiskMap</p>
          <p className="truncate text-xs text-content-muted">Lima Metropolitana</p>
        </div>
      </div>

      {/* Navegación */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Principal">
        <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-content-muted">
          Operaciones
        </p>
        {items.map((item) => (
          <NavItem key={item.to} {...item} onNavigate={() => setMobileOpen(false)} />
        ))}

        {isAdmin && (
          <>
            <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-widest text-content-muted">
              Administración
            </p>
            {adminItems.map((item) => (
              <NavItem key={item.to} {...item} onNavigate={() => setMobileOpen(false)} />
            ))}
          </>
        )}
      </nav>

      {/* Usuario */}
      <div className="space-y-2 border-t border-line-subtle p-3">
        <div className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-content-primary">{username ?? 'Invitado'}</p>
            <p className="text-[11px] text-content-muted">Sesión activa</p>
          </div>
          <ThemeToggle />
        </div>
        <Button
          variant="ghost"
          className="w-full justify-start hover:bg-risk-alto-soft hover:text-risk-alto"
          onClick={handleLogout}
        >
          <LogOut className="size-4" aria-hidden />
          Cerrar sesión
        </Button>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-svh bg-surface-0">
      <aside className="hidden w-64 shrink-0 lg:sticky lg:top-0 lg:block lg:h-svh lg:self-start">
        {sidebar}
      </aside>

      {mobileOpen && (
        <div
          className="animate-fade-in fixed inset-0 z-40 bg-surface-0/70 backdrop-blur-sm lg:hidden"
          role="presentation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transform transition-transform lg:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line-subtle bg-surface-0/85 px-4 py-3 backdrop-blur lg:hidden">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-xl border border-line-subtle bg-surface-1 p-2 text-content-secondary transition hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => setMobileOpen((o) => !o)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? 'Cerrar menú' : 'Abrir menú'}
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <span className="flex items-center gap-2 truncate text-sm font-semibold text-content-primary">
            <Radar className="size-4 text-accent" aria-hidden />
            RiskMap
          </span>
          <ThemeToggle />
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  )
}
