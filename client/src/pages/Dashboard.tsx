import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api/client'
import { DateRangeControl, DownloadButton, type Range } from '../components/DateRange'
import { PageHeader } from '../components/Layout'
import { Button, Card, CardHeader, cx, Spinner } from '../components/ui'
import { daysAgo, formatPeriod, money, num, pct, today } from '../lib/format'
import { useAsync } from '../lib/useAsync'

type Granularity = 'day' | '4day' | 'week'

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: 'day', label: 'Daily' },
  { value: '4day', label: '4 Days' },
  { value: 'week', label: 'Weekly' },
]

const COLORS = {
  revenue: '#2563eb',
  cost: '#cbd5e1',
  margin: '#16a34a',
  answered: '#2563eb',
  missed: '#f43f5e',
}

// ─── PDF generation ──────────────────────────────────────────────────────────

function pdfHeader(doc: jsPDF, title: string, subtitle: string) {
  const pageW = doc.internal.pageSize.getWidth()
  doc.setFontSize(13)
  doc.setTextColor(15, 23, 42)
  doc.setFont('helvetica', 'bold')
  doc.text(title, 40, 46)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 116, 139)
  doc.text(subtitle, 40, 62)
  doc.text(`Generated ${new Date().toLocaleString()}`, pageW - 40, 62, { align: 'right' })
}

function addSection(doc: jsPDF, label: string, y: number): number {
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(26, 54, 84)
  doc.text(label, 40, y)
  return y + 6
}

function addTable(
  doc: jsPDF,
  startY: number,
  head: string[],
  rows: (string | number)[][],
): number {
  autoTable(doc, {
    startY,
    theme: 'grid',
    head: [head],
    body: rows.map((r) => r.map(String)),
    styles: { fontSize: 9, cellPadding: 4, lineColor: [255, 255, 255], lineWidth: 1, textColor: [15, 23, 42], valign: 'middle' },
    headStyles: { fillColor: [26, 54, 84], textColor: 255, fontStyle: 'bold', halign: 'left', lineColor: [26, 54, 84], lineWidth: 1 },
    bodyStyles: { fillColor: [212, 233, 242] },
    columnStyles: Object.fromEntries(
      head.slice(1).map((_, i) => [i + 1, { halign: 'right' }])
    ),
    margin: { left: 40, right: 40 },
  })
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
}

interface DashboardData {
  summary: ReturnType<typeof api.summary> extends Promise<infer T> ? T : never
  trends: Awaited<ReturnType<typeof api.trends>>
  topBuyers: Awaited<ReturnType<typeof api.topBuyers>>
  topSources: Awaited<ReturnType<typeof api.topSources>>
  range: Range
  granularity: Granularity
}

