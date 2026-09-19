// Dashboard — management overview of Leads, revenue, margin and the team's day.
//
// Layout mirrors the client's reference mock (a "Brisk"-style CRM dashboard) one block for
// one block, re-coloured two-tone (white and the navbar's navy, with green/red only for good/bad)
// and set at a denser size:
//
//   toolbar        → quick links · last-updated · CSV export · refresh
//   KPI row        → four compact cards with a % pill and the absolute change vs the previous period
//   revenue chart  → metric dropdown, granularity pills, peak marker and a previous-period ghost line
//   calendar column→ "Team Today": week strip, in/late/on-break/absent counts, hourly clock-in timeline
//   bottom row     → Lead Mix (tabbed 2×2 tiles) beside one wide spend card: the highest and
//                    lowest buyers by revenue, or campaigns by spend, at both ends at once
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { DateRangeControl, type Range } from '../components/DateRange'
import { StaffDashboard } from '../components/StaffDashboard'
import { cx } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { isLateLogin, labelOf, loginLateMinutes } from '../lib/attendanceReports'
import {
  fileDateRange,
  formatDmy,
  formatPeriod,
  money,
  moneyCompact,
  num,
  previousPeriod,
  rangeDays,
  todayRange,
} from '../lib/format'
import { ORG_TZ, gapLabel } from '../lib/staff'
import { BRAND } from '../lib/theme'
import { useAsync } from '../lib/useAsync'
import { useOrgToday } from '../lib/useOrgToday'
import type { AttendanceDay, Summary, TrendPoint } from '../types'

type Granularity = 'day' | '4day' | 'week'

/** How deep the buyer/campaign rankings are fetched — the API's own ceiling. */
const RANK_LIMIT = 50

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: 'day', label: '1D' },
  { value: '4day', label: '4D' },
  { value: 'week', label: '1W' },
]

/**
 * Two-tone palette: white, slate greys and the navbar's navy (the sidebar and dark controls)
 * in a few strengths. Green and red appear only where
 * they code a good or bad movement — delta pills, late/absent, negative profit.
 */
const C = {
  /** The navbar's navy — the one accent on this page. */
  primary: BRAND,
  /** The secondary series (missed bars, the previous-period ghost line): a neutral grey. */
  soft: '#cbd5e1',
  navy: BRAND,
  grid: '#eef2f6',
  axis: '#94a3b8',
}

/** Whether a rising number is good news for this metric (Expenses is the one where it isn't). */
type Tone = 'up-good' | 'down-good'

// ─── Formatting helpers ───────────────────────────────────────────────────────

const signed = (v: number, suffix: string) => `${v > 0 ? '+' : ''}${v.toFixed(1)}${suffix}`
const signedMoney = (v: number) => `${v < 0 ? '−' : '+'}${money(Math.abs(v))}`
const signedNum = (v: number) => `${v < 0 ? '−' : '+'}${num(Math.abs(v))}`

/** % change with the same "no baseline → null" rule the API uses. */
function changePct(prev: number | undefined, curr: number): number | null {
  if (prev === undefined) return null
  if (prev === 0) return curr === 0 ? 0 : null
  return Number((((curr - prev) / Math.abs(prev)) * 100).toFixed(1))
}

/** "vs prev. 7 days" — the comparison window is always the same length as the range. */
function comparisonLabel(range: Range): string {
  const days = rangeDays(range.from, range.to)
  if (days <= 1) return 'vs prev. day'
  return `vs prev. ${days} days`
}

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

/** Codes are short and mostly alphanumeric — first three chars, separators stripped. */
const codeInitials = (code: string) => code.replace(/[\s\-_]+/g, '').slice(0, 3).toUpperCase()

/** Buyers, campaigns and people have no logo — navy initials stand in, as on the staff pages. */
const TINTS = ['bg-brand text-white']
function tintFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return TINTS[h % TINTS.length]
}

/** Client-side CSV download (no API round-trip). */
function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
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
const IconCheck = () => svg(<polyline points="20 6 9 17 4 12" />, 13)
const IconChevD = () => svg(<polyline points="6 9 12 15 18 9" />, 12)
const IconDownload = () => svg(<><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 21h16" /></>)
const IconReport = () => svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8M16 17H8" /></>)
const IconUsers = () => svg(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>)
const IconAlert = () => svg(<><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" /></>, 16)
const IconArrowR = () => svg(<><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>, 12)
const IconCrown = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false"><path d="M3 8l4.4 3L12 5l4.6 6L21 8l-1.5 9.2a1 1 0 0 1-1 .8H5.5a1 1 0 0 1-1-.8L3 8z" /></svg>
)
const IconTrendDown = () => svg(<><path d="m22 17-8.5-8.5-5 5L2 7" /><path d="M16 17h6v-6" /></>, 11)
const IconCal = () => svg(<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>, 12)

// ─── Small building blocks ────────────────────────────────────────────────────

/** Flat white card, matching the reference's panels — slate hairline, soft shadow. */
function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-slate-200/80 bg-white shadow-sm shadow-slate-900/5', className)}>
      {children}
    </section>
  )
}

/** Metric definitions surface as a hover hint rather than eating layout space. */
function InfoDot({ text }: { text: string }) {
  return (
    <button
      type="button"
      title={text}
      aria-label={text}
      className="inline-flex shrink-0 cursor-help text-slate-300 transition-colors hover:text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
      </svg>
    </button>
  )
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-slate-100', className)} />
}

/**
 * The reference's rounded delta pill: "▲ 8%" on a green tint, "▼ 4%" on red. The glyph
 * follows the raw sign; the colour follows whether that movement is good for the metric.
 */
function DeltaPill({ value, tone, suffix = '%' }: { value: number | null | undefined; tone: Tone; suffix?: string }) {
  if (value === undefined || value === null) {
    return <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400" title="No comparable prior period">n/a</span>
  }
  const good = value === 0 ? null : tone === 'up-good' ? value > 0 : value < 0
  return (
    <span
      className={cx(
        'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
        good === null ? 'bg-slate-100 text-slate-500' : good ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600',
      )}
    >
      {value === 0 ? '±' : value > 0 ? '▲' : '▼'} {Math.abs(value).toFixed(1)}{suffix}
    </span>
  )
}

