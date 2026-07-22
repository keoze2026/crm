import { useRef, useState } from 'react'
import { api } from '../api/client'
import type { Range } from './DateRange'
import { money2, num, today } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import type { Vendor, VendorPayment } from '../types'
import { Input, PageLoader, cx } from './ui'

/**
 * Editable per-vendor payment sheet for the Vendors page, mirroring the client spreadsheet:
 * Date · Traffic Source · Converted call · Price (Usd) · Payments · Initial Advance ·
 * Amount paid.
 *
 * Everything is manual entry except three auto-derived columns: Traffic Source (always the
 * active tab's vendor name), Payments (converted_calls × price), and Initial Advance — a
 * running balance where each row opens at the previous row's close, seeded by the figure
 * carried in from earlier periods. Its footer cell is therefore the period's closing
 * balance, the same number the summary shows.
 * The date-range filter is owned by the page and passed in — it scopes the fetched rows and
 * therefore the totals. Below the table:
 *   • Average Calls a Day = round(Σ converted ÷ days worked) — days worked being the
 *     distinct dates that actually have converted calls, mirroring the Buyers sheet's
 *     `counted ÷ record_days` rather than counting idle days in the range.
 *   • Initial Advance = the balance the period OPENS with. Only the very first one is
 *     typed (stored as `vendors.opening_advance`); after that the server carries it
 *     forward — see `VendorController::payments`.
 *   • Amount Due / Advance = Initial Advance + Σ Amount paid − Σ Payments, and its label
 *     follows the sign: positive = Advance (the vendor holds our money, green), negative
 *     = Due (we owe them, red). Never typed, so it can't drift from the figures.
 * Rows auto-save on blur; the trailing row adds an entry.
 *
 * Local edit state is reset the codebase way — via React `key`s that remount a row when its
 * underlying data changes — rather than syncing props into state inside effects.
 */
export default function VendorSheet({
  vendor, range, onVendorChanged,
}: { vendor: Vendor; range: Range; onVendorChanged: () => void }) {
  const payments = useAsync(() => api.vendorPayments(vendor.name, range), [vendor.name, range.from, range.to])
  const ledger = payments.data
  const rows = ledger?.rows ?? []

  const totals = rows.reduce(
    (a, p) => ({
      calls: a.calls + p.converted_calls,
      payments: a.payments + p.converted_calls * p.price,
      paid: a.paid + p.amount_paid,
    }),
    { calls: 0, payments: 0, paid: 0 },
  )

  // Days worked = distinct dates with at least one converted call, so a pure payment row
  // (0 calls) never drags the average down.
  const daysWorked = new Set(rows.filter((p) => p.converted_calls > 0).map((p) => p.entry_date)).size
  const avg = daysWorked > 0 ? Math.round(totals.calls / daysWorked) : null

  // The Initial Advance column is a running balance: every row OPENS where the previous one
  // closed, seeded by the figure carried into this period. Walking it once here (rather than
  // per row) keeps the column, the footer and the summary figure from ever disagreeing —
  // the balance left over after the last row IS the period's Due/Advance.
  const initialAdvance = ledger?.initial_advance ?? 0
  const openingByRow = new Map<number, number>()
  let balance = initialAdvance
  for (const p of rows) {
    openingByRow.set(p.id, balance)
    balance += p.amount_paid - p.converted_calls * p.price
  }
  const finalBalance = balance

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
            <table className="w-full min-w-230 border-collapse text-sm [&_td]:border [&_td]:border-white [&_th]:border [&_th]:border-white">
              <colgroup>
                <col style={{ width: '13%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '6%' }} />
              </colgroup>
              <thead>
                <tr className="bg-[#1a3654] text-center text-xs font-bold uppercase tracking-wide text-white">
                  <th className={headCls}>Date</th>
                  <th className={headCls}>Traffic Source</th>
                  <th className={headCls}>Converted call</th>
                  <th className={headCls}>Price (Usd)</th>
                  <th className={headCls}>Payments</th>
                  <th className={headCls} title="The balance this row opens with — the previous row's closing balance">
                    Initial Advance
                  </th>
                  <th className={headCls}>Amount paid</th>
                  <th className={headCls} aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <PaymentRow
                    key={p.id}
                    payment={p}
                    vendorName={vendor.name}
                    opening={openingByRow.get(p.id) ?? 0}
                    onChanged={() => payments.reload()}
                  />
                ))}
                <AddRow
                  key={addKey}
                  vendorName={vendor.name}
                  defaultDate={defaultDate}
                  defaultPrice={defaultPrice}
                  opening={finalBalance}
                  onChanged={() => payments.reload()}
                />
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="bg-white/40 px-3 py-3 text-center text-xs text-slate-400">
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
                  {/* The column runs on past the last row: this is what the period closes at. */}
                  <td className="px-3 py-2.5 text-center tabular-nums" title="Closing balance = Initial Advance + Amount paid − Payments">
                    {money2(finalBalance)}
                  </td>
                  <td className="px-3 py-2.5 text-center tabular-nums">{money2(totals.paid)}</td>
                  <td className="px-3 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Summary — Average + the opening figure (left) and the derived balance (right). */}
          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-3 self-start">
              <div className="glass-input inline-flex items-center gap-3 self-start rounded-xl border border-white/70 px-4 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Average Calls a Day</span>
                <span className="text-2xl font-bold tabular-nums text-[#1a3654]">{avg ?? '—'}</span>
                <span className="text-xs text-slate-400">
                  {daysWorked > 0
                    ? `${num(totals.calls)} ÷ ${daysWorked} day${daysWorked === 1 ? '' : 's'} worked`
                    : 'no converted calls in range'}
                </span>
              </div>

              {/* Remounts with fresh state whenever the carried-in figure changes. */}
              <InitialAdvance
                key={`${vendor.name}-${initialAdvance}`}
                vendor={vendor}
                initialAdvance={initialAdvance}
                priorNet={ledger?.prior_net ?? 0}
                onSaved={() => { payments.reload(); onVendorChanged() }}
              />
            </div>

            <BalanceSummary balance={finalBalance} initialAdvance={initialAdvance} totals={totals} />
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