async function generateDashboardPdf(data: DashboardData) {
  const { summary: s, trends, topBuyers, topSources, range, granularity } = data
  const rangeLabel = `${range.from}  →  ${range.to}`

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  pdfHeader(doc, 'Dashboard Summary', rangeLabel)

  // ── KPI block ──────────────────────────────────────────────────────────────
  let y = addSection(doc, 'Key Performance Indicators', 82)

  const kpiHead = ['Metric', 'Value', 'vs Previous Period']
  const kpiRows: (string | number)[][] = [
    ['Revenue (billed)',   money(s.revenue), s.deltas.revenue  != null ? pct(s.deltas.revenue)  : '—'],
    ['Running Fee',        money(s.cost),    s.deltas.cost     != null ? pct(s.deltas.cost)     : '—'],
    ['Profit',             money(s.margin),  s.deltas.margin   != null ? pct(s.deltas.margin)   : '—'],
    ['Counted Calls',      num(s.counted),   s.deltas.counted  != null ? pct(s.deltas.counted)  : '—'],
    ['Answer Rate',        `${s.answer_rate}%`,  ''],
    ['Profit Margin',      `${s.margin_pct}%`,   ''],
    ['Active Buyers',      s.active_buyers,      ''],
    ['Active Campaigns',   s.active_campaigns,   ''],
  ]
  y = addTable(doc, y, kpiHead, kpiRows) + 20

  // ── Trends ─────────────────────────────────────────────────────────────────
  const granularityLabel = GRANULARITIES.find((g) => g.value === granularity)?.label ?? granularity
  y = addSection(doc, `Revenue / Running Fee / Profit Trend  (${granularityLabel})`, y)
  const trendRows = trends.map((t) => [
    formatPeriod(t.period),
    `$${t.revenue.toFixed(2)}`,
    `$${t.cost.toFixed(2)}`,
    `$${t.margin.toFixed(2)}`,
    t.counted,
    t.answered,
    t.missed,
  ])
  y = addTable(doc, y, ['Period', 'Revenue', 'Running Fee', 'Profit', 'Counted', 'Answered', 'Missed'], trendRows) + 20

  // ── Top buyers (new page if not enough space) ───────────────────────────────
  const pageH = doc.internal.pageSize.getHeight()
  if (y > pageH - 120) { doc.addPage(); y = 60 }

  y = addSection(doc, 'Top Buyers  (by revenue)', y)
  const buyerRows = topBuyers.map((b) => [
    b.code,
    b.name ?? '',
    `$${b.revenue.toFixed(2)}`,
    b.counted,
    b.answered,
    b.missed,
  ])
  y = addTable(doc, y, ['Buyer', 'Name', 'Revenue', 'Counted', 'Answered', 'Missed'], buyerRows) + 20

  // ── Top sources ─────────────────────────────────────────────────────────────
  if (y > pageH - 120) { doc.addPage(); y = 60 }

  y = addSection(doc, 'Top Traffic Sources  (by spend)', y)
  const sourceRows = topSources.map((s) => [
    s.source,
    `$${s.cost.toFixed(2)}`,
    s.counted,
    s.counted > 0 ? `$${(s.cost / s.counted).toFixed(2)}` : '—',
  ])
  addTable(doc, y, ['Source', 'Spend', 'Counted', 'Avg. / call'], sourceRows)

  doc.save('dashboard-summary.pdf')
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [range, setRange] = useState<Range>({ from: daysAgo(6), to: today() })
  const [granularity, setGranularity] = useState<Granularity>('day')
  const [pdfLoading, setPdfLoading] = useState(false)

  const summary    = useAsync(() => api.summary(range),                             [range.from, range.to])
  const trends     = useAsync(() => api.trends({ ...range, granularity }),          [range.from, range.to, granularity])
  const topBuyers  = useAsync(() => api.topBuyers({ ...range, limit: 8 }),          [range.from, range.to])
  const topSources = useAsync(() => api.topSources({ ...range, limit: 6 }),         [range.from, range.to])

  const s = summary.data

  const handlePdf = async () => {
    if (!summary.data || !trends.data || !topBuyers.data || !topSources.data) return
    setPdfLoading(true)
    try {
      await generateDashboardPdf({
        summary: summary.data,
        trends: trends.data,
        topBuyers: topBuyers.data,
        topSources: topSources.data,
        range,
        granularity,
      })
    } finally {
      setPdfLoading(false)
    }
  }

  const dataReady = !!(summary.data && trends.data && topBuyers.data && topSources.data)

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Performance overview of calls, revenue and margin">
        <DateRangeControl value={range} onChange={setRange} />
        <DownloadButton href={api.reportUrl(range)}>CSV</DownloadButton>
        <Button
          variant="secondary"
          onClick={handlePdf}
          disabled={pdfLoading || !dataReady}
        >
          {pdfLoading ? (
            <Spinner className="h-3.5 w-3.5" />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M16 13H8M16 17H8M10 9H8" />
            </svg>
          )}
          PDF
        </Button>
      </PageHeader>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Revenue (billed)"  value={s ? money(s.revenue) : '—'} delta={s?.deltas.revenue} loading={summary.loading} positiveIsGood />
        <StatCard label="Running Fee"       value={s ? money(s.cost)    : '—'} delta={s?.deltas.cost}    loading={summary.loading} positiveIsGood={false} />
        <StatCard label="Profit"            value={s ? money(s.margin)  : '—'} delta={s?.deltas.margin}  loading={summary.loading} positiveIsGood accent />
        <StatCard label="Counted Calls"     value={s ? num(s.counted)   : '—'} delta={s?.deltas.counted} loading={summary.loading} positiveIsGood />
      </div>

      {/* Secondary metrics */}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MiniStat label="Answer Rate"       value={s ? `${s.answer_rate}%` : '—'} />
        <MiniStat label="Profit Margin"     value={s ? `${s.margin_pct}%`  : '—'} />
        <MiniStat label="Active Buyers"     value={s ? num(s.active_buyers)     : '—'} />
        <MiniStat label="Active Campaigns"  value={s ? num(s.active_campaigns)  : '—'} />
      </div>

      {/* Revenue / cost / margin trend */}
      <Card className="mt-6">
        <CardHeader
          title="Revenue, running fee & profit over time"
          subtitle="Income trend across the selected period"
          action={
            <div className="glass-input flex rounded-xl border border-white/70 p-0.5">
              {GRANULARITIES.map((g) => (
                <button
                  key={g.value}
                  onClick={() => setGranularity(g.value)}
                  className={cx(
                    'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                    granularity === g.value
                      ? 'bg-linear-to-b from-blue-500 to-blue-600 text-white shadow'
                      : 'text-slate-600 hover:bg-white/60',
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>
          }
        />
        <div className="h-80 px-2 py-4">
          {trends.loading ? (
            <ChartLoading />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trends.data ?? []} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={COLORS.revenue} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.revenue} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="period" tickFormatter={formatPeriod} tick={{ fontSize: 12, fill: '#94a3b8' }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tickFormatter={(v) => `$${Math.round(v / 1000)}k`} tick={{ fontSize: 12, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={48} />
                <Tooltip content={<MoneyTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="revenue" name="Revenue"     stroke={COLORS.revenue} strokeWidth={2} fill="url(#rev)" />
                <Area type="monotone" dataKey="cost"    name="Running Fee" stroke={COLORS.cost}    strokeWidth={2} fill="transparent" />
                <Area type="monotone" dataKey="margin"  name="Profit"      stroke={COLORS.margin}  strokeWidth={2} fill="transparent" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top buyers */}
        <Card>
          <CardHeader title="Most active buyers" subtitle="By revenue in the selected period" />
          <div className="h-80 px-2 py-4">
            {topBuyers.loading ? (
              <ChartLoading />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topBuyers.data ?? []} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => `$${Math.round(v / 1000)}k`} tick={{ fontSize: 12, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="code" tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} axisLine={false} width={56} />
                  <Tooltip content={<MoneyTooltip valueKey="revenue" />} cursor={{ fill: '#f8fafc' }} />
                  <Bar dataKey="revenue" name="Revenue" radius={[0, 4, 4, 0]} fill={COLORS.revenue} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Answered vs missed trend */}
        <Card>
          <CardHeader title="Answered vs missed calls" subtitle="Call quality over time (buyer side)" />
          <div className="h-80 px-2 py-4">
            {trends.loading ? (
              <ChartLoading />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trends.data ?? []} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="period" tickFormatter={formatPeriod} tick={{ fontSize: 12, fill: '#94a3b8' }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="answered" name="Answered" stroke={COLORS.answered} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="missed"   name="Missed"   stroke={COLORS.missed}   strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* Top traffic sources */}
      <Card className="mt-6">
        <CardHeader title="Top traffic sources" subtitle="Campaign spend by source" />
        <div className="h-72 px-2 py-4">
          {topSources.loading ? (
            <ChartLoading />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topSources.data ?? []} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="source" tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v) => `$${Math.round(v / 1000)}k`} tick={{ fontSize: 12, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={48} />
                <Tooltip content={<MoneyTooltip valueKey="cost" />} cursor={{ fill: '#f8fafc' }} />
                <Bar dataKey="cost" name="Cost" radius={[4, 4, 0, 0]} barSize={40}>
                  {(topSources.data ?? []).map((_, i) => (
                    <Cell key={i} fill={i === 0 ? COLORS.revenue : '#93c5fd'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {(summary.error || trends.error) && (
        <p className="mt-4 text-sm text-red-600">
          {summary.error || trends.error}. Is the PHP API running on port 8000?
        </p>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label, value, delta, loading, positiveIsGood, accent,
}: {
  label: string
  value: string
  delta?: number | null
  loading: boolean
  positiveIsGood: boolean
  accent?: boolean
}) {
  const good = delta != null && (positiveIsGood ? delta >= 0 : delta <= 0)
  return (
    <div className={cx('rounded-2xl p-5 shadow-xl shadow-slate-900/5', accent ? 'glass-strong ring-1 ring-blue-300/50' : 'glass')}>
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="mt-2 flex items-end justify-between">
        {loading ? (
          <div className="h-8 w-24 animate-pulse rounded bg-slate-100" />
        ) : (
          <div className="text-2xl font-bold tracking-tight text-slate-900">{value}</div>
        )}
        {delta !== undefined && delta !== null && !loading && (
          <span className={cx('flex items-center gap-0.5 text-xs font-semibold', good ? 'text-emerald-600' : 'text-red-500')}>
            {delta >= 0 ? '▲' : '▼'} {pct(Math.abs(delta))}
          </span>
        )}
      </div>
      {delta !== undefined && <div className="mt-1 text-xs text-slate-400">vs previous period</div>}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-2xl p-4 shadow-lg shadow-slate-900/5">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-900">{value}</div>
    </div>
  )
}

function ChartLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner className="h-6 w-6" />
    </div>
  )
}

interface TooltipProps {
  active?: boolean
  payload?: { name: string; value: number; color: string; dataKey: string }[]
  label?: string
  valueKey?: string
}

function MoneyTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      {label && <div className="mb-1 font-medium text-slate-700">{formatPeriod(label)}</div>}
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-500">{p.name}:</span>
          <span className="font-medium text-slate-800">{money(p.value)}</span>
        </div>
      ))}
    </div>
  )
}