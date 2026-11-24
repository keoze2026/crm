// Dashboard — management overview of leads, revenue, margin and the team's day.
//
// Built to the Keoze dark dashboard design (Keoze-CRM-Dashboard.pdf). One column that reads
// top to bottom as a story about the money:
//
//   header           → "Overview" chip, title, the range written out with its length,
//                      jump buttons (Expenses, Buyers) and the "Updated" time
//   KPI cards        → Revenue · Expenses · Profit · Counted leads on a traffic-spend basis,
//                      each against the previous period of the same length
//   what changed     → one sentence on why the margin moved, then every metric side by side
//   revenue by day   → a table of buckets with a bar against the peak, beside
//   where it went    → revenue split into traffic, salary, portal, misc and profit (the last
//                      three typed in here), and the lead mix
//   ranking          → buyers / by price / campaigns: top five, bottom five, middle folded
//   period + team    → the date range, day grouping and exports, beside Team today
//
// Palette: near-black page, dark panels with hairline borders, one bright blue accent,
// green only for profit and good news, red only for something bad. Figures are monospace.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { DateRangeControl, type Range } from '../components/DateRange'
import { StaffDashboard } from '../components/StaffDashboard'
import { cx } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { isLateLogin, labelOf } from '../lib/attendanceReports'
import {
  BUCKET_UNIT,
  barLabel,
  bucketCount,
  bucketLabel,
  groupByPrice,
  parseAmount,
  parseRankCsv,
  roundingDrift,
  type ImportedRow,
  shareLabel,
  shareOf,
  splitEnds,
  unitEconomics,
  whatChanged,
  type Granularity,
} from '../lib/dashboard'
import {
  fileDateRange,
  formatPeriod,
  formatRangeLong,
  money,
  num,
  previousPeriod,
  rangeDays,
  todayRange,
} from '../lib/format'
import { ORG_TZ } from '../lib/staff'
import { useAsync } from '../lib/useAsync'
import { useOrgToday } from '../lib/useOrgToday'
import type { AttendanceDay, LeaveDay, Summary } from '../types'

/** How deep the buyer/campaign rankings are fetched — the API's own ceiling. */
const RANK_LIMIT = 500

const GRANULARITIES: { value: Granularity; label: string; title: string }[] = [
  { value: 'day', label: '1D', title: 'Daily' },
  { value: '4day', label: '4D', title: 'Every 4 days' },
  { value: 'week', label: '1W', title: 'Weekly' },
]

/** Whether a rising number is good news for this metric (expenses and cost are where it isn't). */
type Tone = 'up-good' | 'down-good'

// ─── Shared class strings ─────────────────────────────────────────────────────

/** Small caps label: KPI names, table headings. */
const CAPS = 'font-figures text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500'
const TITLE = 'text-[15px] font-semibold text-slate-50'
const SUBTITLE = 'mt-0.5 text-xs text-slate-400'
const HAIRLINE = 'border-white/[0.06]'
const LINK = 'font-semibold text-blue-400 hover:text-blue-300 hover:underline'
const BTN_BASE = 'inline-flex items-center justify-center rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const BTN = `${BTN_BASE} border-white/10 bg-white/[0.03] text-slate-200 hover:border-white/20 hover:bg-white/[0.06]`
/** The one filled button: Copy CSV. */
const BTN_PRIMARY = `${BTN_BASE} border-blue-500/70 bg-blue-600/25 text-white hover:border-blue-400 hover:bg-blue-600/35`

// ─── Formatting helpers ───────────────────────────────────────────────────────

/** % change with the same "no baseline → null" rule the API uses, to one decimal. */
function changePct(prev: number | null | undefined, curr: number | null | undefined): number | null {
  if (prev === undefined || prev === null || curr === undefined || curr === null) return null
  if (prev === 0) return curr === 0 ? 0 : null
  return Number((((curr - prev) / Math.abs(prev)) * 100).toFixed(1))
}

/** "previous 23 days" / "previous day" — the comparison window always matches the range. */
function previousLabel(days: number): string {
  return days <= 1 ? 'previous day' : `previous ${num(days)} days`
}

/** Money with a real minus sign, for outflows and losses. */
const signedMoney = (v: number) => `${v < 0 ? '−' : ''}${money(Math.abs(v))}`

