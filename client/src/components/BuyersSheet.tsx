import { useRef, useState } from 'react'
import { api } from '../api/client'
import { money, money2, num } from '../lib/format'
import type { Buyer } from '../types'
import { Input, cx } from './ui'

/**
 * "Monthly Sheet" of buyers (revenue side), matching the client layout:
 * Sr. No. · Buyers · Total Calls Bought · Average Calls a Day · Rates · Amount Received.
 *
 * "Total Calls Bought" always auto-populates from the Daily Sheet (the SUM of counted
 * calls in the selected date range), so it changes as the date range changes — it's
 * read-only here. The buyer code and Rates stay editable. Average Calls a Day (= total ÷
 * the buyer's working days with records, N/A when none) and Amount Received (= rate × total)
 * are auto-calculated. Weekends (Sat/Sun) are excluded from every total on this sheet — the
 * server only aggregates weekday (Mon–Fri) records. New buyers show up here once they're
 * used on the Daily Sheet page, so there is no add row. Rows auto-save on blur. Colors match
 * the Daily Sheet.
 */
export default function BuyersSheet({ buyers, onChanged }: { buyers: Buyer[]; onChanged: () => void }) {
  const totals = buyers.reduce(
    (a, b) => ({ counted: a.counted + Number(b.counted), revenue: a.revenue + Number(b.revenue) }),
    { counted: 0, revenue: 0 },
  )
  const avgRate = totals.counted > 0 ? totals.revenue / totals.counted : 0
  // Divisor for the grand "calls a day" = the most active buyer's day count, i.e. the
  // number of business days present in the range.
  const maxDays = buyers.reduce((m, b) => Math.max(m, b.record_days), 0)
  const totalAvgPerDay = maxDays > 0 ? Math.round(totals.counted / maxDays) : 0

  const headCls = 'px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide bg-[#1a3654] text-white'

  return (
    <div className="overflow-x-auto rounded-t-2xl">
      <table className="mx-auto w-[62.5%] min-w-125 border-collapse text-sm [&_td]:border [&_td]:border-white [&_th]:border [&_th]:border-white">
        <thead>
          <tr>
            <th className={headCls}>Sr. No.</th>
            <th className={headCls}>Buyers</th>
            <th className={headCls}>Total Calls Bought</th>
            <th className={headCls}>Average Calls a Day</th>
            <th className={headCls}>Rates</th>
            <th className={headCls}>Amount Received</th>
          </tr>
        </thead>
        <tbody>
          {buyers.map((b, i) => <BuyerRow key={b.id} index={i + 1} buyer={b} onChanged={onChanged} />)}
        </tbody>
        <tfoot>
          <tr className="bg-[#1a3654] font-bold text-white">
            <td className="px-3 py-2.5 text-center text-xs font-bold uppercase">Total</td>
            <td className="px-3 py-2.5 text-center tabular-nums">{num(buyers.length)}</td>
            <td className="px-3 py-2.5 text-center tabular-nums">{num(totals.counted)}</td>
            <td className="px-3 py-2.5 text-center text-white/70">—</td>
            <td className="px-3 py-2.5 text-center tabular-nums" title="Average rate = Amount Received ÷ Total Calls Bought">{money2(avgRate)}</td>
            <td className="px-3 py-2.5 text-center tabular-nums">{money(totals.revenue)}</td>
          </tr>
        </tfoot>
      </table>
      <div className="mt-2 inline-block rounded bg-[#1a3654] px-3 py-1.5 text-sm font-semibold text-white">
        Total Average Calls a Day - {num(totalAvgPerDay)}
      </div>
    </div>
  )
}

const td = 'px-2 py-1'
const roCell = cx(td, 'text-center tabular-nums text-[#0f172a]')

// ── Existing buyer row ──────────────────────────────────────────────────────────
function BuyerRow({ index, buyer, onChanged }: { index: number; buyer: Buyer; onChanged: () => void }) {
  const [code, setCode] = useState(buyer.code)
  const [rate, setRate] = useState(String(buyer.rate))
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)

  const rateNum   = Number(rate) || 0
  const amount    = rateNum * buyer.counted
  const avgPerDay = buyer.record_days > 0 ? Math.round(buyer.counted / buyer.record_days) : null
  const dirty = code.trim() !== buyer.code || rateNum !== buyer.rate

  const save = async () => {
    if (saving.current || !dirty || code.trim() === '') return
    saving.current = true
    try {
      // Name doubles as the code, so keep them in sync. Total Calls Bought is never sent
      // — it always auto-derives from the Daily Sheet records for the selected range.
      await api.updateBuyer(buyer.id, { code: code.trim(), name: code.trim(), rate: rateNum })
      onChanged()
    } catch (e) { alert((e as Error).message) } finally { saving.current = false }
  }
  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className="bg-[#d4e9f2] text-[#0f172a]">
      <td className={roCell}>{num(index)}</td>
      <td className={td}><Input value={code} onChange={(e) => setCode(e.target.value)} /></td>
      <td className={roCell}>{num(buyer.counted)}</td>
      <td className={roCell}>{avgPerDay === null ? 'N/A' : num(avgPerDay)}</td>
      <td className={td}><Input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className="text-right" /></td>
      <td className={cx(roCell, 'font-bold')}>{money(amount)}</td>
    </tr>
  )
}
