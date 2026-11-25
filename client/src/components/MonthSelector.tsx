import { useEffect, useRef, useState } from 'react'
import { CalendarGlyph, DATE_PILL, PillChevron } from './DateRange'
import { cx } from './ui'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/** Current month as "YYYY-MM" (local). */
// eslint-disable-next-line react-refresh/only-export-components
export function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Shift a "YYYY-MM" value by n months. */
// eslint-disable-next-line react-refresh/only-export-components
export function shiftMonth(value: string, n: number): string {
  const [y, m] = value.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** "2026-03" -> "March 2026". */
// eslint-disable-next-line react-refresh/only-export-components
export function formatMonth(value: string): string {
  const [y, m] = value.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

const chevron = (dir: 'left' | 'right') => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points={dir === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
  </svg>
)

/** "2026-03" -> "2026-03-01 ~ 2026-03-31": the month as the app-wide date pill writes a range. */
// eslint-disable-next-line react-refresh/only-export-components
export function formatMonthRange(value: string): string {
  const [y, m] = value.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const mm = String(m).padStart(2, '0')
  return `${y}-${mm}-01 ~ ${y}-${mm}-${String(last).padStart(2, '0')}`
}

const stepBtn = 'flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#0a0e17] text-slate-300 transition-colors hover:border-white/20 hover:text-slate-100'

/**
 * Month picker: prev/next chevrons around a label that opens a year-stepper +
 * 12-month grid popover. Value/onChange use the "YYYY-MM" format.
 */
export function MonthSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  // Year shown in the popover. null = follow the selected value's year, so the grid
  // opens on the current selection; the stepper below sets an explicit override.
  const [yearOverride, setYearOverride] = useState<number | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const selYear = Number(value.split('-')[0])
  const selMonth = Number(value.split('-')[1])
  const pickYear = yearOverride ?? selYear

  // Closing drops the override so the next open starts from the selection again.
  const close = () => { setOpen(false); setYearOverride(null) }

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={wrapRef} className="relative flex flex-wrap items-center gap-1.5">
      <button onClick={() => onChange(shiftMonth(value, -1))} aria-label="Previous month" className={stepBtn}>
        {chevron('left')}
      </button>

      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={formatMonth(value)}
        className={cx(DATE_PILL, 'min-w-0 flex-1 sm:flex-none')}
      >
        <CalendarGlyph />
        <span className="whitespace-nowrap">{formatMonthRange(value)}</span>
        <PillChevron open={open} />
      </button>

      <button onClick={() => onChange(shiftMonth(value, 1))} aria-label="Next month" className={stepBtn}>
        {chevron('right')}
      </button>

      {open && (
        <div className="glass-strong absolute right-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-white/10 p-3 shadow-2xl shadow-slate-900/20">
          {/* Year stepper */}
          <div className="mb-3 flex items-center justify-between">
            <button onClick={() => setYearOverride(pickYear - 1)} aria-label="Previous year"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-slate-100">
              {chevron('left')}
            </button>
            <span className="text-sm font-semibold text-slate-100">{pickYear}</span>
            <button onClick={() => setYearOverride(pickYear + 1)} aria-label="Next year"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-slate-100">
              {chevron('right')}
            </button>
          </div>

          {/* Month grid */}
          <div className="grid grid-cols-3 gap-1.5">
            {MONTHS_SHORT.map((label, i) => {
              const active = pickYear === selYear && i + 1 === selMonth
              return (
                <button
                  key={label}
                  onClick={() => {
                    onChange(`${pickYear}-${String(i + 1).padStart(2, '0')}`)
                    close()
                  }}
                  className={cx(
                    'rounded-lg py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-brand text-white shadow-lg shadow-slate-900/25'
                      : 'text-slate-200 hover:bg-white/[0.05]',
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
