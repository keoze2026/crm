import { useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { DateRangeControl, type Range } from '../components/DateRange'
import { PageHeader } from '../components/Layout'
import { Card, cx, EmptyState, Spinner } from '../components/ui'
import { daysAgo, formatDmy, money, money2, num, today } from '../lib/format'
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

  // Revenue side — one row per destination (buyer)
  const buyerCols: Col[] = [
    { label: 'DESTINATION', w: '18%', box: 'w-16', kind: 'text' },
    { label: 'ANSWERED',    w: '12%', box: 'w-12', kind: 'num'  },
    { label: 'MISSED',      w: '11%', box: 'w-10', kind: 'num'  },
    { label: 'REPLACEMENT', w: '13%', box: 'w-12', kind: 'num'  },
    { label: 'COUNTED',     w: '12%', box: 'w-12', kind: 'num'  },
    { label: 'RATE',        w: '12%', box: 'w-16', kind: 'num'  },
    { label: 'TOTAL BILL',  w: '14%', box: 'w-28', kind: 'total'},
  ]
  const buyerRows = data.buyers.map((b) => [
    b.code, num(b.answered), num(b.missed), num(REPLACEMENT), num(b.counted), money2(b.rate), money2(b.total_bill),
  ])
  const buyerTotals = [
    String(bt.destinations), num(bt.answered), num(bt.missed), num(REPLACEMENT * data.buyers.length), num(bt.counted), '—', money2(bt.total_bill),
  ]

  // Cost side — one row per campaign + destination
  const campCols: Col[] = [
    { label: 'CAMP',        w: '11%', box: 'w-16', kind: 'text' },
    { label: 'DESTINATION', w: '13%', box: 'w-20', kind: 'text' },
    { label: 'ANSWERED',    w: '11%', box: 'w-12', kind: 'num'  },
    { label: 'MISSED',      w: '9%',  box: 'w-10', kind: 'num'  },
    { label: 'REPLACEMENT', w: '12%', box: 'w-12', kind: 'num'  },
    { label: 'COUNTED',     w: '11%', box: 'w-12', kind: 'num'  },
    { label: 'RATE',        w: '11%', box: 'w-16', kind: 'num'  },
    { label: 'TOTAL BILL',  w: '13%', box: 'w-28', kind: 'total'},
  ]
  const campRows = data.campaigns.map((c) => [
    c.camp, c.destination, num(c.answered), num(c.missed), num(REPLACEMENT), num(c.counted), money2(c.rate), money2(c.total_bill),
  ])
  const campTotals = [
    String(ct.camps), String(ct.destinations), num(ct.answered), num(ct.missed), num(REPLACEMENT * data.campaigns.length), num(ct.counted), '—', money2(ct.total_bill),
  ]

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* Period line */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-xs text-slate-500">
        <span>Period: <span className="font-medium text-slate-700">{dateLabel}</span></span>
        <span>{data.buyers.length} destinations · {data.campaigns.length} campaign rows</span>
      </div>

      {/* Revenue (buyer) */}
      <section>
        <SectionHeading title="Revenue" note="buyer destinations" />
        <SectionTable dateLabel={dateLabel} dateW="12%" cols={buyerCols} rows={buyerRows} totals={buyerTotals} />
      </section>

      {/* Cost (campaign) */}
      <section>
        <SectionHeading title="Cost" note="campaign destinations" />
        <SectionTable dateLabel={dateLabel} dateW="14%" cols={campCols} rows={campRows} totals={campTotals} />
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
      <span className="h-5 w-1.5 rounded-full bg-blue-600" />
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

const KIND_CLASS: Record<Col['kind'], string> = {
  text:  'font-medium text-slate-800',
  num:   'tabular-nums text-slate-600',
  total: 'font-semibold tabular-nums text-slate-900',
}

/** One styled report table — blue header, tinted merged Date column, zebra body, blue TOTAL band. */
function SectionTable({ dateLabel, dateW, cols, rows, totals }: {
  dateLabel: string; dateW: string; cols: Col[]; rows: string[][]; totals: string[]
}) {
  const span = Math.max(rows.length, 1)
  return (
    <div className="overflow-x-auto rounded-2xl border border-blue-100 shadow-sm">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col style={{ width: dateW }} />
          {cols.map((c) => <col key={c.label} style={{ width: c.w }} />)}
        </colgroup>

        <thead>
          <tr className="bg-blue-600 text-center text-xs font-semibold uppercase tracking-wide text-blue-50">
            <th className="px-4 py-3">DATE</th>
            {cols.map((c) => <th key={c.label} className="px-4 py-3">{c.label}</th>)}
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr className="border-b border-slate-100/70">
              <td className="bg-blue-50/70 px-4 py-3 text-center align-middle font-semibold leading-tight text-blue-900">{dateLabel}</td>
              {cols.map((c) => <td key={c.label} className="py-3 pl-10 pr-2 text-center text-slate-400"><Box w={c.box}>—</Box></td>)}
            </tr>
          ) : (
            rows.map((cells, ri) => (
              <tr key={ri} className="border-b border-slate-100/70 odd:bg-white/60 even:bg-blue-50/40 hover:bg-blue-100/50">
                {ri === 0 && (
                  <td rowSpan={span} className="bg-blue-50/70 px-4 py-3 text-center align-middle font-semibold leading-tight text-blue-900">
                    {dateLabel}
                  </td>
                )}
                {cells.map((cell, ci) => (
                  <td key={ci} className={cx('py-3 pl-10 pr-2 text-center', KIND_CLASS[cols[ci].kind])}>
                    <Box w={cols[ci].box}>{cell}</Box>
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>

        <tfoot>
          <tr className="border-t-2 border-blue-200 bg-blue-50 font-semibold text-slate-900">
            <td className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-blue-700">TOTAL</td>
            {totals.map((cell, ci) => (
              <td key={ci} className={cx('py-3 pl-10 pr-2 text-center tabular-nums', cols[ci].kind === 'total' && 'text-blue-700')}>
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
    <div className="flex flex-col items-stretch gap-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-5 sm:flex-row sm:items-center sm:justify-center">
      <Tile label="Revenue" value={money(revenue)} />
      <Operator>−</Operator>
      <Tile label="Cost" value={money(cost)} />
      <Operator>=</Operator>
      <Tile label="Profit" value={money(profit)} highlight={profit >= 0 ? 'blue' : 'red'} />
    </div>
  )
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: 'blue' | 'red' }) {
  const filled = highlight === 'blue' ? 'bg-blue-600 text-white border-blue-600'
    : highlight === 'red' ? 'bg-red-600 text-white border-red-600'
    : 'bg-white text-slate-900 border-blue-100'
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
