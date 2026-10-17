import type { HTMLAttributes, ReactNode } from 'react'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={['rounded-2xl border border-line-subtle bg-surface-1', className ?? ''].join(' ')}
      {...rest}
    />
  )
}

interface CardHeaderProps {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}

export function CardHeader({ title, description, action, className }: CardHeaderProps) {
  return (
    <div className={['flex items-start justify-between gap-3', className ?? ''].join(' ')}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-content-primary">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-[13px] text-content-secondary">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function CardContent({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={['mt-4', className ?? ''].join(' ')} {...rest} />
}
