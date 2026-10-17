import { AlertCircle, ArrowRight, Eye, EyeOff, Lock, Radar, User } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Input, Label } from '../components/ui/input'
import { ThemeToggle } from '../components/ui/theme-toggle'
import { useAuth } from '../context/AuthContext'
import { getFirebaseApp } from '../firebase/client'
import { friendlyFirebaseLoginError } from '../utils/firebaseAuthErrors'

export function LoginPage() {
  const { authToken, login, isReady } = useAuth()
  const firebaseConfigured = Boolean(getFirebaseApp())
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (isReady && authToken) {
    return <Navigate to={from} replace />
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(email, password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(friendlyFirebaseLoginError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-surface-0 px-4 py-12">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -20%, rgb(13 148 136 / 0.4), transparent), radial-gradient(ellipse 60% 40% at 100% 0%, rgb(56 189 248 / 0.16), transparent)',
        }}
        aria-hidden
      />
      <div className="absolute right-4 top-4 z-20">
        <ThemeToggle />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="shadow-glow mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-strong text-accent-foreground">
            <Radar className="size-7" aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-content-primary">Acceso al panel</h1>
          <p className="mt-2 text-sm text-content-secondary">
            Usuario de Firebase Authentication (correo y contraseña).
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="shadow-card rounded-2xl border border-line-subtle bg-surface-1/90 p-6 backdrop-blur"
        >
          {error && (
            <div
              className="mb-4 flex gap-3 rounded-xl border border-risk-alto/30 bg-risk-alto-soft px-3 py-3 text-sm text-risk-alto"
              role="alert"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          <div>
            <Label htmlFor="login-email">Correo</Label>
            <div className="relative">
              <User
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-content-muted"
                aria-hidden
              />
              <Input
                id="login-email"
                autoComplete="email"
                type="email"
                className="pl-10"
                placeholder="tu@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="mt-4">
            <Label htmlFor="login-password">Contraseña</Label>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-content-muted"
                aria-hidden
              />
              <Input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                className="pl-10 pr-10"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-content-muted transition hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              </button>
            </div>
          </div>

          <Button type="submit" size="lg" loading={loading} className="mt-6 w-full">
            {loading ? 'Entrando…' : 'Entrar'}
            {!loading && <ArrowRight className="size-4" aria-hidden />}
          </Button>
        </form>

        {!firebaseConfigured && (
          <p className="mt-6 text-center text-xs text-content-muted">
            Falta la configuración web del SDK. Copia{' '}
            <span className="font-mono text-content-secondary">firebase-config.example.json</span> a{' '}
            <span className="font-mono text-content-secondary">firebase-config.json</span> en{' '}
            <span className="font-mono text-content-secondary">frontend/public/</span> con los datos de
            la Consola Firebase (app web), luego{' '}
            <span className="font-mono text-content-secondary">npm run build</span> y despliega.
          </p>
        )}
      </div>
    </div>
  )
}
