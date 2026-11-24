import { useLayoutEffect, useRef } from 'react'
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react'

type Cx = (string | false | null | undefined)[]
// eslint-disable-next-line react-refresh/only-export-components
export const cx = (...c: Cx) => c.filter(Boolean).join(' ')

/**
 * Keeps its text on a single line: if the text would overflow the column, the
 * font size is stepped down (to a floor) until it fits — instead of wrapping.
 * Meant for body cells only; column headers are left to wrap normally.
 */
export function FitText({
  children,
  className,
  min = 10,
  max = 14,
}: {
  children: ReactNode
  className?: string
  /** Smallest font size (px) before we stop shrinking. */
  min?: number
  /** Natural (largest) font size (px) — the column's normal text size. */
  max?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const parent = el.parentElement
    const fit = () => {
      let size = max
      el.style.fontSize = `${size}px`
      // Shrink half a pixel at a time until the line fits or we hit the floor.
      while (size > min && el.scrollWidth > el.clientWidth) {
        size -= 0.5
        el.style.fontSize = `${size}px`
      }
    }
    fit()
    // Re-fit when the column (the cell) is resized — e.g. on window resize.
    const ro = new ResizeObserver(fit)
    if (parent) ro.observe(parent)
    return () => ro.disconnect()
  }, [children, min, max])
  return (
    <span ref={ref} className={cx('block overflow-hidden whitespace-nowrap text-left', className)}>
      {children}
    </span>
  )
}

export function Card({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cx('glass rounded-xl', className)}>
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
    <div className="flex flex-col gap-3 border-b border-white/[0.06] px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div>
        <h3 className="text-[15px] font-semibold text-slate-50">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
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
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark'
  size?: 'sm' | 'md'
}) {
  // The Dashboard's button language: a hairline border, a faint fill, blue for the primary.
  const variants = {
    primary:
      'border border-blue-500/70 bg-blue-600/25 text-white hover:border-blue-400 hover:bg-blue-600/35 disabled:opacity-50',
    secondary: 'border border-white/10 bg-white/[0.03] text-slate-200 hover:border-white/20 hover:bg-white/[0.06] disabled:opacity-50',
    ghost: 'border border-transparent text-slate-300 hover:bg-white/[0.06] hover:text-white disabled:opacity-50',
    danger: 'border border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-400 hover:bg-red-500/20 disabled:opacity-50',
    /** Solid blue — the one strong call to action on a page. */
    dark: 'border border-blue-400/60 bg-blue-600 text-white shadow-[0_0_18px_rgba(59,130,246,0.25)] hover:bg-blue-500 disabled:opacity-50 disabled:shadow-none',
  }
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-4 py-2 text-sm' }
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed',
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
      {label && <span className="mb-1 block text-xs font-medium text-slate-300">{label}</span>}
      <input
        className={cx(
          'glass-input w-full rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 hover:border-white/20 focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30',
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
      {label && <span className="mb-1 block text-xs font-medium text-slate-300">{label}</span>}
      <select
        className={cx(
          'glass-input w-full rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-100 hover:border-white/20 focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30',
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
 *
 * `w-fit` keeps it hugging its tabs on a wide screen, and `flex-wrap` lets it stack onto a
 * second row on a narrow one rather than running off the side and dragging the whole page
 * into a horizontal scroll. Labels never break mid-word.
 */
export function SegmentedTabs<T extends string>({ tabs, value, onChange, className }: {
  tabs: { id: T; label: string; icon?: ReactNode }[]
  value: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div className={cx('flex w-fit max-w-full flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-[#0a1122]/75 p-1 shadow-[0_0_0_1px_rgba(59,130,246,0.07)]', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all sm:px-4',
            value === t.id
              ? 'bg-blue-500/[0.16] text-white shadow-[inset_0_0_0_1px_rgba(96,140,255,0.45),0_0_14px_rgba(59,130,246,0.22)]'
              : 'text-slate-300 hover:bg-white/[0.06] hover:text-white',
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
    <div className="glass rounded-xl p-4 transition-colors hover:border-white/15">
      <div className="flex items-start justify-between gap-3">
        <span className="font-figures text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">{label}</span>
        {icon && <div className="shrink-0 text-blue-400">{icon}</div>}
      </div>
      <div className="mt-2 font-figures text-2xl font-semibold tracking-tight text-slate-50">{value}</div>
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
    slate: 'bg-white/[0.06] text-slate-300 ring-1 ring-white/10',
    blue: 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30',
    green: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
    red: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30',
    amber: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div className={cx('glass-strong w-full rounded-xl shadow-2xl shadow-black/60', maxW)} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <h3 className="text-[15px] font-semibold text-slate-50">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white/[0.06] hover:text-white">
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

/** Download affordance — a tray with an arrow into it. Pairs with the PDF/export buttons. */
export function DownloadIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 21h16" />
    </svg>
  )
}

/** Reload arrows. `spinning` turns them while the fetch it triggered is in flight. */
export function RefreshIcon({ size = 15, spinning = false }: { size?: number; spinning?: boolean }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={cx(spinning && 'animate-spin')}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
    </svg>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('animate-spin text-blue-400', className)} width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
  )
}

/**
 * Page/section loading indicator: a thick ring with a glowing arc that sweeps around, in the
 * app's navy→blue, over a soft slate track — a compact take on the reference loader. Use in
 * place of a bare Spinner for page-level load states. Indeterminate (no percentage) since our
 * data fetches don't report progress.
 */
export function PageLoader({ label = 'Loading…', size = 56, className }: { label?: string; size?: number; className?: string }) {
  const stroke = Math.max(4, Math.round(size / 9))
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const mid = size / 2
  return (
    <div className={cx('flex flex-col items-center justify-center gap-3', className ?? 'py-16')}>
      <svg
        width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        className="animate-spin" style={{ animationDuration: '0.9s' }}
        role="status" aria-label={label || 'Loading'}
      >
        <defs>
          <linearGradient id="pageLoaderArc" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1d4ed8" />
            <stop offset="100%" stopColor="#60a5fa" />
          </linearGradient>
        </defs>
        {/* Track */}
        <circle cx={mid} cy={mid} r={r} fill="none" strokeWidth={stroke} className="stroke-white/[0.08]" />
        {/* Sweeping arc (~28% of the ring) with a soft glow */}
        <circle
          cx={mid} cy={mid} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          stroke="url(#pageLoaderArc)"
          strokeDasharray={`${circumference * 0.28} ${circumference}`}
          style={{ filter: 'drop-shadow(0 0 6px rgba(59,130,246,0.45))' }}
        />
      </svg>
      {label && <span className="animate-pulse text-sm font-medium text-slate-400">{label}</span>}
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center text-slate-500">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 7h18M3 12h18M3 17h18" />
      </svg>
      <p className="mt-2 text-sm">{message}</p>
    </div>
  )
}
