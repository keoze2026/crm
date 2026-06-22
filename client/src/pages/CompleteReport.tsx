import { useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../api/client'
import { DateRangeControl, type Range } from '../components/DateRange'
import { PageHeader } from '../components/Layout'
import {
  SectionTable, SectionHeading, rangeText,
  buyerCols, campCols, buyerTableData, campTableData,
} from '../components/ReportTable'
import { Button, Card, cx, EmptyState, Input, Spinner } from '../components/ui'
import { daysAgo, money2, today } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import type { CompleteReport } from '../types'

// Admin gate for the comprehensive report. NOTE: this is a client-side gate for
// access control in the UI only — it is NOT real security (the password ships in
// the bundle). Move this check to the backend/auth layer for true protection.
const ADMIN_PASSWORD = 'callflow-admin'
const UNLOCK_KEY = 'complete-report-unlocked'

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function CompleteReportPage() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(UNLOCK_KEY) === '1')
  const [range, setRange] = useState<Range>({ from: daysAgo(6), to: today() })
  const report = useAsync(() => api.completeReport(range), [range.from, range.to])
  const data = report.data

  if (!unlocked) {
    return (
      <div>
        <PageHeader title="Complete Report" subtitle="Admin only — combined revenue, cost and profit" />
        <PasswordGate onUnlock={() => { sessionStorage.setItem(UNLOCK_KEY, '1'); setUnlocked(true) }} />
      </div>
    )
  }

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

// ─── Admin password gate ─────────────────────────────────────────────────────────

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [pwd, setPwd] = useState('')
  const [error, setError] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (pwd === ADMIN_PASSWORD) onUnlock()
    else setError(true)
  }

  return (
    <Card className="mx-auto max-w-sm p-8">
      <div className="mb-4 flex flex-col items-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1a3654] text-white">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-800">Admin access required</h2>
          <p className="mt-0.5 text-sm text-slate-500">Enter the password to view the comprehensive report.</p>
        </div>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <Input
          type="password"
          placeholder="Password"
          value={pwd}
          onChange={(e) => { setPwd(e.target.value); setError(false) }}
          autoFocus
        />
        {error && <p className="text-sm text-red-600">Incorrect password.</p>}
        <Button type="submit" className="w-full justify-center">Unlock</Button>
      </form>
    </Card>
  )
}
