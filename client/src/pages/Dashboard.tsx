// Dashboard — performance overview of calls, revenue and margin.
//
// Visual language here is intentionally local to this page: flat white panels rather
// than the app-wide frosted `.glass` surfaces, per the 2026-07 redesign. The shared
// components in components/ui.tsx are deliberately NOT used for panels/tiles so the
// other pages keep their current look. See docs/design/dashboard-design-brief.md.
//
// Report downloads (CSV/PDF) were removed and are not part of this page.
import { useMemo, useState, type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { DateRangeControl, type Range } from '../components/DateRange'
import { PageHeader } from '../components/Layout'
import { cx } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import {
  daysAgo,
  formatPeriod,
  money,
  moneyCompact,
  num,
  previousPeriod,
  rangeDays,
  today,
} from '../lib/format'
import { useAsync } from '../lib/useAsync'

type Granularity = 'day' | '4day' | 'week'

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: 'day', label: 'Daily' },
  { value: '4day', label: '4 Days' },
  { value: 'week', label: 'Weekly' },
]

/** One colour = one meaning, across every block on the page. */
const C = {
  revenue: '#2563eb',
  cost: '#f97316',
  profit: '#16a34a',
  marginPct: '#8b5cf6',
  answerRate: '#0d9488',
  answered: '#16a34a',
  missed: '#ef4444',
  grid: '#eef2f6',
  axis: '#94a3b8',
}

/**
 * Whether a rising number is good news for this metric. Running Fee is a cost, so it
 * is the one metric where falling is good — the arrow follows the raw sign, the colour
 * follows the meaning.
 */
type Tone = 'up-good' | 'down-good'

// ─── Formatting helpers ───────────────────────────────────────────────────────

const signed = (v: number, suffix: string) => `${v > 0 ? '+' : ''}${v.toFixed(1)}${suffix}`

/** % change with the same "no baseline → null" rule the API uses. */
function changePct(prev: number | undefined, curr: number): number | null {
  if (prev === undefined) return null
  if (prev === 0) return curr === 0 ? 0 : null
  return Number((((curr - prev) / Math.abs(prev)) * 100).toFixed(1))
}

/** "vs previous 7 days" — the comparison window is always the same length as the range. */
function comparisonLabel(range: Range): string {
  const days = rangeDays(range.from, range.to)
  if (days <= 1) return 'vs previous day'
  return `vs previous ${days} days`
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const svg = (children: ReactNode, size = 20) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
    {children}
  </svg>
)

const IconDollar = () => svg(<><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>)
const IconOutflow = () => svg(<><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-4 4" /></>)
const IconPercent = () => svg(<><line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></>)
const IconTarget = () => svg(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>)
const IconPhone = () => svg(<><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></>)
const IconUsers = () => svg(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></>)
const IconMegaphone = () => svg(<><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></>)
const IconPhoneIn = () => svg(<><polyline points="16 2 16 8 22 8" /><line x1="22" y1="2" x2="16" y2="8" /><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></>)

// ─── Small building blocks ────────────────────────────────────────────────────

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-900/5', className)}>
      {children}
    </section>
  )
}

/** Metric definitions surface as a hover/focus hint rather than eating layout space. */
function InfoDot({ text }: { text: string }) {
  return (
    <button
      type="button"
      title={text}
      aria-label={text}
      className="inline-flex cursor-help text-slate-300 transition-colors hover:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
      </svg>
    </button>
  )
}

