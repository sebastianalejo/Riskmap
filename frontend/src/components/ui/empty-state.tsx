import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={[
        'flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong bg-surface-1/60 px-6 py-10 text-center',
        className ?? '',
      ].join(' ')}
    >
      <div className="flex size-11 items-center justify-center rounded-xl bg-surface-2 text-content-muted">
        <Icon className="size-5" aria-hidden />
      </div>
      <div>
        <p className="text-sm font-semibold text-content-primary">{title}</p>
        {description ? (
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-content-secondary">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  )
}
