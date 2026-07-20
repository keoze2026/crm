import { useRef, useState } from 'react'
import { api } from '../api/client'
import type { Range } from './DateRange'
import { money2, num, today, weekdaysBetween } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import type { Vendor, VendorPayment } from '../types'
import { Input, PageLoader, cx } from './ui'

/**
 * Editable per-vendor payment sheet for the Vendors page, mirroring the client spreadsheet:
 * Date · Traffic Source · Converted call · Price (Usd) · Payments · Amount paid.
 *
 * Everything is manual entry except two auto-derived fields: the Traffic Source column
 * (always the active tab's vendor name) and the Payments column (converted_calls × price).
 * The date-range filter is owned by the page and passed in — it scopes the fetched rows and
 * therefore the totals. Below the table:
 *   • Average Calls a Day = round(Σ converted ÷ weekdays in the selected range)
 *   • Amount Due / Advance = a hand-entered figure per vendor (positive = Due in red,
 *     negative = Advance in green) — not auto-computed.
 * Rows auto-save on blur; the trailing row adds an entry. The balance is saved per vendor.
 *
 * Local edit state is reset the codebase way — via React `key`s that remount a row when its
 * underlying data changes — rather than syncing props into state inside effects.
 */
export default function VendorSheet({
  vendor, range, onVendorChanged,
}: { vendor: Vendor; range: Range; onVendorChanged: () => void }) {
  const payments = useAsync(() => api.vendorPayments(vendor.name, range), [vendor.name, range.from, range.to])
  const rows = payments.data ?? []

  const totals = rows.reduce(
    (a, p) => ({
      calls: a.calls + p.converted_calls,
      payments: a.payments + p.converted_calls * p.price,
      paid: a.paid + p.amount_paid,
    }),
    { calls: 0, payments: 0, paid: 0 },
  )

  const weekdays = weekdaysBetween(range.from, range.to)
  const avg = weekdays > 0 ? Math.round(totals.calls / weekdays) : null

  // New rows default their price to the last entered row's price (constant per vendor in
  // practice) and their date to the day after the last row — or the range start when empty.
  const lastRow = rows[rows.length - 1]
  const defaultPrice = lastRow ? String(lastRow.price) : ''
  const defaultDate = lastRow ? addDays(lastRow.entry_date, 1) : (range.from || today())
  // Remount the add-row (clearing it with fresh defaults) whenever the row set or range shifts.
  const addKey = `add-${range.from}-${range.to}-${rows.length}-${lastRow?.id ?? 'x'}`

  return (
    <div>
      {payments.loading ? (
        <PageLoader label="Loading entries…" size={48} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-200 border-collapse text-sm [&_td]:border [&_td]:border-white [&_th]:border [&_th]:border-white">
              <colgroup>
                <col style={{ width: '15%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '6%' }} />
              </colgroup>
              <thead>
                <tr className="bg-[#1a3654] text-center text-xs font-bold uppercase tracking-wide text-white">
                  <th className={headCls}>Date</th>
                  <th className={headCls}>Traffic Source</th>
                  <th className={headCls}>Converted call</th>
                  <th className={headCls}>Price (Usd)</th>
                  <th className={headCls}>Payments</th>
                  <th className={headCls}>Amount paid</th>
                  <th className={headCls} aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <PaymentRow key={p.id} payment={p} vendorName={vendor.name} onChanged={() => payments.reload()} />
                ))}
                <AddRow
                  key={addKey}
                  vendorName={vendor.name}
                  defaultDate={defaultDate}
                  defaultPrice={defaultPrice}
                  onChanged={() => payments.reload()}
                />
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="bg-white/40 px-3 py-3 text-center text-xs text-slate-400">
                      No entries in the selected range yet — add one in the row above.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="bg-[#1a3654] font-bold text-white">
                  <td className="px-3 py-2.5 text-center text-xs font-bold uppercase" colSpan={2}>Total</td>
                  <td className="px-3 py-2.5 text-center tabular-nums">{num(totals.calls)}</td>
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 text-center tabular-nums">{money2(totals.payments)}</td>
                  <td className="px-3 py-2.5 text-center tabular-nums">{money2(totals.paid)}</td>
                  <td className="px-3 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Summary — Average (left) + the hand-entered Due / Advance balance (right). */}
          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="glass-input inline-flex items-center gap-3 self-start rounded-xl border border-white/70 px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Average Calls a Day</span>
              <span className="text-2xl font-bold tabular-nums text-[#1a3654]">{avg ?? '—'}</span>
              <span className="text-xs text-slate-400">
                {weekdays > 0 ? `${num(totals.calls)} ÷ ${weekdays} weekday${weekdays === 1 ? '' : 's'}` : 'select a date range'}
              </span>
            </div>

            {/* Keyed on the vendor so switching tabs resets the balance input. */}
            <BalanceSummary key={vendor.name} vendor={vendor} onVendorChanged={onVendorChanged} />
          </div>
        </>
      )}

      {payments.error && <p className="mt-4 text-sm text-red-600">{payments.error}</p>}
    </div>
  )
}

