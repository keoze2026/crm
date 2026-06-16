import { useState } from 'react'
import { api } from '../api/client'
import { DateRangeControl, type Range } from '../components/DateRange'
import { PageHeader } from '../components/Layout'
import { Card, cx, EmptyState, Spinner } from '../components/ui'
import { daysAgo, formatDmy, money, money2, num, today } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import type { CompleteReport } from '../types'

// Palette mirrors the downloadable PDF (navy bands, cyan revenue body, white date column).
const NAVY = 'rgb(26, 54, 84)'
const CYAN = 'rgb(212, 233, 242)'
const INK = 'rgb(15, 23, 42)'
const BORDER = '1px solid white'

/** Human-readable date label: single day, range, or em-dash when unset. */
function rangeText(from: string | null, to: string | null): string {
  if (!from && !to) return '—'
  if (from && to && from !== to) return `${formatDmy(from)}  –  ${formatDmy(to)}`
  return formatDmy(from ?? to)
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function CompleteReportPage() {
  const [range, setRange] = useState<Range>({ from: daysAgo(6), to: today() })
  const report = useAsync(() => api.completeReport(range), [range.from, range.to])
  const data = report.data

  return (
    <div>
      <PageHeader title="Complete Report" subtitle="Filter by date — the report below updates to match">
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

// ─── Rendered report (same layout as the PDF export) ────────────────────────────

function ReportView({ data }: { data: CompleteReport }) {
  const dateLabel = rangeText(data.from, data.to)
  const startLabel = data.from ? formatDmy(data.from) : dateLabel
  const endLabel = data.to && data.to !== data.from ? formatDmy(data.to) : ''
  const bt = data.buyer_totals
  const ct = data.campaign_totals

  const buyerRows = data.buyers.map((b) => [
    b.code, num(b.answered), num(b.missed), num(b.counted), money2(b.rate), money2(b.total_bill),
  ])
  const buyerTotals = [
    'TOTAL', String(bt.destinations), num(bt.answered), num(bt.missed), num(bt.counted), '—', money2(bt.total_bill),
  ]

  const campRows = data.campaigns.map((c) => [
    c.camp, c.destination, num(c.answered), num(c.missed), num(c.counted), money2(c.rate), money2(c.total_bill),
  ])
  const campTotals = [
    'TOTAL', String(ct.camps), String(ct.destinations), num(ct.answered), num(ct.missed), num(ct.counted), '—', money2(ct.total_bill),
  ]

  return (
    <div className="mx-auto max-w-4xl">
      {/* Title block — matches the PDF header */}
      <div className="mb-4">
        <h2 className="text-lg font-bold" style={{ color: NAVY }}>Complete Report</h2>
        <div className="mt-0.5 flex flex-wrap justify-between gap-x-4 text-xs text-slate-500">
          <span>Period: {dateLabel}</span>
          <span>Generated {new Date().toLocaleString()}</span>
        </div>
      </div>

      {/* Revenue side — one row per destination (buyer) */}
      <div className="overflow-x-auto">
        <ReportTable
          columns={['DATE', 'DESTINATION', 'ANSWERED', 'MISSED', 'COUNTED', 'RATE', 'TOTAL BILL']}
          rows={buyerRows}
          totals={buyerTotals}
          startLabel={startLabel}
          endLabel={endLabel}
          bodyBg={CYAN}
        />
      </div>

      {/* Profit badge */}
      <div className="my-5 flex justify-center">
        <div style={{ backgroundColor: NAVY }} className="rounded-lg px-10 py-2.5 text-2xl font-bold text-white shadow-md">
          {money(data.profit)}
        </div>
      </div>

      {/* Cost side — one row per campaign + destination */}
      <div className="overflow-x-auto">
        <ReportTable
          columns={['DATE', 'CAMP', 'DESTINATION', 'ANSWERED', 'MISSED', 'COUNTED', 'RATE', 'TOTAL BILL']}
          rows={campRows}
          totals={campTotals}
          startLabel={startLabel}
          endLabel={endLabel}
          bodyBg="white"
        />
      </div>
    </div>
  )
}

/** One report table: navy header, body, and an integrated navy TOTAL row. */
function ReportTable({
  columns,
  rows,
  totals,
  startLabel,
  endLabel,
  bodyBg,
}: {
  columns: string[]
  rows: string[][]
  totals: string[]
  startLabel: string
  endLabel: string
  bodyBg: string
}) {
  const last = rows.length - 1
  return (
    <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c}
              style={{ backgroundColor: NAVY, color: 'white', border: BORDER }}
              className="px-2 py-1.5 text-center font-bold uppercase tracking-wide"
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td style={{ backgroundColor: 'white', color: INK, border: BORDER }} className="px-2 py-1.5 text-center font-semibold">
              {startLabel}
            </td>
            {columns.slice(1).map((_, i) => (
              <td key={i} style={{ backgroundColor: bodyBg, color: INK, border: BORDER }} className="px-2 py-1.5">—</td>
            ))}
          </tr>
        ) : (
          rows.map((cells, ri) => (
            <tr key={ri}>
              <td
                style={{ backgroundColor: 'white', color: INK, border: BORDER }}
                className="whitespace-nowrap px-2 py-1.5 text-center font-semibold"
              >
                {ri === 0 ? startLabel : ri === last && endLabel ? endLabel : ''}
              </td>
              {cells.map((cell, ci) => (
                <td key={ci} style={{ backgroundColor: bodyBg, color: INK, border: BORDER }} className="px-2 py-1.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))
        )}
        {/* TOTAL row */}
        <tr>
          {totals.map((cell, i) => (
            <td
              key={i}
              style={{ backgroundColor: NAVY, color: 'white', border: BORDER }}
              className={cx('px-2 py-1.5 font-bold', i >= 2 ? 'text-right' : 'text-left')}
            >
              {cell}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}
