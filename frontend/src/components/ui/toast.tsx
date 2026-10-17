import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

export type ToastVariant = 'success' | 'error' | 'info'

export interface ToastOptions {
  title: string
  description?: string
  variant?: ToastVariant
  /** Milisegundos antes del autocierre; 0 lo mantiene abierto. */
  duration?: number
}

interface ToastItem {
  id: number
  title: string
  description?: string
  variant: ToastVariant
  duration: number
}

interface ToastContextValue {
  toast: (options: ToastOptions) => number
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const VARIANT_STYLES: Record<ToastVariant, { icon: typeof Info; bar: string; iconClass: string }> = {
  success: { icon: CheckCircle2, bar: 'bg-risk-bajo', iconClass: 'text-risk-bajo' },
  error: { icon: AlertCircle, bar: 'bg-risk-alto', iconClass: 'text-risk-alto' },
  info: { icon: Info, bar: 'bg-info', iconClass: 'text-info' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const idRef = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = ++idRef.current
      const item: ToastItem = {
        id,
        title: options.title,
        description: options.description,
        variant: options.variant ?? 'info',
        duration: options.duration ?? 5000,
      }
      setToasts((current) => [...current.slice(-3), item])
      if (item.duration > 0) {
        window.setTimeout(() => dismiss(id), item.duration)
      }
      return id
    },
    [dismiss],
  )

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex justify-center p-4 sm:justify-end">
          <div
            aria-live="polite"
            aria-atomic="false"
            className="flex w-full flex-col gap-2 sm:max-w-sm"
          >
            {toasts.map((t) => {
              const style = VARIANT_STYLES[t.variant]
              const Icon = style.icon
              return (
                <div
                  key={t.id}
                  role="status"
                  className="animate-toast-in shadow-card pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-xl border border-line-subtle bg-surface-2 px-4 py-3"
                >
                  <span
                    className={['absolute inset-y-0 left-0 w-[3px]', style.bar].join(' ')}
                    aria-hidden
                  />
                  <Icon className={['mt-0.5 size-4 shrink-0', style.iconClass].join(' ')} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-content-primary">{t.title}</p>
                    {t.description ? (
                      <p className="mt-0.5 text-[13px] text-content-secondary">{t.description}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(t.id)}
                    aria-label="Cerrar notificación"
                    className="rounded-md p-0.5 text-content-muted transition hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </div>
              )
            })}
          </div>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>')
  return ctx
}
