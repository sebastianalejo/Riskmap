import type { HTMLAttributes } from 'react'

export type BadgeTone = 'neutral' | 'accent' | 'bajo' | 'medio' | 'alto' | 'info'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-content-secondary ring-line-subtle',
  accent: 'bg-accent-soft text-accent ring-accent/30',
  bajo: 'bg-risk-bajo-soft text-risk-bajo ring-risk-bajo/35',
  medio: 'bg-risk-medio-soft text-risk-medio ring-risk-medio/35',
  alto: 'bg-risk-alto-soft text-risk-alto ring-risk-alto/35',
  info: 'bg-info-soft text-info ring-info/35',
}

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

export function Badge({ tone = 'neutral', className, ...rest }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1',
        TONES[tone],
        className ?? '',
      ].join(' ')}
      {...rest}
    />
  )
}
