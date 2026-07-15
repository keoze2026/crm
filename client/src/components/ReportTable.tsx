/* Shared billing-report table used by Complete Report, Buyers (revenue billing)
 * and Campaigns (cost billing) so all three match. Restyled to the M.O.N.K.Y
 * dark theme — structure (date rowspan, TOTAL band) preserved, colours tokenized. */
import type { ReactNode } from 'react'
import { formatDmy, money2, num } from '../lib/format'
import { cn } from '@/lib/utils'
import { Bullet } from '@/components/ui/bullet'
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
    <div className="mb-3 flex items-center gap-2.5">
      <Bullet />
      <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">
        {title} <span className="font-normal normal-case text-muted-foreground">— {note}</span>
      </h3>
    </div>
  )
}

// Fixed-width, left-aligned box centered in a `text-center` cell.
function Box({ children, w }: { children: ReactNode; w: string }) {
  return <span className={cn('inline-block text-left tabular-nums', w)}>{children}</span>
}

const KIND_CLASS: Record<Col['kind'], string> = {
  text:  'text-foreground',
  num:   'tabular-nums text-foreground',
  total: 'font-bold tabular-nums text-foreground',
}

/** One styled report table — primary header, dark body with subtle grid, primary TOTAL band. */
export function SectionTable({ dateLabel, cols, rows, totals }: { dateLabel: string; cols: Col[]; rows: string[][]; totals: string[] }) {
  const span = Math.max(rows.length, 1)
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-border">
      <table className="w-full min-w-180 table-fixed border-collapse text-sm">
        <colgroup>
          <col style={{ width: '11%' }} />{/* Date */}
          {cols.map((c) => <col key={c.label} style={{ width: c.w }} />)}
        </colgroup>

        <thead>
          <tr className="bg-primary text-center text-xs font-bold uppercase tracking-wide text-primary-foreground">
            <th className="border border-border px-4 py-2.5">DATE</th>
            {cols.map((c) => <th key={c.label} className="border border-border px-4 py-2.5">{c.label}</th>)}
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="border border-border bg-accent px-2 py-2 text-center align-middle font-bold leading-tight text-foreground">{dateLabel}</td>
              {cols.map((c) => <td key={c.label} className="border border-border bg-card px-2 py-2 text-center text-muted-foreground"><Box w={c.box}>—</Box></td>)}
            </tr>
          ) : (
            rows.map((cells, ri) => (
              <tr key={ri}>
                {ri === 0 && (
                  <td rowSpan={span} className="border border-border bg-accent px-2 py-2 text-center align-middle font-bold leading-tight text-foreground">
                    {dateLabel}
                  </td>
                )}
                {cells.map((cell, ci) => (
                  <td key={ci} className={cn('border border-border bg-card px-2 py-2 text-center', KIND_CLASS[cols[ci].kind])}>
                    <Box w={cols[ci].box}>{cell}</Box>
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>

        <tfoot>
          <tr className="bg-primary text-primary-foreground">
            <td className="border border-border px-4 py-2.5 text-center text-xs font-bold uppercase tracking-wide">TOTAL</td>
            {totals.map((cell, ci) => (
              <td key={ci} className="border border-border px-2 py-2.5 text-center font-bold tabular-nums">
                <Box w={cols[ci].box}>{cell}</Box>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