const pctText = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`)

const timeLabel = (d: Date) =>
  d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

/** Hour of a UTC timestamp in the org's clock, as "9 AM" and as a sortable 0–23 key. */
function orgHour(iso: string): { key: number; label: string } {
  const d = new Date(iso)
  const key = Number(new Intl.DateTimeFormat('en-US', { timeZone: ORG_TZ, hour: '2-digit', hour12: false }).format(d)) % 24
  const label = new Intl.DateTimeFormat('en-US', { timeZone: ORG_TZ, hour: 'numeric', hour12: true }).format(d)
  return { key, label }
}

/** "Jane Doe" → "JD"; a handle or id falls back to its first two characters. */
function initials(name: string): string {
  const words = name.replace(/^@/, '').trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return name.replace(/^@/, '').slice(0, 2).toUpperCase()
}

/** "Sep 25 – Sep 30", or one date when both ends agree. */
function spanLabel(first?: string | null, last?: string | null): string {
  if (!first || !last) return '—'
  return first === last ? formatPeriod(first) : `${formatPeriod(first)} – ${formatPeriod(last)}`
}

const toCsv = (rows: (string | number)[][]) => {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(esc).join(',')).join('\n')
}

/** Client-side CSV download — the fallback when the clipboard can't be written. */
function downloadCsv(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const svg = (children: ReactNode, size = 14) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
    {children}
  </svg>
)

const IconRefresh = () => svg(<><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></>)
const IconAlert = () => svg(<><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" /></>, 16)
const IconSearch = () => svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>, 13)

// ─── Small building blocks ────────────────────────────────────────────────────

/**
 * Dark panel with a hairline border. `accent` is the blue-edged highlight (the Profit card).
 * `dim` fades it while a refresh is in flight, so stale numbers never pass for fresh ones.
 */
function Panel({ children, className, dim, accent, id }: { children: ReactNode; className?: string; dim?: boolean; accent?: boolean; id?: string }) {
  return (
    <section
      id={id}
      aria-busy={dim || undefined}
      className={cx(
        'scroll-mt-4 rounded-xl border transition-opacity duration-200 motion-reduce:transition-none',
        accent ? 'border-blue-500/50 bg-linear-to-b from-blue-500/[0.14] to-[#0a0e17] shadow-[0_0_0_1px_rgba(59,130,246,0.08)]' : 'border-white/[0.07] bg-[#0a0e17]',
        dim && 'opacity-60',
        className,
      )}
    >
      {children}
    </section>
  )
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-white/[0.06] motion-reduce:animate-none', className)} />
}

/**
 * "▼ 20.9%" — the glyph follows the raw sign, the colour follows whether that movement is
 * good for the metric. `fixed` always prints one decimal (tables); otherwise "21%" drops it.
 */
function DeltaPill({ value, tone, unit = '%', fixed, suffix }: { value: number | null | undefined; tone: Tone; unit?: string; fixed?: boolean; suffix?: string }) {
  if (value === undefined || value === null) return <span className="font-figures text-[11px] text-slate-600">—</span>
  const good = value === 0 ? null : tone === 'up-good' ? value > 0 : value < 0
  const abs = Math.abs(value)
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 font-figures text-[10px] font-semibold tabular-nums',
        good === null ? 'bg-white/[0.06] text-slate-300' : good ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400',
      )}
    >
      {value === 0 ? '±' : value > 0 ? '▲' : '▼'} {fixed ? abs.toFixed(1) : num(abs)}{unit}{suffix && ` ${suffix}`}
    </span>
  )
}

function EmptyHint({ message, className }: { message: string; className?: string }) {
  return (
    <div className={cx('flex h-full flex-col items-center justify-center gap-1.5 py-8 text-center', className)}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-slate-600" aria-hidden>
        <path d="M3 3v18h18" /><path d="m7 15 3.5-3.5 3 3L21 7" />
      </svg>
      <p className="max-w-[32ch] text-xs text-slate-500">{message}</p>
    </div>
  )
}

/** A thin track with a fill — share bars and "vs peak" bars. Red marks something bad. */
function Meter({ pct, bad, className }: { pct: number; bad?: boolean; className?: string }) {
  return (
    <span className={cx('block h-1.5 overflow-hidden rounded-full bg-white/[0.05]', className)}>
      <span
        className={cx('block h-full rounded-full', bad ? 'bg-red-500' : 'bg-blue-500')}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, minWidth: pct > 0 ? 6 : 0 }}
      />
    </span>
  )
}

/** Grey segmented tabs with a blue active segment. */
function Segmented<T extends string>({ tabs, value, onChange, label }: {
  tabs: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
  label: string
}) {
  return (
    <div className="flex w-fit max-w-full rounded-lg border border-white/[0.08] bg-[#05070c] p-0.5" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'rounded-md px-3 py-1 text-xs font-medium transition-colors',
            value === t.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-100',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ─── KPI cards ────────────────────────────────────────────────────────────────

/**
 * Small caps label (its definition on hover), the figure in full, one line that explains it,
 * then — under a hairline — the previous period's figure and the change.
 */
function KpiCard({ label, info, value, valueClass, sub, prev, delta, tone, accent, loading, dim }: {
  label: string
  info: string
  value: string
  valueClass?: string
  sub: ReactNode
  /** "Prev. 23 days $1,333,562.00", or why there is no comparison. */
  prev: string
  delta: number | null
  tone: Tone
  accent?: boolean
  loading: boolean
  dim?: boolean
}) {
  return (
    <Panel className="flex flex-col p-4" dim={dim} accent={accent}>
      <span className={cx(CAPS, 'cursor-help text-slate-400')} title={info}>{label}</span>
      {loading ? (
        <>
          <Skeleton className="mt-2.5 h-7 w-40" />
          <Skeleton className="mt-2 h-3 w-36" />
        </>
      ) : (
        <>
          <div className={cx('mt-2 font-figures text-[22px] font-semibold leading-tight tracking-tight tabular-nums sm:text-2xl', valueClass ?? 'text-slate-50')}>{value}</div>
          <div className="mt-1 text-[11px] text-slate-400">{sub}</div>
        </>
      )}
      <div className={cx('mt-auto pt-3')}>
        <div className={cx('flex items-center justify-between gap-2 border-t pt-2.5', HAIRLINE)}>
          {loading ? <Skeleton className="h-3 w-40" /> : <span className="min-w-0 truncate font-figures text-[10px] text-slate-500">{prev}</span>}
          {!loading && <DeltaPill value={delta} tone={tone} />}
        </div>
      </div>
    </Panel>
  )
}

// ─── What changed ─────────────────────────────────────────────────────────────

interface ChangeRow {
  label: string
  curr: string
  prev: string
  delta: number | null
  tone: Tone
  unit?: string
  bad?: boolean
}

function WhatChangedCard({ sentence, rows, basisLabel, prevLabel, loading, dim }: {
  sentence: string
  rows: ChangeRow[]
  basisLabel: string
  prevLabel: string
  loading: boolean
  dim: boolean
}) {
  return (
    <Panel className="p-4" dim={dim}>
      <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="min-w-0">
          <h2 className={TITLE}>What changed</h2>
          {loading ? <Skeleton className="mt-2 h-4 w-96 max-w-full" /> : <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-slate-300">{sentence}</p>}
        </div>
        <p className="shrink-0 font-figures text-[10px] text-slate-500 md:pt-1">{basisLabel}</p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="table-dash w-full min-w-[36rem] border-collapse text-left">
          <thead>
            <tr className={cx('border-b', HAIRLINE)}>
              <th className={CAPS}>Metric</th>
              <th className={cx(CAPS, 'text-right')}>This period</th>
              <th className={cx(CAPS, 'text-right')}>{prevLabel}</th>
              <th className={cx(CAPS, 'text-right')}>Change</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? [0, 1, 2, 3].map((i) => (
                  <tr key={i}><td colSpan={4}><Skeleton className="h-5" /></td></tr>
                ))
              : rows.map((r) => (
                  <tr key={r.label} className={cx('border-b last:border-b-0', HAIRLINE)}>
                    <td className="text-[13px] text-slate-300">{r.label}</td>
                    <td className={cx('text-right font-figures text-[13px] font-semibold tabular-nums', r.bad ? 'text-red-400' : 'text-slate-50')}>{r.curr}</td>
                    <td className="text-right font-figures text-[13px] tabular-nums text-slate-400">{r.prev}</td>
                    <td className="text-right"><DeltaPill value={r.delta} tone={r.tone} unit={r.unit} fixed /></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

// ─── Revenue by day ───────────────────────────────────────────────────────────

/**
 * Revenue per bucket as a table: only buckets with revenue are listed (the caption says how
 * many of the range's buckets that is), each with a bar measured against the peak. The peak
 * is printed in full; the rest are rounded to $1K with a "~" (hover for the exact figure), and
 * the footnote says how far the printed figures drift from the total. A bucket under a tenth
 * of the peak gets a red bar — an outlier worth a look.
 */
function RevenueByDayCard({ points, granularity, range, total, delta, prevLabel, loading, dim }: {
  points: { period: string; revenue: number }[]
  granularity: Granularity
  range: Range
  total: number
  delta: number | null
  prevLabel: string
  loading: boolean
  dim: boolean
}) {
  const rows = useMemo(() => points.filter((p) => p.revenue !== 0), [points])
  const peakIdx = useMemo(() => rows.reduce((best, d, i) => (d.revenue > rows[best].revenue ? i : best), 0), [rows])
  const peak = rows[peakIdx]
  const buckets = bucketCount(range.from, range.to, granularity)
  const unit = BUCKET_UNIT[granularity]
  const prevShort = prevLabel.replace('previous', 'prev.')
  const drift = roundingDrift(rows.map((r) => r.revenue), peakIdx, total)
  const driftK = Math.max(1, Math.ceil(drift / 1000))

  const caption = rows.length === 0
    ? 'No revenue in this period'
    : `Revenue landed on ${num(rows.length)} of ${num(buckets)} ${buckets === 1 ? unit.one : unit.many}` +
      (peak && rows.length > 1 ? ` · peak ${money(peak.revenue)} on ${granularity === 'week' ? 'week of ' : ''}${formatPeriod(peak.period)}` : '')

  return (
    <Panel className="flex h-full flex-col p-4" dim={dim}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className={TITLE}>Revenue {unit.title}</h2>
          <p className={SUBTITLE}>{loading ? ' ' : caption}</p>
        </div>
        {!loading && delta !== null && <DeltaPill value={delta} tone="up-good" suffix={`vs ${prevShort}`} />}
      </div>

      <div className="mt-3 max-h-[30rem] min-h-0 flex-1 overflow-y-auto lg:max-h-none">
        {loading ? (
          <div className="space-y-2 pt-1">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-7" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyHint message="No revenue was recorded in this period. Try a wider date range." />
        ) : (
          <table className="table-dash w-full border-collapse text-left">
            <thead className="sticky top-0 z-[1] bg-[#0a0e17]">
              <tr className={cx('border-b', HAIRLINE)}>
                <th className={CAPS}>{granularity === 'day' ? 'Date' : 'Period'}</th>
                <th className={cx(CAPS, 'text-right')}>Revenue</th>
                <th className={cx(CAPS, 'w-[42%]')}>vs peak</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isPeak = i === peakIdx
                const pct = peak && peak.revenue > 0 ? (r.revenue / peak.revenue) * 100 : 0
                return (
                  <tr key={r.period} className={cx('border-b', HAIRLINE)}>
                    <td className="whitespace-nowrap">
                      <span className={cx('text-[13px]', isPeak ? 'font-semibold text-slate-50' : 'text-slate-300')}>{bucketLabel(r.period, granularity)}</span>
                      {isPeak && rows.length > 1 && <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">Peak</span>}
                    </td>
                    <td
                      className={cx('whitespace-nowrap text-right font-figures text-[13px] tabular-nums', isPeak ? 'font-semibold text-slate-50' : 'text-slate-200', r.revenue < 0 && 'text-red-400')}
                      title={isPeak ? undefined : signedMoney(r.revenue)}
                    >
                      {isPeak ? signedMoney(r.revenue) : barLabel(r.revenue, 'money', false)}
                    </td>
                    <td><Meter pct={pct} bad={rows.length > 2 && pct < 10} /></td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-[1] bg-[#0a0e17]">
              <tr className="bg-blue-500/[0.1] shadow-[inset_0_1px_0_rgba(59,130,246,0.3)]">
                <td className="text-[13px] font-semibold text-slate-50">Total billed</td>
                <td className="whitespace-nowrap text-right font-figures text-[13px] font-semibold tabular-nums text-slate-50">{money(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {!loading && rows.length > 1 && (
        <p className="mt-2.5 text-[11px] text-slate-500">
          Figures marked ~ are rounded to $1K, so the {unit.many.replace('4-day periods', 'periods')} add up to within {drift < 1000 ? '$1K' : `about $${driftK}K`} of the total.
        </p>
      )}
    </Panel>
  )
}

// ─── Where the revenue went ───────────────────────────────────────────────────

type ExtraKey = 'salary' | 'portal' | 'misc'
type Extras = Partial<Record<ExtraKey, string>>

/** The typed expenses, per date range, kept in this browser. */
const EXTRAS_STORE = 'dashboard.extraExpenses.v1'

function readExtrasStore(): Record<string, Extras> {
  try {
    const v = JSON.parse(localStorage.getItem(EXTRAS_STORE) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

const EXTRA_LINES: { key: ExtraKey; label: string; sub: string; color: string }[] = [
  { key: 'salary', label: 'Salary expenses', sub: 'Team pay for the period', color: '#8b5cf6' },
  { key: 'portal', label: 'Portal expenses', sub: 'Portal and tool costs', color: '#0ea5e9' },
  { key: 'misc', label: 'Miscellaneous expenses', sub: 'Everything else', color: '#eab308' },
]
const TRAFFIC_COLOR = '#64748b'
const PROFIT_COLOR = '#3b82f6'

function AmountInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const bad = parseAmount(value) === null
  return (
    <input
      type="text"
      inputMode="decimal"
      value={value}
      placeholder="0.00"
      aria-label={label}
      aria-invalid={bad || undefined}
      title={bad ? 'Enter an amount, like 1250.50' : 'Saved in this browser for this period'}
      onChange={(e) => onChange(e.target.value)}
      // Whole amounts are written out with cents once the field is left.
      onBlur={() => {
        const n = parseAmount(value)
        if (n !== null && value.trim() !== '') onChange(n.toFixed(2))
      }}
      className={cx(
        'w-28 rounded-md border bg-[#05070c] px-2 py-1 text-right font-figures text-[12px] tabular-nums text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2',
        bad ? 'border-red-500/70 focus:ring-red-500/30' : 'border-white/10 focus:border-blue-500 focus:ring-blue-500/25',
      )}
    />
  )
}

/**
 * Every billed dollar split into what it paid for. Traffic spend comes from the sheets; the
 * salary, portal and miscellaneous lines are typed here (portal starts at what the Portal
 * Expenses page charges to the range), and the profit line is what is left — true profit.
 */
function RevenueFlowCard({ summary, extras, setExtra, loading, dim }: {
  summary: Summary | null
  extras: Extras
  setExtra: (k: ExtraKey, v: string) => void
  loading: boolean
  dim: boolean
}) {
  const s = summary
  if (loading || !s) {
    return (
      <Panel className="p-4" dim={dim} id="dash-flow">
        <h2 className={TITLE}>Where the revenue went</h2>
        <Skeleton className="mt-3 h-2" />
        <div className="mt-4 space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8" />)}</div>
      </Panel>
    )
  }
  const rev = s.revenue
  const traffic = s.cost
  const value = (k: ExtraKey) => extras[k] ?? (k === 'portal' && (s.portal_expenses ?? 0) > 0 ? (s.portal_expenses ?? 0).toFixed(2) : '')
  const amount = (k: ExtraKey) => parseAmount(value(k)) ?? 0
  const extraTotal = EXTRA_LINES.reduce((sum, l) => sum + amount(l.key), 0)
  const out = traffic + extraTotal
  const profit = rev - out
  const marginPct = rev !== 0 ? (profit / rev) * 100 : null
  const ofRev = (v: number) => (rev > 0 ? shareLabel((v / rev) * 100) : '—')
  const per = (v: number) => (s.counted > 0 ? signedMoney(v / s.counted) : '—')

  // The bar is drawn against revenue, or against the spend when the spend outgrew it.
  const whole = Math.max(rev, out)
  const segments = [
    { key: 'traffic', label: 'Traffic', value: traffic, color: TRAFFIC_COLOR },
    ...EXTRA_LINES.map((l) => ({ key: l.key, label: l.label.replace(' expenses', ''), value: amount(l.key), color: l.color })),
    { key: 'profit', label: 'Profit', value: Math.max(0, profit), color: PROFIT_COLOR },
  ].filter((x) => x.value > 0)

  return (
    <Panel className="p-4" dim={dim} id="dash-flow">
      <h2 className={TITLE}>Where the revenue went</h2>
      <p className={SUBTITLE}>Enter salary, portal and miscellaneous expenses to see true profit.</p>

      {rev === 0 && out === 0 ? (
        <EmptyHint message="Nothing was billed or spent in this period." />
      ) : (
        <>
          <div className="relative mt-3 flex h-2 gap-px overflow-hidden rounded-full bg-white/[0.05]" role="img" aria-label={segments.map((x) => `${x.label} ${ofRev(x.value)}`).join(', ')}>
            {segments.map((x) => (
              <div key={x.key} style={{ width: `${shareOf(x.value, whole)}%`, background: x.color }} title={`${x.label} ${money(x.value)}`} />
            ))}
            {profit < 0 && (
              // The stretch of spend that revenue did not cover — the loss, in red.
              <div className="absolute inset-y-0 right-0 bg-red-600" style={{ left: `${shareOf(rev, whole)}%` }} title={`Loss ${money(-profit)}`} />
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
            {segments.map((x) => (
              <span key={x.key} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: x.color }} aria-hidden />
                {x.label} <span className="font-figures text-slate-300">{ofRev(x.value)}</span>
              </span>
            ))}
            {profit < 0 && (
              <span className="inline-flex items-center gap-1.5 text-red-400">
                <span className="h-2 w-2 rounded-full bg-red-600" aria-hidden />
                Loss <span className="font-figures">{money(-profit)}</span>
              </span>
            )}
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="table-dash w-full min-w-[28rem] border-collapse text-left">
              <thead>
                <tr className={cx('border-b', HAIRLINE)}>
                  <th className={CAPS}>Line</th>
                  <th className={cx(CAPS, 'text-right')}>Amount</th>
                  <th className={cx(CAPS, 'text-right')}>Share</th>
                  <th className={cx(CAPS, 'text-right')}>Per lead</th>
                </tr>
              </thead>
              <tbody className="font-figures text-[13px] tabular-nums">
                <FlowRow label="Revenue billed" sub={`${num(s.active_buyers)} buyers · ${num(s.counted)} counted leads`} amount={money(rev)} share={rev > 0 ? '100%' : '—'} per={per(rev)} strong />
                <FlowRow label="Traffic source spend" amount={signedMoney(-traffic)} share={ofRev(traffic)} per={per(traffic)} />
                {EXTRA_LINES.map((l) => (
                  <FlowRow
                    key={l.key}
                    label={l.label}
                    sub={l.sub}
                    amount={<AmountInput label={l.label} value={value(l.key)} onChange={(v) => setExtra(l.key, v)} />}
                    share={ofRev(amount(l.key))}
                    per={per(amount(l.key))}
                  />
                ))}
                <FlowRow label="Total expenses" sub="Traffic + salary + portal + misc" amount={signedMoney(-out)} share={ofRev(out)} per={per(out)} strong />
              </tbody>
              <tfoot>
                <tr className={cx('font-figures text-[13px] font-semibold tabular-nums', profit < 0 ? 'bg-red-500/[0.08] text-red-400' : 'bg-blue-500/[0.08] text-emerald-400')}>
                  <td className="rounded-l-lg font-sans">
                    <div className="text-[13px] text-slate-50">{profit < 0 ? 'Loss' : 'Profit'}</div>
                    <div className="text-[11px] font-normal text-slate-400">{pctText(marginPct)} margin</div>
                  </td>
                  <td className="text-right">{signedMoney(profit)}</td>
                  <td className="text-right">{marginPct === null ? '—' : shareLabel(marginPct)}</td>
                  <td className="rounded-r-lg text-right">{per(profit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </Panel>
  )
}

function FlowRow({ label, sub, amount, share, per, strong }: { label: string; sub?: string; amount: ReactNode; share: string; per: string; strong?: boolean }) {
  return (
    <tr className={cx('border-b', HAIRLINE)}>
      <td className="font-sans">
        <div className={cx('text-[13px]', strong ? 'font-medium text-slate-50' : 'text-slate-200')}>{label}</div>
        {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
      </td>
      <td className={cx('whitespace-nowrap text-right', strong ? 'font-semibold text-slate-50' : 'text-slate-200')}>{amount}</td>
      <td className="whitespace-nowrap text-right text-slate-400">{share}</td>
      <td className="whitespace-nowrap text-right text-slate-300">{per}</td>
    </tr>
  )
}

// ─── Lead mix ─────────────────────────────────────────────────────────────────

function MixRow({ label, value, unit, valueClass }: { label: string; value: string; unit?: string; valueClass?: string }) {
  return (
    <div className={cx('flex items-baseline justify-between gap-3 border-b py-2.5 last:border-b-0', HAIRLINE)}>
      <span className="min-w-0 truncate text-[13px] text-slate-300">{label}</span>
      <span className="shrink-0">
        <span className={cx('font-figures text-[13px] font-semibold tabular-nums', valueClass ?? 'text-slate-50')}>{value}</span>
        {unit && <span className="ml-1.5 text-[11px] text-slate-500">{unit}</span>}
      </span>
    </div>
  )
}

function LeadMixCard({ summary, loading, dim }: { summary: Summary | null; loading: boolean; dim: boolean }) {
  const s = summary
  const calls = s ? s.answered + s.missed : 0
  const notCounted = s ? Math.max(0, s.answered - s.counted) : 0
  const billable = s && s.answered > 0 ? (s.counted / s.answered) * 100 : null
  return (
    <Panel className="p-4" dim={dim}>
      <h2 className={TITLE}>Lead mix</h2>
      <p className={SUBTITLE}>Outcome of every call in the period</p>
      {loading || !s ? (
        <div className="mt-3 space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-7" />)}</div>
      ) : (
        <div className="mt-2">
          <MixRow label="Total calls" value={num(calls)} unit="leads" />
          <MixRow label="Answered" value={num(s.answered)} unit="leads" />
          <MixRow label="Missed" value={num(s.missed)} unit="leads" valueClass={s.missed > 0 ? 'text-red-400' : undefined} />
          <MixRow label="Counted (billable)" value={num(s.counted)} unit="leads" />
          <MixRow label="Answered, not counted" value={num(notCounted)} unit="leads" />
          <MixRow label="Answer rate" value={`${s.answer_rate}%`} unit="of calls" />
          <MixRow label="Billable rate" value={pctText(billable)} unit="of answered" />
        </div>
      )}
    </Panel>
  )
}

// ─── Ranking table (buyers / by price / campaigns) ────────────────────────────

type RankTab = 'buyers' | 'price' | 'campaigns'

interface RankRow {
  key: string
  rank: number
  label: string
  /** Hover text, and what search also matches (a buyer's name, a price's buyers). */
  name: string | null
  value: number
  counted: number
  /** The last column: a first–last date span, or the buyers at a price. */
  extra: string
}

const RANK_TABS: Record<RankTab, {
  title: string
  noun: { one: string; many: string }
  nameHead: string
  valueHead: string
  extraHead: string
  totalLabel: string
  activeLabel: string
  topLabel: string
  lowLabel: string
}> = {
  buyers: {
    title: 'Revenue by buyer', noun: { one: 'buyer', many: 'buyers' }, nameHead: 'Buyer', valueHead: 'Revenue', extraHead: 'First – last date',
    totalLabel: 'Total billed', activeLabel: 'Active buyers', topLabel: 'Top buyer', lowLabel: 'Lowest buyer',
  },
  price: {
    title: 'Revenue by price', noun: { one: 'price point', many: 'price points' }, nameHead: 'Price / lead', valueHead: 'Revenue', extraHead: 'Buyers',
    totalLabel: 'Total billed', activeLabel: 'Price points', topLabel: 'Top price point', lowLabel: 'Lowest price point',
  },
  campaigns: {
    title: 'Spend by campaign', noun: { one: 'campaign', many: 'campaigns' }, nameHead: 'Campaign', valueHead: 'Spend', extraHead: 'First – last date',
    totalLabel: 'Total spend', activeLabel: 'Active campaigns', topLabel: 'Top campaign', lowLabel: 'Lowest campaign',
  },
}

function StatCell({ label, value, foot }: { label: string; value: string; foot?: string }) {
  return (
    <div className="min-w-0 bg-[#0a0e17] px-3 py-2.5">
      <div className="truncate text-[11px] text-slate-500">{label}</div>
      <div className="mt-0.5 truncate font-figures text-sm font-semibold tabular-nums text-slate-50">{value}</div>
      {foot && <div className="truncate text-[11px] text-slate-500">{foot}</div>}
    </div>
  )
}

function RankTableRow({ r, max, total, low }: { r: RankRow; max: number; total: number; low: boolean }) {
  return (
    <tr className={cx('border-b last:border-b-0 hover:bg-white/[0.02]', HAIRLINE)}>
      <td className="font-figures text-xs tabular-nums text-slate-500">{r.rank}</td>
      <td className="max-w-[12rem]">
        <span className="block truncate text-[13px] font-semibold text-slate-50" title={r.name ?? undefined}>{r.label}</span>
      </td>
      <td className="text-right font-figures text-[13px] font-semibold tabular-nums text-slate-50">{money(r.value)}</td>
      <td>
        <div className="flex items-center gap-2">
          <Meter pct={max > 0 ? (r.value / max) * 100 : 0} bad={low} className="w-28 shrink-0" />
          <span className="w-12 text-right font-figures text-[11px] tabular-nums text-slate-400">{shareLabel(shareOf(r.value, total))}</span>
        </div>
      </td>
      <td className="text-right font-figures text-[13px] tabular-nums text-slate-200">{num(r.counted)}</td>
      <td className="text-right font-figures text-[13px] tabular-nums text-slate-200">{r.counted > 0 ? money(r.value / r.counted) : '—'}</td>
      <td className="max-w-[14rem] truncate whitespace-nowrap text-xs text-slate-400" title={r.extra}>{r.extra}</td>
    </tr>
  )
}

function RankingCard({ buyers, prices, campaigns, totals, imported, onImport, loading, dim, rangeLabel }: {
  buyers: RankRow[]
  prices: RankRow[]
  campaigns: RankRow[]
  /** What the shares are measured against: billed revenue, and campaign spend (or imported revenue). */
  totals: { revenue: number; campaigns: number }
  /** Which lists come from an import kept in this browser rather than the server. */
  imported: { buyers: boolean; campaigns: boolean }
  /** Opens the Import data panel. */
  onImport: () => void
  loading: boolean
  dim: boolean
  rangeLabel: string
}) {
  const [tab, setTab] = useState<RankTab>('buyers')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // "/" jumps to the search box from anywhere on the page that isn't already a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // An imported campaign list carries revenue, not spend.
  const cfg = tab === 'campaigns' && imported.campaigns
    ? { ...RANK_TABS.campaigns, title: 'Revenue by campaign', valueHead: 'Revenue', totalLabel: 'Total billed' }
    : RANK_TABS[tab]
  const rows = tab === 'buyers' ? buyers : tab === 'price' ? prices : campaigns
  const total = tab === 'campaigns' ? totals.campaigns : totals.revenue
  const isImported = tab === 'campaigns' ? imported.campaigns : imported.buyers
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0)

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? rows.filter((r) => r.label.toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q)) : rows),
    [rows, q],
  )
  // A search shows every match; otherwise the middle of a long list folds away.
  const { head, middle, tail } = useMemo(
    () => (q || expanded ? { head: filtered, middle: [], tail: [] } : splitEnds(filtered)),
    [filtered, q, expanded],
  )

  const leader = rows[0]
  const last = rows.length ? rows[rows.length - 1] : undefined
  const top5 = rows.slice(0, 5).reduce((s, r) => s + r.value, 0)
  const subtitle = tab === 'price'
    ? `${num(rows.length)} ${rows.length === 1 ? 'price point' : 'price points'} across ${num(buyers.length)} buyers · ranked by revenue · ${rangeLabel}`
    : `${num(rows.length)} active ${rows.length === 1 ? cfg.noun.one : cfg.noun.many} · ranked by ${cfg.valueHead.toLowerCase()} · ${rangeLabel}`
  const importText = tab === 'campaigns' ? `Import all ${num(campaigns.length)} campaigns →` : `Import all ${num(buyers.length)} buyers →`

  const switchTab = (t: RankTab) => { setTab(t); setExpanded(false) }

  return (
    <Panel className="p-4" dim={dim} id="dash-buyers">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h2 className={cx(TITLE, 'flex items-center gap-2')}>
            {cfg.title}
            {isImported && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300" title="These figures were imported in this browser. Reset to built-in figures in Import data to go back.">
                Imported
              </span>
            )}
          </h2>
          <p className={SUBTITLE}>{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"><IconSearch /></span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur() } }}
              placeholder={`Search ${tab === 'price' ? 'buyers' : cfg.noun.many} (press /)`}
              aria-label={`Search ${cfg.noun.many}`}
              className="w-52 rounded-lg border border-white/10 bg-[#05070c] py-1.5 pl-8 pr-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25"
            />
          </label>
          <Segmented
            label="Ranking"
            tabs={[{ id: 'buyers', label: 'Buyers' }, { id: 'price', label: 'By price' }, { id: 'campaigns', label: 'Campaigns' }]}
            value={tab}
            onChange={switchTab}
          />
        </div>
      </div>

      {/* Five figures that summarise the table before it is read. */}
      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.06] sm:grid-cols-3 lg:grid-cols-5">
        <StatCell label={cfg.totalLabel} value={loading ? '—' : money(total)} foot={tab === 'campaigns' ? 'all campaigns' : 'all buyers'} />
        <StatCell
          label={cfg.activeLabel}
          value={loading ? '—' : num(rows.length)}
          foot={rows.length > 0 ? `${money(total / rows.length)} avg each` : undefined}
        />
        <StatCell label={cfg.topLabel} value={leader?.label ?? '—'} foot={leader ? `${money(leader.value)} · ${shareLabel(shareOf(leader.value, total))}` : undefined} />
        <StatCell label={cfg.lowLabel} value={last?.label ?? '—'} foot={last ? `${money(last.value)} · ${shareLabel(shareOf(last.value, total))}` : undefined} />
        <StatCell label="Top 5 share" value={rows.length ? shareLabel(shareOf(top5, total)) : '—'} foot={rows.length ? `${money(top5)} of ${cfg.valueHead.toLowerCase()}` : undefined} />
      </div>

      <div className="mt-3 overflow-x-auto">
        {loading ? (
          <div className="space-y-2 pt-1">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyHint message={q ? `Nothing matches “${query.trim()}”.` : `No ${cfg.noun.one} activity in this period.`} />
        ) : (
          <table className="table-dash w-full min-w-[44rem] border-collapse text-left">
            <thead>
              <tr className={cx('border-b', HAIRLINE)}>
                <th className={CAPS}>#</th>
                <th className={CAPS}>{cfg.nameHead}</th>
                <th className={cx(CAPS, 'text-right')}>{cfg.valueHead}</th>
                <th className={CAPS}>Share</th>
                <th className={cx(CAPS, 'text-right')}>Leads</th>
                <th className={cx(CAPS, 'text-right')}>$ / lead</th>
                <th className={CAPS}>{cfg.extraHead}</th>
              </tr>
            </thead>
            <tbody>
              {head.map((r) => <RankTableRow key={r.key} r={r} max={max} total={total} low={false} />)}
              {middle.length > 0 && (
                <tr className={cx('border-b', HAIRLINE)}>
                  <td colSpan={7} className="p-0">
                    <button
                      type="button"
                      onClick={() => setExpanded(true)}
                      title="Show every row"
                      className="w-full bg-blue-500/[0.06] py-2 text-center text-xs text-slate-400 transition-colors hover:bg-blue-500/[0.12] hover:text-slate-200"
                    >
                      Ranks {middle[0].rank}–{middle[middle.length - 1].rank} · {num(middle.length)} more {cfg.noun.many} · {money(middle.reduce((s, r) => s + r.value, 0))} combined
                    </button>
                  </td>
                </tr>
              )}
              {tail.map((r) => <RankTableRow key={r.key} r={r} max={max} total={total} low />)}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        <p className="text-slate-500">
          {q
            ? `${num(filtered.length)} of ${num(rows.length)} ${cfg.noun.many} match`
            : middle.length > 0
            ? `Showing top ${head.length} and bottom ${tail.length} of ${num(rows.length)}`
            : rows.length > 0
            ? `Showing all ${num(rows.length)} ${rows.length === 1 ? cfg.noun.one : cfg.noun.many}${tab !== 'price' && rows.length >= RANK_LIMIT ? ` (the ${RANK_LIMIT} biggest)` : ''}`
            : ''}
          {expanded && !q && (
            <button type="button" onClick={() => setExpanded(false)} className={cx('ml-2', LINK)}>Fold the middle</button>
          )}
        </p>
        <button type="button" onClick={onImport} className={cx('shrink-0', LINK)}>{importText}</button>
      </div>
    </Panel>
  )
}

// ─── Import data ──────────────────────────────────────────────────────────────

type Imports = { buyers?: ImportedRow[]; campaigns?: ImportedRow[] }

/** Imported buyer/campaign lists, per date range, kept in this browser only. */
const IMPORTS_STORE = 'dashboard.imports.v1'

function readImportsStore(): Record<string, Imports> {
  try {
    const v = JSON.parse(localStorage.getItem(IMPORTS_STORE) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

const IMPORT_PLACEHOLDER = 'buyer,revenue,leads,first,last\nRTG 04,171380,3116,Nov 02,Nov 19'

/**
 * Paste (or choose) a buyer or campaign CSV to load it into the ranking for this period;
 * "Reset to built-in figures" goes back to what the server reports.
 */
function ImportCard({ textRef, hasImport, onApply, onReset }: {
  textRef: React.RefObject<HTMLTextAreaElement | null>
  hasImport: boolean
  /** Returns the confirmation sentence, or throws with the reason it couldn't be loaded. */
  onApply: (text: string) => string
  onReset: () => void
}) {
  const [text, setText] = useState('')
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const apply = (csv: string) => {
    try {
      setNote({ ok: true, text: onApply(csv) })
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message })
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    const csv = await file.text()
    setText(csv)
    apply(csv)
  }

  return (
    <Panel className="p-4" id="dash-import">
      <h2 className={TITLE}>Import data</h2>
      <p className={SUBTITLE}>Load the full buyer and campaign lists</p>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-xs font-medium text-slate-400">Paste CSV</span>
        <textarea
          ref={textRef}
          value={text}
          onChange={(e) => { setText(e.target.value); setNote(null) }}
          placeholder={IMPORT_PLACEHOLDER}
          rows={5}
          spellCheck={false}
          className="w-full resize-y rounded-lg border border-white/10 bg-[#05070c] px-3 py-2 font-figures text-[11px] leading-relaxed text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25"
        />
      </label>
      {note && <p role="status" className={cx('mt-1.5 text-[11px]', note.ok ? 'text-emerald-400' : 'text-red-400')}>{note.text}</p>}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => apply(text)} disabled={!text.trim()} className={BTN_PRIMARY}>Apply</button>
        <button type="button" onClick={() => fileRef.current?.click()} className={BTN}>Choose file</button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }}
        />
      </div>
      <button
        type="button"
        onClick={() => { onReset(); setNote({ ok: true, text: 'Back to the built-in figures.' }) }}
        disabled={!hasImport}
        className={cx(BTN, 'mt-2 w-full')}
      >
        Reset to built-in figures
      </button>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Buyers: buyer, revenue, leads, first, last. Campaigns: campaign, buyer, revenue, leads, first, last. Kept in this browser only.
      </p>
    </Panel>
  )
}

// ─── Team today ───────────────────────────────────────────────────────────────

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The Sunday-to-Saturday week around an ISO day, as ISO days. */
function weekOf(iso: string): string[] {
  const d = new Date(`${iso}T00:00:00`)
  const sun = new Date(d)
  sun.setDate(d.getDate() - d.getDay())
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(sun)
    x.setDate(sun.getDate() + i)
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  })
}

type AvatarTone = 'plain' | 'break' | 'absent'

const AVATAR_TONE: Record<AvatarTone, string> = {
  plain: 'bg-blue-500/20 text-blue-200',
  break: 'bg-amber-500/20 text-amber-200',
  absent: 'bg-red-500/20 text-red-200',
}

function Avatars({ names, tone, max = 3 }: { names: string[]; tone: AvatarTone; max?: number }) {
  const shown = names.slice(0, max)
  const rest = names.length - shown.length
  return (
    <span className="flex shrink-0 items-center">
      {shown.map((n, i) => (
        <span
          key={n + i}
          title={n}
          className={cx('inline-flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-semibold ring-2 ring-[#0a0e17]', AVATAR_TONE[tone], i > 0 && '-ml-1')}
        >
          {initials(n)}
        </span>
      ))}
      {rest > 0 && <span className="-ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[8px] font-semibold text-slate-300 ring-2 ring-[#0a0e17]">+{rest}</span>}
    </span>
  )
}

/** One line of the day: when (or what), who, how many. */
function TeamRow({ label, labelClass, names, tone, count, countClass, countTitle }: {
  label: string
  labelClass: string
  names: string[]
  tone: AvatarTone
  count: number
  countClass?: string
  countTitle?: string
}) {
  const text = names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '')
  return (
    <li className={cx('flex items-center gap-2.5 border-b py-2.5 last:border-b-0', HAIRLINE)}>
      <span className={cx('w-12 shrink-0 font-figures text-[11px] font-medium', labelClass)}>{label}</span>
      <Avatars names={names} tone={tone} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-slate-300" title={names.join(', ')}>{text}</span>
      <span className={cx('shrink-0 font-figures text-[13px] font-semibold tabular-nums', countClass ?? 'text-slate-50')} title={countTitle}>{count}</span>
    </li>
  )
}

interface HourGroup { key: number; label: string; rows: AttendanceDay[] }

function TeamTodayCard({ day, onDay, today, roster, leaveDays, staff, loading, error }: {
  day: string
  onDay: (iso: string) => void
  today: string
  roster: AttendanceDay[]
  /** Who is on leave that day — never counted absent. */
  leaveDays: LeaveDay[]
  staff: { user_id: string; staff_name: string | null; username: string | null }[]
  loading: boolean
  error: string | null
}) {
  const week = useMemo(() => weekOf(day), [day])
  const isToday = day === today

  const stats = useMemo(() => {
    const presentIds = new Set(roster.map((r) => r.user_id))
    const leaveIds = new Set(leaveDays.map((d) => d.user_id))
    // Somebody on leave isn't missing: they are listed on their own rather than as absent.
    const absent = staff.filter((m) => !presentIds.has(m.user_id) && !leaveIds.has(m.user_id))
    const onLeave = staff.filter((m) => !presentIds.has(m.user_id) && leaveIds.has(m.user_id))
    const present = roster.filter((r) => r.present).length
    return {
      present,
      stillIn: roster.filter((r) => r.still_in).length,
      onBreak: roster.filter((r) => r.on_break),
      late: roster.filter(isLateLogin),
      absent,
      onLeave,
      // Expected = everyone on the roster who isn't on leave.
      expected: present + absent.length,
    }
  }, [roster, leaveDays, staff])

  // Clock-ins grouped by the hour they happened, in the org's clock.
  const hours = useMemo<HourGroup[]>(() => {
    const map = new Map<number, HourGroup>()
    for (const r of roster) {
      if (!r.login_at) continue
      const { key, label } = orgHour(r.login_at)
      const g = map.get(key) ?? { key, label, rows: [] }
      g.rows.push(r)
      map.set(key, g)
    }
    return [...map.values()].sort((a, b) => a.key - b.key)
  }, [roster])

  const dayLabel = new Date(`${day}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const pct = stats.expected > 0 ? Math.round((stats.present / stats.expected) * 100) : 0

  return (
    <Panel className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2
            className={cx(TITLE, 'cursor-help')}
            title={`Who clocked in on the selected day, by hour, in the org's clock (${ORG_TZ}). Late is judged against each person's expected login on the Staff page, or 9:00 AM where none is set. People on leave are never counted absent.`}
          >
            Team today
          </h2>
          {!loading && !error && stats.expected > 0 && (
            <p className={SUBTITLE}>{num(stats.present)} of {num(stats.expected)} clocked in · {pct}% attendance</p>
          )}
        </div>
        {/* On a past day this is the way back to today. */}
        <button
          type="button"
          onClick={() => onDay(today)}
          disabled={isToday}
          title={isToday ? undefined : 'Back to today'}
          className={cx('shrink-0 text-right font-figures text-[11px]', isToday ? 'cursor-default text-slate-500' : 'font-medium text-blue-400 hover:underline')}
        >
          {dayLabel.replace(',', '')}
        </button>
      </div>

      {/* Week strip — the selected day gets the blue disc; future days can't be opened. */}
      <div className="mt-3 grid grid-cols-7 gap-0.5">
        {week.map((iso, i) => {
          const future = iso > today
          const active = iso === day
          return (
            <button
              key={iso}
              type="button"
              disabled={future}
              onClick={() => onDay(iso)}
              className={cx('flex flex-col items-center gap-1 rounded-lg py-1 text-[11px] transition-colors', future ? 'cursor-not-allowed' : 'hover:bg-white/[0.04]')}
              aria-pressed={active}
              title={iso}
            >
              <span className={cx(future ? 'text-slate-600' : 'text-slate-500')}>{WEEKDAYS[i]}</span>
              <span className={cx(
                'flex h-7 w-7 items-center justify-center rounded-full font-figures text-[12px] tabular-nums',
                active ? 'bg-blue-600 font-semibold text-white shadow-[0_0_0_3px_rgba(59,130,246,0.25)]' : future ? 'text-slate-600' : 'text-slate-200',
              )}>
                {Number(iso.slice(-2))}
              </span>
            </button>
          )
        })}
      </div>

      {/* Headcount strip. */}
      {!loading && !error && (
        <div className="mt-3 grid grid-cols-5 gap-px overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.06] text-center">
          {[
            { label: 'In', value: stats.present, bad: false },
            { label: 'Still in', value: stats.stillIn, bad: false },
            { label: 'Break', value: stats.onBreak.length, bad: false },
            { label: 'Late', value: stats.late.length, bad: stats.late.length > 0 },
            { label: 'Absent', value: stats.absent.length, bad: stats.absent.length > 0 },
          ].map((c) => (
            <div key={c.label} className="bg-[#0a0e17] px-0.5 py-2.5">
              <div className={cx('font-figures text-lg font-semibold tabular-nums', c.bad ? 'text-red-400' : 'text-slate-50')}>{c.value}</div>
              <div className="font-figures text-[9px] font-medium uppercase tracking-wider text-slate-500">{c.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2">
        {loading ? (
          <div className="mt-2 space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : error ? (
          <EmptyHint message="Attendance data isn't available right now." />
        ) : roster.length === 0 && stats.absent.length === 0 && stats.onLeave.length === 0 ? (
          <EmptyHint message={isToday ? 'Nobody has clocked in yet today.' : 'No clock-ins were recorded on this day.'} />
        ) : (
          <ul>
            {isToday && stats.onBreak.length > 0 && (
              <TeamRow label="Break" labelClass="text-amber-400" names={stats.onBreak.map(labelOf)} tone="break" count={stats.onBreak.length} />
            )}
            {hours.map((g) => {
              const late = g.rows.filter(isLateLogin).length
              return (
                <TeamRow
                  key={g.key}
                  label={g.label}
                  labelClass="text-slate-500"
                  names={g.rows.map(labelOf)}
                  tone="plain"
                  count={g.rows.length}
                  countClass={late ? 'text-red-400' : undefined}
                  countTitle={late ? `${late} late` : undefined}
                />
              )
            })}
            {stats.absent.length > 0 && (
              <TeamRow label="Absent" labelClass="text-red-400" names={stats.absent.map(labelOf)} tone="absent" count={stats.absent.length} countClass="text-red-400" />
            )}
            {stats.onLeave.length > 0 && (
              <TeamRow label="Leave" labelClass="text-slate-500" names={stats.onLeave.map(labelOf)} tone="plain" count={stats.onLeave.length} />
            )}
          </ul>
        )}
      </div>

      <div className="mt-3 text-right">
        <Link to="/attendance" className={cx('text-xs', LINK)}>Open attendance →</Link>
      </div>
    </Panel>
  )
}

/** Fallback beside the Period panel for a viewer without the Attendance page. */
function LeadQualityCard({ summary, loading }: { summary: Summary | null; loading: boolean }) {
  const answered = summary?.answered ?? 0
  const missed = summary?.missed ?? 0
  const total = answered + missed
  return (
    <Panel className="p-4">
      <h2 className={TITLE}>Lead quality</h2>
      <p className={SUBTITLE}>Calls picked up versus not, across the whole period</p>
      {loading ? (
        <Skeleton className="mt-3 h-16" />
      ) : total === 0 ? (
        <EmptyHint message="No answered or missed calls were recorded in this period." />
      ) : (
        <>
          <div className="mt-3 font-figures text-2xl font-semibold tabular-nums text-slate-50">{summary?.answer_rate}%<span className="ml-1.5 font-sans text-xs font-normal text-slate-500">answered</span></div>
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
            <div className="bg-blue-500" style={{ width: `${shareOf(answered, total)}%` }} />
            <div className="bg-red-500" style={{ width: `${shareOf(missed, total)}%` }} />
          </div>
          <div className="mt-2">
            <MixRow label="Answered" value={num(answered)} unit="leads" />
            <MixRow label="Missed" value={num(missed)} unit="leads" valueClass={missed > 0 ? 'text-red-400' : undefined} />
          </div>
        </>
      )}
    </Panel>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  return <DashboardPage />
}

function DashboardPage() {
  const { canAccess } = useAuth()
  // Open on today, like every other date filter in the CRM; a wider window is an explicit choice.
  const [range, setRange] = useState<Range>(todayRange)
  const [granularity, setGranularity] = useState<Granularity>('day')
  // The staff view slides in over the overview and slides back out.
  const [view, setView] = useState<'overview' | 'staff'>('overview')
  const showStaff = useCallback(() => setView('staff'), [])
  const showOverview = useCallback(() => setView('overview'), [])

  const prev = useMemo(() => previousPeriod(range.from, range.to), [range.from, range.to])
  const days = rangeDays(range.from, range.to)
  const prevLabel = previousLabel(days)
  const prevShort = days <= 1 ? 'Prev. day' : `Prev. ${num(days)} days`

  const summary = useAsync(() => api.summary(range), [range.from, range.to])
  // The previous window's own summary gives every "Prev." figure and the What-changed column.
  const prevSummary = useAsync(() => api.summary(prev), [prev.from, prev.to])
  const trends = useAsync(() => api.trends({ ...range, granularity }), [range.from, range.to, granularity])
  // The whole ranking, not its head: the table shows the top five AND the bottom five.
  const topBuyers = useAsync(() => api.topBuyers({ ...range, limit: RANK_LIMIT }), [range.from, range.to])
  const topCampaigns = useAsync(() => api.topCampaigns({ ...range, limit: RANK_LIMIT }), [range.from, range.to])

  // Team today reads the attendance roster in the org's clock. Hooks can't be conditional,
  // so a viewer without the Attendance page gets a resolved null and the fallback card.
  const canAttendance = canAccess('attendance')
  const today = useOrgToday()
  const [teamDay, setTeamDay] = useState(today)
  const roster = useAsync(() => (canAttendance ? api.attendanceRoster(teamDay) : Promise.resolve(null)), [teamDay, canAttendance])
  const staff = useAsync(() => (canAttendance ? api.attendanceStaff() : Promise.resolve(null)), [canAttendance])

  // Salary, portal and misc typed into "Where the revenue went", per range, in this browser.
  const rangeKey = `${range.from}_${range.to}`
  const [extrasStore, setExtrasStore] = useState<Record<string, Extras>>(readExtrasStore)
  const extras = extrasStore[rangeKey] ?? {}
  const setExtra = useCallback((k: ExtraKey, v: string) => {
    setExtrasStore((store) => {
      const next = { ...store, [rangeKey]: { ...store[rangeKey], [k]: v } }
      try { localStorage.setItem(EXTRAS_STORE, JSON.stringify(next)) } catch { /* private mode: keep it in memory */ }
      return next
    })
  }, [rangeKey])

  // Buyer/campaign lists pasted into Import data, per range, in this browser.
  const [importsStore, setImportsStore] = useState<Record<string, Imports>>(readImportsStore)
  const imports = importsStore[rangeKey] ?? {}
  const writeImports = useCallback((next: Imports) => {
    setImportsStore((store) => {
      const all = { ...store, [rangeKey]: next }
      if (!next.buyers && !next.campaigns) delete all[rangeKey]
      try { localStorage.setItem(IMPORTS_STORE, JSON.stringify(all)) } catch { /* private mode: keep it in memory */ }
      return all
    })
  }, [rangeKey])
  const importText = useRef<HTMLTextAreaElement>(null)

  // "Updated" is the moment the headline figures last changed.
  const updatedAt = useMemo(() => (summary.data ? new Date() : null), [summary.data])

  const s = summary.data
  const ps = prevSummary.data
  const series = useMemo(() => trends.data ?? [], [trends.data])

  const importedRows = (list: ImportedRow[], prefix: string): RankRow[] => list.map((r, i) => ({
    key: `${prefix}${i}`, rank: i + 1, label: r.label, name: r.buyer, value: r.value, counted: r.counted,
    extra: !r.first && !r.last ? '—' : r.first === r.last || !r.last ? r.first : !r.first ? r.last : `${r.first} – ${r.last}`,
  }))
  const buyerRows: RankRow[] = useMemo(
    () => imports.buyers
      ? importedRows(imports.buyers, 'ib')
      : (topBuyers.data ?? []).map((b, i) => ({
          key: `b${b.id}`, rank: i + 1, label: b.code, name: b.name, value: b.revenue, counted: b.counted,
          extra: spanLabel(b.first_date, b.last_date),
        })),
    [topBuyers.data, imports.buyers],
  )
  const priceRows: RankRow[] = useMemo(
    () => groupByPrice(buyerRows).map((g, i) => ({
      key: `p${g.price ?? 'none'}`, rank: i + 1,
      label: g.price === null ? 'No leads' : money(g.price),
      name: g.members.join(', '),
      value: g.value, counted: g.counted,
      extra: g.members.slice(0, 3).join(', ') + (g.members.length > 3 ? ` +${g.members.length - 3}` : ''),
    })),
    [buyerRows],
  )
  const campaignRows: RankRow[] = useMemo(
    () => imports.campaigns
      ? importedRows(imports.campaigns, 'ic')
      : (topCampaigns.data ?? []).map((c, i) => ({
          key: `c${c.id}`, rank: i + 1, label: c.code, name: c.name, value: c.cost, counted: c.counted,
          extra: spanLabel(c.first_date, c.last_date),
        })),
    [topCampaigns.data, imports.campaigns],
  )
  const sum = (rows: RankRow[]) => rows.reduce((t, r) => t + r.value, 0)
  const rankTotals = {
    revenue: imports.buyers ? sum(buyerRows) : s?.revenue ?? 0,
    campaigns: imports.campaigns ? sum(campaignRows) : s?.cost ?? 0,
  }

  const applyImport = (text: string): string => {
    const parsed = parseRankCsv(text)
    if ('error' in parsed) throw new Error(parsed.error)
    writeImports({ ...imports, [parsed.kind]: parsed.rows })
    const n = parsed.rows.length
    return `Loaded ${num(n)} ${parsed.kind === 'buyers' ? (n === 1 ? 'buyer' : 'buyers') : (n === 1 ? 'campaign' : 'campaigns')} for ${formatRangeLong(range.from, range.to, false)}.`
  }
  const openImport = () => {
    document.getElementById('dash-import')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    importText.current?.focus({ preventScroll: true })
  }

  const rosterRows = useMemo(() => roster.data?.rows ?? [], [roster.data])
  const rosterLeave = useMemo(() => roster.data?.leave_days ?? [], [roster.data])

  const blocks = [summary, trends, topBuyers, topCampaigns]
  const failed = blocks.filter((b) => b.error)
  const refreshAll = () => [summary, prevSummary, trends, topBuyers, topCampaigns, roster, staff].forEach((b) => b.reload())
  const refreshing = blocks.some((b) => b.refreshing)

  // ── Traffic-spend basis: the KPI row and What changed leave salary/portal/misc out ──
  const curr = s ? { revenue: s.revenue, cost: s.cost, counted: s.counted } : null
  const before = ps ? { revenue: ps.revenue, cost: ps.cost, counted: ps.counted } : null
  const cu = curr ? unitEconomics(curr) : null
  const pu = before ? unitEconomics(before) : null
  const hasPrev = !!before && before.revenue !== 0

  const prevLine = (has: boolean, v: string, noun: string) => (!ps ? '…' : has ? `${prevShort} ${v}` : `No ${noun} in ${prevLabel}`)

  const changeRows: ChangeRow[] = cu && curr ? [
    { label: 'Revenue', curr: money(curr.revenue), prev: before ? money(before.revenue) : '—', delta: changePct(before?.revenue, curr.revenue), tone: 'up-good' },
    { label: 'Expenses', curr: money(curr.cost), prev: before ? money(before.cost) : '—', delta: changePct(before?.cost, curr.cost), tone: 'down-good' },
    { label: 'Profit', curr: signedMoney(cu.profit), prev: pu ? signedMoney(pu.profit) : '—', delta: hasPrev ? changePct(pu?.profit, cu.profit) : null, tone: 'up-good', bad: cu.profit < 0 },
    {
      label: 'Profit margin', curr: pctText(cu.marginPct), prev: pu ? pctText(pu.marginPct) : '—',
      delta: cu.marginPct !== null && pu?.marginPct != null ? Number((cu.marginPct - pu.marginPct).toFixed(1)) : null, tone: 'up-good', unit: ' pts', bad: cu.profit < 0,
    },
    { label: 'Counted leads', curr: num(curr.counted), prev: before ? num(before.counted) : '—', delta: changePct(before?.counted, curr.counted), tone: 'up-good' },
    { label: 'Revenue / lead', curr: cu.revenuePerLead === null ? '—' : money(cu.revenuePerLead), prev: pu?.revenuePerLead == null ? '—' : money(pu.revenuePerLead), delta: changePct(pu?.revenuePerLead, cu.revenuePerLead), tone: 'up-good' },
    { label: 'Cost / lead', curr: cu.costPerLead === null ? '—' : money(cu.costPerLead), prev: pu?.costPerLead == null ? '—' : money(pu.costPerLead), delta: changePct(pu?.costPerLead, cu.costPerLead), tone: 'down-good' },
    { label: 'Profit / lead', curr: cu.profitPerLead === null ? '—' : signedMoney(cu.profitPerLead), prev: pu?.profitPerLead == null ? '—' : signedMoney(pu.profitPerLead), delta: hasPrev ? changePct(pu?.profitPerLead, cu.profitPerLead) : null, tone: 'up-good', bad: (cu.profitPerLead ?? 0) < 0 },
  ] : []

  // ── Copy CSV ──
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'downloaded'>('idle')
  useEffect(() => {
    if (copyState === 'idle') return
    const t = setTimeout(() => setCopyState('idle'), 2200)
    return () => clearTimeout(t)
  }, [copyState])

  const copyCsv = async () => {
    if (!s) return
    const row = (label: string, c: number, b: number | undefined, fmt = (v: number) => String(v)) =>
      [label, fmt(c), b === undefined ? '' : fmt(b), changePct(b, c) ?? '']
    const extraRows = EXTRA_LINES.map((l) => {
      const typed = extras[l.key] ?? (l.key === 'portal' && (s.portal_expenses ?? 0) > 0 ? String(s.portal_expenses) : '')
      return [`${l.label} (entered)`, (parseAmount(typed) ?? 0).toFixed(2), '', '']
    })
    const text = toCsv([
      ['Keoze CRM dashboard', `${range.from} to ${range.to}`, `previous: ${prev.from} to ${prev.to}`, ''],
      ['Metric', 'This period', 'Previous period', 'Change %'],
      row('Revenue (billed)', s.revenue, ps?.revenue, (v) => v.toFixed(2)),
      row('Traffic source spend', s.cost, ps?.cost, (v) => v.toFixed(2)),
      row('Profit (traffic basis)', s.revenue - s.cost, ps ? ps.revenue - ps.cost : undefined, (v) => v.toFixed(2)),
      ...extraRows,
      row('Counted leads', s.counted, ps?.counted),
      row('Answered', s.answered, ps?.answered),
      row('Missed', s.missed, ps?.missed),
      ['Answer rate %', s.answer_rate, ps?.answer_rate ?? '', ''],
      row('Active buyers', s.active_buyers, ps?.active_buyers),
      row('Active campaigns', s.active_campaigns, ps?.active_campaigns),
      [],
      ['Period', 'Revenue', 'Traffic spend', 'Counted', 'Answered', 'Missed'],
      ...series.map((p) => [p.period, p.revenue.toFixed(2), p.cost.toFixed(2), p.counted, p.answered, p.missed]),
    ])
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard')
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
    } catch {
      // The clipboard needs a secure page; over plain http the CSV downloads instead.
      downloadCsv(`dashboard_${fileDateRange(range.from, range.to)}.csv`, text)
      setCopyState('downloaded')
    }
  }

  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const kpiDim = summary.refreshing || prevSummary.refreshing
  const rangeLong = formatRangeLong(range.from, range.to)
  const rangeShort = formatRangeLong(range.from, range.to, false)

  if (view === 'staff') {
    return (
      <div className="text-slate-900" style={{ fontFamily: "'Inter', 'Poppins', ui-sans-serif, system-ui, sans-serif" }}>
        <div key="staff" className="animate-page-in-right flex flex-col lg:h-[calc(100vh-3rem-var(--app-header-h,0px))]">
          <StaffDashboard onBack={showOverview} />
        </div>
      </div>
    )
  }

  return (
    // Full-bleed dark page: the negative margins undo the layout's padding so the dark
    // background reaches the edges of the content area, then the padding is put back.
    <div
      className="-mx-4 -my-6 flex flex-col bg-[#04060b] px-4 py-6 text-slate-200 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      <div key="overview" className="animate-page-in-left flex grow flex-col gap-4">
        {/* Header. */}
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-0.5 text-[11px] font-medium text-blue-300">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400" aria-hidden /> Overview
            </span>
            <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-tight text-white">Dashboard</h1>
            <p className="mt-0.5 text-sm text-slate-400">
              Leads, revenue, margin and team · {rangeLong} ({num(days)} {days === 1 ? 'day' : 'days'})
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* The page's date filter, up top; the Period panel further down drives the same range. */}
            <div className="w-full sm:w-64" title="Date range for every figure on this page">
              <DateRangeControl value={range} onChange={setRange} tone="night" />
            </div>
            <button type="button" onClick={() => jump('dash-flow')} className={cx(BTN, 'h-9 py-0')}>Expenses</button>
            <button type="button" onClick={() => jump('dash-buyers')} className={cx(BTN, 'h-9 py-0')}>Buyers</button>
            <span className="ml-1 font-figures text-[11px] text-slate-500" aria-live="polite">
              {refreshing ? 'Refreshing…' : updatedAt ? `Updated ${timeLabel(updatedAt)}` : 'Loading…'}
            </span>
          </div>
        </div>

        {/* One banner for any block that failed — the rest of the page stays usable. */}
        {failed.length > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-red-400"><IconAlert /></span>
              <p className="text-xs text-red-200">
                {failed[0].error}
                {failed.length > 1 && ` (and ${failed.length - 1} other section${failed.length > 2 ? 's' : ''})`}. The rest of the page is current.
              </p>
            </div>
            <button
              type="button"
              onClick={refreshAll}
              className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-red-500/40 px-3 py-1 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/10 sm:self-auto"
            >
              <IconRefresh /> Retry
            </button>
          </div>
        )}

        {/* KPI row — traffic-spend basis; the extra expenses are added further down. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Revenue"
            info="Total billed to buyers for leads delivered in the selected period."
            value={s ? money(s.revenue) : '—'}
            sub={cu?.revenuePerLead != null ? `${money(cu.revenuePerLead)} per counted lead` : 'No counted leads'}
            prev={prevLine(!!ps && ps.revenue !== 0, money(ps?.revenue ?? 0), 'revenue')}
            delta={changePct(ps?.revenue, s?.revenue)}
            tone="up-good"
            loading={summary.loading}
            dim={kpiDim}
          />
          <KpiCard
            label="Expenses"
            info="Traffic source spend — what the campaigns cost. Salary, portal and miscellaneous expenses are added in Where the revenue went. Falling expenses is good news."
            value={s ? money(s.cost) : '—'}
            sub="Traffic only · add salary, portal, misc below"
            prev={prevLine(!!ps && ps.cost !== 0, money(ps?.cost ?? 0), 'expenses')}
            delta={changePct(ps?.cost, s?.cost)}
            tone="down-good"
            loading={summary.loading}
            dim={kpiDim}
          />
          <KpiCard
            label="Profit"
            info="Revenue minus traffic source spend. Where the revenue went takes off salary, portal and miscellaneous expenses for true profit."
            value={cu ? signedMoney(cu.profit) : '—'}
            valueClass={cu && cu.profit < 0 ? 'text-red-400' : 'text-blue-400'}
            sub={cu ? (cu.profit < 0 ? <span className="font-medium text-red-400">Loss · {pctText(cu.marginPct)} margin</span> : `${pctText(cu.marginPct)} margin`) : ''}
            // A profit with nothing billed behind it is not a baseline worth a percentage.
            prev={!ps ? '…' : hasPrev && pu ? `${prevShort} ${signedMoney(pu.profit)}` : 'No comparable previous period'}
            delta={hasPrev ? changePct(pu?.profit, cu?.profit) : null}
            tone="up-good"
            accent
            loading={summary.loading}
            dim={kpiDim}
          />
          <KpiCard
            label="Counted leads"
            info="Billable leads in the selected period. Not the same as answered leads."
            value={s ? num(s.counted) : '—'}
            sub={s ? `${num(s.answered)} answered · ${num(s.missed)} missed` : ''}
            prev={prevLine(!!ps && ps.counted !== 0, num(ps?.counted ?? 0), 'leads')}
            delta={changePct(ps?.counted, s?.counted)}
            tone="up-good"
            loading={summary.loading}
            dim={kpiDim}
          />
        </div>

        <WhatChangedCard
          sentence={curr && before ? whatChanged(curr, before, prevLabel) : ''}
          rows={changeRows}
          basisLabel={`Traffic-spend basis · ${rangeShort} vs ${prevLabel}`}
          prevLabel={prevLabel}
          loading={summary.loading || prevSummary.loading}
          dim={kpiDim}
        />

        {/* Revenue by day beside the money breakdown. On a wide screen the day table takes
            the height of the right column and scrolls inside it ([contain:size] keeps a long
            range from stretching the row). */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="min-w-0 lg:[contain:size]">
            <RevenueByDayCard
              points={series}
              granularity={granularity}
              range={range}
              total={s?.revenue ?? 0}
              delta={changePct(ps?.revenue, s?.revenue)}
              prevLabel={prevLabel}
              loading={trends.loading}
              dim={trends.refreshing}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <RevenueFlowCard summary={s} extras={extras} setExtra={setExtra} loading={summary.loading} dim={summary.refreshing} />
            <LeadMixCard summary={s} loading={summary.loading} dim={summary.refreshing} />
          </div>
        </div>

        <RankingCard
          buyers={buyerRows}
          prices={priceRows}
          campaigns={campaignRows}
          totals={rankTotals}
          imported={{ buyers: !!imports.buyers, campaigns: !!imports.campaigns }}
          onImport={openImport}
          loading={topBuyers.loading || topCampaigns.loading || summary.loading}
          dim={topBuyers.refreshing || topCampaigns.refreshing}
          rangeLabel={rangeShort}
        />

        {/* Controls and the import beside the team's day. */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
          <Panel className="space-y-4 p-4">
            <div>
              <div className="mb-1.5 text-xs font-medium text-slate-400">Period</div>
              <DateRangeControl value={range} onChange={setRange} tone="night" />
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-slate-400">Group days by</div>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Group days by">
                {GRANULARITIES.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => setGranularity(g.value)}
                    aria-pressed={granularity === g.value}
                    title={g.title}
                    className={cx(
                      'rounded-lg border py-1.5 font-figures text-xs font-semibold transition-colors',
                      granularity === g.value ? 'border-blue-500/70 bg-blue-600/25 text-white' : 'border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-100',
                    )}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={copyCsv}
                disabled={!s}
                title="Copy the period's figures as CSV"
                className={BTN_PRIMARY}
              >
                {copyState === 'copied' ? 'Copied ✓' : copyState === 'downloaded' ? 'Downloaded' : 'Copy CSV'}
              </button>
              {canAccess('complete-report') ? <Link to="/complete-report" className={BTN}>Report</Link> : <span />}
              {/* Opens the staff view in place — the manager stays on the dashboard. */}
              {canAccess('staff') ? <button type="button" onClick={showStaff} className={BTN}>Staff</button> : <span />}
            </div>
          </Panel>

          <ImportCard
            textRef={importText}
            hasImport={!!imports.buyers || !!imports.campaigns}
            onApply={applyImport}
            onReset={() => writeImports({})}
          />
          </div>

          {canAttendance ? (
            <TeamTodayCard
              day={teamDay}
              onDay={setTeamDay}
              today={today}
              roster={rosterRows}
              leaveDays={rosterLeave}
              staff={staff.data ?? []}
              loading={roster.loading}
              error={roster.error}
            />
          ) : (
            <LeadQualityCard summary={s} loading={summary.loading} />
          )}
        </div>

        <footer className={cx('mt-auto flex flex-wrap justify-between gap-2 border-t pt-4 text-[11px] text-slate-500', HAIRLINE)}>
          <span>Keoze CRM</span>
          <span className="font-figures">Figures for {rangeLong} · days marked ~ are rounded to $1K</span>
        </footer>
      </div>
    </div>
  )
}
