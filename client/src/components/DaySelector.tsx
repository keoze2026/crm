import { today } from '../lib/format'
import { cx } from './ui'

const chevron = (dir: 'left' | 'right') => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points={dir === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
  </svg>
)

const stepBtn =
  'glass-input flex h-9 w-9 items-center justify-center rounded-lg border border-white/70 text-slate-600 '
  + 'transition-colors hover:bg-white/80 hover:text-slate-900 disabled:text-slate-300 disabled:hover:bg-transparent'

/** Shift a "YYYY-MM-DD" value by n days, using local parts so it never skips a day. */
function shiftDay(value: string, n: number): string {
  const d = new Date(`${value}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Day picker: prev/next chevrons around a date field, plus a Today shortcut. The
 * day-scale counterpart to MonthSelector, and styled to match it, so a page that steps
 * through days reads like one that steps through months.
 *
 * Value/onChange use "YYYY-MM-DD". The future is capped at today — these controls sit over
 * records of what happened, and there is nothing to show past that.
 */
export function DaySelector({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const now = today()

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button onClick={() => onChange(shiftDay(value, -1))} aria-label="Previous day" className={stepBtn}>
        {chevron('left')}
      </button>

      <input
        type="date"
        value={value}
        max={now}
        onChange={(e) => { if (e.target.value) onChange(e.target.value) }}
        className="glass-input min-w-0 flex-1 rounded-xl border border-white/70 px-3 py-2 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 sm:flex-none"
      />

      <button
        onClick={() => onChange(shiftDay(value, 1))}
        disabled={value >= now}
        aria-label="Next day"
        className={stepBtn}
      >
        {chevron('right')}
      </button>

      <button
        onClick={() => onChange(now)}
        disabled={value === now}
        className={cx(stepBtn, 'w-auto px-3 text-xs font-semibold')}
      >
        Today
      </button>
    </div>
  )
}
