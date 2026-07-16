import { useEffect, useRef, useState } from 'react'
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
function shiftMonth(value: string, n: number): string {
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

const stepBtn = 'glass-input flex h-9 w-9 items-center justify-center rounded-lg border border-white/70 text-slate-600 transition-colors hover:bg-white/80 hover:text-slate-900'

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
    <div ref={wrapRef} className="relative flex items-center gap-1.5">
      <button onClick={() => onChange(shiftMonth(value, -1))} aria-label="Previous month" className={stepBtn}>
        {chevron('left')}
      </button>

      <button
        onClick={() => (open ? close() : setOpen(true))}
        className="glass-input flex min-w-44 items-center justify-center gap-2 rounded-xl border border-white/70 px-3 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-white/80"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-slate-400">
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        {formatMonth(value)}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          className={cx('text-slate-400 transition-transform', open && 'rotate-180')}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <button onClick={() => onChange(shiftMonth(value, 1))} aria-label="Next month" className={stepBtn}>
        {chevron('right')}
      </button>

      {open && (
        <div className="glass-strong absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-white/50 p-3 shadow-2xl shadow-slate-900/20">
          {/* Year stepper */}
          <div className="mb-3 flex items-center justify-between">
            <button onClick={() => setYearOverride(pickYear - 1)} aria-label="Previous year"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/60 hover:text-slate-900">
              {chevron('left')}
            </button>
            <span className="text-sm font-semibold text-slate-900">{pickYear}</span>
            <button onClick={() => setYearOverride(pickYear + 1)} aria-label="Next year"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/60 hover:text-slate-900">
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
                      ? 'bg-linear-to-b from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-600/25'
                      : 'text-slate-700 hover:bg-white/60',
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
