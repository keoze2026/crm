import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react'

type Cx = (string | false | null | undefined)[]
// eslint-disable-next-line react-refresh/only-export-components
export const cx = (...c: Cx) => c.filter(Boolean).join(' ')

export function Card({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cx('glass rounded-2xl shadow-xl shadow-slate-900/5', className)}>
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-white/50 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div>
        <h3 className="font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}) {
  const variants = {
    primary:
      'bg-linear-to-b from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-600/25 hover:from-blue-600 hover:to-blue-700 disabled:from-blue-300 disabled:to-blue-300 disabled:shadow-none',
    secondary: 'glass-input border border-white/70 text-slate-700 hover:bg-white/80',
    ghost: 'text-slate-600 hover:bg-white/60',
    danger: 'border border-red-200 bg-white/70 text-red-600 hover:bg-red-50',
  }
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-4 py-2 text-sm' }
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function Input({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>}
      <input
        className={cx(
          'glass-input w-full rounded-xl border border-white/70 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30',
          className,
        )}
        {...props}
      />
    </label>
  )
}

export function Select({
  label,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>}
      <select
        className={cx(
          'glass-input w-full rounded-xl border border-white/70 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </label>
  )
}

/**
 * Segmented pill tab bar — a dark rounded container with a raised active segment, matching
 * the app's sidebar language. Generic over the tab id type.
 */
export function SegmentedTabs<T extends string>({ tabs, value, onChange, className }: {
  tabs: { id: T; label: string; icon?: ReactNode }[]
  value: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div className={cx('inline-flex items-center gap-1 rounded-2xl bg-linear-to-b from-[#131b31] to-[#0d1424] p-1 shadow-lg shadow-slate-900/25 ring-1 ring-white/10 backdrop-blur', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'flex items-center gap-2 rounded-xl px-4 py-1.5 text-sm font-medium transition-all',
            value === t.id
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-300 hover:bg-white/10 hover:text-white',
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** Compact KPI scorecard for the top of a page. */
export function StatTile({ label, value, hint, icon }: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="glass rounded-2xl p-4 shadow-lg shadow-slate-900/5 transition-transform hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        {icon && <div className="shrink-0 text-blue-900">{icon}</div>}
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </div>
  )
}

export function Badge({
  children,
  color = 'slate',
}: {
  children: ReactNode
  color?: 'slate' | 'blue' | 'green' | 'red' | 'amber'
}) {
  const colors = {
    slate: 'bg-slate-100 text-slate-600',
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    red: 'bg-red-50 text-red-700',
    amber: 'bg-amber-50 text-amber-700',
  }
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', colors[color])}>
      {children}
    </span>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'lg',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  size?: 'sm' | 'lg'
}) {
  if (!open) return null
  const maxW = size === 'sm' ? 'max-w-md' : 'max-w-lg'
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/30 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div className={cx('glass-strong w-full rounded-2xl shadow-2xl shadow-slate-900/20', maxW)} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/50 px-4 py-3">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('animate-spin text-blue-600', className)} width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 7h18M3 12h18M3 17h18" />
      </svg>
      <p className="mt-2 text-sm">{message}</p>
    </div>
  )
}
