/* Shared billing-report table (navy/cyan theme) used by Complete Report,
 * Buyers (revenue billing) and Campaigns (cost billing) so all three match. */
import type { ReactNode } from 'react'
import { formatDmy, money2, num } from '../lib/format'
import { cx } from './ui'
import type { CompleteReport } from '../types'

export interface Col { label: string; w: string; box: string; kind: 'text' | 'num' | 'total' }

/** Human-readable date label: single day, range, or em-dash when unset. */
export function rangeText(from: string | null, to: string | null): string {
  if (!from && !to) return '—'
  if (from && to && from !== to) return `${formatDmy(from)} – ${formatDmy(to)}`
  return formatDmy(from ?? to)
}

export const buyerCols: Col[] = [
  { label: 'DESTINATION', w: '16%', box: 'w-16', kind: 'text' },
  { label: 'ANSWERED',    w: '14%', box: 'w-12', kind: 'num'  },
  { label: 'MISSED',      w: '12%', box: 'w-10', kind: 'num'  },
  { label: 'REPLACEMENT', w: '14%', box: 'w-12', kind: 'num'  },
  { label: 'COUNTED',     w: '14%', box: 'w-12', kind: 'num'  },
  { label: 'RATE',        w: '14%', box: 'w-16', kind: 'num'  },
  { label: 'TOTAL BILL',  w: '16%', box: 'w-28', kind: 'total'},
]

export const campCols: Col[] = [
  { label: 'CAMP',        w: '11%', box: 'w-16', kind: 'text' },
  { label: 'DESTINATION', w: '13%', box: 'w-20', kind: 'text' },
  { label: 'ANSWERED',    w: '12%', box: 'w-12', kind: 'num'  },
  { label: 'MISSED',      w: '10%', box: 'w-10', kind: 'num'  },
  { label: 'REPLACEMENT', w: '13%', box: 'w-12', kind: 'num'  },
  { label: 'COUNTED',     w: '12%', box: 'w-12', kind: 'num'  },
  { label: 'RATE',        w: '12%', box: 'w-16', kind: 'num'  },
  { label: 'TOTAL BILL',  w: '17%', box: 'w-28', kind: 'total'},
]

/** Buyer (revenue) rows + totals, sorted by Rate high → low. */
export function buyerTableData(data: CompleteReport) {
  const sorted = [...data.buyers].sort((a, b) => b.rate - a.rate)
  const rows = sorted.map((b) => [
    b.code, num(b.answered), num(b.missed), num(b.replacement), num(b.counted), money2(b.rate), money2(b.total_bill),
  ])
  const bt = data.buyer_totals
  const totals = [
    String(bt.destinations), num(bt.answered), num(bt.missed), num(bt.replacement), num(bt.counted), '—', money2(bt.total_bill),
  ]
  return { rows, totals }
}

/** Campaign (cost) rows + totals, sorted by Rate high → low. */
export function campTableData(data: CompleteReport) {
  const sorted = [...data.campaigns].sort((a, b) => b.rate - a.rate)
  const rows = sorted.map((c) => [
    c.camp, c.destination, num(c.answered), num(c.missed), num(c.replacement), num(c.counted), money2(c.rate), money2(c.total_bill),
  ])
  const ct = data.campaign_totals
  const totals = [
    String(ct.camps), String(ct.destinations), num(ct.answered), num(ct.missed), num(ct.replacement), num(ct.counted), '—', money2(ct.total_bill),
  ]
  return { rows, totals }
}

export function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="h-5 w-1.5 rounded-full bg-[#1a3654]" />
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
        {title} <span className="font-normal normal-case text-slate-400">— {note}</span>
      </h3>
    </div>
  )
}

// Fixed-width, left-aligned box centered in a `text-center` cell.
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
export function SectionTable({ dateLabel, cols, rows, totals }: { dateLabel: string; cols: Col[]; rows: string[][]; totals: string[] }) {
  const span = Math.max(rows.length, 1)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-180 table-fixed border-collapse text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
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
              {cols.map((c) => <td key={c.label} className="border border-white bg-[#d4e9f2] px-2 py-2 text-center text-slate-400"><Box w={c.box}>—</Box></td>)}
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
                  <td key={ci} className={cx('border border-white bg-[#d4e9f2] px-2 py-2 text-center', KIND_CLASS[cols[ci].kind])}>
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
              <td key={ci} className="border border-white px-2 py-2.5 text-center font-bold tabular-nums">
                <Box w={cols[ci].box}>{cell}</Box>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
