import { useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { DateRangeControl, type Range } from '../components/DateRange'
import { PageHeader } from '../components/Layout'
import { Card, cx, EmptyState, Spinner } from '../components/ui'
import { daysAgo, formatDmy, money2, num, today } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import type { CompleteReport } from '../types'

/** Human-readable date label: single day, range, or em-dash when unset. */
function rangeText(from: string | null, to: string | null): string {
  if (!from && !to) return '—'
  if (from && to && from !== to) return `${formatDmy(from)} – ${formatDmy(to)}`
  return formatDmy(from ?? to)
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function CompleteReportPage() {
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
  const bt = data.buyer_totals
  const ct = data.campaign_totals

  // Placeholder per-row replacement count (after Missed, before the final Counted).
  const REPLACEMENT = 1

  // Sort both tables by Total Bill, highest → lowest.
  const sortedBuyers = [...data.buyers].sort((a, b) => b.total_bill - a.total_bill)
  const sortedCampaigns = [...data.campaigns].sort((a, b) => b.total_bill - a.total_bill)

  // Revenue side — one row per destination (buyer)
  const buyerCols: Col[] = [
    { label: 'DESTINATION', w: '16%', box: 'w-16', kind: 'text' },
    { label: 'ANSWERED',    w: '14%', box: 'w-12', kind: 'num'  },
    { label: 'MISSED',      w: '12%', box: 'w-10', kind: 'num'  },
    { label: 'REPLACEMENT', w: '14%', box: 'w-12', kind: 'num'  },
    { label: 'COUNTED',     w: '14%', box: 'w-12', kind: 'num'  },
    { label: 'RATE',        w: '14%', box: 'w-16', kind: 'num'  },
    { label: 'TOTAL BILL',  w: '16%', box: 'w-28', kind: 'total'},
  ]
  const buyerRows = sortedBuyers.map((b) => [
    b.code, num(b.answered), num(b.missed), num(REPLACEMENT), num(b.counted), money2(b.rate), money2(b.total_bill),
  ])
  const buyerTotals = [
    String(bt.destinations), num(bt.answered), num(bt.missed), num(REPLACEMENT * data.buyers.length), num(bt.counted), '—', money2(bt.total_bill),
  ]

  // Cost side — one row per campaign + destination
  const campCols: Col[] = [
    { label: 'CAMP',        w: '11%', box: 'w-16', kind: 'text' },
    { label: 'DESTINATION', w: '13%', box: 'w-20', kind: 'text' },
    { label: 'ANSWERED',    w: '12%', box: 'w-12', kind: 'num'  },
    { label: 'MISSED',      w: '10%', box: 'w-10', kind: 'num'  },
    { label: 'REPLACEMENT', w: '13%', box: 'w-12', kind: 'num'  },
    { label: 'COUNTED',     w: '12%', box: 'w-12', kind: 'num'  },
    { label: 'RATE',        w: '12%', box: 'w-16', kind: 'num'  },
    { label: 'TOTAL BILL',  w: '17%', box: 'w-28', kind: 'total'},
  ]
  const campRows = sortedCampaigns.map((c) => [
    c.camp, c.destination, num(c.answered), num(c.missed), num(REPLACEMENT), num(c.counted), money2(c.rate), money2(c.total_bill),
  ])
  const campTotals = [
    String(ct.camps), String(ct.destinations), num(ct.answered), num(ct.missed), num(REPLACEMENT * data.campaigns.length), num(ct.counted), '—', money2(ct.total_bill),
  ]

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
        <SectionTable dateLabel={dateLabel} cols={buyerCols} rows={buyerRows} totals={buyerTotals} />
      </section>

      {/* Cost (campaign) */}
      <section>
        <SectionHeading title="Cost" note="campaign destinations" />
        <SectionTable dateLabel={dateLabel} cols={campCols} rows={campRows} totals={campTotals} />
      </section>

      {/* Combined — Revenue − Cost = Profit */}
      <section>
        <SectionHeading title="Complete" note="revenue − cost = profit" />
        <FormulaBand revenue={data.revenue} cost={data.cost} profit={data.profit} />
      </section>
    </div>
  )
}

// ─── Building blocks ─────────────────────────────────────────────────────────────

interface Col { label: string; w: string; box: string; kind: 'text' | 'num' | 'total' }

function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="h-5 w-1.5 rounded-full bg-[#1a3654]" />
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
        {title} <span className="font-normal normal-case text-slate-400">— {note}</span>
      </h3>
    </div>
  )
}

// Fixed-width, left-aligned box centered in a `text-center` cell — values share one
// clean vertical line (same pattern as the Leads Record table).
function Box({ children, w }: { children: ReactNode; w: string }) {
  return <span className={cx('inline-block text-left tabular-nums', w)}>{children}</span>
}

// Body text colours mirror the report theme: ink text on cyan cells, bold total.
const KIND_CLASS: Record<Col['kind'], string> = {
  text:  'text-[#0f172a]',
  num:   'tabular-nums text-[#0f172a]',
  total: 'font-bold tabular-nums text-[#0f172a]',
}

/** One styled report table — navy header, cyan body with white grid, navy TOTAL band. */
function SectionTable({ dateLabel, cols, rows, totals }: { dateLabel: string; cols: Col[]; rows: string[][]; totals: string[] }) {
  const span = Math.max(rows.length, 1)
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col style={{ width: '11%' }} />{/* Date */}
          {cols.map((c) => <col key={c.label} style={{ width: c.w }} />)}
        </colgroup>

        <thead>
          <tr className="bg-[#1a3654] text-center text-xs font-bold uppercase tracking-wide text-white">
            <th className="border border-white px-4 py-2.5">DATE</th>
            {cols.map((c) => <th key={c.label} className="border border-white px-4 py-2.5">{c.label}</th>)}
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="border border-white bg-[#bfdeeb] px-2 py-2 text-center align-middle font-bold leading-tight text-[#1a3654]">{dateLabel}</td>
              {cols.map((c) => <td key={c.label} className="border border-white bg-[#d4e9f2] py-2 pl-10 pr-2 text-center text-slate-400"><Box w={c.box}>—</Box></td>)}
            </tr>
          ) : (
            rows.map((cells, ri) => (
              <tr key={ri}>
                {ri === 0 && (
                  <td rowSpan={span} className="border border-white bg-[#bfdeeb] px-2 py-2 text-center align-middle font-bold leading-tight text-[#1a3654]">
                    {dateLabel}
                  </td>
                )}
                {cells.map((cell, ci) => (
                  <td key={ci} className={cx('border border-white bg-[#d4e9f2] py-2 pl-10 pr-2 text-center', KIND_CLASS[cols[ci].kind])}>
                    <Box w={cols[ci].box}>{cell}</Box>
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>

        <tfoot>
          <tr className="bg-[#1a3654] text-white">
            {/* "TOTAL" sits under the DATE column; each data column shows its total. */}
            <td className="border border-white px-4 py-2.5 text-center text-xs font-bold uppercase tracking-wide">TOTAL</td>
            {totals.map((cell, ci) => (
              <td key={ci} className="border border-white py-2.5 pl-10 pr-2 text-center font-bold tabular-nums">
                <Box w={cols[ci].box}>{cell}</Box>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

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
