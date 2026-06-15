import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { daysAgo, today } from '../lib/format'
import { Button, cx } from './ui'

export interface Range {
  from: string
  to: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function isBetween(d: Date, from: Date, to: Date) { return d > from && d < to }
function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate() }
function firstDayOfMonth(y: number, m: number) { return (new Date(y, m, 1).getDay() + 6) % 7 }
function toDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS   = ['MON','TUE','WED','THU','FRI','SAT','SUN']

const PRESETS = [
  { label: 'Today',        range: (): Range => ({ from: today(), to: today() }) },
  { label: 'Yesterday',    range: (): Range => { const d = daysAgo(1); return { from: d, to: d } } },
  { label: 'Last 7 days',  range: (): Range => ({ from: daysAgo(6),  to: today() }) },
  { label: 'Last 30 days', range: (): Range => ({ from: daysAgo(29), to: today() }) },
  { label: 'Last 90 days', range: (): Range => ({ from: daysAgo(89), to: today() }) },
  { label: 'This month',   range: (): Range => ({ from: `${today().slice(0,7)}-01`, to: today() }) },
]

// ─── Calendar ─────────────────────────────────────────────────────────────────

function Calendar({ year, month, selecting, from, to, hover, onDayClick, onDayHover, onPrev, onNext }: {
  year: number; month: number; selecting: 'from' | 'to'
  from: string; to: string; hover: string
  onDayClick: (iso: string) => void; onDayHover: (iso: string) => void
  onPrev: () => void; onNext: () => void
}) {
  const fromD  = from  ? toDate(from)  : null
  const toD    = to    ? toDate(to)    : null
  const hoverD = hover ? toDate(hover) : null
  const todayD = toDate(today())
  const first   = firstDayOfMonth(year, month)
  const numDays = daysInMonth(year, month)
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: numDays }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="select-none">
      {/* Month nav */}
      <div className="mb-3 flex items-center justify-between">
        <button onClick={onPrev} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="text-sm font-semibold text-slate-800">{MONTHS[month]} {year}</span>
        <button onClick={onNext} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      {/* Day headers */}
      <div className="mb-1 grid grid-cols-7 text-center">
        {DAYS.map((d) => <div key={d} className="py-1 text-[10px] font-semibold tracking-wide text-slate-400">{d}</div>)}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {cells.map((day, idx) => {
          if (!day) return <div key={idx} />
          const iso = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const d   = new Date(year, month, day)
          const isFrom  = fromD && sameDay(d, fromD)
          const isTo    = toD   && sameDay(d, toD)
          const isToday = sameDay(d, todayD)
          let inRange = false
          if (fromD && toD) inRange = isBetween(d, fromD, toD)
          else if (fromD && hoverD && selecting === 'to') inRange = isBetween(d, fromD, hoverD)
          return (
            <button key={idx} onClick={() => onDayClick(iso)} onMouseEnter={() => onDayHover(iso)}
              className={cx(
                'flex h-9 w-full items-center justify-center text-sm transition-colors',
                inRange  && 'bg-blue-50 text-blue-700',
                isFrom   && 'rounded-l-full bg-blue-600 text-white hover:bg-blue-700',
                isTo     && 'rounded-r-full bg-blue-600 text-white hover:bg-blue-700',
                isFrom && isTo && 'rounded-full',
                !isFrom && !isTo && !inRange && 'rounded-full text-slate-700 hover:bg-slate-100',
                isToday && !isFrom && !isTo && 'font-bold text-blue-600',
              )}>
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── DateRangeControl ─────────────────────────────────────────────────────────

export function DateRangeControl({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const [open,        setOpen]        = useState(false)
  const [draft,       setDraft]       = useState<Range>(value)
  const [selecting,   setSelecting]   = useState<'from' | 'to'>('from')
  const [hover,       setHover]       = useState('')
  const [dropPos,     setDropPos]     = useState({ top: 0, left: 0 })
  const [presetOpen,  setPresetOpen]  = useState(false)

  const wrapRef    = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())

  useEffect(() => { setDraft(value) }, [value.from, value.to])

  useLayoutEffect(() => {
    if (open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setDropPos({ top: r.bottom + window.scrollY + 6, left: r.left + window.scrollX })
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (wrapRef.current?.contains(target)) return
      const portal = document.querySelector('[data-datepicker]')
      if (portal?.contains(target)) return
      setOpen(false)
      setPresetOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleDayClick = (iso: string) => {
    if (selecting === 'from') {
      setDraft({ from: iso, to: '' })
      setSelecting('to')
    } else {
      if (draft.from && iso < draft.from) setDraft({ from: iso, to: draft.from })
      else setDraft((d) => ({ ...d, to: iso }))
      setSelecting('from')
    }
  }

  const handlePreset = (range: Range) => {
    setDraft(range)
    setSelecting('from')
    setPresetOpen(false)
  }

  const handleApply = () => {
    onChange({ from: draft.from || today(), to: draft.to || draft.from || today() })
    setOpen(false)
    setPresetOpen(false)
  }

  const handleCancel = () => {
    setDraft(value)
    setSelecting('from')
    setOpen(false)
    setPresetOpen(false)
  }

  // Determine active preset label for the dropdown button
  const activePreset = PRESETS.find((p) => {
    const r = p.range()
    return r.from === draft.from && r.to === draft.to
  })

  const triggerLabel = value.from
    ? `${value.from} ~ ${value.to || value.from}`
    : 'Select date range'

  const dropdown = (
    <div
      data-datepicker
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      style={{ position: 'absolute', top: dropPos.top, left: dropPos.left, width: 320, zIndex: 9999 }}
    >
      <div className="p-4">
        {/* Presets dropdown */}
        <div className="relative mb-4">
          <button
            onClick={() => setPresetOpen((o) => !o)}
            className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <span>{activePreset?.label ?? 'Custom range'}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className={cx('transition-transform', presetOpen && 'rotate-180')}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          {presetOpen && (
            <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              {PRESETS.map((p) => {
                const r = p.range()
                const active = r.from === draft.from && r.to === draft.to
                return (
                  <button key={p.label} onClick={() => handlePreset(r)}
                    className={cx(
                      'w-full px-3 py-2 text-left text-sm transition-colors',
                      active ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-50',
                    )}>
                    {p.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Calendar */}
        <Calendar
          year={year} month={month} selecting={selecting}
          from={draft.from} to={draft.to} hover={hover}
          onDayClick={handleDayClick} onDayHover={setHover}
          onPrev={() => { if (month === 0) { setMonth(11); setYear(y => y - 1) } else setMonth(m => m - 1) }}
          onNext={() => { if (month === 11) { setMonth(0);  setYear(y => y + 1) } else setMonth(m => m + 1) }}
        />

        {/* Footer */}
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
          <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
          <Button onClick={handleApply} disabled={!draft.from}>Apply</Button>
        </div>
      </div>
    </div>
  )

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        onClick={() => { setDraft(value); setOpen((o) => !o) }}
        className="glass-input flex items-center gap-2 rounded-xl border border-white/70 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-white/70"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
        </svg>
        {triggerLabel}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={cx('transition-transform', open && 'rotate-180')}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && createPortal(dropdown, document.body)}
    </div>
  )
}

// ─── Standalone filter pair ───────────────────────────────────────────────────

export function DateRangeFilter({ from, to, onFromChange, onToChange }: {
  from: string; to: string; onFromChange: (iso: string) => void; onToChange: (iso: string) => void
}) {
  return (
    <DateRangeControl
      value={{ from, to }}
      onChange={(r) => { onFromChange(r.from); onToChange(r.to) }}
    />
  )
}

// ─── Download button ──────────────────────────────────────────────────────────

export function DownloadButton({ href, filename, children }: { href: string; filename?: string; children: React.ReactNode }) {
  return (
    <a href={href} download={filename ?? ''}>
      <Button variant="secondary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
        </svg>
        {children}
      </Button>
    </a>
  )
}