const headCls = 'px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide'
const cellCls = 'px-2 py-1'
const roCell = cx(cellCls, 'text-center tabular-nums')

/** Add n days to an ISO date (YYYY-MM-DD), returning ISO. */
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return iso
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

// ── Existing payment row ────────────────────────────────────────────────────────
function PaymentRow({
  payment, vendorName, onChanged,
}: { payment: VendorPayment; vendorName: string; onChanged: () => void }) {
  const [date, setDate] = useState(payment.entry_date)
  const [calls, setCalls] = useState(String(payment.converted_calls))
  const [price, setPrice] = useState(String(payment.price))
  const [paid, setPaid] = useState(String(payment.amount_paid))
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)

  const nCalls = Number(calls) || 0
  const nPrice = Number(price) || 0
  const nPaid = Number(paid) || 0
  const rowPayments = nCalls * nPrice

  const dirty =
    date !== payment.entry_date ||
    nCalls !== payment.converted_calls ||
    nPrice !== payment.price ||
    nPaid !== payment.amount_paid

  const save = async () => {
    if (saving.current || !dirty || !date) return
    saving.current = true
    try {
      await api.updateVendorPayment(payment.id, {
        entry_date: date,
        converted_calls: nCalls,
        price: nPrice,
        amount_paid: nPaid,
      })
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  const remove = async () => {
    if (!confirm(`Delete the ${payment.entry_date} entry?`)) return
    try {
      await api.deleteVendorPayment(payment.id)
      onChanged()
    } catch (err) { alert((err as Error).message) }
  }

  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className="bg-[#d4e9f2] text-[#0f172a]">
      <td className={cellCls}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></td>
      <td className={cx(cellCls, 'text-center font-medium text-[#1a3654]')}>{vendorName}</td>
      <td className={cellCls}>
        <Input type="number" min="0" step="1" value={calls} className="text-right"
          onChange={(e) => setCalls(e.target.value)} />
      </td>
      <td className={cellCls}>
        <Input type="number" min="0" step="0.01" value={price} className="text-right"
          onChange={(e) => setPrice(e.target.value)} />
      </td>
      <td className={cx(roCell, 'font-semibold')}>{money2(rowPayments)}</td>
      <td className={cellCls}>
        <Input type="number" min="0" step="0.01" value={paid} className="text-right"
          onChange={(e) => setPaid(e.target.value)} />
      </td>
      <td className="p-0 text-center">
        <button onClick={remove} title="Delete row"
          className="mx-auto flex h-7 w-7 items-center justify-center rounded text-slate-500 transition-colors hover:bg-red-100 hover:text-red-600">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
          </svg>
        </button>
      </td>
    </tr>
  )
}

