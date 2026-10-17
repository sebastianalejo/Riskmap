import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  User,
  UserPlus,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import {
  createUser,
  currentAdminUid,
  sendPasswordReset,
  setUserDisabled,
  setUserRole,
  subscribeUsers,
  type AdminUser,
  type UserRole,
} from '../api/admin'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardHeader } from '../components/ui/card'
import { Input, Label, Select } from '../components/ui/input'
import { Modal } from '../components/ui/modal'
import { useToast } from '../components/ui/toast'
import { friendlyUserError } from '../utils/adminErrors'

interface CreatedAccount {
  displayName: string
  email: string
  password: string
}

type ConfirmAction =
  | { kind: 'disable'; user: AdminUser }
  | { kind: 'enable'; user: AdminUser }
  | { kind: 'demote'; user: AdminUser }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function formatDateTime(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Inicial para el avatar de una cuenta. */
function userInitial(u: AdminUser): string {
  return (u.displayName || u.email || '?').trim().charAt(0).toUpperCase() || '?'
}

/** Insignia de estado compartida por la tabla (escritorio) y las tarjetas (móvil). */
function StatusBadge({ disabled }: { disabled: boolean }) {
  return disabled ? (
    <Badge tone="alto">
      <ShieldOff className="size-3" aria-hidden />
      Deshabilitada
    </Badge>
  ) : (
    <Badge tone="bajo">
      <ShieldCheck className="size-3" aria-hidden />
      Activa
    </Badge>
  )
}

export function UsersPage() {
  const { toast } = useToast()
  const selfUid = currentAdminUid()

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
  const [pendingUid, setPendingUid] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)

  useEffect(() => {
    return subscribeUsers(
      (data) => {
        setUsers(data)
        setListError(null)
        setListLoading(false)
      },
      (err) => {
        setListError(friendlyUserError(err, 'No se pudieron cargar las cuentas.'))
        setListLoading(false)
      },
    )
  }, [reloadKey])

  const refreshUsers = () => {
    setListLoading(true)
    setListError(null)
    setReloadKey((k) => k + 1)
  }

  const commit = async (action: () => Promise<void>, uid: string, fallback: string) => {
    setPendingUid(uid)
    try {
      await action()
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Operación no completada',
        description: friendlyUserError(err, fallback),
      })
    } finally {
      setPendingUid(null)
    }
  }

  const activeAdmins = users.filter((u) => u.role === 'admin' && !u.disabled).length

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
      const user = await createUser({
        displayName: trimmedName,
        email: trimmedEmail,
        password,
      })
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
    } catch (err) {
      setError(friendlyUserError(err, 'No se pudo crear la cuenta.'))
    } finally {
      setLoading(false)
    }
  }

  const commitRole = (user: AdminUser, role: UserRole) =>
    commit(
      async () => {
        await setUserRole(user.uid, role)
        toast({
          variant: 'success',
          title: role === 'admin' ? 'Rol admin asignado' : 'Rol actualizado',
          description:
            role === 'admin'
              ? `${user.displayName || user.email} verá la sección Administración al recargar.`
              : `${user.displayName || user.email} queda como usuario.`,
        })
      },
      user.uid,
      'No se pudo cambiar el rol.',
    )

  const applyRole = async (user: AdminUser, role: UserRole) => {
    if (user.role === role) return
    if (role === 'user' && user.role === 'admin' && activeAdmins <= 1) {
      toast({
        variant: 'error',
        title: 'No se puede quitar el rol',
        description: 'Es el último administrador activo. Asigna otro admin antes de cambiarlo.',
      })
      return
    }
    if (role === 'user' && user.role === 'admin') {
      setConfirmAction({ kind: 'demote', user })
      return
    }
    await commitRole(user, role)
  }

  const applyDisabled = async (user: AdminUser, disabled: boolean) => {
    await commit(async () => {
      await setUserDisabled(user.uid, disabled)
      toast({
        variant: 'success',
        title: disabled ? 'Cuenta deshabilitada' : 'Cuenta habilitada',
        description: disabled
          ? `${user.displayName || user.email} ya no puede acceder a los datos.`
          : `${user.displayName || user.email} recupera el acceso.`,
      })
    }, user.uid, 'No se pudo actualizar el estado de la cuenta.')
  }

  const handleReset = (user: AdminUser) => {
    if (!user.email) return
    void commit(
      async () => {
        await sendPasswordReset(user.email!)
        toast({
          variant: 'success',
          title: 'Correo enviado',
          description: `Se envió el restablecimiento de contraseña a ${user.email}.`,
        })
      },
      user.uid,
      'No se pudo enviar el correo de restablecimiento.',
    )
  }

  const confirmCopy = (() => {
    if (!confirmAction) return null
    const who = confirmAction.user.displayName || confirmAction.user.email || 'esta cuenta'
    if (confirmAction.kind === 'disable') {
      return {
        title: 'Deshabilitar cuenta',
        description: `${who} no podrá volver a leer ni escribir datos hasta que la habilites. La cuenta seguirá existiendo.`,
        label: 'Deshabilitar',
        variant: 'danger' as const,
        run: () => applyDisabled(confirmAction.user, true),
      }
    }
    if (confirmAction.kind === 'enable') {
      return {
        title: 'Habilitar cuenta',
        description: `${who} recuperará el acceso a los datos que permite su rol.`,
        label: 'Habilitar',
        variant: 'primary' as const,
        run: () => applyDisabled(confirmAction.user, false),
      }
    }
    return {
      title: 'Quitar rol de administrador',
      description: `${who} dejará de ver la sección Administración. Para borrar la cuenta definitivamente, hazlo desde la consola de administración.`,
      label: 'Quitar admin',
      variant: 'danger' as const,
      run: () => commitRole(confirmAction.user, 'user'),
    }
  })()

  /** Botones de acción de una cuenta; se usan en la tabla y en las tarjetas móviles. */
  const accountActions = (u: AdminUser, isSelf: boolean, busy: boolean) => (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy || !u.email}
        onClick={() => handleReset(u)}
        title="Enviar correo de restablecimiento de contraseña"
      >
        <KeyRound className="size-3.5" aria-hidden />
        Reset
      </Button>
      <Button
        variant={u.disabled ? 'secondary' : 'ghost'}
        size="sm"
        disabled={busy || isSelf}
        title={isSelf ? 'No puedes deshabilitar tu propia cuenta' : undefined}
        onClick={() => setConfirmAction({ kind: u.disabled ? 'enable' : 'disable', user: u })}
      >
        {u.disabled ? 'Habilitar' : 'Deshabilitar'}
      </Button>
    </div>
  )

  /** Selector de rol compartido; el id permite etiquetarlo en las tarjetas móviles. */
  const roleSelect = (u: AdminUser, isSelf: boolean, busy: boolean, id?: string) => (
    <Select
      id={id}
      aria-label={`Rol de ${u.displayName || u.email || u.uid}`}
      value={u.role}
      disabled={busy || isSelf}
      title={isSelf ? 'No puedes cambiar tu propio rol' : undefined}
      onChange={(e) => void applyRole(u, e.target.value as UserRole)}
      className="h-8 w-28 px-2 py-0 text-xs"
    >
      <option value="user">Usuario</option>
      <option value="admin">Admin</option>
    </Select>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-content-primary">Usuarios</h1>
        <p className="mt-1 max-w-2xl text-sm text-content-secondary">
          Crea cuentas y gestiona roles y estado. Los roles se guardan en la base de datos y se
          aplican al instante; las contraseñas se gestionan en el sistema de cuentas.
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
        <Card className="p-4 sm:p-6">
          <CardHeader
            title="Nueva cuenta"
            description="La cuenta se crea con rol Usuario; asciéndela cuando corresponda."
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
            La contraseña es temporal: compártela y pide a la persona cambiarla con “Enviar
            restablecimiento” o desde el inicio de sesión. Para eliminar una cuenta por completo,
            usa la consola de administración.
          </p>
        </Card>

        <Card className="p-4 sm:p-6">
          <CardHeader
            title="Cuentas registradas"
            description="Rol y estado de cada cuenta."
            action={
              <Button variant="ghost" size="sm" loading={listLoading} onClick={refreshUsers}>
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
            <>
              {/* Móvil: tarjetas apiladas, sin scroll horizontal */}
              <ul className="mt-4 space-y-3 md:hidden" aria-label="Cuentas registradas">
                {users.map((u) => {
                  const isSelf = u.uid === selfUid
                  const busy = pendingUid === u.uid
                  const roleFieldId = `user-role-${u.uid}`
                  return (
                    <li key={u.uid} className="rounded-xl border border-line-subtle bg-surface-1 p-3">
                      <div className="flex items-start gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                          {userInitial(u)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-content-primary">
                            {u.displayName || 'Sin nombre'}
                            {isSelf && <span className="ml-1 text-[10px] text-content-muted">(tú)</span>}
                          </p>
                          <p className="truncate text-xs text-content-muted">{u.email ?? '—'}</p>
                        </div>
                        <StatusBadge disabled={u.disabled} />
                      </div>

                      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="min-w-0">
                          <dt className="text-content-muted">Último acceso</dt>
                          <dd className="mt-0.5 truncate text-content-secondary">
                            {formatDateTime(u.lastSignInAt)}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-content-muted">Creada</dt>
                          <dd className="mt-0.5 truncate text-content-secondary">
                            {formatDateTime(u.createdAt)}
                          </dd>
                        </div>
                      </dl>

                      <div className="mt-3">
                        <Label htmlFor={roleFieldId}>Rol</Label>
                        {roleSelect(u, isSelf, busy, roleFieldId)}
                      </div>

                      <div className="mt-3 border-t border-line-subtle pt-3">
                        {accountActions(u, isSelf, busy)}
                      </div>
                    </li>
                  )
                })}
              </ul>

              {/* Escritorio: tabla */}
              <div className="mt-4 hidden overflow-x-auto rounded-xl border border-line-subtle md:block">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="bg-surface-2 text-[10px] uppercase tracking-wide text-content-muted">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Usuario</th>
                      <th className="px-3 py-2 font-semibold">Rol</th>
                      <th className="px-3 py-2 font-semibold">Estado</th>
                      <th className="px-3 py-2 font-semibold">Último acceso</th>
                      <th className="px-3 py-2 font-semibold">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      const isSelf = u.uid === selfUid
                      const busy = pendingUid === u.uid
                      return (
                        <tr key={u.uid} className="border-t border-line-subtle hover:bg-surface-2/60">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
                                {userInitial(u)}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium text-content-primary">
                                  {u.displayName || 'Sin nombre'}
                                  {isSelf && <span className="ml-1 text-[10px] text-content-muted">(tú)</span>}
                                </p>
                                <p className="truncate text-[11px] text-content-muted">
                                  {u.email ?? '—'}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2">{roleSelect(u, isSelf, busy)}</td>
                          <td className="px-3 py-2">
                            <StatusBadge disabled={u.disabled} />
                          </td>
                          <td className="px-3 py-2 text-content-secondary">
                            <p>{formatDateTime(u.lastSignInAt)}</p>
                            <p className="text-[11px] text-content-muted">
                              Creada: {formatDateTime(u.createdAt)}
                            </p>
                          </td>
                          <td className="px-3 py-2">{accountActions(u, isSelf, busy)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <p className="mt-3 text-[11px] text-content-muted">
            {users.length} cuenta(s). No puedes cambiar tu propio rol ni deshabilitar tu cuenta. El
            borrado definitivo se hace desde la consola de administración.
          </p>
        </Card>
      </div>

      <Modal
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        title={confirmCopy?.title ?? ''}
        description={confirmCopy?.description}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmAction(null)}>
              Cancelar
            </Button>
            <Button
              variant={confirmCopy?.variant ?? 'primary'}
              onClick={() => {
                const run = confirmCopy?.run
                setConfirmAction(null)
                void run?.()
              }}
            >
              {confirmCopy?.label ?? 'Confirmar'}
            </Button>
          </>
        }
      />
    </div>
  )
}