function PanelHeader({ title, subtitle, info, action }: {
  title: string
  subtitle?: string
  info?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 px-5 pb-2 pt-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate font-semibold text-slate-900">{title}</h3>
          {info && <InfoDot text={info} />}
        </div>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-slate-100', className)} />
}

/**
 * Change vs the previous period. The glyph follows the raw sign; the colour follows
 * whether that movement is good for this particular metric.
 */
function DeltaChip({ value, tone, suffix = '%', caption, className, hideWhenNull }: {
  value?: number | null
  tone: Tone
  suffix?: string
  caption?: string
  className?: string
  /** In dense rows, say nothing rather than spending a line on "no prior period". */
  hideWhenNull?: boolean
}) {
  if (value === undefined || value === null) {
    if (hideWhenNull) return null
    return <span className={cx('text-xs text-slate-400', className)}>No comparable prior period</span>
  }
  const good = value === 0 ? null : tone === 'up-good' ? value > 0 : value < 0
  return (
    <span className={cx('flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5', className)}>
      <span
        className={cx(
          'text-xs font-semibold',
          good === null ? 'text-slate-500' : good ? 'text-emerald-600' : 'text-red-500',
        )}
      >
        {value === 0 ? '±' : value > 0 ? '▲' : '▼'} {signed(value, suffix)}
      </span>
      {caption && <span className="text-xs text-slate-400">{caption}</span>}
    </span>
  )
}

/** Axis-less trend line for the KPI tiles, drawn from the same series as the main chart. */
function Sparkline({ id, data, color, height = 40 }: {
  id: string
  data: number[]
  color: string
  height?: number
}) {
  // Genuinely nothing to plot — the range holds no records at all. Say so rather than
  // leaving a blank gap that reads as a chart which failed to load.
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <span className="text-[11px] text-slate-300">No trend data in this range</span>
      </div>
    )
  }

  // A single bucket (only one day in the range carries records) still deserves a mark:
  // duplicate it so there is a segment to stroke. Without this the tile silently loses
  // its chart, which looks like a bug rather than like thin data.
  const values = data.length === 1 ? [data[0], data[0]] : data
  const points = values.map((v, i) => ({ i, v }))

  // A perfectly flat series makes dataMin === dataMax, which pins the line to the edge of
  // the band (and is the normal case for the duplicated single bucket above). Pad the
  // domain so a flat line sits at mid-height instead.
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = min === max ? Math.abs(max) * 0.5 || 1 : 0

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={[min - pad, max + pad]} />
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.75} fill={`url(#${id})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function EmptyHint({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-slate-300">
        <path d="M3 3v18h18" /><path d="m7 15 3.5-3.5 3 3L21 7" />
      </svg>
      <p className="max-w-[26ch] text-sm text-slate-400">{message}</p>
    </div>
  )
}

function ChartSkeleton() {
  return (
    <div className="flex h-full items-end gap-2 px-2 pb-6 pt-4">
      {[38, 62, 45, 78, 55, 88, 66, 72, 50, 80].map((h, i) => (
        <div key={i} className="flex-1 animate-pulse rounded-t bg-slate-100" style={{ height: `${h}%` }} />
      ))}
    </div>
  )
}

// ─── KPI tiles ────────────────────────────────────────────────────────────────

/** The page's lead figure: profit, its direction, and its shape over the period. */
function ProfitHero({ value, delta, caption, spark, loading }: {
  value: number | undefined
  delta: number | null | undefined
  caption: string
  spark: number[]
  loading: boolean
}) {
  const negative = value !== undefined && value < 0
  return (
    <Panel className="flex flex-col justify-between p-5 sm:col-span-2 lg:col-span-4 xl:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-slate-500">Profit</span>
          <InfoDot text="Revenue (billed) minus Running Fee for the selected period. Negative means the calls cost more than they billed." />
        </div>
        {!loading && value !== undefined && (
          <span
            className={cx(
              'rounded-full px-2.5 py-0.5 text-xs font-semibold',
              negative ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700',
            )}
          >
            {negative ? 'Negative' : 'Positive'}
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 items-end gap-4 sm:grid-cols-2">
        <div>
          {loading ? (
            <Skeleton className="h-10 w-44" />
          ) : (
            <div className={cx('text-3xl font-bold tracking-tight', negative ? 'text-red-600' : 'text-slate-900')}>
              {value !== undefined ? money(value) : '—'}
            </div>
          )}
          {!loading && <DeltaChip className="mt-2" value={delta} tone="up-good" caption={caption} />}
        </div>
        <div className="h-16">{!loading && <Sparkline id="spark-profit" data={spark} color={C.profit} height={64} />}</div>
      </div>
    </Panel>
  )
}

function MetricTile({ icon, iconClass, label, info, value, delta, deltaSuffix, tone, caption, spark, sparkId, sparkColor, loading }: {
  icon: ReactNode
  iconClass: string
  label: string
  info: string
  value: string
  delta: number | null | undefined
  deltaSuffix?: string
  tone: Tone
  caption: string
  spark: number[]
  sparkId: string
  sparkColor: string
  loading: boolean
}) {
  return (
    <Panel className="flex flex-col justify-between p-4">
      <div>
        <span className={cx('inline-flex h-10 w-10 items-center justify-center rounded-full', iconClass)}>{icon}</span>
        <div className="mt-3 flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-slate-500">{label}</span>
          <InfoDot text={info} />
        </div>
        {loading ? (
          <Skeleton className="mt-1.5 h-7 w-28" />
        ) : (
          <div className="mt-1 text-xl font-bold tracking-tight text-slate-900">{value}</div>
        )}
        {!loading && <DeltaChip className="mt-1.5" value={delta} tone={tone} suffix={deltaSuffix} caption={caption} />}
      </div>
      <div className="-mx-1 mt-3 h-10">
        {!loading && <Sparkline id={sparkId} data={spark} color={sparkColor} />}
      </div>
    </Panel>
  )
}

function StripStat({ icon, iconClass, label, info, value, delta, tone, caption, loading }: {
  icon: ReactNode
  iconClass: string
  label: string
  info: string
  value: string
  delta: number | null | undefined
  tone: Tone
  caption: string
  loading: boolean
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <span className={cx('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full', iconClass)}>{icon}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-slate-500">{label}</span>
          <InfoDot text={info} />
        </div>
        {loading ? (
          <Skeleton className="mt-1 h-6 w-20" />
        ) : (
          <div className="mt-0.5 text-xl font-bold tracking-tight text-slate-900">{value}</div>
        )}
        {!loading && <DeltaChip className="mt-0.5" value={delta} tone={tone} caption={caption} />}
      </div>
    </div>
  )
}

// ─── Ranked lists ─────────────────────────────────────────────────────────────

/**
 * Buyers and campaigns have no logo in the schema — only a short code and an optional
 * name — so identity is carried by initials on a tint derived from the code, which keeps
 * each entity the same colour between loads.
 */
const TINTS = [
  'bg-blue-50 text-blue-700',
  'bg-emerald-50 text-emerald-700',
  'bg-amber-50 text-amber-700',
  'bg-violet-50 text-violet-700',
  'bg-rose-50 text-rose-700',
  'bg-cyan-50 text-cyan-700',
  'bg-indigo-50 text-indigo-700',
  'bg-teal-50 text-teal-700',
]

function tintFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return TINTS[h % TINTS.length]
}

/**
 * Codes are short and mostly alphanumeric ("L48", "RTG 04", "C-05"), so the first three
 * characters with separators stripped stay recognisable. Taking one letter per word
 * instead would collapse a whole campaign list to "C0"/"C1"/"C2".
 */
function initialsFor(code: string): string {
  return code.replace(/[\s\-_]+/g, '').slice(0, 3).toUpperCase()
}

interface RankRow {
  key: string
  code: string
  name: string | null
  value: number
  delta: number | null
}

function RankPanel({ title, subtitle, info, rows, loading, emptyMessage, to, perm, linkLabel, caption }: {
  title: string
  subtitle: string
  info: string
  rows: RankRow[]
  loading: boolean
  emptyMessage: string
  to: string
  /** Permission key for the linked page — the link is hidden from viewers who lack it. */
  perm: string
  linkLabel: string
  caption: string
}) {
  const { canAccess } = useAuth()
  return (
    <Panel className="flex flex-col">
      <PanelHeader title={title} subtitle={subtitle} info={info} />
      <div className="flex-1 px-2 pb-1 pt-1">
        {loading ? (
          <ul className="space-y-1 px-3 py-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-center gap-3 py-1.5">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-16" />
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <EmptyHint message={emptyMessage} />
        ) : (
          <ol className="px-1">
            {rows.map((r, i) => (
              <li
                key={r.key}
                className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-slate-50"
              >
                <span className="w-4 shrink-0 text-right text-xs font-medium text-slate-400">{i + 1}</span>
                <span
                  className={cx(
                    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tracking-tight',
                    tintFor(r.code),
                  )}
                  aria-hidden
                >
                  {initialsFor(r.code)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800">{r.code}</span>
                  {r.name && <span className="block truncate text-xs text-slate-400">{r.name}</span>}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-semibold tabular-nums text-slate-900">{money(r.value)}</span>
                  <DeltaChip value={r.delta} tone="up-good" className="justify-end" hideWhenNull />
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {canAccess(perm) && (
        <div className="mt-auto border-t border-slate-100 px-5 py-3">
          <Link
            to={to}
            className="group inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            {linkLabel}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="transition-transform group-hover:translate-x-0.5">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>
          <p className="sr-only">{caption}</p>
        </div>
      )}
    </Panel>
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
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      {label && <div className="mb-1 font-semibold text-slate-700">{formatPeriod(label)}</div>}
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-500">{p.name}:</span>
          <span className="font-semibold tabular-nums text-slate-800">{format(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  return <DashboardPage />
}

function DashboardPage() {
  const [range, setRange] = useState<Range>({ from: daysAgo(6), to: today() })
  const [granularity, setGranularity] = useState<Granularity>('day')

  const prev = useMemo(() => previousPeriod(range.from, range.to), [range.from, range.to])
  const caption = comparisonLabel(range)

  const summary = useAsync(() => api.summary(range), [range.from, range.to])
  const trends = useAsync(() => api.trends({ ...range, granularity }), [range.from, range.to, granularity])
  const topBuyers = useAsync(() => api.topBuyers({ ...range, limit: 5 }), [range.from, range.to])
  const topCampaigns = useAsync(() => api.topCampaigns({ ...range, limit: 5 }), [range.from, range.to])
  const topSources = useAsync(() => api.topSources({ ...range, limit: 50 }), [range.from, range.to])
  // Ranked lists show a per-row change, which the ranking endpoints don't provide — so the
  // same ranking is pulled for the previous window and matched by id. A wider limit is used
  // because today's top 5 may have sat well down the table last period.
  const prevBuyers = useAsync(() => api.topBuyers({ ...prev, limit: 50 }), [prev.from, prev.to])
  const prevCampaigns = useAsync(() => api.topCampaigns({ ...prev, limit: 50 }), [prev.from, prev.to])

  const s = summary.data
  const series = useMemo(() => trends.data ?? [], [trends.data])

  // KPI sparklines are derived from the trend series — the two rate metrics aren't
  // returned per bucket, so they're recomputed here from their components.
  const sparks = useMemo(
    () => ({
      revenue: series.map((p) => p.revenue),
      cost: series.map((p) => p.cost),
      profit: series.map((p) => p.margin),
      marginPct: series.map((p) => (p.revenue > 0 ? (p.margin / p.revenue) * 100 : 0)),
      answerRate: series.map((p) => (p.answered + p.missed > 0 ? (p.answered / (p.answered + p.missed)) * 100 : 0)),
    }),
    [series],
  )

  const buyerRows: RankRow[] = useMemo(() => {
    const before = new Map((prevBuyers.data ?? []).map((b) => [b.id, b.revenue]))
    return (topBuyers.data ?? []).map((b) => ({
      key: String(b.id),
      code: b.code,
      name: b.name,
      value: b.revenue,
      delta: changePct(before.get(b.id), b.revenue),
    }))
  }, [topBuyers.data, prevBuyers.data])

  const campaignRows: RankRow[] = useMemo(() => {
    const before = new Map((prevCampaigns.data ?? []).map((c) => [c.id, c.cost]))
    return (topCampaigns.data ?? []).map((c) => ({
      key: String(c.id),
      code: c.code,
      name: c.name,
      value: c.cost,
      delta: changePct(before.get(c.id), c.cost),
    }))
  }, [topCampaigns.data, prevCampaigns.data])

  // Spend is heavily top-weighted, so the tail is folded into a single "Others" row
  // rather than rendered as a row of invisible slivers.
  const sources = useMemo(() => {
    const all = topSources.data ?? []
    const total = all.reduce((sum, r) => sum + r.cost, 0)
    const head = all.slice(0, 5)
    const tail = all.slice(5)
    const rows = head.map((r) => ({ name: r.source, cost: r.cost, counted: r.counted }))
    if (tail.length) {
      rows.push({
        name: `Others (${tail.length})`,
        cost: tail.reduce((sum, r) => sum + r.cost, 0),
        counted: tail.reduce((sum, r) => sum + r.counted, 0),
      })
    }
    return { rows, total }
  }, [topSources.data])

  const answered = s?.answered ?? 0
  const missed = s?.missed ?? 0
  const callMix = [
    { name: 'Answered', value: answered, color: C.answered },
    { name: 'Missed', value: missed, color: C.missed },
  ]
  const callTotal = answered + missed

  const blocks = [summary, trends, topBuyers, topCampaigns, topSources]
  const failed = blocks.filter((b) => b.error)
  const refreshing = blocks.some((b) => b.refreshing)
  const retryAll = () => failed.forEach((b) => b.reload())

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Performance overview of calls, revenue and margin">
        {refreshing && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400" role="status">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
            Updating…
          </span>
        )}
        {/* Dark date box — the client asked for this one control to be dark, on the
            otherwise-light header. Opt-in, so the six other pages using this control
            keep the standard frosted pill. */}
        <DateRangeControl value={range} onChange={setRange} tone="dark" />
      </PageHeader>

      {/* Headline: profit leads, its inputs and the two rate metrics sit beside it.
          At lg the hero takes a full row so the four tiles stay on one line; only at xl
          is there room for the hero and all four side by side. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <ProfitHero
          value={s?.margin}
          delta={s?.deltas.margin}
          caption={caption}
          spark={sparks.profit}
          loading={summary.loading}
        />
        <MetricTile
          icon={<IconDollar />} iconClass="bg-blue-100 text-blue-700"
          label="Revenue (billed)"
          info="Total billed to buyers for calls delivered in the selected period."
          value={s ? money(s.revenue) : '—'}
          delta={s?.deltas.revenue} tone="up-good" caption={caption}
          spark={sparks.revenue} sparkId="spark-revenue" sparkColor={C.revenue}
          loading={summary.loading}
        />
        <MetricTile
          icon={<IconOutflow />} iconClass="bg-orange-100 text-orange-700"
          label="Running Fee"
          info="Total paid to campaigns and traffic sources in the selected period. This is a cost — a falling Running Fee is good news."
          value={s ? money(s.cost) : '—'}
          delta={s?.deltas.cost} tone="down-good" caption={caption}
          spark={sparks.cost} sparkId="spark-cost" sparkColor={C.cost}
          loading={summary.loading}
        />
        <MetricTile
          icon={<IconPercent />} iconClass="bg-violet-100 text-violet-700"
          label="Profit Margin"
          info="Profit as a share of revenue. Shown as a percentage-point change against the previous period."
          value={s ? `${s.margin_pct}%` : '—'}
          delta={s?.point_deltas?.margin_pct} deltaSuffix="pp" tone="up-good" caption={caption}
          spark={sparks.marginPct} sparkId="spark-margin" sparkColor={C.marginPct}
          loading={summary.loading}
        />
        <MetricTile
          icon={<IconTarget />} iconClass="bg-teal-100 text-teal-700"
          label="Answer Rate"
          info="Answered calls as a share of answered + missed, buyer side. Shown as a percentage-point change against the previous period."
          value={s ? `${s.answer_rate}%` : '—'}
          delta={s?.point_deltas?.answer_rate} deltaSuffix="pp" tone="up-good" caption={caption}
          spark={sparks.answerRate} sparkId="spark-answer" sparkColor={C.answerRate}
          loading={summary.loading}
        />
      </div>

      {/* Volume metrics — counts rather than money. */}
      <Panel className="mt-4 grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x lg:divide-slate-100">
        <StripStat
          icon={<IconPhone />} iconClass="bg-emerald-100 text-emerald-700"
          label="Counted Calls"
          info="Billable calls in the selected period. Not the same as answered calls."
          value={s ? num(s.counted) : '—'}
          delta={s?.deltas.counted} tone="up-good" caption={caption} loading={summary.loading}
        />
        <StripStat
          icon={<IconUsers />} iconClass="bg-blue-100 text-blue-700"
          label="Active Buyers"
          info="Distinct buyers with recorded activity in the selected period."
          value={s ? num(s.active_buyers) : '—'}
          delta={s?.deltas.active_buyers} tone="up-good" caption={caption} loading={summary.loading}
        />
        <StripStat
          icon={<IconMegaphone />} iconClass="bg-violet-100 text-violet-700"
          label="Active Campaigns"
          info="Distinct campaigns with recorded activity in the selected period."
          value={s ? num(s.active_campaigns) : '—'}
          delta={s?.deltas.active_campaigns} tone="up-good" caption={caption} loading={summary.loading}
        />
        <StripStat
          icon={<IconPhoneIn />} iconClass="bg-amber-100 text-amber-700"
          label="Answered Calls"
          info="Calls the buyer actually picked up, in the selected period."
          value={s ? num(s.answered) : '—'}
          delta={s?.deltas.answered} tone="up-good" caption={caption} loading={summary.loading}
        />
      </Panel>

      {/* Below xl the trend chart takes a full row rather than squeezing the ranked
          lists into a third of ~720px of usable width. */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {/* Money over time */}
        <Panel className="lg:col-span-2">
          <PanelHeader
            title="Revenue, Running Fee & Profit Over Time"
            subtitle="Income trend across the selected period"
            info="Profit is Revenue minus Running Fee and crosses zero, so this chart can run below the baseline."
            action={
              <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="Time bucket">
                {GRANULARITIES.map((g) => (
                  <button
                    key={g.value}
                    onClick={() => setGranularity(g.value)}
                    aria-pressed={granularity === g.value}
                    className={cx(
                      'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                      granularity === g.value
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-white hover:text-slate-900',
                    )}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            }
          />
          <div className="h-80 px-2 pb-4 pt-2">
            {trends.loading ? (
              <ChartSkeleton />
            ) : series.length === 0 ? (
              <EmptyHint message="No calls were recorded in this period. Try a wider date range." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                  <XAxis dataKey="period" tickFormatter={formatPeriod} tick={{ fontSize: 12, fill: C.axis }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tickFormatter={moneyCompact} tick={{ fontSize: 12, fill: C.axis }} tickLine={false} axisLine={false} width={60} />
                  {/* Zero baseline matters: profit legitimately runs negative. */}
                  <ReferenceLine y={0} stroke="#cbd5e1" strokeWidth={1} />
                  <Tooltip content={<SeriesTooltip format={money} />} />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="plainline" />
                  <Line type="monotone" dataKey="revenue" name="Revenue (billed)" stroke={C.revenue} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="cost" name="Running Fee" stroke={C.cost} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="margin" name="Profit" stroke={C.profit} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        {/* Call quality mix */}
        <Panel>
          <PanelHeader
            title="Answered vs Missed Calls"
            subtitle="Call quality over time (buyer side)"
            info="Share of calls delivered to buyers that were picked up versus not picked up, across the whole period."
          />
          <div className="px-5 pb-5 pt-2">
            {summary.loading ? (
              <div className="flex items-center gap-5 py-6">
                <Skeleton className="h-32 w-32 rounded-full" />
                <div className="flex-1 space-y-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </div>
            ) : callTotal === 0 ? (
              <EmptyHint message="No answered or missed calls were recorded in this period." />
            ) : (
              <div className="flex flex-col items-center gap-5 sm:flex-row">
                <div className="h-40 w-40 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={callMix}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="62%"
                        outerRadius="94%"
                        paddingAngle={2}
                        stroke="none"
                      >
                        {callMix.map((slice) => (
                          <Cell key={slice.name} fill={slice.color} />
                        ))}
                      </Pie>
                      {/* No tooltip: both values and shares are already listed beside the ring. */}
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <dl className="w-full space-y-4">
                  {callMix.map((slice) => (
                    <div key={slice.name}>
                      <dt className="flex items-center gap-2 text-sm text-slate-500">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: slice.color }} />
                        {slice.name}
                      </dt>
                      <dd className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">{num(slice.value)}</dd>
                      <dd className="text-xs font-medium" style={{ color: slice.color }}>
                        {((slice.value / callTotal) * 100).toFixed(1)}% of calls
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </Panel>

        {/* Ranked buyers */}
        <RankPanel
          title="Most Active Buyers"
          subtitle="By revenue in the selected period"
          info="Top 5 buyers by revenue. The change compares each buyer against the same buyer in the previous period."
          rows={buyerRows}
          loading={topBuyers.loading}
          emptyMessage="No buyer activity in this period."
          to="/buyers"
          perm="buyers"
          linkLabel="View all buyers"
          caption={`Change shown ${caption}`}
        />

        {/* Ranked campaigns */}
        <RankPanel
          title="Top Campaigns"
          subtitle="By spend in the selected period"
          info="Top 5 campaigns by Running Fee. The change compares each campaign against the same campaign in the previous period."
          rows={campaignRows}
          loading={topCampaigns.loading}
          emptyMessage="No campaign activity in this period."
          to="/campaigns"
          perm="campaigns"
          linkLabel="View all campaigns"
          caption={`Change shown ${caption}`}
        />

        {/* Traffic sources */}
        <Panel className="flex flex-col">
          <PanelHeader
            title="Top Traffic Sources"
            subtitle="Campaign spend by source"
            info="Share of Running Fee by traffic source. Sources beyond the top five are grouped into Others."
          />
          <div className="flex-1 px-5 pb-5 pt-2">
            {topSources.loading ? (
              <div className="space-y-5 py-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-2 w-full" />
                  </div>
                ))}
              </div>
            ) : sources.rows.length === 0 ? (
              <EmptyHint message="No campaign spend was recorded in this period." />
            ) : (
              <ul className="space-y-4">
                {sources.rows.map((row) => {
                  const share = sources.total > 0 ? (row.cost / sources.total) * 100 : 0
                  return (
                    <li key={row.name}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-medium text-slate-700">{row.name}</span>
                        <span className="shrink-0 text-xs text-slate-400">
                          {row.counted > 0 ? `${money(row.cost / row.counted)} / call` : '—'}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-3">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-blue-600"
                            style={{ width: `${Math.max(share, share > 0 ? 1.5 : 0)}%` }}
                          />
                        </div>
                        <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-900">
                          {money(row.cost)}
                        </span>
                        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-slate-400">
                          {share.toFixed(1)}%
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </Panel>
      </div>

      {/* One banner for any block that failed — the rest of the page stays usable. */}
      {failed.length > 0 && (
        <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0 text-red-500">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" />
              </svg>
            </span>
            <p className="text-sm text-red-700">
              {failed[0].error}
              {failed.length > 1 && ` (and ${failed.length - 1} other section${failed.length > 2 ? 's' : ''})`}
              . Is the PHP API running on port 8000?
            </p>
          </div>
          <button
            onClick={retryAll}
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 sm:self-auto"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
