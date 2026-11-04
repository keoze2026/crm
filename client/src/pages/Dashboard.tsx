// Dashboard — management overview of Leads, revenue, margin and the team's day.
//
// Built to the dashboard design (docs/design/Dashboard-Design-Principles.pdf). A main column
// that reads top to bottom as a story about the money, beside a right rail of controls and
// the team's day:
//
//   header         → title, the range written out with its length, "Updated" time
//   KPI cards      → Revenue · Expenses · Profit · Counted leads, each with a plain-words
//                    comparison against the previous period of the same length
//   chart          → the chosen metric as bars per bucket, the peak bar in navy
//   ranking table  → buyers / campaigns / dates: top five, the bottom five, the rest folded
//   revenue flow   → where every billed dollar went: spend, portal, profit
//   lead mix       → what happened to the calls, with the per-lead economics
//   right rail     → period, time bucket, chart metric, refresh, CSV / Report / Staff,
//                    then Team today
//
// Palette: white panels on slate, the navbar's navy as the one accent, green only for
// profit and red only for something bad (a loss, late, absent, missed).
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
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
import { isLateLogin, labelOf } from '../lib/attendanceReports'
import {
  BUCKET_UNIT,
  barLabel,
  bucketCount,
  shareLabel,
  shareOf,
  splitEnds,
  type Granularity,
} from '../lib/dashboard'
import {
  fileDateRange,
  formatPeriod,
  formatRangeLong,
  money,
  moneyCompact,
  num,
  previousPeriod,
  rangeDays,
  todayRange,
} from '../lib/format'
import { ORG_TZ } from '../lib/staff'
import { BRAND } from '../lib/theme'
import { useAsync } from '../lib/useAsync'
import { useOrgToday } from '../lib/useOrgToday'
import type { AttendanceDay, LeaveDay, Summary, TrendPoint } from '../types'

/** How deep the buyer/campaign rankings are fetched — the API's own ceiling. */
const RANK_LIMIT = 500

const GRANULARITIES: { value: Granularity; label: string; title: string }[] = [
  { value: 'day', label: '1D', title: 'Daily' },
  { value: '4day', label: '4D', title: 'Every 4 days' },
  { value: 'week', label: '1W', title: 'Weekly' },
]

/** Profit green — the one place green appears on the page. */
const PROFIT = '#047857'
/** Loss dark red — the loss segment, its key dot and negative chart bars, always solid. */
const LOSS = '#b91c1c'
const GRID = '#eef2f6'
const AXIS = '#64748b'

/** Whether a rising number is good news for this metric (Expenses is the one where it isn't). */
type Tone = 'up-good' | 'down-good'

// ─── Formatting helpers ───────────────────────────────────────────────────────

/** % change with the same "no baseline → null" rule the API uses. */
function changePct(prev: number | undefined, curr: number): number | null {
  if (prev === undefined) return null
  if (prev === 0) return curr === 0 ? 0 : null
  return Number((((curr - prev) / Math.abs(prev)) * 100).toFixed(1))
}

/** "previous 90 days" / "previous day" — the comparison window always matches the range. */
function previousLabel(range: Range): string {
  const days = rangeDays(range.from, range.to)
  return days <= 1 ? 'previous day' : `previous ${num(days)} days`
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Money with a real minus sign, for outflows and losses. */
const signedMoney = (v: number) => `${v < 0 ? '−' : ''}${money(Math.abs(v))}`

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
const IconChevD = () => svg(<polyline points="6 9 12 15 18 9" />, 12)
const IconAlert = () => svg(<><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" /></>, 16)
const IconSearch = () => svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>, 13)

// ─── Small building blocks ────────────────────────────────────────────────────

/**
 * Flat white panel: hairline border, no heavy shadow. `dim` fades it while a refresh is in
 * flight, so stale numbers never pass for fresh ones.
 */
function Panel({ children, className, dim }: { children: ReactNode; className?: string; dim?: boolean }) {
  return (
    <section
      aria-busy={dim || undefined}
      className={cx('rounded-xl border border-slate-200 bg-white transition-opacity duration-200 motion-reduce:transition-none', dim && 'opacity-60', className)}
    >
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
      className="inline-flex shrink-0 cursor-help text-slate-400 transition-colors hover:text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
      </svg>
    </button>
  )
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-slate-100 motion-reduce:animate-none', className)} />
}

/**
 * "▲ 12.4%" — the glyph follows the raw sign, the colour follows whether that movement is
 * good for the metric. Expenses going up is red; going down is green.
 */
function DeltaPill({ value, tone }: { value: number | null | undefined; tone: Tone }) {
  if (value === undefined || value === null) return null
  const good = value === 0 ? null : tone === 'up-good' ? value > 0 : value < 0
  return (
    <span
      className={cx(
        'inline-flex items-center gap-0.5 rounded px-1 py-px text-[11px] font-semibold tabular-nums',
        good === null ? 'bg-slate-100 text-slate-600' : good ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
      )}
    >
      {value === 0 ? '±' : value > 0 ? '▲' : '▼'} {num(Math.abs(value))}%
    </span>
  )
}

/** Grey segmented tabs with a raised white active segment. */
function Segmented<T extends string>({ tabs, value, onChange, label }: {
  tabs: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
  label: string
}) {
  return (
    <div className="flex w-fit max-w-full rounded-lg bg-slate-100 p-0.5" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'rounded-md px-3 py-1 text-xs font-medium transition-colors',
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
    <div className={cx('flex h-full flex-col items-center justify-center gap-1.5 py-8 text-center', className)}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-slate-300" aria-hidden>
        <path d="M3 3v18h18" /><path d="m7 15 3.5-3.5 3 3L21 7" />
      </svg>
      <p className="max-w-[30ch] text-xs text-slate-500">{message}</p>
    </div>
  )
}

/** A comparison sentence: "Previous 90 days: $26,713.32 ▲ 12.4%", or why there is none. */
function Compare({ children }: { children: ReactNode }) {
  return <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">{children}</span>
}

// ─── KPI cards ────────────────────────────────────────────────────────────────

/**
 * Label with its definition, the figure in full (cents included), one line that explains
 * the figure, then — under a hairline — the comparison against the previous period.
 */
function KpiCard({ label, info, value, valueClass, sub, compare, loading, dim }: {
  label: string
  info: string
  value: string
  valueClass?: string
  sub: ReactNode
  compare: ReactNode
  loading: boolean
  dim?: boolean
}) {
  return (
    <Panel className="flex flex-col p-4" dim={dim}>
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-slate-600">
        {label}
        <InfoDot text={info} />
      </span>
      {loading ? (
        <>
          <Skeleton className="mt-2 h-7 w-36" />
          <Skeleton className="mt-2 h-3 w-40" />
        </>
      ) : (
        <>
          <div className={cx('mt-1.5 text-[26px] font-bold leading-tight tracking-tight tabular-nums', valueClass ?? 'text-slate-900')}>{value}</div>
          <div className="mt-1 text-xs text-slate-500">{sub}</div>
        </>
      )}
      <div className="mt-auto pt-3">
        <div className="border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">{loading ? <Skeleton className="h-3 w-32" /> : compare}</div>
      </div>
    </Panel>
  )
}

// ─── Chart ────────────────────────────────────────────────────────────────────

type MetricId = 'revenue' | 'cost' | 'margin' | 'counted'

interface Metric {
  id: MetricId
  label: string
  /** The word used in "No revenue in previous 90 days". */
  noun: string
  kind: 'money' | 'count'
  format: (v: number) => string
  axis: (v: number) => string
  pick: (p: TrendPoint) => number
  tone: Tone
}

const METRICS: Metric[] = [
  { id: 'revenue', label: 'Revenue', noun: 'revenue', kind: 'money', format: money, axis: moneyCompact, pick: (p) => p.revenue, tone: 'up-good' },
  { id: 'cost', label: 'Expenses', noun: 'expenses', kind: 'money', format: money, axis: moneyCompact, pick: (p) => p.cost, tone: 'down-good' },
  { id: 'margin', label: 'Profit', noun: 'profit', kind: 'money', format: signedMoney, axis: moneyCompact, pick: (p) => p.margin, tone: 'up-good' },
  { id: 'counted', label: 'Counted leads', noun: 'leads', kind: 'count', format: num, axis: (v) => num(v), pick: (p) => p.counted, tone: 'up-good' },
]

interface TooltipProps {
  active?: boolean
  payload?: { value: number }[]
  label?: string
}

function BarTooltip({ active, payload, label, metric }: TooltipProps & { metric: Metric }) {
  if (!active || !payload?.length) return null
  const v = payload[0].value
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] shadow-lg">
      {label && <div className="font-semibold text-slate-700">{formatPeriod(label)}</div>}
      <div className={cx('font-semibold tabular-nums', v < 0 ? 'text-red-600' : 'text-slate-900')}>{metric.label}: {metric.format(v)}</div>
    </div>
  )
}

