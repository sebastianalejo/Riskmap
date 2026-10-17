import type { HTMLAttributes } from 'react'

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={['animate-pulse rounded-xl bg-surface-2', className ?? ''].join(' ')}
      {...rest}
    />
  )
}