/** The reference's slate tab bar (Status / Sources / Qualification) — white raised active segment. */
function MiniTabs<T extends string>({ tabs, value, onChange }: {
  tabs: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div className="flex w-fit max-w-full rounded-lg bg-slate-100 p-0.5" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
            value === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function EmptyHint({ message, className }: { message: string; className?: string }) {
  return (
    <div className={cx('flex h-full flex-col items-center justify-center gap-1.5 py-6 text-center', className)}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-slate-300">
        <path d="M3 3v18h18" /><path d="m7 15 3.5-3.5 3 3L21 7" />
      </svg>
      <p className="max-w-[24ch] text-xs text-slate-400">{message}</p>
    </div>
  )
}

// ─── Tooltips ─────────────────────────────────────────────────────────────────

interface TooltipProps {
  active?: boolean
  payload?: { name: string; value: number; color: string; dataKey: string }[]
  label?: string
}

function SeriesTooltip({ active, payload, label, format }: TooltipProps & { format: (v: number) => string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] shadow-lg">
      {label && <div className="mb-0.5 font-semibold text-slate-700">{formatPeriod(label)}</div>}
      {payload.filter((p) => p.value != null).map((p) => (
        <div key={p.dataKey} className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-500">{p.name}:</span>
          <span className="font-semibold tabular-nums text-slate-800">{format(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── KPI cards ────────────────────────────────────────────────────────────────

/**
 * One of the reference's small stat cards: label + % pill on the first line, the figure
 * with its absolute change beside it, and a per-Lead figure underneath for management.
 */
function KpiCard({ label, info, value, delta, deltaSuffix, tone, change, foot, loading }: {
  label: string
  info: string
  value: string
  delta: number | null | undefined
  deltaSuffix?: string
  tone: Tone
  /** "+$1,240 vs prev. 7 days" — the absolute movement, from the previous period's summary. */
  change: string | null
  foot?: string
  loading: boolean
}) {
  return (
    <Panel className="p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs font-medium text-slate-600">
          {label}
          <InfoDot text={info} />
        </span>
        {!loading && <DeltaPill value={delta} tone={tone} suffix={deltaSuffix} />}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-6 w-24" />
      ) : (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
          <span className="text-lg font-bold tracking-tight text-slate-900">{value}</span>
          {change && <span className="text-[11px] text-slate-400">{change}</span>}
        </div>
      )}
      {!loading && foot && <div className="mt-0.5 text-[11px] text-slate-400">{foot}</div>}
    </Panel>
  )
}

// ─── Trend chart ──────────────────────────────────────────────────────────────

type MetricId = 'revenue' | 'cost' | 'margin' | 'counted'

interface Metric {
  id: MetricId
  label: string
  color: string
  format: (v: number) => string
  axis: (v: number) => string
  pick: (p: TrendPoint) => number
  total: (s: Summary) => number
  delta: (s: Summary) => number | null
  tone: Tone
}

const METRICS: Metric[] = [
  { id: 'revenue', label: 'Revenue', color: C.primary, format: money, axis: moneyCompact, pick: (p) => p.revenue, total: (s) => s.revenue, delta: (s) => s.deltas.revenue, tone: 'up-good' },
  { id: 'cost', label: 'Expenses', color: C.primary, format: money, axis: moneyCompact, pick: (p) => p.cost, total: (s) => s.cost, delta: (s) => s.deltas.cost, tone: 'down-good' },
  { id: 'margin', label: 'Profit', color: C.primary, format: money, axis: moneyCompact, pick: (p) => p.margin, total: (s) => s.margin, delta: (s) => s.deltas.margin, tone: 'up-good' },
  { id: 'counted', label: 'Counted Leads', color: C.primary, format: num, axis: (v) => num(v), pick: (p) => p.counted, total: (s) => s.counted, delta: (s) => s.deltas.counted, tone: 'up-good' },
]
/**
 * The peak marker's label: a small white pill above the dot, anchored away from whichever
 * chart edge it is near so it never runs off the plot or under the axis.
 */
function PeakLabel({ viewBox, text, anchor }: { viewBox?: { x?: number; y?: number }; text: string; anchor: 'start' | 'middle' | 'end' }) {
  const cx = viewBox?.x ?? 0
  const cy = viewBox?.y ?? 0
  const w = text.length * 5.6 + 12
  const x = anchor === 'start' ? cx - 8 : anchor === 'end' ? cx - w + 8 : cx - w / 2
  const y = cy - 24
  return (
    <g pointerEvents="none">
      <rect x={x} y={y} width={w} height={16} rx={5} fill="#fff" stroke="#e2e8f0" />
      <text x={x + w / 2} y={y + 11} textAnchor="middle" fontSize={10} fontWeight={600} fill="#1e293b">{text}</text>
    </g>
  )
}


/**
 * The reference's Revenue card: a metric dropdown where its title sits, the period total
 * with its % pill, 1D/4D/1W pills, then a smooth line with a soft fill, a dashed marker
 * on the peak bucket, and the previous period drawn underneath as a grey ghost line.
 */
function TrendCard({ metric, onMetric, summary, series, prevSeries, loading, caption }: {
  metric: Metric
  onMetric: (id: MetricId) => void
  summary: Summary | null
  series: TrendPoint[]
  prevSeries: TrendPoint[]
  loading: boolean
  caption: string
}) {
  const data = useMemo(
    () => series.map((p, i) => ({
      period: p.period,
      value: metric.pick(p),
      // Aligned by position: the previous window is the same length, so bucket i sits at
      // the same offset into its period. Missing tail buckets simply leave the line short.
      prev: prevSeries[i] ? metric.pick(prevSeries[i]) : null,
    })),
    [series, prevSeries, metric],
  )
  const peak = useMemo(() => {
    if (data.length < 2) return null
    let at = 0
    data.forEach((d, i) => { if (d.value > data[at].value) at = i })
    const frac = at / (data.length - 1)
    return { ...data[at], anchor: (frac < 0.15 ? 'start' : frac > 0.85 ? 'end' : 'middle') as 'start' | 'middle' | 'end' }
  }, [data])
  const single = series.length === 1

  return (
    <Panel className="flex lg:min-h-0 flex-1 flex-col p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {/* Dropdown in the title slot, like the reference's "Revenue ▾". */}
          <label className="relative inline-flex items-center gap-1 text-xs font-semibold text-slate-700">
            <select
              value={metric.id}
              onChange={(e) => onMetric(e.target.value as MetricId)}
              aria-label="Chart metric"
              className="cursor-pointer appearance-none bg-transparent pr-4 text-xs font-semibold text-slate-700 focus:outline-none"
            >
              {METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <span className="pointer-events-none absolute right-0 text-slate-400"><IconChevD /></span>
          </label>
          {loading || !summary ? (
            <Skeleton className="mt-1 h-6 w-32" />
          ) : (
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              <span className={cx('text-xl font-bold tracking-tight', metric.id === 'margin' && summary.margin < 0 ? 'text-rose-600' : 'text-slate-900')}>
                {metric.format(metric.total(summary))}
              </span>
              <DeltaPill value={metric.delta(summary)} tone={metric.tone} />
              <span className="text-[11px] text-slate-400">{caption}</span>
            </div>
          )}
        </div>
        {/* The legend lives in the header, so nothing overlays the plot. */}
        <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
          <div className="flex items-center gap-3 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3.5 rounded" style={{ background: metric.color }} />This period</span>
            <span className="flex items-center gap-1"><span className="inline-block h-0 w-3.5 border-t-2 border-dashed border-slate-400" />Previous period</span>
          </div>
        </div>
      </div>

      <div className="relative mt-2 h-56 lg:h-auto lg:min-h-0 lg:flex-1">
        {loading ? (
          <div className="flex h-full items-end gap-1.5 px-1 pb-5 pt-3">
            {[38, 62, 45, 78, 55, 88, 66, 72, 50, 80, 60, 70].map((h, i) => (
              <div key={i} className="flex-1 animate-pulse rounded-t bg-slate-100" style={{ height: `${h}%` }} />
            ))}
          </div>
        ) : data.length === 0 ? (
          <EmptyHint message="No Leads were recorded in this period. Try a wider date range." />
        ) : (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 30, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={metric.color} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={metric.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <XAxis dataKey="period" tickFormatter={formatPeriod} tick={{ fontSize: 10, fill: C.axis }} tickLine={false} axisLine={false} minTickGap={28} interval="preserveStartEnd" tickMargin={6} />
                <YAxis tickFormatter={metric.axis} tick={{ fontSize: 10, fill: C.axis }} tickLine={false} axisLine={false} width={48} tickMargin={4} />
                {metric.id === 'margin' && <ReferenceLine y={0} stroke="#cbd5e1" />}
                <Tooltip content={<SeriesTooltip format={metric.format} />} cursor={{ stroke: C.soft, strokeDasharray: '3 3' }} />
                <Line type="monotone" dataKey="prev" name="Previous period" stroke={C.primary} strokeOpacity={0.3} strokeWidth={1.5} strokeDasharray="4 3" dot={false} activeDot={{ r: 3, fill: C.soft, stroke: '#fff' }} isAnimationActive={false} connectNulls={false} />
                <Area type="monotone" dataKey="value" name={metric.label} stroke={metric.color} strokeWidth={2} fill="url(#trend-fill)" dot={single ? { r: 4, strokeWidth: 2, fill: '#fff' } : false} activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
                {peak && (
                  <>
                    <ReferenceLine x={peak.period} stroke="#cbd5e1" strokeDasharray="3 3" />
                    <ReferenceDot
                      x={peak.period}
                      y={peak.value}
                      r={4}
                      fill={metric.color}
                      stroke="#fff"
                      strokeWidth={2}
                      label={<PeakLabel text={`Peak ${metric.format(peak.value)}`} anchor={peak.anchor} />}
                    />
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
            {single && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
                <p className="max-w-xs rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-center text-[11px] leading-relaxed text-slate-500 shadow-sm backdrop-blur-sm">
                  Only one bucket in this range has records, so there is no trend to plot yet. Widen the date range to compare periods.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  )
}

// ─── Team Today (the reference's calendar column) ─────────────────────────────

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

function Avatars({ names, max = 4 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max)
  const rest = names.length - shown.length
  return (
    <span className="flex items-center">
      {shown.map((n, i) => (
        <span
          key={n + i}
          title={n}
          className={cx('inline-flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold ring-2 ring-white', tintFor(n), i > 0 && '-ml-1.5')}
        >
          {initials(n)}
        </span>
      ))}
      {rest > 0 && <span className="-ml-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-500 ring-2 ring-white">+{rest}</span>}
    </span>
  )
}

interface HourGroup { key: number; label: string; rows: AttendanceDay[] }

function TeamTodayCard({ day, onDay, today, roster, staff, loading, error }: {
  day: string
  onDay: (iso: string) => void
  today: string
  roster: AttendanceDay[]
  staff: { user_id: string; staff_name: string | null; username: string | null }[]
  loading: boolean
  error: string | null
}) {
  const week = useMemo(() => weekOf(day), [day])
  const isToday = day === today

  const stats = useMemo(() => {
    const presentIds = new Set(roster.map((r) => r.user_id))
    const absent = staff.filter((m) => !presentIds.has(m.user_id))
    return {
      present: roster.filter((r) => r.present).length,
      stillIn: roster.filter((r) => r.still_in).length,
      onBreak: roster.filter((r) => r.on_break),
      late: roster.filter(isLateLogin),
      absent,
    }
  }, [roster, staff])

  // Clock-ins grouped by the hour they happened, in the org's clock — one "event" per hour
  // in the timeline, the way the reference lists meetings against 9 am / 10 am / 11 am.
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

  const dayLabel = new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <Panel className="flex lg:min-h-0 flex-1 flex-col p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-semibold text-slate-900">Team Today</h3>
          <InfoDot text={`Who clocked in on the selected day, by hour, in the org's clock (${ORG_TZ}). Late is judged against each person's expected login on the Staff page, or 9:00 AM where none is set.`} />
        </div>
        {/* Reads as the reference's month pill; on a past day it is the way back to today. */}
        <button
          type="button"
          onClick={() => onDay(today)}
          disabled={isToday}
          title={isToday ? undefined : 'Back to today'}
          className={cx(
            'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
            isToday ? 'border-slate-200 bg-white text-slate-600' : 'border-brand/40 bg-white text-brand hover:bg-slate-50',
          )}
        >
          <IconCal />
          {isToday ? 'Today' : dayLabel}
        </button>
      </div>

      {/* Week strip — the selected day gets the navy disc; future days can't be opened. */}
      <div className="mt-3 grid grid-cols-7 gap-0.5">
        {week.map((iso, i) => {
          const future = iso > today
          const active = iso === day
          const n = Number(iso.slice(-2))
          return (
            <button
              key={iso}
              disabled={future}
              onClick={() => onDay(iso)}
              className={cx('flex flex-col items-center gap-1 rounded-lg py-1 text-[10px] transition-colors', future ? 'cursor-not-allowed opacity-40' : 'hover:bg-slate-50')}
              aria-pressed={active}
              title={iso}
            >
              <span className={cx('font-medium', active ? 'text-slate-900' : 'text-slate-400')}>{WEEKDAYS[i]}</span>
              <span className={cx(
                'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                active ? 'bg-brand text-white shadow-sm' : iso === today ? 'text-brand' : 'text-slate-700',
              )}>
                {n}
              </span>
            </button>
          )
        })}
      </div>

      {/* Headcount chips. */}
      {!loading && !error && (
        <div className="mt-3 grid grid-cols-5 gap-1 text-center">
          {[
            { label: 'In', value: stats.present, cls: 'text-slate-900' },
            { label: 'Still in', value: stats.stillIn, cls: 'text-brand' },
            { label: 'Break', value: stats.onBreak.length, cls: 'text-brand' },
            { label: 'Late', value: stats.late.length, cls: stats.late.length ? 'text-rose-600' : 'text-slate-900' },
            { label: 'Absent', value: stats.absent.length, cls: stats.absent.length ? 'text-rose-600' : 'text-slate-900' },
          ].map((c) => (
            <div key={c.label} className="rounded-lg bg-slate-50 px-1 py-1.5">
              <div className={cx('text-sm font-bold tabular-nums', c.cls)}>{c.value}</div>
              <div className="text-[9px] font-medium uppercase tracking-wide text-slate-400">{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Timeline. Scrolls inside the card so the column matches the chart column's height. */}
      <div className="mt-3 max-h-80 lg:min-h-0 flex-1 overflow-y-auto pr-0.5 lg:max-h-none">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
          </div>
        ) : error ? (
          <EmptyHint message="Attendance data isn't available right now." />
        ) : roster.length === 0 && stats.absent.length === 0 ? (
          <EmptyHint message={isToday ? 'Nobody has clocked in yet today.' : 'No clock-ins were recorded on this day.'} />
        ) : (
          <ol className="relative space-y-2 border-l border-slate-200 pl-3">
            {roster.length === 0 && (
              <li className="relative">
                <span className="absolute -left-4.25 top-3 h-2 w-2 rounded-full bg-slate-300 ring-2 ring-white" />
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-[11px] text-slate-500">
                  {isToday ? 'Nobody has clocked in yet today.' : 'No clock-ins were recorded on this day.'}
                </div>
              </li>
            )}
            {isToday && stats.onBreak.length > 0 && (
              <li className="relative">
                <span className="absolute -left-4.25 top-3 h-2 w-2 rounded-full bg-brand ring-2 ring-white" />
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800">On break now</span>
                    <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-semibold text-brand">{stats.onBreak.length}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Avatars names={stats.onBreak.map(labelOf)} />
                    <span className="truncate text-[11px] text-slate-500">{stats.onBreak.map(labelOf).slice(0, 3).join(', ')}</span>
                  </div>
                </div>
              </li>
            )}
            {hours.map((g) => {
              const late = g.rows.filter(isLateLogin)
              const worst = late.reduce((m, r) => Math.max(m, loginLateMinutes(r) ?? 0), 0)
              return (
                <li key={g.key} className="relative">
                  <span className={cx('absolute -left-4.25 top-3 h-2 w-2 rounded-full ring-2 ring-white', late.length ? 'bg-rose-500' : 'bg-brand')} />
                  <div className="flex items-start gap-2">
                    <span className="w-11 shrink-0 pt-2 text-[10px] font-medium text-slate-400">{g.label}</span>
                    <div className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-800">{g.rows.length} clocked in</span>
                        <span className={cx('rounded-md px-1.5 py-0.5 text-[10px] font-semibold', late.length ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700')}>
                          {late.length ? `${late.length} late · ${gapLabel(worst)}` : 'On time'}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Avatars names={g.rows.map(labelOf)} />
                        <span className="truncate text-[11px] text-slate-500">
                          {g.rows.map(labelOf).slice(0, 2).join(', ')}{g.rows.length > 2 ? ` +${g.rows.length - 2}` : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
            {stats.absent.length > 0 && (
              <li className="relative">
                <span className="absolute -left-4.25 top-3 h-2 w-2 rounded-full bg-rose-400 ring-2 ring-white" />
                <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800">{isToday ? 'Not in yet' : 'Absent'}</span>
                    <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">{stats.absent.length}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Avatars names={stats.absent.map(labelOf)} />
                    <span className="truncate text-[11px] text-slate-500">
                      {stats.absent.map(labelOf).slice(0, 2).join(', ')}{stats.absent.length > 2 ? ` +${stats.absent.length - 2}` : ''}
                    </span>
                  </div>
                </div>
              </li>
            )}
          </ol>
        )}
      </div>

      <Link to="/attendance" className="mt-3 inline-flex items-center gap-1 self-end text-[11px] font-semibold text-brand hover:underline">
        Open Attendance <IconArrowR />
      </Link>
    </Panel>
  )
}

// ─── Lead Mix (the reference's Leads Management card) ─────────────────────────

type MixTab = 'outcome' | 'activity' | 'sources'

function MixTile({ label, value, unit, delta, deltaSuffix, tone }: {
  label: string
  value: string
  unit?: string
  delta?: number | null
  deltaSuffix?: string
  tone: Tone
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1">
      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{label}</span>
      <span className="flex shrink-0 items-baseline gap-1">
        <span className="text-sm font-bold tabular-nums text-slate-900">{value}</span>
        {unit && <span className="text-[10px] text-slate-400">{unit}</span>}
      </span>
      {delta !== undefined && <DeltaPill value={delta} tone={tone} suffix={deltaSuffix} />}
    </div>
  )
}

function LeadMixCard({ summary, prevSummary, sources, loading, sourcesLoading, canAccess }: {
  summary: Summary | null
  prevSummary: Summary | null
  sources: { name: string; cost: number; counted: number }[]
  loading: boolean
  sourcesLoading: boolean
  canAccess: (k: string) => boolean
}) {
  const [tab, setTab] = useState<MixTab>('outcome')
  const s = summary
  const total = sources.reduce((sum, r) => sum + r.cost, 0)
  const max = sources.reduce((m, r) => Math.max(m, r.cost), 0)
  return (
    <Panel className="flex lg:min-h-0 flex-col overflow-hidden p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-semibold text-slate-900">Lead Mix</h3>
          <InfoDot text="Outcome: what happened to the Leads delivered. Activity: how many buyers, campaigns and sheet rows were involved. Sources: campaign spend by traffic source." />
        </div>
      </div>
      <MiniTabs
        tabs={[{ id: 'outcome', label: 'Outcome' }, { id: 'activity', label: 'Activity' }, { id: 'sources', label: 'Sources' }]}
        value={tab}
        onChange={setTab}
      />
      <div className="mt-2 lg:min-h-0 flex-1 lg:overflow-y-auto overflow-x-hidden">
        {loading || !s ? (
          <div className="grid grid-cols-2 gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
        ) : tab === 'outcome' ? (
          <div className="grid grid-cols-1 gap-1.5">
            <MixTile label="Answered" value={num(s.answered)} unit="leads" delta={s.deltas.answered} tone="up-good" />
            <MixTile label="Missed" value={num(s.missed)} unit="leads" delta={changePct(prevSummary?.missed, s.missed)} tone="down-good" />
            <MixTile label="Counted (billable)" value={num(s.counted)} unit="leads" delta={s.deltas.counted} tone="up-good" />
            <MixTile label="Answer rate" value={`${s.answer_rate}%`} delta={s.point_deltas?.answer_rate} deltaSuffix="pp" tone="up-good" />
          </div>
        ) : tab === 'activity' ? (
          <div className="grid grid-cols-1 gap-1.5">
            <MixTile label="Active buyers" value={num(s.active_buyers)} delta={s.deltas.active_buyers} tone="up-good" />
            <MixTile label="Active campaigns" value={num(s.active_campaigns)} delta={s.deltas.active_campaigns} tone="up-good" />
            <MixTile label="Buyer rows" value={num(s.buyer_records)} unit="sheet rows" tone="up-good" />
            <MixTile label="Campaign rows" value={num(s.campaign_records)} unit="sheet rows" tone="up-good" />
          </div>
        ) : sourcesLoading ? (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-7 rounded-md" />)}</div>
        ) : sources.length === 0 ? (
          <EmptyHint message="No campaign spend was recorded in this period." />
        ) : (
          <ul className="space-y-2">
            {sources.slice(0, 5).map((r) => {
              const share = total > 0 ? (r.cost / total) * 100 : 0
              const w = max > 0 ? (r.cost / max) * 100 : 0
              return (
                <li key={r.name}>
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate font-semibold uppercase tracking-wide text-slate-700">{r.name}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">
                      <span className="font-semibold text-slate-800">{money(r.cost)}</span> · {share.toFixed(0)}%
                      {r.counted > 0 && <span className="text-slate-400"> · {money(r.cost / r.counted)}/lead</span>}
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(w, w > 0 ? 3 : 0)}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {/* Unit economics — what each counted Lead earned, cost and left over. */}
      {!loading && s && tab !== 'sources' && s.counted > 0 && (
        <div className="mt-3 grid grid-cols-3 divide-x divide-slate-200 rounded-lg bg-slate-50 py-2 text-center">
          {[
            { label: 'Revenue / lead', value: s.revenue / s.counted, cls: 'text-slate-900' },
            { label: 'Cost / lead', value: s.cost / s.counted, cls: 'text-slate-900' },
            { label: 'Profit / lead', value: s.margin / s.counted, cls: s.margin < 0 ? 'text-rose-600' : 'text-emerald-600' },
          ].map((u) => (
            <div key={u.label} className="px-1">
              <div className={cx('text-xs font-bold tabular-nums', u.cls)}>{u.value < 0 ? '−' : ''}${Math.abs(u.value).toFixed(2)}</div>
              <div className="text-[9px] font-medium uppercase tracking-wide text-slate-400">{u.label}</div>
            </div>
          ))}
        </div>
      )}
      {tab === 'sources' && canAccess('vendors') && (
        <Link to="/vendors" className="mt-3 inline-flex items-center gap-1 self-end text-[11px] font-semibold text-brand hover:underline">
          Traffic sources <IconArrowR />
        </Link>
      )}
    </Panel>
  )
}

// ─── Spend leaders (one wide card: Answer Rate + Top Buyers/Campaigns) ────────
//
// The money question the earlier dashboard answered across two ranked panels — who bills
// the most, who costs the most — put back in one wide card, with the half that was
// missing: the bottom of each list. Both ends sit side by side so the spread reads in one
// look. The crown, the rank badge and the per-row change against the previous period come
// from those old panels; the share bar and the tabs come from the card this replaces.

interface RankRow {
  key: string
  code: string
  name: string | null
  value: number
  share: number
  counted: number
  delta: number | null
}

/**
 * The two ends of a ranked list: the biggest `n`, and the smallest `n` counted up from the
 * bottom. With ten or fewer rows the lists would overlap, so the tail starts after the head.
 */
function endsOf(rows: RankRow[], n = 5): { top: RankRow[]; low: RankRow[] } {
  const top = rows.slice(0, n)
  return { top, low: rows.slice(Math.max(top.length, rows.length - n)).reverse() }
}

/** One figure in the card's summary strip. */
function LeaderStat({ label, value, foot, delta, tone }: {
  label: string
  value: string
  foot?: string
  delta?: number | null
  tone?: Tone
}) {
  return (
    <div className="flex min-w-0 shrink-0 flex-col justify-center rounded-lg bg-slate-50 px-2 py-1.5">
      <div className="flex items-center gap-1">
        <span className="truncate text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
        {delta !== undefined && tone && <DeltaPill value={delta} tone={tone} />}
      </div>
      <div className="truncate text-sm font-bold tabular-nums text-slate-900">{value}</div>
      {foot && <div className="truncate text-[9px] text-slate-400">{foot}</div>}
    </div>
  )
}

/** Green up / red down / grey flat, against the same entity in the previous period. */
function TrendArrow({ delta }: { delta: number | null }) {
  const flat = delta == null || delta === 0
  return (
    <span
      title={delta == null ? 'No comparable prior period' : `${signed(delta, '%')} vs previous period`}
      className={cx(
        'w-9 shrink-0 text-right text-[10px] font-bold tabular-nums',
        flat ? 'text-slate-300' : delta > 0 ? 'text-emerald-600' : 'text-rose-500',
      )}
    >
      {flat ? '–' : `${delta > 0 ? '↑' : '↓'}${Math.abs(delta).toFixed(0)}%`}
    </span>
  )
}

/**
 * One end of the ranking. `end` colours the whole column — navy and a crown for the
 * leaders, amber for the tail — and marks its first row with a label, so "top" and "low"
 * read without comparing the figures.
 */
function LeaderList({ end, title, hint, rows, max, unit, loading, empty }: {
  end: 'top' | 'low'
  title: string
  hint: string
  rows: RankRow[]
  /** The whole list's biggest value — every bar is drawn against it, so the tail looks small. */
  max: number
  /** "Revenue" or "Spend" — the column head over the figures. */
  unit: string
  loading: boolean
  empty: string
}) {
  const isTop = end === 'top'
  return (
    <div className="flex min-w-0 flex-col lg:min-h-0">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1">
        <div className="flex min-w-0 items-center gap-1">
          <span className={cx('inline-flex h-4 w-4 shrink-0 items-center justify-center rounded', isTop ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600')}>
            {isTop ? <IconCrown /> : <IconTrendDown />}
          </span>
          <h4 className="truncate text-[11px] font-bold uppercase tracking-wide text-slate-600">{title}</h4>
          <InfoDot text={hint} />
        </div>
        <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-slate-400">{unit}</span>
      </div>
      {loading ? (
        <div className="mt-1.5 space-y-1.5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-7 rounded-lg" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyHint message={empty} />
      ) : (
        <ol className="mt-1 flex lg:min-h-0 lg:flex-1 flex-col lg:justify-evenly">
          {rows.map((r, i) => (
            <li key={r.key} className="flex items-center gap-1.5 rounded-lg px-1 py-[3px] hover:bg-slate-50">
              <span
                className={cx(
                  'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[9px] font-bold tabular-nums',
                  i === 0
                    ? isTop ? 'bg-brand text-white' : 'bg-amber-500 text-white'
                    : 'bg-slate-100 text-slate-500',
                )}
              >
                {i + 1}
              </span>
              {/* Buyers and campaigns have no logo — the code's first three characters stand in. */}
              <span className={cx('inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold', tintFor(r.code))} aria-hidden>
                {codeInitials(r.code)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1">
                  <span className="truncate text-[11px] font-semibold text-slate-800">{r.code}</span>
                  {r.name && <span className="truncate text-[9px] text-slate-400">{r.name}</span>}
                  {i === 0 && (
                    <span className={cx('shrink-0 rounded px-1 text-[8px] font-bold uppercase tracking-wide', isTop ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600')}>
                      {isTop ? 'Highest' : 'Lowest'}
                    </span>
                  )}
                </span>
                <span className="mt-[3px] flex items-center gap-1">
                  <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <span
                      className={cx('block h-full rounded-full', isTop ? 'bg-brand' : 'bg-amber-400')}
                      style={{ width: `${max > 0 ? Math.max(2, (r.value / max) * 100) : 2}%` }}
                    />
                  </span>
                  <span className="w-7 shrink-0 text-right text-[9px] tabular-nums text-slate-400">{r.share.toFixed(r.share >= 10 ? 0 : 1)}%</span>
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[11px] font-bold tabular-nums text-slate-900">{moneyCompact(r.value)}</span>
                <span className="block text-[9px] tabular-nums text-slate-400">{num(r.counted)} leads</span>
              </span>
              <TrendArrow delta={r.delta} />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function SpendLeadersCard({ buyers, campaigns, summary, loading, caption, canAccess }: {
  buyers: RankRow[]
  campaigns: RankRow[]
  summary: Summary | null
  loading: boolean
  caption: string
  canAccess: (k: string) => boolean
}) {
  const [tab, setTab] = useState<'buyers' | 'campaigns'>('buyers')
  const isBuyers = tab === 'buyers'
  const rows = isBuyers ? buyers : campaigns
  const { top, low } = useMemo(() => endsOf(rows), [rows])
  const max = rows[0]?.value ?? 0
  const perm = isBuyers ? 'buyers' : 'campaigns'
  // Buyers are billed (revenue), campaigns are paid (Lead cost) — two sides of the same
  // money. Portal expenses stay out of the campaign total: no campaign carries them.
  const total = (isBuyers ? summary?.revenue : summary?.cost) ?? 0
  const active = (isBuyers ? summary?.active_buyers : summary?.active_campaigns) ?? 0
  const leader = rows[0]
  const tail = rows.length ? rows[rows.length - 1] : undefined
  return (
    <Panel className="flex lg:min-h-0 flex-col overflow-hidden p-3 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-semibold text-slate-900">
            {isBuyers ? 'Buyer Revenue' : 'Campaign Spend'} · Highest & Lowest
          </h3>
          <InfoDot text={isBuyers
            ? "Every buyer billed in the period, ranked by revenue: the five biggest beside the five smallest. Share is the buyer's part of the period's revenue; the arrow compares the buyer against itself in the previous period."
            : "Every campaign paid in the period, ranked by Lead cost: the five biggest beside the five smallest. Share is the campaign's part of the period's Expenses; the arrow compares the campaign against itself in the previous period."} />
        </div>
        <MiniTabs tabs={[{ id: 'buyers', label: 'Buyers' }, { id: 'campaigns', label: 'Campaigns' }]} value={tab} onChange={setTab} />
      </div>

      {/* Two columns: what the period came to on the left, who it came from on the right.
          Stacking the figures gives each one a whole line to itself and hands the width
          back to the names, which is where the reading actually happens. Below the
          breakpoint the figures go back to a 2×2 block above the lists. */}
      <div className="mt-2 grid lg:min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(8.5rem,0.85fr)_2.6fr] lg:overflow-y-auto no-scrollbar">
      {/* Each figure is the height of its own text — never a fixed share of the column, which
          on a short screen squeezed a value under the box below it. Leftover room goes
          between the boxes; when there is none, the body scrolls. The title and the tabs
          above stay put while it does, and the bar itself is hidden — see .no-scrollbar. */}
      <div className="grid shrink-0 grid-cols-2 gap-1.5 sm:grid-cols-4 lg:flex lg:flex-col lg:justify-between lg:gap-2">
        <LeaderStat
          label={isBuyers ? 'Total billed' : 'Total spend'}
          value={loading ? '—' : money(total)}
          delta={isBuyers ? summary?.deltas.revenue : summary?.deltas.cost}
          tone={isBuyers ? 'up-good' : 'down-good'}
          foot={caption}
        />
        <LeaderStat
          label={isBuyers ? 'Active buyers' : 'Active campaigns'}
          value={loading ? '—' : num(active)}
          foot={active > 0 ? `${money(total / active)} each on avg.` : undefined}
        />
        <LeaderStat
          label="Top of the list"
          value={leader ? leader.code : '—'}
          foot={leader ? `${money(leader.value)} · ${leader.share.toFixed(0)}% of the total` : undefined}
        />
        <LeaderStat
          label="Bottom of the list"
          value={tail ? tail.code : '—'}
          foot={tail ? `${money(tail.value)} · ${tail.share.toFixed(tail.share >= 10 ? 0 : 1)}% of the total` : undefined}
        />
      </div>

      {/* The two ends, side by side. */}
      <div className="grid lg:min-h-52 grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <LeaderList
          end="top"
          title={isBuyers ? 'Top 5 buyers' : 'Top 5 campaigns'}
          hint={isBuyers ? 'The five buyers that billed the most in this period.' : 'The five campaigns that cost the most in this period.'}
          rows={top}
          max={max}
          unit={isBuyers ? 'Revenue' : 'Spend'}
          loading={loading}
          empty={`No ${isBuyers ? 'buyer' : 'campaign'} activity in this period.`}
        />
        <LeaderList
          end="low"
          title={isBuyers ? 'Lowest 5 buyers' : 'Lowest 5 campaigns'}
          hint={isBuyers
            ? 'The five buyers that billed the least, smallest first — the accounts worth chasing or retiring.'
            : 'The five campaigns that cost the least, smallest first — the spend worth growing or cutting.'}
          rows={low}
          max={max}
          unit={isBuyers ? 'Revenue' : 'Spend'}
          loading={loading}
          empty={rows.length === 0
            ? `No ${isBuyers ? 'buyer' : 'campaign'} activity in this period.`
            : `Only ${rows.length} ${isBuyers ? 'buyer' : 'campaign'}${rows.length === 1 ? '' : 's'} billed in this period — every one is listed beside this.`}
        />
      </div>
      </div>

      <div className="mt-1.5 flex shrink-0 items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
        <p className="truncate text-[10px] text-slate-400">
          {rows.length > 0 && `Ranked over ${num(rows.length)} ${isBuyers ? 'buyer' : 'campaign'}${rows.length === 1 ? '' : 's'} with activity${rows.length >= RANK_LIMIT ? ` (the ${RANK_LIMIT} biggest)` : ''}`}
        </p>
        {canAccess(perm) && (
          <Link to={`/${perm}`} className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-brand hover:underline">
            View all <IconArrowR />
          </Link>
        )}
      </div>
    </Panel>
  )
}

// ─── Lead quality fallback (right column when Attendance isn't accessible) ────

function LeadQualityCard({ summary, loading }: { summary: Summary | null; loading: boolean }) {
  const answered = summary?.answered ?? 0
  const missed = summary?.missed ?? 0
  const total = answered + missed
  const size = 140
  const stroke = 16
  const r = size / 2 - stroke / 2 - 2
  const circ = 2 * Math.PI * r
  const aFrac = total ? answered / total : 0
  return (
    <Panel className="flex lg:min-h-0 flex-1 flex-col p-3">
      <div className="flex items-center gap-1">
        <h3 className="text-sm font-semibold text-slate-900">Lead Quality</h3>
        <InfoDot text="Share of Leads delivered to buyers that were picked up versus not, across the whole period." />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-4">
        {loading ? (
          <Skeleton className="h-36 w-36 rounded-full" />
        ) : total === 0 ? (
          <EmptyHint message="No answered or missed Leads were recorded in this period." />
        ) : (
          <>
            <div className="relative" style={{ width: size, height: size }}>
              <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }} aria-hidden>
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.soft} strokeWidth={stroke} />
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.primary} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${Math.max(0.1, aFrac * circ)} ${circ}`} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-bold tabular-nums text-slate-900">{summary?.answer_rate}%</span>
                <span className="text-[10px] text-slate-400">answered</span>
              </div>
            </div>
            <dl className="grid w-full grid-cols-2 gap-2 text-center">
              <div className="rounded-lg bg-slate-100 px-2 py-1.5">
                <dd className="text-sm font-bold tabular-nums text-brand">{num(answered)}</dd>
                <dt className="text-[10px] text-slate-500">Answered</dt>
              </div>
              <div className="rounded-lg bg-slate-100 px-2 py-1.5">
                <dd className="text-sm font-bold tabular-nums text-brand">{num(missed)}</dd>
                <dt className="text-[10px] text-slate-500">Missed</dt>
              </div>
            </dl>
          </>
        )}
      </div>
    </Panel>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  return <DashboardPage />
}

function DashboardPage() {
  const { canAccess } = useAuth()
  // Open on today, like every other date filter in the CRM; a wider window is an explicit
  // choice, never the default.
  const [range, setRange] = useState<Range>(todayRange)
  const [granularity, setGranularity] = useState<Granularity>('day')
  const [metricId, setMetricId] = useState<MetricId>('revenue')
  // Which page of the frame is showing. The staff view slides in over the overview and
  // slides back out; only one is mounted, so each keeps its own natural height/scroll.
  const [view, setView] = useState<'overview' | 'staff'>('overview')
  const showStaff = useCallback(() => setView('staff'), [])
  const showOverview = useCallback(() => setView('overview'), [])

  const prev = useMemo(() => previousPeriod(range.from, range.to), [range.from, range.to])
  const caption = comparisonLabel(range)
  const metric = METRICS.find((m) => m.id === metricId) ?? METRICS[0]

  const summary = useAsync(() => api.summary(range), [range.from, range.to])
  // The previous window's own summary gives the absolute movement the cards print beside
  // the figure ("+$1,240"), which the % deltas alone can't.
  const prevSummary = useAsync(() => api.summary(prev), [prev.from, prev.to])
  const trends = useAsync(() => api.trends({ ...range, granularity }), [range.from, range.to, granularity])
  const prevTrends = useAsync(() => api.trends({ ...prev, granularity }), [prev.from, prev.to, granularity])
  // Deep enough to hold both ends: the card shows the top five AND the bottom five, so it
  // needs the whole ranking, not just its head. 50 is the API's own ceiling.
  const topBuyers = useAsync(() => api.topBuyers({ ...range, limit: RANK_LIMIT }), [range.from, range.to])
  const topCampaigns = useAsync(() => api.topCampaigns({ ...range, limit: RANK_LIMIT }), [range.from, range.to])
  const topSources = useAsync(() => api.topSources({ ...range, limit: 20 }), [range.from, range.to])
  // Per-row change needs the previous window's ranking, matched by id.
  const prevBuyers = useAsync(() => api.topBuyers({ ...prev, limit: RANK_LIMIT }), [prev.from, prev.to])
  const prevCampaigns = useAsync(() => api.topCampaigns({ ...prev, limit: RANK_LIMIT }), [prev.from, prev.to])

  // Team Today reads the attendance roster in the org's clock. Hooks can't be conditional,
  // so a viewer without the Attendance page gets a resolved null and the fallback card.
  const canAttendance = canAccess('attendance')
  const today = useOrgToday()
  const [teamDay, setTeamDay] = useState(today)
  const roster = useAsync(() => (canAttendance ? api.attendanceRoster(teamDay) : Promise.resolve(null)), [teamDay, canAttendance])
  const staff = useAsync(() => (canAttendance ? api.attendanceStaff() : Promise.resolve(null)), [canAttendance])

  // "Last updated" is the moment the headline figures last changed — derived from the
  // summary result itself rather than written into state from an effect.
  const updatedAt = useMemo(() => (summary.data ? new Date() : null), [summary.data])

  const s = summary.data
  const ps = prevSummary.data
  const series = useMemo(() => trends.data ?? [], [trends.data])
  const prevSeries = useMemo(() => prevTrends.data ?? [], [prevTrends.data])

  const buyerRows: RankRow[] = useMemo(() => {
    const before = new Map((prevBuyers.data ?? []).map((b) => [b.id, b.revenue]))
    const total = s?.revenue ?? 0
    return (topBuyers.data ?? []).map((b) => ({
      key: String(b.id),
      code: b.code,
      name: b.name,
      value: b.revenue,
      share: total > 0 ? (b.revenue / total) * 100 : 0,
      counted: b.counted,
      delta: changePct(before.get(b.id), b.revenue),
    }))
  }, [topBuyers.data, prevBuyers.data, s?.revenue])

  const campaignRows: RankRow[] = useMemo(() => {
    const before = new Map((prevCampaigns.data ?? []).map((c) => [c.id, c.cost]))
    const total = s?.cost ?? 0
    return (topCampaigns.data ?? []).map((c) => ({
      key: String(c.id),
      code: c.code,
      name: c.name,
      value: c.cost,
      share: total > 0 ? (c.cost / total) * 100 : 0,
      counted: c.counted,
      delta: changePct(before.get(c.id), c.cost),
    }))
  }, [topCampaigns.data, prevCampaigns.data, s?.cost])

  const sources = useMemo(
    () => (topSources.data ?? []).map((r) => ({ name: r.source, cost: r.cost, counted: r.counted })),
    [topSources.data],
  )

  const rosterRows = useMemo(() => roster.data?.rows ?? [], [roster.data])

  const blocks = [summary, trends, topBuyers, topCampaigns, topSources]
  const failed = blocks.filter((b) => b.error)
  const refreshAll = () => [summary, prevSummary, trends, prevTrends, topBuyers, topCampaigns, topSources, prevBuyers, prevCampaigns, roster, staff].forEach((b) => b.reload())
  const refreshing = blocks.some((b) => b.refreshing)

  const exportCsv = () => {
    if (!s) return
    const row = (label: string, curr: number, before: number | undefined, delta: number | null | undefined, fmt = (v: number) => String(v)) =>
      [label, fmt(curr), before === undefined ? '' : fmt(before), delta == null ? '' : `${delta}%`]
    const rows: (string | number)[][] = [
      ['Platform-CRM dashboard', `${range.from} to ${range.to}`, `previous: ${prev.from} to ${prev.to}`, ''],
      ['Metric', 'This period', 'Previous period', 'Change'],
      row('Revenue (billed)', s.revenue, ps?.revenue, s.deltas.revenue, (v) => v.toFixed(2)),
      row('Expenses (Lead cost)', s.cost, ps?.cost, s.deltas.cost, (v) => v.toFixed(2)),
      row('Portal expenses', s.portal_expenses ?? 0, ps?.portal_expenses ?? 0, null, (v) => v.toFixed(2)),
      row('Profit', s.margin, ps?.margin, s.deltas.margin, (v) => v.toFixed(2)),
      ['Profit margin %', s.margin_pct, ps?.margin_pct ?? '', s.point_deltas?.margin_pct == null ? '' : `${s.point_deltas.margin_pct}pp`],
      row('Counted Leads', s.counted, ps?.counted, s.deltas.counted),
      row('Answered', s.answered, ps?.answered, s.deltas.answered),
      row('Missed', s.missed, ps?.missed, null),
      ['Answer rate %', s.answer_rate, ps?.answer_rate ?? '', s.point_deltas?.answer_rate == null ? '' : `${s.point_deltas.answer_rate}pp`],
      row('Active buyers', s.active_buyers, ps?.active_buyers, s.deltas.active_buyers),
      row('Active campaigns', s.active_campaigns, ps?.active_campaigns, s.deltas.active_campaigns),
      [],
      ['Period', 'Revenue', 'Expenses', 'Profit', 'Counted', 'Answered', 'Missed'],
      ...series.map((p) => [p.period, p.revenue.toFixed(2), p.cost.toFixed(2), p.margin.toFixed(2), p.counted, p.answered, p.missed]),
    ]
    downloadCsv(`dashboard_${fileDateRange(range.from, range.to)}.csv`, rows)
  }

  const perLead = (v: number) => (s && s.counted > 0 ? `${money(v / s.counted)} / lead` : undefined)

  const railBtn = 'inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors'

  return (
    // Plus Jakarta Sans, scoped to this page (inherited by children, incl. the Recharts SVG
    // text). Other pages keep the app-wide Poppins.
    //
    // One screen on desktop: the page takes the viewport height (the layout pads 1.5rem top
    // and bottom) and every band flexes to fit — KPI row and attention strip at their natural
    // height, the trend chart and the bottom row sharing what is left. Filters and actions
    // sit in a right rail that never moves; Team Today fills the rail beneath them and
    // scrolls inside itself. Below the desktop breakpoint the page scrolls as normal.
    <div
      className="flex flex-col text-slate-900 lg:h-[calc(100vh-3rem)] lg:overflow-hidden"
      style={{ fontFamily: "'Plus Jakarta Sans', 'Poppins', ui-sans-serif, system-ui, sans-serif" }}
    >
      {view === 'staff' ? (
        <div key="staff" className="animate-page-in-right flex min-h-0 flex-1 flex-col">
          <StaffDashboard onBack={showOverview} />
        </div>
      ) : (
      <div key="overview" className="animate-page-in-left flex min-h-0 flex-1 flex-col">
      {/* Title row. */}
      <div className="mb-3 flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h1 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">Dashboard</h1>
        <p className="text-xs text-slate-500">
          Leads, revenue, margin and the team · {formatDmy(range.from)}{range.from !== range.to && ` – ${formatDmy(range.to)}`}
        </p>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
          <IconCheck />
          {refreshing ? 'Refreshing…' : updatedAt ? `Last updated ${timeLabel(updatedAt)}` : 'Loading…'}
        </span>
      </div>

      <div className="flex lg:min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {/* Main column. */}
        <div className="flex lg:min-h-0 min-w-0 flex-1 flex-col gap-3">
          <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              label="Revenue"
              info="Total billed to buyers for Leads delivered in the selected period."
              value={s ? money(s.revenue) : '—'}
              delta={s?.deltas.revenue} tone="up-good"
              change={s && ps ? `${signedMoney(s.revenue - ps.revenue)} ${caption}` : null}
              foot={s ? perLead(s.revenue) : undefined}
              loading={summary.loading}
            />
            <KpiCard
              label="Expenses"
              info="Lead cost paid to campaigns and traffic sources, plus portal expenses for months the range covers in full. Falling Expenses is good news."
              value={s ? money(s.cost + (s.portal_expenses ?? 0)) : '—'}
              delta={s?.deltas.cost} tone="down-good"
              change={s && ps ? `${signedMoney(s.cost - ps.cost)} ${caption}` : null}
              foot={s ? (s.portal_expenses ? `incl. ${money(s.portal_expenses)} portal` : perLead(s.cost)) : undefined}
              loading={summary.loading}
            />
            <KpiCard
              label="Profit"
              info="Revenue minus Lead cost and portal expenses. Negative means the Leads and overheads cost more than they billed."
              value={s ? money(s.margin) : '—'}
              delta={s?.deltas.margin} tone="up-good"
              change={s && ps ? `${signedMoney(s.margin - ps.margin)} ${caption}` : null}
              foot={s ? `${s.margin_pct}% margin${s.point_deltas?.margin_pct != null ? ` (${signed(s.point_deltas.margin_pct, 'pp')})` : ''}` : undefined}
              loading={summary.loading}
            />
            <KpiCard
              label="Counted Leads"
              info="Billable Leads in the selected period. Not the same as answered Leads."
              value={s ? num(s.counted) : '—'}
              delta={s?.deltas.counted} tone="up-good"
              change={s && ps ? `${signedNum(s.counted - ps.counted)} ${caption}` : null}
              foot={s ? `${num(s.answered)} answered · ${num(s.missed)} missed` : undefined}
              loading={summary.loading}
            />
          </div>

          <TrendCard
            metric={metric}
            onMetric={setMetricId}
            summary={s}
            series={series}
            prevSeries={prevSeries}
            loading={trends.loading}
            caption={caption}
          />

          {/* Bottom row — three cells sharing the remaining height. */}
          <div className="grid lg:min-h-0 flex-[1.1] grid-cols-1 gap-3 md:grid-cols-3 md:[grid-template-rows:minmax(0,1fr)]">
            <LeadMixCard summary={s} prevSummary={ps} sources={sources} loading={summary.loading} sourcesLoading={topSources.loading} canAccess={canAccess} />
            <SpendLeadersCard
              buyers={buyerRows}
              campaigns={campaignRows}
              summary={s}
              loading={topBuyers.loading || topCampaigns.loading || summary.loading}
              caption={caption}
              canAccess={canAccess}
            />
          </div>

          {/* One banner for any block that failed — the rest of the page stays usable. */}
          {failed.length > 0 && (
            <div className="flex shrink-0 flex-col gap-2 rounded-xl border border-red-200 bg-red-50/70 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-red-500"><IconAlert /></span>
                <p className="text-xs text-red-700">
                  {failed[0].error}
                  {failed.length > 1 && ` (and ${failed.length - 1} other section${failed.length > 2 ? 's' : ''})`}
                  . Is the PHP API running on port 8000?
                </p>
              </div>
              <button
                onClick={refreshAll}
                className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 sm:self-auto"
              >
                <IconRefresh /> Retry
              </button>
            </div>
          )}
        </div>

        {/* Right rail — every filter and action, fixed; Team Today fills the rest. */}
        <aside className="contents lg:flex lg:min-h-0 lg:w-64 lg:shrink-0 lg:flex-col lg:gap-3">
          <Panel className="order-first shrink-0 p-3 lg:order-none">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Filters</div>
            <div className="space-y-2.5">
              <div>
                <div className="mb-1 text-[11px] font-medium text-slate-500">Period</div>
                {/* Dark date box, per the client's request; stretched to the rail's width. */}
                <div className="[&_button]:w-full [&_button]:justify-between [&_button]:whitespace-nowrap [&_button]:px-2.5 [&_button]:text-xs">
                  <DateRangeControl value={range} onChange={setRange} tone="dark" />
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium text-slate-500">Time bucket</div>
                <div className="grid grid-cols-3 rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="Time bucket">
                  {GRANULARITIES.map((g) => (
                    <button
                      key={g.value}
                      onClick={() => setGranularity(g.value)}
                      aria-pressed={granularity === g.value}
                      title={{ day: 'Daily', '4day': 'Every 4 days', week: 'Weekly' }[g.value]}
                      className={cx(
                        'rounded-md py-1 text-[11px] font-semibold transition-colors',
                        granularity === g.value ? 'bg-brand text-white shadow-sm' : 'text-slate-500 hover:text-slate-900',
                      )}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium text-slate-500">Chart metric</div>
                <label className="relative block">
                  <select
                    value={metric.id}
                    onChange={(e) => setMetricId(e.target.value as MetricId)}
                    aria-label="Chart metric"
                    className="w-full cursor-pointer appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-2.5 pr-7 text-xs font-medium text-slate-800 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                  >
                    {METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"><IconChevD /></span>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-2.5">
                <button
                  onClick={refreshAll}
                  className={cx(railBtn, 'border-white/10 bg-linear-to-b from-brand to-brand-dark text-slate-100 shadow-md shadow-slate-900/20 hover:from-brand-dark hover:to-brand-dark')}
                >
                  <span className={cx(refreshing && 'animate-spin')}><IconRefresh /></span> Refresh
                </button>
                <button onClick={exportCsv} disabled={!s} className={cx(railBtn, 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50')}>
                  <IconDownload /> CSV
                </button>
                {canAccess('complete-report') && (
                  <Link to="/complete-report" className={cx(railBtn, 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}>
                    <IconReport /> Report
                  </Link>
                )}
                {/* Opens the staff overlay in place — the manager stays on the dashboard. */}
                {canAccess('staff') && (
                  <button onClick={showStaff} className={cx(railBtn, 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}>
                    <IconUsers /> Staff
                  </button>
                )}
              </div>
            </div>
          </Panel>

          <div className="order-last flex lg:min-h-0 flex-1 flex-col lg:order-none">
          {canAttendance ? (
            <TeamTodayCard
              day={teamDay}
              onDay={setTeamDay}
              today={today}
              roster={rosterRows}
              staff={staff.data ?? []}
              loading={roster.loading}
              error={roster.error}
            />
          ) : (
            <LeadQualityCard summary={s} loading={summary.loading} />
          )}
          </div>
        </aside>
      </div>

      </div>
      )}
    </div>
  )
}

