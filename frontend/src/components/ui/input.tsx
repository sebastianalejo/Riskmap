import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

const fieldClass = [
  'w-full rounded-xl border border-line-subtle bg-surface-2 px-3 py-2 text-sm text-content-primary',
  'placeholder:text-content-muted outline-none transition',
  'focus:border-accent/60 focus:ring-2 focus:ring-accent/25',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ')

export function Label({ className, children, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={['mb-1.5 block text-[13px] font-medium text-content-secondary', className ?? ''].join(' ')}
      {...rest}
    >
      {children}
    </label>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={[fieldClass, className ?? ''].join(' ')} {...rest} />
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={[fieldClass, className ?? ''].join(' ')} {...rest}>
      {children}
    </select>
  )
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={[fieldClass, 'font-mono text-xs leading-relaxed', className ?? ''].join(' ')}
      {...rest}
    />
  )
}
