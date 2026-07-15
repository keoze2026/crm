import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/** Current month as "YYYY-MM" (local). */
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
export function formatMonth(value: string): string {
  const [y, m] = value.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

const chevron = (dir: 'left' | 'right') => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points={dir === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
  </svg>
)

/**
 * Month picker: prev/next chevrons around a label that opens a year-stepper +
 * 12-month grid popover. Value/onChange use the "YYYY-MM" format.
 */
export function MonthSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [pickYear, setPickYear] = useState(() => Number(value.split('-')[0]))
  const wrapRef = useRef<HTMLDivElement>(null)

  const selYear = Number(value.split('-')[0])
  const selMonth = Number(value.split('-')[1])

  useEffect(() => { if (open) setPickYear(selYear) }, [open, selYear])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={wrapRef} className="relative flex items-center gap-1">
      <button
        onClick={() => onChange(shiftMonth(value, -1))}
        aria-label="Previous month"
        className="flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {chevron('left')}
      </button>

      <button
        onClick={() => setOpen((o) => !o)}
        className="flex min-w-40 items-center justify-center gap-2 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent/50"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        {formatMonth(value)}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={cn('transition-transform', open && 'rotate-180')}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <button
        onClick={() => onChange(shiftMonth(value, 1))}
        aria-label="Next month"
        className="flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {chevron('right')}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-2xl">
          {/* Year stepper */}
          <div className="mb-3 flex items-center justify-between">
            <button onClick={() => setPickYear((y) => y - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
              {chevron('left')}
            </button>
            <span className="text-sm font-semibold text-foreground">{pickYear}</span>
            <button onClick={() => setPickYear((y) => y + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
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
                    setOpen(false)
                  }}
                  className={cn(
                    'rounded-lg py-2 text-sm font-medium transition-colors',
                    active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-accent',
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
