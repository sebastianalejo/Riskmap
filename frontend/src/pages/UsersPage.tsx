import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  User,
  UserPlus,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { createUser, listUsers, type AdminUser } from '../api/admin'
import { ApiError } from '../api/client'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardHeader } from '../components/ui/card'
import { Input, Label } from '../components/ui/input'
import { useToast } from '../components/ui/toast'

interface CreatedAccount {
  displayName: string
  email: string
  password: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function friendlyAdminError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Tu sesión expiró. Vuelve a iniciar sesión y reinténtalo.'
    if (err.status === 403) return 'Tu cuenta no tiene el permiso admin para esta operación.'
    return err.message
  }
  return err instanceof Error ? err.message : fallback
}

function formatDateTime(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' })
}

export function UsersPage() {
  const { toast } = useToast()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedAccount | null>(null)

  const [users, setUsers] = useState<AdminUser[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await listUsers()
        if (cancelled) return
        setUsers(data)
        setListError(null)
      } catch (err) {
        if (!cancelled) {
          setListError(friendlyAdminError(err, 'No se pudieron cargar las cuentas.'))
        }
      } finally {
        if (!cancelled) setListLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const refreshUsers = () => {
    setListLoading(true)
    setListError(null)
    setReloadKey((k) => k + 1)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    const trimmedName = name.trim()
    const trimmedEmail = email.trim()

    if (!trimmedName) {
      setError('Indica el nombre de la persona.')
      return
    }
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError('El correo electrónico no es válido.')
      return
    }
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setLoading(true)
    try {
      const user = await createUser({ displayName: trimmedName, email: trimmedEmail, password })
      setCreated({
        displayName: user.displayName?.trim() || trimmedName,
        email: user.email ?? trimmedEmail,
        password,
      })
      setName('')
      setEmail('')
      setPassword('')
      setConfirm('')
      toast({
        variant: 'success',
        title: 'Cuenta creada',
        description: 'La persona ya puede iniciar sesión en /login con esas credenciales.',
      })
      refreshUsers()
    } catch (err) {
      setError(friendlyAdminError(err, 'No se pudo crear la cuenta.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-content-primary">Usuarios</h1>
        <p className="mt-1 max-w-2xl text-sm text-content-secondary">
          Crea cuentas para acceder al panel y consulta los roles existentes. Se registran en
          Firebase Authentication (correo y contraseña) y se usan en{' '}
          <code className="rounded bg-surface-2 px-1 font-mono text-xs">/login</code>.
        </p>
      </div>

      {created && (
        <div
          className="flex gap-3 rounded-2xl border border-risk-bajo/30 bg-risk-bajo-soft px-4 py-3 text-sm"
          role="status"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-risk-bajo" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium text-content-primary">Cuenta creada</p>
            <p className="mt-1 text-content-secondary">
              Comparte estas credenciales con {created.displayName} — la contraseña no se volverá a
              mostrar:
            </p>
            <dl className="mt-2 space-y-1 font-mono text-xs text-content-secondary">
              <div className="flex flex-wrap gap-2">
                <dt className="text-content-muted">Correo:</dt>
                <dd className="break-all">{created.email}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="text-content-muted">Contraseña:</dt>
                <dd className="break-all">{created.password}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[26rem_minmax(0,1fr)]">
        <Card className="p-6">
          <CardHeader
            title="Nueva cuenta"
            description="La cuenta no recibe permisos de administrador automáticamente."
          />

          <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
            {error && (
              <div
                className="flex gap-3 rounded-xl border border-risk-alto/30 bg-risk-alto-soft px-3 py-3 text-sm text-risk-alto"
                role="alert"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{error}</span>
              </div>
            )}

            <div>
              <Label htmlFor="user-name">Nombre</Label>
              <div className="relative">
                <User
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-content-muted"
                  aria-hidden
                />
                <Input
                  id="user-name"
                  autoComplete="name"
                  className="pl-10"
                  placeholder="María Pérez"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <Label htmlFor="user-email">Correo</Label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-content-muted"
                  aria-hidden
                />
                <Input
                  id="user-email"
                  type="email"
                  autoComplete="off"
                  className="pl-10"
                  placeholder="persona@correo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <Label htmlFor="user-password">Contraseña temporal</Label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-content-muted"
                  aria-hidden
                />
                <Input
                  id="user-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  className="pl-10 pr-10"
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-content-muted transition hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </button>
              </div>
            </div>

            <div>
              <Label htmlFor="user-confirm">Confirmar contraseña</Label>
              <div className="relative">
                <ShieldCheck
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-content-muted"
                  aria-hidden
                />
                <Input
                  id="user-confirm"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  className="pl-10"
                  placeholder="Repite la contraseña"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
            </div>

            <Button type="submit" size="lg" loading={loading} className="w-full">
              {loading ? 'Creando…' : 'Crear cuenta'}
              {!loading && <UserPlus className="size-4" aria-hidden />}
            </Button>
          </form>

          <p className="mt-4 text-xs text-content-muted">
            ¿La cuenta necesita permisos de administrador? Asígnalos con{' '}
            <span className="font-mono text-content-secondary">
              python scripts/set-admin-claim.py correo@ejemplo.com
            </span>{' '}
            y pídele cerrar sesión y volver a entrar.
          </p>
        </Card>

        <Card className="p-6">
          <CardHeader
            title="Cuentas registradas"
            description="Roles, estado y actividad según Firebase Authentication."
            action={
              <Button
                variant="ghost"
                size="sm"
                loading={listLoading}
                onClick={refreshUsers}
              >
                <RefreshCw className="size-3.5" aria-hidden />
                Actualizar
              </Button>
            }
          />

          {listError && (
            <div
              className="mt-4 flex gap-3 rounded-xl border border-risk-alto/30 bg-risk-alto-soft px-3 py-3 text-sm text-risk-alto"
              role="alert"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{listError}</span>
            </div>
          )}

          {listLoading && users.length === 0 ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-content-secondary">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Cargando cuentas…
            </div>
          ) : users.length === 0 ? (
            <p className="mt-4 text-sm text-content-muted">Aún no hay cuentas registradas.</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-line-subtle">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="bg-surface-2 text-[10px] uppercase tracking-wide text-content-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Usuario</th>
                    <th className="px-3 py-2 font-semibold">Rol</th>
                    <th className="px-3 py-2 font-semibold">Estado</th>
                    <th className="px-3 py-2 font-semibold">Último acceso</th>
                    <th className="px-3 py-2 font-semibold">Creada</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.uid} className="border-t border-line-subtle hover:bg-surface-2/60">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
                            {(u.displayName || u.email || '?').trim().charAt(0).toUpperCase() || '?'}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-content-primary">
                              {u.displayName || 'Sin nombre'}
                            </p>
                            <p className="truncate text-[11px] text-content-muted">
                              {u.email ?? '—'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={u.role === 'admin' ? 'accent' : 'neutral'}>
                          {u.role === 'admin' ? (
                            <>
                              <ShieldCheck className="size-3" aria-hidden />
                              Admin
                            </>
                          ) : (
                            'Usuario'
                          )}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <span className={u.disabled ? 'text-risk-alto' : 'text-risk-bajo'}>
                          {u.disabled ? 'Deshabilitada' : 'Activa'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-content-secondary">
                        {formatDateTime(u.lastSignInAt)}
                      </td>
                      <td className="px-3 py-2 text-content-secondary">
                        {formatDateTime(u.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!listLoading && !listError && (
            <p className="mt-3 text-[11px] text-content-muted">
              {users.length} cuenta(s). Los roles se asignan por fuera de la app:{' '}
              <span className="font-mono text-content-secondary">
                python scripts/set-admin-claim.py correo@ejemplo.com
              </span>
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}
