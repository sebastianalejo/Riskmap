import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from './card'

export type StatTone = 'accent' | 'bajo' | 'medio' | 'alto' | 'info' | 'neutral'

const ICON_TONES: Record<StatTone, string> = {
  accent: 'bg-accent-soft text-accent',
  bajo: 'bg-risk-bajo-soft text-risk-bajo',
  medio: 'bg-risk-medio-soft text-risk-medio',
  alto: 'bg-risk-alto-soft text-risk-alto',
  info: 'bg-info-soft text-info',
  neutral: 'bg-surface-2 text-content-secondary',
}

interface StatCardProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: LucideIcon
  tone?: StatTone
  className?: string
  /** Permite ajustar el tamaño del número (p. ej. `text-lg` para nombres). */
  valueClassName?: string
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'accent',
  className,
  valueClassName,
}: StatCardProps) {
  return (
    <Card className={['p-5', className ?? ''].join(' ')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-content-muted">
            {label}
          </p>
          <p
            className={[
              'mt-1.5 truncate font-mono font-semibold text-content-primary',
              valueClassName ?? 'text-2xl',
            ].join(' ')}
          >
            {value}
          </p>
        </div>
        {Icon ? (
          <div
            className={[
              'flex size-10 shrink-0 items-center justify-center rounded-xl',
              ICON_TONES[tone],
            ].join(' ')}
          >
            <Icon className="size-5" aria-hidden />
          </div>
        ) : null}
      </div>
      {hint ? <div className="mt-3 text-xs leading-relaxed text-content-secondary">{hint}</div> : null}
    </Card>
  )
}
