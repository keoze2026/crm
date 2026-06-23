import { useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { DateRangeControl, type Range } from '../components/DateRange'
import { PageHeader } from '../components/Layout'
import { Protected } from '../components/PasswordGate'
import {
  SectionTable, SectionHeading, rangeText,
  buyerCols, campCols, buyerTableData, campTableData,
} from '../components/ReportTable'
import { Card, cx, EmptyState, Spinner } from '../components/ui'
import { daysAgo, money2, today } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import type { CompleteReport } from '../types'

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function CompleteReportPage() {
  return (
    <Protected pageTitle="Complete Report" password="admin-2026" storageKey="lock-complete-report">
      <CompleteReportView />
    </Protected>
  )
}

function CompleteReportView() {
  const [range, setRange] = useState<Range>({ from: daysAgo(6), to: today() })
  const report = useAsync(() => api.completeReport(range), [range.from, range.to])
  const data = report.data

  return (
    <div>
      <PageHeader title="Complete Report" subtitle="Revenue and cost, combined into profit — filter by date">
        <DateRangeControl value={range} onChange={setRange} />
      </PageHeader>

      <Card className="p-6">
        {report.loading ? (
          <div className="flex justify-center py-16"><Spinner className="h-7 w-7" /></div>
        ) : report.error ? (
          <p className="py-10 text-center text-sm text-red-600">{report.error}</p>
        ) : !data || (data.buyers.length === 0 && data.campaigns.length === 0) ? (
          <EmptyState message="No data for this period." />
        ) : (
          <ReportView data={data} />
        )}
      </Card>
    </div>
  )
}

// ─── Rendered report ────────────────────────────────────────────────────────────

function ReportView({ data }: { data: CompleteReport }) {
  const dateLabel = rangeText(data.from, data.to)
  const buyer = buyerTableData(data)
  const camp = campTableData(data)

  return (
    <div className="mx-auto space-y-8">
      {/* Period line */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-xs text-slate-500">
        <span>Period: <span className="font-medium text-slate-700">{dateLabel}</span></span>
        <span>{data.buyers.length} destinations · {data.campaigns.length} campaign rows</span>
      </div>

      {/* Revenue (buyer) */}
      <section>
        <SectionHeading title="Revenue" note="buyer destinations" />
        <SectionTable dateLabel={dateLabel} cols={buyerCols} rows={buyer.rows} totals={buyer.totals} />
      </section>

      {/* Cost (campaign) */}
      <section>
        <SectionHeading title="Cost" note="campaign destinations" />
        <SectionTable dateLabel={dateLabel} cols={campCols} rows={camp.rows} totals={camp.totals} />
      </section>

      {/* Combined — Revenue − Cost = Profit */}
      <section>
        <SectionHeading title="Complete" note="revenue − cost = profit" />
        <FormulaBand revenue={data.revenue} cost={data.cost} profit={data.profit} />
      </section>
    </div>
  )
}

// ─── Profit band ─────────────────────────────────────────────────────────────────

/** Combined profit: Revenue − Cost = Profit, laid out as an equation. */
function FormulaBand({ revenue, cost, profit }: { revenue: number; cost: number; profit: number }) {
  return (
    <div className="flex flex-col items-stretch gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:flex-row sm:items-center sm:justify-center">
      <Tile label="Revenue" value={money2(revenue)} />
      <Operator>−</Operator>
      <Tile label="Cost" value={money2(cost)} />
      <Operator>=</Operator>
      <Tile label="Profit" value={money2(profit)} highlight={profit >= 0 ? 'navy' : 'red'} />
    </div>
  )
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: 'navy' | 'red' }) {
  const filled = highlight === 'navy' ? 'bg-[#1a3654] text-white border-[#1a3654]'
    : highlight === 'red' ? 'bg-red-600 text-white border-red-600'
    : 'bg-white text-[#0f172a] border-slate-200'
  return (
    <div className={cx('flex-1 rounded-xl border px-6 py-4 text-center shadow-sm', filled)}>
      <p className={cx('text-[11px] font-semibold uppercase tracking-wide', highlight ? 'text-white/80' : 'text-slate-400')}>{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  )
}

function Operator({ children }: { children: ReactNode }) {
  return <span className="self-center text-2xl font-bold text-slate-400">{children}</span>
}
