import { useRef } from 'react'
import { today } from '../lib/format'
import { CalendarGlyph, DATE_PILL, PillChevron } from './DateRange'
import { cx } from './ui'

const chevron = (dir: 'left' | 'right') => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points={dir === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
  </svg>
)

const stepBtn =
  'flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#0a0e17] text-slate-300 '
  + 'transition-colors hover:border-white/20 hover:text-slate-100 disabled:text-slate-500 disabled:hover:border-white/10'

/** Shift a "YYYY-MM-DD" value by n days, using local parts so it never skips a day. */
function shiftDay(value: string, n: number): string {
  const d = new Date(`${value}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * One day as the app-wide date pill (calendar glyph, "YYYY-MM-DD", chevron). The native
 * date picker sits behind it, so the browser's calendar still does the picking.
 */
export function DayField({ value, onChange, max, label = 'Day', className }: {
  value: string
  onChange: (iso: string) => void
  max?: string
  label?: string
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const openPicker = () => {
    const el = inputRef.current
    if (!el) return
    // showPicker needs a user gesture, which the click is; older browsers fall back to focus.
    if (typeof el.showPicker === 'function') { try { el.showPicker(); return } catch { /* fall through */ } }
    el.focus()
  }
  return (
    <div className={cx('relative', className)}>
      <button type="button" onClick={openPicker} aria-label={label} className={cx(DATE_PILL, 'w-full')}>
        <CalendarGlyph />
        <span className="whitespace-nowrap">{value || 'Select day'}</span>
        <PillChevron open={false} className="ml-auto" />
      </button>
      <input
        ref={inputRef}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={value}
        max={max}
        onChange={(e) => { if (e.target.value) onChange(e.target.value) }}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      />
    </div>
  )
}

/**
 * Day picker: prev/next chevrons around a date pill, plus a Today shortcut. The
 * day-scale counterpart to MonthSelector, and styled to match it, so a page that steps
 * through days reads like one that steps through months.
 *
 * Value/onChange use "YYYY-MM-DD". The future is capped at today — these controls sit over
 * records of what happened, and there is nothing to show past that.
 *
 * Which "today" that is can be passed in. A page over records kept in a particular
 * timezone has to cap at THAT day, not the browser's, or a viewer a few hours ahead is
 * offered a day the records have not reached yet.
 */
export function DaySelector({ value, onChange, today: todayIso }: {
  value: string
  onChange: (iso: string) => void
  /** Today as the data reckons it. Defaults to the browser's local day. */
  today?: string
}) {
  const now = todayIso ?? today()

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button onClick={() => onChange(shiftDay(value, -1))} aria-label="Previous day" className={stepBtn}>
        {chevron('left')}
      </button>

      <DayField value={value} onChange={onChange} max={now} className="min-w-0 flex-1 sm:flex-none" />

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