// ── Trailing "add entry" row (remounts with fresh defaults after any row change) ──
function AddRow({
  vendorName, defaultDate, defaultPrice, onChanged,
}: { vendorName: string; defaultDate: string; defaultPrice: string; onChanged: () => void }) {
  const [date, setDate] = useState(defaultDate)
  const [calls, setCalls] = useState('')
  const [price, setPrice] = useState(defaultPrice)
  const [paid, setPaid] = useState('')
  const saving = useRef(false)

  const nCalls = Number(calls) || 0
  const nPrice = Number(price) || 0
  const nPaid = Number(paid) || 0
  const rowPayments = nCalls * nPrice

  const add = async () => {
    if (saving.current || !date || calls.trim() === '') return
    saving.current = true
    try {
      await api.createVendorPayment({
        vendor: vendorName,
        entry_date: date,
        converted_calls: nCalls,
        price: nPrice,
        amount_paid: nPaid,
      })
      onChanged() // reload → this row remounts (via its key) with the next default date
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') add() }

  return (
    <tr className="bg-[#eaf5fa] text-[#0f172a]" onKeyDown={onKeyDown}>
      <td className={cellCls}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></td>
      <td className={cx(cellCls, 'text-center font-medium text-slate-400')}>{vendorName}</td>
      <td className={cellCls}><Input type="number" min="0" step="1" value={calls} placeholder="0" className="text-right" onChange={(e) => setCalls(e.target.value)} /></td>
      <td className={cellCls}><Input type="number" min="0" step="0.01" value={price} placeholder="0.00" className="text-right" onChange={(e) => setPrice(e.target.value)} /></td>
      <td className={roCell}>{calls.trim() === '' ? '—' : money2(rowPayments)}</td>
      <td className={cellCls}><Input type="number" min="0" step="0.01" value={paid} placeholder="0.00" className="text-right" onChange={(e) => setPaid(e.target.value)} /></td>
      <td className="p-0 text-center">
        <button onClick={add} disabled={!date || calls.trim() === ''} title="Add entry"
          className="mx-auto flex h-7 w-7 items-center justify-center rounded text-blue-600 transition-colors hover:bg-blue-100 disabled:opacity-30 disabled:hover:bg-transparent">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </td>
    </tr>
  )
}

// ── Hand-entered Due / Advance balance (keyed on vendor, so no prop→state effect) ──
function BalanceSummary({
  vendor, onVendorChanged,
}: { vendor: Vendor; onVendorChanged: () => void }) {
  // The user enters a positive amount and picks the kind; it's stored signed in `manual_due`
  // (positive = Due, negative = Advance). Zero when the field is blank.
  const [amount, setAmount] = useState(vendor.manual_due ? String(Math.abs(vendor.manual_due)) : '')
  const [kind, setKind] = useState<'due' | 'advance'>(vendor.manual_due < 0 ? 'advance' : 'due')
  const wrapRef = useRef<HTMLDivElement>(null)
  const saving = useRef(false)

  const n = Number(amount) || 0
  const color = n === 0 ? 'text-slate-400' : kind === 'advance' ? 'text-emerald-600' : 'text-red-600'

  const save = async () => {
    const signed = kind === 'advance' ? -n : n
    if (saving.current || signed === vendor.manual_due) return
    saving.current = true
    try {
      await api.saveVendorMeta({ name: vendor.name, manual_due: signed })
      onVendorChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  // Save once focus leaves the whole widget — switching the Due/Advance toggle keeps focus
  // inside, so it just updates the kind without a premature save.
  const onWrapBlur = () => setTimeout(() => {
    if (wrapRef.current && !wrapRef.current.contains(document.activeElement)) save()
  }, 0)

  return (
    <div ref={wrapRef} onBlur={onWrapBlur} className="text-right">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Amount Due / Advance</div>
      <div className="flex items-center justify-end gap-2">
        <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
          {(['due', 'advance'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={cx('rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                kind === k
                  ? (k === 'advance' ? 'bg-white text-emerald-600 shadow' : 'bg-white text-red-600 shadow')
                  : 'text-slate-500 hover:text-slate-700')}>
              {k === 'advance' ? 'Advance' : 'Due'}
            </button>
          ))}
        </div>
        <span className={cx('text-2xl font-bold', color)}>$</span>
        <input
          type="number" min="0" step="0.01" value={amount} placeholder="0.00"
          onChange={(e) => setAmount(e.target.value)}
          className={cx('glass-input w-40 rounded-lg border border-white/70 px-3 py-1.5 text-right text-3xl font-extrabold tracking-tight focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30', color)}
        />
      </div>
    </div>
  )
}
