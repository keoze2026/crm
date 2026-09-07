import { useRef, useState } from 'react'
import { api } from '../api/client'
import type { Range } from './DateRange'
import { money2, num, today } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import type { Vendor, VendorPayment } from '../types'
import { Input, PageLoader, cx } from './ui'

/**
 * Editable per-vendor payment sheet for the Vendors page, mirroring the client spreadsheet:
 * Date · Traffic Source · Converted Lead · Price (Usd) · Payments · Initial Advance ·
 * Amount paid.
 *
 * Amount paid is the ONLY hand-entered figure. Everything else is derived:
 *   • Converted Lead / Price / Payments come from this source's campaign records — Σ counted,
 *     the rate charged that day, and Σ total_bill. Payments is the summed bill rather than
 *     counted × price, so this column equals the Campaigns side exactly and a rounded rate
 *     on screen can never make the two pages disagree.
 *   • Traffic Source is always the active tab's vendor name.
 *   • Initial Advance is a running balance where each row opens at the previous row's close,
 *     seeded by the figure carried in from earlier periods. Its footer cell is therefore the
 *     period's closing balance, the same number the summary shows.
 *
 * There is one row per DAY: every day the source had campaign activity, plus any day
 * carrying a payment. Rows appear and disappear as the campaign records change.
 * The date-range filter is owned by the page and passed in — it scopes the fetched rows and
 * therefore the totals. Below the table:
 *   • Average Leads a Day = round(Σ converted ÷ days worked) — days worked being the
 *     distinct dates that actually have converted Leads, mirroring the Buyers sheet's
 *     `counted ÷ record_days` rather than counting idle days in the range.
 *   • Initial Advance = the balance the period OPENS with. Only the very first one is
 *     typed (stored as `vendors.opening_advance`); after that the server carries it
 *     forward — see `VendorController::payments`.
 *   • Amount Due / Advance = Initial Advance + Σ Amount paid − Σ Payments, and its label
 *     follows the sign: positive = Advance (the vendor holds our money, green), negative
 *     = Due (we owe them, red). Never typed, so it can't drift from the figures.
 * Amount paid auto-saves on blur; the trailing row records a payment on a day the source had
 * no campaign activity (an advance, say) — active days already have a row of their own.
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

  // `payments` comes straight from the campaign records' total_bill, so this column and the
  // Campaigns page are the same number — never counted × a rounded rate.
  const totals = rows.reduce(
    (a, p) => ({
      leads: a.leads + p.converted_calls,
      payments: a.payments + p.payments,
      paid: a.paid + p.amount_paid,
    }),
    { leads: 0, payments: 0, paid: 0 },
  )

  // Days worked = distinct dates with at least one converted Lead, so a pure payment row
  // (0 Leads) never drags the average down.
  const daysWorked = new Set(rows.filter((p) => p.converted_calls > 0).map((p) => p.entry_date)).size
  const avg = daysWorked > 0 ? Math.round(totals.leads / daysWorked) : null

  // The Initial Advance column is a running balance: every row OPENS where the previous one
  // closed, seeded by the figure carried into this period. Walking it once here (rather than
  // per row) keeps the column, the footer and the summary figure from ever disagreeing —
  // the balance left over after the last row IS the period's Due/Advance.
  // Rows are one per DAY now, so the running balance is keyed by date rather than by a
  // vendor_payments id — a day with campaign activity and nothing paid yet has no such row.
  const initialAdvance = ledger?.initial_advance ?? 0
  const openingByRow = new Map<string, number>()
  let balance = initialAdvance
  for (const p of rows) {
    openingByRow.set(p.entry_date, balance)
    balance += p.amount_paid - p.payments
  }
  const finalBalance = balance

  // The add-row exists only to record a payment on a day this source had no campaign
  // activity — every active day already has a row of its own. Defaults to the next day.
  const lastRow = rows[rows.length - 1]
  const defaultDate = lastRow ? addDays(lastRow.entry_date, 1) : (range.from || today())
  // Remount the add-row (clearing it with fresh defaults) whenever the row set or range shifts.
  const addKey = `add-${range.from}-${range.to}-${rows.length}-${lastRow?.entry_date ?? 'x'}`

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
                  <th className={headCls}>Converted Lead</th>
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
                    key={p.entry_date}
                    payment={p}
                    vendorName={vendor.name}
                    opening={openingByRow.get(p.entry_date) ?? 0}
                    onChanged={() => payments.reload()}
                  />
                ))}
                <AddRow
                  key={addKey}
                  vendorName={vendor.name}
                  defaultDate={defaultDate}
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
                  <td className="px-3 py-2.5 text-center tabular-nums">{num(totals.leads)}</td>
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
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Average Leads a Day</span>
                <span className="text-2xl font-bold tabular-nums text-[#1a3654]">{avg ?? '—'}</span>
                <span className="text-xs text-slate-400">
                  {daysWorked > 0
                    ? `${num(totals.leads)} ÷ ${daysWorked} day${daysWorked === 1 ? '' : 's'} worked`
                    : 'no converted Leads in range'}
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
  // Only the amount is editable. The date identifies the row (it is the campaign day), and
  // Converted Lead / Price / Payments are read from the campaign records.
  const [paid, setPaid] = useState(String(payment.amount_paid))
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)

  const nPaid = Number(paid) || 0
  const dirty = nPaid !== payment.amount_paid

  const save = async () => {
    if (saving.current || !dirty) return
    saving.current = true
    try {
      // A day with campaign activity may have no vendor_payments row yet — the first amount
      // typed against it creates one; the POST upserts, so it can't double up.
      if (payment.payment_id !== null) {
        await api.updateVendorPayment(payment.payment_id, { amount_paid: nPaid })
      } else {
        await api.createVendorPayment({
          vendor: vendorName, entry_date: payment.entry_date, amount_paid: nPaid,
        })
      }
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  // Only the payment can be removed; the campaign figures belong to the Campaigns page, so a
  // day that has activity keeps its row and simply returns to nothing paid.
  const remove = async () => {
    if (payment.payment_id === null) return
    if (!confirm(`Clear the amount paid on ${payment.entry_date}?`)) return
    try {
      await api.deleteVendorPayment(payment.payment_id)
      onChanged()
    } catch (err) { alert((err as Error).message) }
  }

  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className="bg-[#d4e9f2] text-[#0f172a]">
      <td className={roCell}>{payment.entry_date}</td>
      <td className={cx(cellCls, 'text-center font-medium text-[#1a3654]')}>{vendorName}</td>
      {/* Read-only: these three come from this source's campaign records for the day. */}
      <td className={cx(roCell, 'text-right')} title="From the Campaigns records for this day">
        {num(payment.converted_calls)}
      </td>
      <td className={cx(roCell, 'text-right')} title="Rate charged that day — payments ÷ converted Leads">
        {payment.converted_calls > 0 ? money2(payment.price) : '—'}
      </td>
      <td className={cx(roCell, 'font-semibold')}>{money2(payment.payments)}</td>
      <td className={cx(roCell, 'font-semibold', balanceColor(opening))}>{money2(opening)}</td>
      <td className={cellCls}>
        <Input type="number" min="0" step="0.01" value={paid} className="text-right"
          onChange={(e) => setPaid(e.target.value)} />
      </td>
      <td className="p-0 text-center">
        <button onClick={remove} disabled={payment.payment_id === null}
          title={payment.payment_id === null ? 'Nothing paid on this day yet' : 'Clear the amount paid'}
          className="mx-auto flex h-7 w-7 items-center justify-center rounded text-slate-500 transition-colors hover:bg-red-100 hover:text-red-600 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-slate-500">
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
  vendorName, defaultDate, opening, onChanged,
}: { vendorName: string; defaultDate: string; opening: number; onChanged: () => void }) {
  const [date, setDate] = useState(defaultDate)
  const [paid, setPaid] = useState('')
  const saving = useRef(false)

  const nPaid = Number(paid) || 0
  // Converted Lead and Price aren't typed any more, so the only thing this row records is a
  // payment. Days the source actually ran already appear on their own.
  const canAdd = !!date && paid.trim() !== ''

  const add = async () => {
    if (saving.current || !canAdd) return
    saving.current = true
    try {
      await api.createVendorPayment({ vendor: vendorName, entry_date: date, amount_paid: nPaid })
      onChanged() // reload → this row remounts (via its key) with the next default date
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') add() }

  return (
    <tr className="bg-[#eaf5fa] text-[#0f172a]" onKeyDown={onKeyDown}>
      <td className={cellCls}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></td>
      <td className={cx(cellCls, 'text-center font-medium text-slate-400')}>{vendorName}</td>
      <td className={cx(roCell, 'text-right text-slate-400')} title="Comes from the Campaigns records">—</td>
      <td className={cx(roCell, 'text-right text-slate-400')} title="Comes from the Campaigns records">—</td>
      <td className={cx(roCell, 'text-slate-400')}>—</td>
      {/* What a new entry would open with = where the ledger currently stands. */}
      <td className={cx(roCell, 'text-slate-400')}>{money2(opening)}</td>
      <td className={cellCls}><Input type="number" min="0" step="0.01" value={paid} placeholder="0.00" className="text-right" onChange={(e) => setPaid(e.target.value)} /></td>
      <td className="p-0 text-center">
        {/* Say WHY it is greyed out — an unexplained disabled button reads as broken. */}
        <button onClick={add} disabled={!canAdd}
          title={canAdd ? 'Record this payment' : !date ? 'Pick a date first' : 'Enter an amount paid'}
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