/**
 * The metric per bucket as bars. Only buckets with activity are drawn (the caption says how
 * many of the range's buckets that is), the peak bar is navy and the rest a light navy, and
 * each bar carries its value on top while there are few enough bars to read them.
 */
function ChartCard({ metric, granularity, range, series, prevSeries, loading, dim, prevLabel, portalNote }: {
  metric: Metric
  granularity: Granularity
  range: Range
  series: TrendPoint[]
  prevSeries: TrendPoint[]
  loading: boolean
  dim: boolean
  prevLabel: string
  /** Day/4-day/week buckets never carry portal expenses — say so under Expenses and Profit. */
  portalNote: boolean
}) {
  const data = useMemo(
    () => series.map((p) => ({ period: p.period, value: metric.pick(p) })).filter((d) => d.value !== 0),
    [series, metric],
  )
  const total = useMemo(() => series.reduce((s, p) => s + metric.pick(p), 0), [series, metric])
  const prevTotal = useMemo(() => prevSeries.reduce((s, p) => s + metric.pick(p), 0), [prevSeries, metric])
  const prevHas = prevSeries.some((p) => metric.pick(p) !== 0)
  const peakIdx = useMemo(() => data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0), [data])
  const peak = data[peakIdx]
  const buckets = bucketCount(range.from, range.to, granularity)
  const unit = BUCKET_UNIT[granularity]
  const showAllLabels = data.length <= 16
  const hasNegative = data.some((d) => d.value < 0)

  const caption = data.length === 0
    ? `No ${metric.noun} in this period`
    : `${metric.label} landed on ${num(data.length)} of ${num(buckets)} ${buckets === 1 ? unit.one : unit.many}` +
      (peak && data.length > 1 ? ` · peak ${metric.format(peak.value)} on ${granularity === 'week' ? 'week of ' : ''}${formatPeriod(peak.period)}` : '') +
      (portalNote && (metric.id === 'cost' || metric.id === 'margin') ? ' · before portal expenses' : '')

  return (
    <Panel className="p-4" dim={dim}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-slate-600">{metric.label} {unit.title}</div>
          {loading ? (
            <Skeleton className="mt-1.5 h-7 w-40" />
          ) : (
            <div className={cx('mt-0.5 text-2xl font-bold tracking-tight tabular-nums', total < 0 ? 'text-red-600' : 'text-slate-900')}>{metric.format(total)}</div>
          )}
          <div className="mt-0.5 text-xs text-slate-500">{loading ? ' ' : caption}</div>
        </div>
        {!loading && (
          <div className="shrink-0 text-xs text-slate-500">
            {prevHas ? (
              <Compare>
                {cap(prevLabel)}: <span className="font-medium text-slate-700">{metric.format(prevTotal)}</span>
                <DeltaPill value={changePct(prevTotal, total)} tone={metric.tone} />
              </Compare>
            ) : (
              `No ${metric.noun} in ${prevLabel}`
            )}
          </div>
        )}
      </div>

      <div className="mt-3 h-64">
        {loading ? (
          <div className="flex h-full items-end gap-3 px-12 pb-6 pt-4">
            {[45, 52, 92, 86].map((h, i) => (
              <div key={i} className="flex-1 animate-pulse rounded-t bg-slate-100 motion-reduce:animate-none" style={{ height: `${h}%` }} />
            ))}
          </div>
        ) : data.length === 0 ? (
          <EmptyHint message={`No ${metric.noun} was recorded in this period. Try a wider date range.`} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} barCategoryGap="24%">
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis
                dataKey="period"
                tickFormatter={formatPeriod}
                tick={{ fontSize: 11, fill: AXIS }}
                tickLine={false}
                axisLine={{ stroke: '#e2e8f0' }}
                minTickGap={16}
                interval="preserveStartEnd"
                tickMargin={8}
              />
              <YAxis tickFormatter={metric.axis} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={52} tickMargin={4} tickCount={5} />
              {hasNegative && <ReferenceLine y={0} stroke="#94a3b8" />}
              <Tooltip content={<BarTooltip metric={metric} />} cursor={{ fill: '#f1f5f9' }} />
              <Bar dataKey="value" maxBarSize={64} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                {data.map((d, i) => (
                  <Cell key={d.period} fill={d.value < 0 ? LOSS : BRAND} fillOpacity={d.value < 0 || i === peakIdx ? 1 : 0.42} />
                ))}
                <LabelList
                  dataKey="value"
                  content={(p) => {
                    const i = Number(p.index)
                    if (!showAllLabels && i !== peakIdx) return null
                    const v = Number(p.value)
                    const x = Number(p.x) + Number(p.width) / 2
                    const y = Number(p.y) - 6
                    const isPeak = i === peakIdx
                    return (
                      <text x={x} y={v < 0 ? Number(p.y) + Number(p.height) + 14 : y} textAnchor="middle" fontSize={11} fontWeight={isPeak ? 700 : 500} fill={isPeak ? '#0f172a' : '#334155'}>
                        {barLabel(v, metric.kind, isPeak)}
                      </text>
                    )
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  )
}

// ─── Ranking table (buyers / campaigns / by date) ─────────────────────────────

type RankTab = 'buyers' | 'campaigns' | 'dates'

interface RankRow {
  key: string
  rank: number
  label: string
  name: string | null
  value: number
  counted: number
  /** The last column: a first–last date span, or answered/missed for a date row. */
  extra: string
}

function StatTile({ label, value, foot }: { label: string; value: string; foot?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2">
      <div className="truncate text-[11px] text-slate-500">{label}</div>
      <div className="truncate text-sm font-bold tabular-nums text-slate-900">{value}</div>
      {foot && <div className="truncate text-[11px] text-slate-500">{foot}</div>}
    </div>
  )
}

function RankTableRow({ r, max, total, tone }: { r: RankRow; max: number; total: number; tone: 'top' | 'mid' | 'low' }) {
  const share = shareOf(r.value, total)
  const w = max > 0 ? Math.max(1.5, (r.value / max) * 100) : 0
  return (
    <tr className="border-b border-slate-100 last:border-b-0">
      <td className="py-2.5 pl-1 pr-2 text-xs tabular-nums text-slate-500">{r.rank}</td>
      <td className="max-w-[12rem] py-2.5 pr-3">
        <span className="block truncate text-[13px] font-semibold text-slate-900" title={r.name ?? undefined}>{r.label}</span>
      </td>
      <td className="py-2.5 pr-4 text-right text-[13px] font-semibold tabular-nums text-slate-900">{money(r.value)}</td>
      <td className="py-2.5 pr-4">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-slate-100">
            <span
              className={cx('block h-full rounded-full', tone === 'top' ? 'bg-brand' : tone === 'low' ? 'bg-red-500' : 'bg-slate-400')}
              style={{ width: `${w}%` }}
            />
          </span>
          <span className="w-12 text-right text-xs tabular-nums text-slate-600">{shareLabel(share)}</span>
        </div>
      </td>
      <td className="py-2.5 pr-4 text-right text-[13px] tabular-nums text-slate-700">{num(r.counted)}</td>
      <td className="py-2.5 pr-4 text-right text-[13px] tabular-nums text-slate-700">{r.counted > 0 ? money(r.value / r.counted) : '—'}</td>
      <td className="whitespace-nowrap py-2.5 pr-1 text-xs text-slate-500">{r.extra}</td>
    </tr>
  )
}

function RankingCard({ buyers, campaigns, dates, summary, loading, dim, rangeLabel, canAccess }: {
  buyers: RankRow[]
  campaigns: RankRow[]
  dates: RankRow[]
  summary: Summary | null
  loading: boolean
  dim: boolean
  rangeLabel: string
  canAccess: (k: string) => boolean
}) {
  const [tab, setTab] = useState<RankTab>('buyers')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)

  const rows = tab === 'buyers' ? buyers : tab === 'campaigns' ? campaigns : dates
  const isDates = tab === 'dates'
  const total = (tab === 'campaigns' ? summary?.cost : summary?.revenue) ?? 0
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0)

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? rows.filter((r) => r.label.toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q)) : rows),
    [rows, q],
  )
  // Dates read in calendar order and are never folded; a search shows every match.
  const { head, middle, tail } = useMemo(
    () => (q || isDates || expanded ? { head: filtered, middle: [], tail: [] } : splitEnds(filtered)),
    [filtered, q, isDates, expanded],
  )

  const byValue = isDates ? [...rows].sort((a, b) => b.value - a.value) : rows
  const leader = byValue[0]
  const tail1 = byValue.length ? byValue[byValue.length - 1] : undefined
  const top5 = byValue.slice(0, 5).reduce((s, r) => s + r.value, 0)

  const noun = tab === 'buyers' ? { one: 'buyer', many: 'buyers' } : tab === 'campaigns' ? { one: 'campaign', many: 'campaigns' } : { one: 'day', many: 'days' }
  const valueHead = tab === 'campaigns' ? 'Spend' : 'Revenue'
  const title = tab === 'buyers' ? 'Revenue by buyer' : tab === 'campaigns' ? 'Spend by campaign' : 'Revenue by date'
  const subtitle = isDates
    ? `${num(rows.length)} ${rows.length === 1 ? 'day' : 'days'} with revenue · in date order · ${rangeLabel}`
    : `${num(rows.length)} active ${rows.length === 1 ? noun.one : noun.many} · ranked by ${valueHead.toLowerCase()} · ${rangeLabel}`
  const link = tab === 'buyers' ? { to: '/buyers', perm: 'buyers' } : tab === 'campaigns' ? { to: '/campaigns', perm: 'campaigns' } : { to: '/records', perm: null }

  const switchTab = (t: RankTab) => { setTab(t); setExpanded(false) }
  const shown = head.length + tail.length

  return (
    <Panel className="p-4" dim={dim}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"><IconSearch /></span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              aria-label={`Search ${noun.many}`}
              className="w-44 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <Segmented
            label="Ranking"
            tabs={[{ id: 'buyers', label: 'Buyers' }, { id: 'campaigns', label: 'Campaigns' }, { id: 'dates', label: 'By date' }]}
            value={tab}
            onChange={switchTab}
          />
        </div>
      </div>

      {/* Five figures that summarise the table before it is read. */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label={tab === 'campaigns' ? 'Total spend' : 'Total billed'} value={loading ? '—' : money(total)} foot={isDates ? `${num(rows.length)} days` : `all ${noun.many}`} />
        <StatTile
          label={isDates ? 'Days with revenue' : `Active ${noun.many}`}
          value={loading ? '—' : num(rows.length)}
          foot={rows.length > 0 ? `${money(total / rows.length)} avg ${isDates ? 'per day' : 'each'}` : undefined}
        />
        <StatTile label={isDates ? 'Best day' : `Top ${noun.one}`} value={leader?.label ?? '—'} foot={leader ? `${money(leader.value)} · ${shareLabel(shareOf(leader.value, total))}` : undefined} />
        <StatTile label={isDates ? 'Quietest day' : `Lowest ${noun.one}`} value={tail1?.label ?? '—'} foot={tail1 ? `${money(tail1.value)} · ${shareLabel(shareOf(tail1.value, total))}` : undefined} />
        <StatTile label={isDates ? 'Top 5 days share' : 'Top 5 share'} value={rows.length ? shareLabel(shareOf(top5, total)) : '—'} foot={rows.length ? `${money(top5)} of ${valueHead.toLowerCase()}` : undefined} />
      </div>

      <div className={cx('mt-3 overflow-x-auto', isDates && 'max-h-[28rem] overflow-y-auto')}>
        {loading ? (
          <div className="space-y-2 pt-1">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyHint message={q ? `No ${noun.one} matches “${query.trim()}”.` : `No ${noun.one} activity in this period.`} />
        ) : (
          <table className="table-dash w-full min-w-[40rem] border-collapse text-left">
            <thead className={cx(isDates && 'sticky top-0 bg-white')}>
              <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-2 pl-1 pr-2 font-semibold">#</th>
                <th className="py-2 pr-3 font-semibold">{isDates ? 'Date' : noun.one}</th>
                <th className="py-2 pr-4 text-right font-semibold">{valueHead}</th>
                <th className="py-2 pr-4 font-semibold">Share</th>
                <th className="py-2 pr-4 text-right font-semibold">Leads</th>
                <th className="py-2 pr-4 text-right font-semibold">$ / lead</th>
                <th className="py-2 pr-1 font-semibold">{isDates ? 'Answered · missed' : 'First – last date'}</th>
              </tr>
            </thead>
            <tbody>
              {head.map((r) => <RankTableRow key={r.key} r={r} max={max} total={total} tone={q || isDates || expanded ? 'mid' : 'top'} />)}
              {middle.length > 0 && (
                <tr className="border-b border-slate-100">
                  <td colSpan={7} className="p-0">
                    <button
                      type="button"
                      onClick={() => setExpanded(true)}
                      title="Show every row"
                      className="w-full bg-slate-50 py-2 text-center text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                    >
                      Ranks {middle[0].rank}–{middle[middle.length - 1].rank} · {num(middle.length)} more {noun.many} · {money(middle.reduce((s, r) => s + r.value, 0))} combined
                    </button>
                  </td>
                </tr>
              )}
              {tail.map((r) => <RankTableRow key={r.key} r={r} max={max} total={total} tone="low" />)}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        <p className="text-slate-500">
          {q
            ? `${num(filtered.length)} of ${num(rows.length)} ${noun.many} match`
            : middle.length > 0
            ? `Showing top ${head.length} and bottom ${tail.length} of ${num(rows.length)}`
            : rows.length > 0
            ? `Showing all ${num(shown)} ${shown === 1 ? noun.one : noun.many}${!isDates && rows.length >= RANK_LIMIT ? ` (the ${RANK_LIMIT} biggest)` : ''}`
            : ''}
          {expanded && !q && (
            <button type="button" onClick={() => setExpanded(false)} className="ml-2 font-medium text-brand hover:underline">Fold the middle</button>
          )}
        </p>
        {(link.perm === null || canAccess(link.perm)) && (
          <Link to={link.to} className="shrink-0 font-semibold text-brand hover:underline">
            {isDates ? 'Open Daily Sheet →' : `View all ${num(rows.length)} ${noun.many} →`}
          </Link>
        )}
      </div>
    </Panel>
  )
}

// ─── Where the revenue went ───────────────────────────────────────────────────

function FlowItem({ swatch, label, sub, value, valueClass }: {
  swatch: string
  label: string
  sub: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: swatch }} aria-hidden />
      <div className="min-w-0 flex-1">
        {/* Label and value share a line while they fit; a long value drops beneath the label. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="whitespace-nowrap text-[13px] text-slate-800">{label}</span>
          <span className={cx('text-sm font-semibold tabular-nums', valueClass ?? 'text-slate-900')}>{value}</span>
        </div>
        <div className="text-[11px] leading-snug text-slate-500">{sub}</div>
      </div>
    </div>
  )
}

/**
 * One bar that splits every billed dollar into what it paid for: traffic spend, portal
 * expenses and what was left. Nothing new is computed — it is the KPI row, drawn as parts
 * of a whole.
 */
function RevenueFlowCard({ summary, loading, dim }: { summary: Summary | null; loading: boolean; dim: boolean }) {
  const s = summary
  const lightNavy = 'rgba(31, 78, 140, 0.42)'
  if (loading || !s) {
    return (
      <Panel className="p-4" dim={dim}>
        <h2 className="text-sm font-semibold text-slate-900">Where the revenue went</h2>
        <Skeleton className="mt-3 h-6" />
        <div className="mt-4 grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      </Panel>
    )
  }
  const rev = s.revenue
  const portal = s.portal_expenses ?? 0
  const spend = s.cost
  const out = spend + portal
  const per = (v: number) => (s.counted > 0 ? money(v / s.counted) : '—')
  // A loss means spend outgrew revenue: the bar is drawn against the spend instead.
  const whole = Math.max(rev, out)
  const pSpend = shareOf(spend, whole)
  const pPortal = shareOf(portal, whole)
  const pProfit = s.margin > 0 ? shareOf(s.margin, whole) : 0
  const ofRev = (v: number) => (rev > 0 ? `${(v / rev * 100).toFixed(1)}%` : '—')
  const dollar = (v: number) => (rev > 0 ? `$${(v / rev).toFixed(2)}` : '—')

  return (
    <Panel className="p-4" dim={dim}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Where the revenue went</h2>
        {rev > 0 && (
          <p className="text-xs text-slate-500">
            Every $1 billed → {dollar(spend)} traffic spend · {dollar(portal)} portal · {s.margin < 0 ? <span className="text-red-600">−{dollar(-s.margin)} loss</span> : `${dollar(s.margin)} profit`}
          </p>
        )}
      </div>

      {rev === 0 && out === 0 ? (
        <EmptyHint message="Nothing was billed or spent in this period." />
      ) : (
        <>
          <div className="relative mt-3 flex h-6 overflow-hidden rounded-md bg-slate-100" role="img" aria-label={`Spend ${ofRev(spend)}, portal ${ofRev(portal)}, profit ${ofRev(s.margin)} of revenue`}>
            {pSpend > 0 && (
              <div className="flex items-center px-2 text-[11px] font-semibold text-slate-900" style={{ width: `${pSpend}%`, background: lightNavy }}>
                {pSpend >= 8 && ofRev(spend)}
              </div>
            )}
            {pPortal > 0 && <div className="border-l border-white" style={{ width: `${pPortal}%`, background: BRAND }} title={`Portal ${ofRev(portal)}`} />}
            {pProfit > 0 && (
              <div className="flex items-center justify-center border-l border-white text-[11px] font-semibold text-white" style={{ width: `${pProfit}%`, background: PROFIT }}>
                {pProfit >= 6 && `${s.margin_pct}%`}
              </div>
            )}
            {s.margin < 0 && (
              // The stretch of spend that revenue did not cover — the loss, in red.
              <div
                className="absolute inset-y-0 right-0 flex items-center justify-end border-l border-white bg-red-700 px-2 text-[11px] font-semibold text-white"
                style={{ left: `${shareOf(rev, whole)}%` }}
                title={`Loss ${money(-s.margin)}`}
              >
                {shareOf(-s.margin, whole) >= 6 && `${s.margin_pct}%`}
              </div>
            )}
          </div>
          {s.margin < 0 && (
            <p className="mt-1.5 text-[11px] font-medium text-red-600">Spend and portal expenses came to {money(out)} — {money(-s.margin)} more than was billed.</p>
          )}

          <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <FlowItem swatch="#e2e8f0" label="Revenue billed" sub={`${num(s.active_buyers)} buyers · ${num(s.counted)} counted leads`} value={money(rev)} />
            <FlowItem swatch={lightNavy} label="Traffic source spend" sub={`${ofRev(spend)} of revenue · ${per(spend)} per lead`} value={signedMoney(-spend)} />
            <FlowItem swatch={BRAND} label="Portal expenses" sub={`${ofRev(portal)} of revenue · ${per(portal)} per lead`} value={signedMoney(-portal)} />
            <FlowItem
              swatch={s.margin < 0 ? LOSS : PROFIT}
              label={s.margin < 0 ? 'Loss' : 'Profit'}
              sub={`${s.margin_pct}% margin · ${per(s.margin)} per lead`}
              value={signedMoney(s.margin)}
              valueClass={s.margin < 0 ? 'text-red-600' : 'text-emerald-700'}
            />
          </div>
        </>
      )}
    </Panel>
  )
}

// ─── Lead mix ─────────────────────────────────────────────────────────────────

type MixTab = 'outcome' | 'activity' | 'sources'

function MixRow({ label, value, unit, valueClass }: { label: string; value: string; unit?: string; valueClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2.5 last:border-b-0">
      <span className="min-w-0 truncate text-[13px] text-slate-700">{label}</span>
      <span className="shrink-0">
        <span className={cx('text-[13px] font-semibold tabular-nums', valueClass ?? 'text-slate-900')}>{value}</span>
        {unit && <span className="ml-1 text-[11px] text-slate-500">{unit}</span>}
      </span>
    </div>
  )
}

function LeadMixCard({ summary, sources, loading, sourcesLoading, dim, canAccess }: {
  summary: Summary | null
  sources: { name: string; cost: number; counted: number }[]
  loading: boolean
  sourcesLoading: boolean
  dim: boolean
  canAccess: (k: string) => boolean
}) {
  const [tab, setTab] = useState<MixTab>('outcome')
  const s = summary
  const calls = s ? s.answered + s.missed : 0
  const notCounted = s ? Math.max(0, s.answered - s.counted) : 0
  const billable = s && s.answered > 0 ? (s.counted / s.answered) * 100 : 0
  const outflow = s ? s.cost + (s.portal_expenses ?? 0) : 0
  const sourceTotal = sources.reduce((sum, r) => sum + r.cost, 0)
  const sourceMax = sources.reduce((m, r) => Math.max(m, r.cost), 0)

  return (
    <Panel className="p-4" dim={dim}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold text-slate-900">Lead mix</h2>
          <InfoDot text="Outcome: what happened to the calls delivered. Activity: how many buyers, campaigns and sheet rows were involved. Sources: spend by traffic source." />
        </div>
        <Segmented
          label="Lead mix"
          tabs={[{ id: 'outcome', label: 'Outcome' }, { id: 'activity', label: 'Activity' }, { id: 'sources', label: 'Sources' }]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {loading || !s ? (
        <div className="mt-3 space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-7" />)}</div>
      ) : tab === 'outcome' ? (
        <>
          {/* Answered against missed, as one thin bar: the red end is the share that rang out. */}
          <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${s.answer_rate}% answered`}>
            <div className="bg-brand" style={{ width: `${shareOf(s.answered, calls)}%` }} />
            <div className="bg-red-600" style={{ width: `${shareOf(s.missed, calls)}%` }} />
          </div>
          <div className="mt-2">
            <MixRow label="Total calls" value={num(calls)} unit="leads" />
            <MixRow label="Answered" value={num(s.answered)} unit="leads" />
            <MixRow label="Missed" value={num(s.missed)} unit="leads" valueClass={s.missed > 0 ? 'text-red-600' : undefined} />
            <MixRow label="Counted (billable)" value={num(s.counted)} unit="leads" />
            <MixRow label="Answered, not counted" value={num(notCounted)} unit="leads" />
            <MixRow label="Answer rate" value={`${s.answer_rate}%`} unit="of calls" />
            <MixRow label="Billable rate" value={`${billable.toFixed(1)}%`} unit="of answered" />
          </div>
        </>
      ) : tab === 'activity' ? (
        <div className="mt-2">
          <MixRow label="Active buyers" value={num(s.active_buyers)} />
          <MixRow label="Active campaigns" value={num(s.active_campaigns)} />
          <MixRow label="Buyer rows" value={num(s.buyer_records)} unit="sheet rows" />
          <MixRow label="Campaign rows" value={num(s.campaign_records)} unit="sheet rows" />
          <MixRow label="Counted leads per buyer" value={s.active_buyers > 0 ? (s.counted / s.active_buyers).toFixed(1) : '—'} unit="avg" />
        </div>
      ) : sourcesLoading ? (
        <div className="mt-3 space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-7" />)}</div>
      ) : sources.length === 0 ? (
        <EmptyHint message="No traffic source spend was recorded in this period." />
      ) : (
        <ul className="mt-2">
          {sources.slice(0, 8).map((r) => (
            <li key={r.name} className="border-b border-slate-100 py-2.5 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[13px] font-semibold text-slate-800">{r.name}</span>
                <span className="shrink-0 text-[13px] tabular-nums">
                  <span className="font-semibold text-slate-900">{money(r.cost)}</span>
                  <span className="ml-1 text-[11px] text-slate-500">{shareLabel(shareOf(r.cost, sourceTotal))}{r.counted > 0 && ` · ${money(r.cost / r.counted)} / lead`}</span>
                </span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand" style={{ width: `${sourceMax > 0 ? Math.max(1.5, (r.cost / sourceMax) * 100) : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* What each counted lead earned, cost (spend + portal) and left over. */}
      {!loading && s && tab !== 'sources' && s.counted > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { label: 'Revenue / lead', value: money(s.revenue / s.counted), cls: 'text-slate-900' },
            { label: 'Cost / lead', value: money(outflow / s.counted), cls: 'text-slate-900' },
            { label: 'Profit / lead', value: signedMoney(s.margin / s.counted), cls: s.margin < 0 ? 'text-red-600' : 'text-emerald-700' },
          ].map((u) => (
            <div key={u.label} className="rounded-lg bg-slate-50 px-3 py-2">
              <div className={cx('text-base font-bold tabular-nums', u.cls)}>{u.value}</div>
              <div className="text-[11px] text-slate-500">{u.label}</div>
            </div>
          ))}
        </div>
      )}
      {tab === 'sources' && canAccess('vendors') && (
        <div className="mt-3 text-right">
          <Link to="/vendors" className="text-xs font-semibold text-brand hover:underline">Traffic sources →</Link>
        </div>
      )}
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
  plain: 'bg-slate-100 text-slate-600',
  break: 'bg-amber-100 text-amber-800',
  absent: 'bg-red-50 text-red-700',
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
          className={cx('inline-flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-semibold ring-2 ring-white', AVATAR_TONE[tone], i > 0 && '-ml-1.5')}
        >
          {initials(n)}
        </span>
      ))}
      {rest > 0 && <span className="-ml-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-600 ring-2 ring-white">+{rest}</span>}
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
    <li className="flex items-center gap-2.5 border-b border-slate-100 py-2.5 last:border-b-0">
      <span className={cx('w-12 shrink-0 text-xs font-medium', labelClass)}>{label}</span>
      <Avatars names={names} tone={tone} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700" title={names.join(', ')}>{text}</span>
      <span className={cx('shrink-0 text-[13px] font-semibold tabular-nums', countClass ?? 'text-slate-900')} title={countTitle}>{count}</span>
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
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold text-slate-900">Team today</h2>
            <InfoDot text={`Who clocked in on the selected day, by hour, in the org's clock (${ORG_TZ}). Late is judged against each person's expected login on the Staff page, or 9:00 AM where none is set. People on leave are never counted absent.`} />
          </div>
          {!loading && !error && stats.expected > 0 && (
            <p className="mt-0.5 text-xs text-slate-500">{num(stats.present)} of {num(stats.expected)} clocked in · {pct}% attendance</p>
          )}
        </div>
        {/* On a past day this is the way back to today. */}
        <button
          type="button"
          onClick={() => onDay(today)}
          disabled={isToday}
          title={isToday ? undefined : 'Back to today'}
          className={cx('shrink-0 text-right text-xs', isToday ? 'cursor-default text-slate-500' : 'font-medium text-brand hover:underline')}
        >
          {dayLabel.replace(',', '')}
        </button>
      </div>

      {/* Week strip — the selected day gets the navy disc; future days can't be opened. */}
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
              className={cx('flex flex-col items-center gap-1 rounded-lg py-1 text-[11px] transition-colors', future ? 'cursor-not-allowed' : 'hover:bg-slate-50')}
              aria-pressed={active}
              title={iso}
            >
              <span className={cx(future ? 'text-slate-300' : 'text-slate-500')}>{WEEKDAYS[i]}</span>
              <span className={cx(
                'flex h-7 w-7 items-center justify-center rounded-full text-[13px] tabular-nums',
                active ? 'bg-brand font-semibold text-white' : future ? 'text-slate-300' : 'text-slate-800',
              )}>
                {Number(iso.slice(-2))}
              </span>
            </button>
          )
        })}
      </div>

      {/* Headcount strip. */}
      {!loading && !error && (
        <div className="mt-3 grid grid-cols-5 divide-x divide-slate-200 rounded-lg border border-slate-200 py-2 text-center">
          {[
            { label: 'In', value: stats.present, bad: false },
            { label: 'Still in', value: stats.stillIn, bad: false },
            { label: 'Break', value: stats.onBreak.length, bad: false },
            { label: 'Late', value: stats.late.length, bad: stats.late.length > 0 },
            { label: 'Absent', value: stats.absent.length, bad: stats.absent.length > 0 },
          ].map((c) => (
            <div key={c.label} className="px-0.5">
              <div className={cx('text-base font-bold tabular-nums', c.bad ? 'text-red-600' : 'text-slate-900')}>{c.value}</div>
              <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{c.label}</div>
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
              <TeamRow label="Break" labelClass="text-amber-700" names={stats.onBreak.map(labelOf)} tone="break" count={stats.onBreak.length} />
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
                  countClass={late ? 'text-red-600' : undefined}
                  countTitle={late ? `${late} late` : undefined}
                />
              )
            })}
            {stats.absent.length > 0 && (
              <TeamRow label="Absent" labelClass="text-red-600" names={stats.absent.map(labelOf)} tone="absent" count={stats.absent.length} countClass="text-red-600" />
            )}
            {stats.onLeave.length > 0 && (
              <TeamRow label="Leave" labelClass="text-slate-500" names={stats.onLeave.map(labelOf)} tone="plain" count={stats.onLeave.length} />
            )}
          </ul>
        )}
      </div>

      <div className="mt-3 text-right">
        <Link to="/attendance" className="text-xs font-semibold text-brand hover:underline">Open attendance →</Link>
      </div>
    </Panel>
  )
}