/** Balance colouring, shared by the Initial Advance column and the summary: green when the
 *  vendor is holding our money (Advance), red when we owe them (Due). */
function balanceColor(n: number): string {
  if (Math.abs(n) < 0.005) return 'text-slate-400'
  return n > 0 ? 'text-emerald-600' : 'text-red-600'
}

/** Add n days to an ISO date (YYYY-MM-DD), returning ISO. */
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return iso
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

// ── Existing payment row ────────────────────────────────────────────────────────
function PaymentRow({
  payment, vendorName, opening, onChanged,
}: { payment: VendorPayment; vendorName: string; opening: number; onChanged: () => void }) {
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
      <td className={cx(roCell, 'font-semibold', balanceColor(opening))}>{money2(opening)}</td>
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
  vendorName, defaultDate, defaultPrice, opening, onChanged,
}: { vendorName: string; defaultDate: string; defaultPrice: string; opening: number; onChanged: () => void }) {
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
      {/* What a new entry would open with = where the ledger currently stands. */}
      <td className={cx(roCell, 'text-slate-400')}>{money2(opening)}</td>
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

// ── Initial Advance — the balance the period opens with ─────────────────────────
/**
 * Shows (and lets you seed) the opening balance — the figure the Initial Advance column
 * starts its first row from. Signed: positive = Advance the vendor is holding, negative =
 * Due we still owe.
 *
 * What's typed here is the opening balance *for the period on screen*, but what's stored is
 * the ledger's seed — so we subtract `priorNet` (everything the ledger moved before this
 * period) before saving. Set it once on the earliest period and every later period inherits
 * it automatically; typing over a carried-forward figure re-bases the ledger to say "this
 * is what the balance was entering this period".
 */
function InitialAdvance({
  vendor, initialAdvance, priorNet, onSaved,
}: { vendor: Vendor; initialAdvance: number; priorNet: number; onSaved: () => void }) {
  const [amount, setAmount] = useState(initialAdvance ? String(initialAdvance) : '')
  const saving = useRef(false)

  const n = Number(amount) || 0
  const carried = Math.abs(priorNet) > 0.005

  const save = async () => {
    if (saving.current || Math.abs(n - initialAdvance) < 0.005) return
    saving.current = true
    try {
      // Store the seed, not the on-screen figure — see the note above.
      await api.saveVendorMeta({ name: vendor.name, opening_advance: n - priorNet })
      onSaved()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  return (
    <div className="glass-input inline-flex items-center gap-3 self-start rounded-xl border border-white/70 px-4 py-2.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Initial Advance</span>
      <input
        type="number" step="0.01" value={amount} placeholder="0.00"
        onChange={(e) => setAmount(e.target.value)} onBlur={save}
        className={cx('glass-input w-32 rounded-lg border border-white/70 px-2.5 py-1 text-right text-lg font-bold tabular-nums focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30',
          balanceColor(n))}
      />
      <span className="text-xs text-slate-400">
        {carried ? 'carried forward — starts the column below' : 'opening balance — negative = Due'}
      </span>
    </div>
  )
}

// ── Amount Due / Advance — fully derived, so the label always matches the figures ──
function BalanceSummary({
  balance, initialAdvance, totals,
}: { balance: number; initialAdvance: number; totals: { payments: number; paid: number } }) {
  // Positive = the vendor is holding our money (Advance); negative = we owe them (Due).
  const settled = Math.abs(balance) < 0.005
  const advance = balance > 0

  return (
    <div className="text-right">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Amount Due / Advance</div>
      <div className="flex items-center justify-end gap-2">
        <span className={cx('rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide',
          settled ? 'bg-slate-100 text-slate-500' : advance ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600')}>
          {settled ? 'Settled' : advance ? 'Advance' : 'Due'}
        </span>
        <span className={cx('text-3xl font-extrabold tabular-nums tracking-tight', balanceColor(balance))}>
          {money2(Math.abs(balance))}
        </span>
      </div>
      <div className="mt-1 text-xs text-slate-400">
        {money2(initialAdvance)} initial + {money2(totals.paid)} paid − {money2(totals.payments)} payments
      </div>
    </div>
  )
}