/** Right-rail fallback for a viewer without the Attendance page. */
function LeadQualityCard({ summary, loading }: { summary: Summary | null; loading: boolean }) {
  const answered = summary?.answered ?? 0
  const missed = summary?.missed ?? 0
  const total = answered + missed
  return (
    <Panel className="p-4">
      <div className="flex items-center gap-1.5">
        <h2 className="text-sm font-semibold text-slate-900">Lead quality</h2>
        <InfoDot text="Share of calls delivered to buyers that were picked up versus not, across the whole period." />
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-16" />
      ) : total === 0 ? (
        <EmptyHint message="No answered or missed calls were recorded in this period." />
      ) : (
        <>
          <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{summary?.answer_rate}%<span className="ml-1 text-xs font-normal text-slate-500">answered</span></div>
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="bg-brand" style={{ width: `${shareOf(answered, total)}%` }} />
            <div className="bg-red-600" style={{ width: `${shareOf(missed, total)}%` }} />
          </div>
          <div className="mt-2">
            <MixRow label="Answered" value={num(answered)} unit="leads" />
            <MixRow label="Missed" value={num(missed)} unit="leads" valueClass={missed > 0 ? 'text-red-600' : undefined} />
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
  const [metricId, setMetricId] = useState<MetricId>('revenue')
  // The staff view slides in over the overview and slides back out.
  const [view, setView] = useState<'overview' | 'staff'>('overview')
  const showStaff = useCallback(() => setView('staff'), [])
  const showOverview = useCallback(() => setView('overview'), [])

  const prev = useMemo(() => previousPeriod(range.from, range.to), [range.from, range.to])
  const prevLabel = previousLabel(range)
  const metric = METRICS.find((m) => m.id === metricId) ?? METRICS[0]
  const days = rangeDays(range.from, range.to)

  const summary = useAsync(() => api.summary(range), [range.from, range.to])
  // The previous window's own summary gives the figure the cards print ("Previous 90 days: $X").
  const prevSummary = useAsync(() => api.summary(prev), [prev.from, prev.to])
  const trends = useAsync(() => api.trends({ ...range, granularity }), [range.from, range.to, granularity])
  const prevTrends = useAsync(() => api.trends({ ...prev, granularity }), [prev.from, prev.to, granularity])
  // The whole ranking, not its head: the table shows the top five AND the bottom five.
  const topBuyers = useAsync(() => api.topBuyers({ ...range, limit: RANK_LIMIT }), [range.from, range.to])
  const topCampaigns = useAsync(() => api.topCampaigns({ ...range, limit: RANK_LIMIT }), [range.from, range.to])
  const topSources = useAsync(() => api.topSources({ ...range, limit: 20 }), [range.from, range.to])
  // The By-date tab is always daily, whatever bucket the chart uses.
  const daily = useAsync(() => api.trends({ ...range, granularity: 'day' }), [range.from, range.to])

  // Team today reads the attendance roster in the org's clock. Hooks can't be conditional,
  // so a viewer without the Attendance page gets a resolved null and the fallback card.
  const canAttendance = canAccess('attendance')
  const today = useOrgToday()
  const [teamDay, setTeamDay] = useState(today)
  const roster = useAsync(() => (canAttendance ? api.attendanceRoster(teamDay) : Promise.resolve(null)), [teamDay, canAttendance])
  const staff = useAsync(() => (canAttendance ? api.attendanceStaff() : Promise.resolve(null)), [canAttendance])

  // "Updated" is the moment the headline figures last changed.
  const updatedAt = useMemo(() => (summary.data ? new Date() : null), [summary.data])

  const s = summary.data
  const ps = prevSummary.data
  const series = useMemo(() => trends.data ?? [], [trends.data])
  const prevSeries = useMemo(() => prevTrends.data ?? [], [prevTrends.data])

  const buyerRows: RankRow[] = useMemo(
    () => (topBuyers.data ?? []).map((b, i) => ({
      key: `b${b.id}`, rank: i + 1, label: b.code, name: b.name, value: b.revenue, counted: b.counted,
      extra: spanLabel(b.first_date, b.last_date),
    })),
    [topBuyers.data],
  )
  const campaignRows: RankRow[] = useMemo(
    () => (topCampaigns.data ?? []).map((c, i) => ({
      key: `c${c.id}`, rank: i + 1, label: c.code, name: c.name, value: c.cost, counted: c.counted,
      extra: spanLabel(c.first_date, c.last_date),
    })),
    [topCampaigns.data],
  )
  const dateRows: RankRow[] = useMemo(
    () => (daily.data ?? []).filter((p) => p.revenue !== 0 || p.counted !== 0).map((p, i) => ({
      key: p.period, rank: i + 1, label: formatPeriod(p.period), name: null, value: p.revenue, counted: p.counted,
      extra: `${num(p.answered)} · ${num(p.missed)}`,
    })),
    [daily.data],
  )
  const sources = useMemo(
    () => (topSources.data ?? []).map((r) => ({ name: r.source, cost: r.cost, counted: r.counted })),
    [topSources.data],
  )

  const rosterRows = useMemo(() => roster.data?.rows ?? [], [roster.data])
  const rosterLeave = useMemo(() => roster.data?.leave_days ?? [], [roster.data])

  const blocks = [summary, trends, topBuyers, topCampaigns, topSources, daily]
  const failed = blocks.filter((b) => b.error)
  const refreshAll = () => [summary, prevSummary, trends, prevTrends, topBuyers, topCampaigns, topSources, daily, roster, staff].forEach((b) => b.reload())
  const refreshing = blocks.some((b) => b.refreshing)

  const exportCsv = () => {
    if (!s) return
    const row = (label: string, curr: number, before: number | undefined, fmt = (v: number) => String(v)) =>
      [label, fmt(curr), before === undefined ? '' : fmt(before), changePct(before, curr) ?? '']
    const rows: (string | number)[][] = [
      ['Platform-CRM dashboard', `${range.from} to ${range.to}`, `previous: ${prev.from} to ${prev.to}`, ''],
      ['Metric', 'This period', 'Previous period', 'Change %'],
      row('Revenue (billed)', s.revenue, ps?.revenue, (v) => v.toFixed(2)),
      row('Traffic source spend', s.cost, ps?.cost, (v) => v.toFixed(2)),
      row('Portal expenses', s.portal_expenses ?? 0, ps ? ps.portal_expenses ?? 0 : undefined, (v) => v.toFixed(2)),
      row('Expenses (total)', s.cost + (s.portal_expenses ?? 0), ps ? ps.cost + (ps.portal_expenses ?? 0) : undefined, (v) => v.toFixed(2)),
      row('Profit', s.margin, ps?.margin, (v) => v.toFixed(2)),
      ['Profit margin %', s.margin_pct, ps?.margin_pct ?? '', ''],
      row('Counted leads', s.counted, ps?.counted),
      row('Answered', s.answered, ps?.answered),
      row('Missed', s.missed, ps?.missed),
      ['Answer rate %', s.answer_rate, ps?.answer_rate ?? '', ''],
      row('Active buyers', s.active_buyers, ps?.active_buyers),
      row('Active campaigns', s.active_campaigns, ps?.active_campaigns),
      [],
      ['Period', 'Revenue', 'Expenses', 'Profit', 'Counted', 'Answered', 'Missed'],
      ...series.map((p) => [p.period, p.revenue.toFixed(2), p.cost.toFixed(2), p.margin.toFixed(2), p.counted, p.answered, p.missed]),
    ]
    downloadCsv(`dashboard_${fileDateRange(range.from, range.to)}.csv`, rows)
  }

  // ── KPI comparison lines ──
  const expenses = s ? s.cost + (s.portal_expenses ?? 0) : 0
  const prevExpenses = ps ? ps.cost + (ps.portal_expenses ?? 0) : 0
  const prevLine = (v: string, delta: number | null, tone: Tone) => (
    <Compare>
      {cap(prevLabel)}: <span className="font-medium text-slate-700">{v}</span>
      <DeltaPill value={delta} tone={tone} />
    </Compare>
  )
  const compareRevenue = !ps ? '…' : ps.revenue === 0 ? `No revenue in ${prevLabel}` : prevLine(money(ps.revenue), changePct(ps.revenue, s?.revenue ?? 0), 'up-good')
  const compareExpenses = !ps ? '…' : prevExpenses === 0 ? `No expenses in ${prevLabel}` : prevLine(money(prevExpenses), changePct(prevExpenses, expenses), 'down-good')
  // A profit with nothing billed behind it is not a baseline worth a percentage.
  const compareProfit = !ps ? '…' : ps.revenue === 0 ? 'No comparable previous period' : prevLine(signedMoney(ps.margin), changePct(ps.margin, s?.margin ?? 0), 'up-good')
  const compareCounted = !ps ? '…' : ps.counted === 0 ? `No leads in ${prevLabel}` : prevLine(num(ps.counted), changePct(ps.counted, s?.counted ?? 0), 'up-good')

  const kpiDim = summary.refreshing || prevSummary.refreshing
  const railBtn = 'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'
  const railActions = [
    <button key="csv" type="button" onClick={exportCsv} disabled={!s} className={railBtn}>CSV</button>,
    canAccess('complete-report') && <Link key="report" to="/complete-report" className={railBtn}>Report</Link>,
    // Opens the staff view in place — the manager stays on the dashboard.
    canAccess('staff') && <button key="staff" type="button" onClick={showStaff} className={railBtn}>Staff</button>,
  ].filter(Boolean)

  return (
    // Inter, scoped to this page (inherited by children, including the Recharts SVG text).
    // Other pages keep the app-wide Poppins.
    <div className="text-slate-900" style={{ fontFamily: "'Inter', 'Poppins', ui-sans-serif, system-ui, sans-serif" }}>
      {view === 'staff' ? (
        <div key="staff" className="animate-page-in-right flex flex-col lg:h-[calc(100vh-3rem)]">
          <StaffDashboard onBack={showOverview} />
        </div>
      ) : (
        <div key="overview" className="animate-page-in-left">
          {/* Header. */}
          <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                Leads, revenue, margin and team · {formatRangeLong(range.from, range.to)} ({num(days)} {days === 1 ? 'day' : 'days'})
              </p>
            </div>
            <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-slate-500" aria-live="polite">
              <span className={cx('h-2 w-2 rounded-full', refreshing ? 'animate-pulse bg-amber-500 motion-reduce:animate-none' : 'bg-emerald-500')} aria-hidden />
              {refreshing ? 'Refreshing…' : updatedAt ? `Updated ${timeLabel(updatedAt)}` : 'Loading…'}
            </span>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            {/* Main column. */}
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              {/* One banner for any block that failed — the rest of the page stays usable. */}
              {failed.length > 0 && (
                <div className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 text-red-600"><IconAlert /></span>
                    <p className="text-xs text-red-800">
                      {failed[0].error}
                      {failed.length > 1 && ` (and ${failed.length - 1} other section${failed.length > 2 ? 's' : ''})`}. The rest of the page is current.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={refreshAll}
                    className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 sm:self-auto"
                  >
                    <IconRefresh /> Retry
                  </button>
                </div>
              )}

              {/* Three across at the usual width; the fourth wraps beneath, four across on a wide screen. */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
                <KpiCard
                  label="Revenue"
                  info="Total billed to buyers for Leads delivered in the selected period."
                  value={s ? money(s.revenue) : '—'}
                  sub={s && s.counted > 0 ? `${money(s.revenue / s.counted)} per counted lead` : 'No counted leads'}
                  compare={compareRevenue}
                  loading={summary.loading}
                  dim={kpiDim}
                />
                <KpiCard
                  label="Expenses"
                  info="Traffic source spend (what campaigns cost) plus portal expenses for months the range covers in full. Falling expenses is good news."
                  value={s ? money(expenses) : '—'}
                  sub={s ? `Excl. portal ${money(s.cost)} · Portal ${money(s.portal_expenses ?? 0)}` : ''}
                  compare={compareExpenses}
                  loading={summary.loading}
                  dim={kpiDim}
                />
                <KpiCard
                  label="Profit"
                  info="Revenue minus traffic source spend and portal expenses. Negative means the Leads and overheads cost more than they billed."
                  value={s ? signedMoney(s.margin) : '—'}
                  valueClass={s && s.margin < 0 ? 'text-red-600' : undefined}
                  sub={s ? (s.margin < 0 ? <span className="font-medium text-red-600">Loss · {s.margin_pct}% margin</span> : `${s.margin_pct}% margin`) : ''}
                  compare={compareProfit}
                  loading={summary.loading}
                  dim={kpiDim}
                />
                <KpiCard
                  label="Counted leads"
                  info="Billable Leads in the selected period. Not the same as answered Leads."
                  value={s ? num(s.counted) : '—'}
                  sub={s ? `${num(s.answered)} answered · ${num(s.missed)} missed` : ''}
                  compare={compareCounted}
                  loading={summary.loading}
                  dim={kpiDim}
                />
              </div>

              <ChartCard
                metric={metric}
                granularity={granularity}
                range={range}
                series={series}
                prevSeries={prevSeries}
                loading={trends.loading}
                dim={trends.refreshing}
                prevLabel={prevLabel}
                portalNote={(s?.portal_expenses ?? 0) > 0}
              />

              <RankingCard
                buyers={buyerRows}
                campaigns={campaignRows}
                dates={dateRows}
                summary={s}
                loading={topBuyers.loading || topCampaigns.loading || summary.loading}
                dim={topBuyers.refreshing || topCampaigns.refreshing || daily.refreshing}
                rangeLabel={formatRangeLong(range.from, range.to, false)}
                canAccess={canAccess}
              />

              <RevenueFlowCard summary={s} loading={summary.loading} dim={summary.refreshing} />

              <LeadMixCard
                summary={s}
                sources={sources}
                loading={summary.loading}
                sourcesLoading={topSources.loading}
                dim={summary.refreshing || topSources.refreshing}
                canAccess={canAccess}
              />
            </div>

            {/* Right rail — every control, then the team's day. On a phone the controls lead
                the page and Team today closes it. */}
            <aside className="contents lg:flex lg:w-76 lg:shrink-0 lg:flex-col lg:gap-4">
              <Panel className="order-first space-y-4 p-4 lg:order-none">
                <div>
                  <div className="mb-1.5 text-xs font-medium text-slate-600">Period</div>
                  <DateRangeControl value={range} onChange={setRange} tone="field" />
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-medium text-slate-600">Time bucket</div>
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Time bucket">
                    {GRANULARITIES.map((g) => (
                      <button
                        key={g.value}
                        type="button"
                        onClick={() => setGranularity(g.value)}
                        aria-pressed={granularity === g.value}
                        title={g.title}
                        className={cx(
                          'rounded-md py-1.5 text-xs font-semibold transition-colors',
                          granularity === g.value ? 'bg-brand text-white shadow-sm' : 'text-slate-600 hover:text-slate-900',
                        )}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-medium text-slate-600">Chart metric</div>
                  <label className="relative block">
                    <select
                      value={metric.id}
                      onChange={(e) => setMetricId(e.target.value as MetricId)}
                      aria-label="Chart metric"
                      className="w-full cursor-pointer appearance-none rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-8 text-sm text-slate-900 hover:border-slate-300 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                    >
                      {METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><IconChevD /></span>
                  </label>
                </div>
                <button
                  type="button"
                  onClick={refreshAll}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2"
                >
                  {refreshing && <span className="animate-spin motion-reduce:animate-none"><IconRefresh /></span>}
                  {refreshing ? 'Refreshing…' : 'Refresh'}
                </button>
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${railActions.length}, minmax(0, 1fr))` }}>
                  {railActions}
                </div>
              </Panel>

              <div className="order-last lg:order-none">
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
            </aside>
          </div>
        </div>
      )}
    </div>
  )
}
