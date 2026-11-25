import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { Range } from './DateRange'
import { money2, num, today } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import type { Vendor, VendorPayment } from '../types'
import { isEnterSubmit } from './sheet'
import { Input, PageLoader, cx } from './ui'
import { useServerDraft } from '../lib/useServerDraft'

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
 * Amount paid saves when the row is left OR when Enter is pressed in it, and every save says
 * so: a spinner while it is in flight, a tick when it lands, a red "Failed" (with the reason
 * on hover) when it doesn't. Nothing is ever typed, accepted on screen and quietly dropped.
 * The trailing row records a payment on a day the source had no campaign activity (an
 * advance, say) — active days already have a row of their own.
 *
 * Which columns are typed is said ON the sheet, not only in tooltips: the three derived
 * columns carry a "from Campaigns" sub-label and the caption above names the one cell that
 * is hand-entered. A read-only sheet that doesn't admit it reads as a broken one.
 *
 * Local edit state is reset the codebase way — via React `key`s — rather than syncing props
 * into state inside effects. The add-row's key is a NONCE this component owns, bumped only
 * when that row itself saves: keying it on the row set instead meant a live re-read (someone
 * else's campaign record landing) remounted it and threw away a half-typed entry.
 */
export default function VendorSheet({
  vendor, range, onVendorChanged,
}: { vendor: Vendor; range: Range; onVendorChanged: () => void }) {
  const payments = useAsync(() => api.vendorPayments(vendor.name, range), [vendor.name, range.from, range.to])
  const ledger = payments.data
  const rows = ledger?.rows ?? []
  // Bumped only by the add-row's own save — see addKey below.
  const [addNonce, setAddNonce] = useState(0)

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
  // Clear the add-row only when IT saves (or the range changes) — never because the row set
  // moved underneath it. A live re-read must not take away what somebody is still typing.
  const addKey = `add-${range.from}-${range.to}-${addNonce}`

  return (
    <div>
      {payments.loading ? (
        <PageLoader label="Loading entries…" size={48} />
      ) : (
        <>
          {/* Say what this sheet does and does not take, so a derived column never reads as
              a field that won't accept typing. */}
          <p className="mb-3 text-xs leading-relaxed text-slate-400">
            <span className="font-semibold text-slate-300">Amount paid</span> is the only figure typed here
            {' '}(plus the opening balance below). Converted Lead, Price and Payments are read from this
            source&apos;s records on the{' '}
            <Link to="/daily-billing" className="font-medium text-blue-400 underline decoration-blue-300 underline-offset-2 hover:text-blue-300">
              AHT Daily Billing sheet
            </Link>
            {' '}— enter them there. The balances are calculated and never typed.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full min-w-230 border-collapse text-sm [&_td]:border [&_td]:border-white/[0.08] [&_th]:border [&_th]:border-white/[0.08]">
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
                <tr className="bg-[#132a52] text-center text-xs font-bold uppercase tracking-wide text-white">
                  <th className={headCls}>Date</th>
                  <th className={headCls}>Traffic Source</th>
                  <th className={headCls}>Converted Lead<FromCampaigns /></th>
                  <th className={headCls}>Price (Usd)<FromCampaigns /></th>
                  <th className={headCls}>Payments<FromCampaigns /></th>
                  <th className={headCls} title="The balance this row opens with — the previous row's closing balance">
                    Initial Advance<Derived label="calculated" />
                  </th>
                  <th className={headCls}>Amount paid<Derived label="you type this" /></th>
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
                  onAdded={() => { setAddNonce((n) => n + 1); payments.reload() }}
                />
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="bg-white/[0.05] px-3 py-3 text-center text-xs text-slate-400">
                      No entries in the selected range yet — add one in the row above.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="bg-[#132a52] font-bold text-white">
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
              <div className="glass-input inline-flex items-center gap-3 self-start rounded-xl border border-white/10 px-4 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Average Leads a Day</span>
                <span className="text-2xl font-bold tabular-nums text-blue-300">{avg ?? '—'}</span>
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

      {payments.error && <p className="mt-4 text-sm text-red-400">{payments.error}</p>}
    </div>
  )
}

const headCls = 'px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide'
const cellCls = 'px-2 py-1'
const roCell = cx(cellCls, 'text-center tabular-nums')

/**
 * A column header's second line: where its figures come from. On the sheet rather than in a
 * tooltip, because a cell that won't accept typing has to explain itself before it is clicked,
 * not after.
 */
function Derived({ label }: { label: string }) {
  return <span className="mt-0.5 block text-[10px] font-medium normal-case tracking-normal text-white/55">{label}</span>
}

function FromCampaigns() {
  return <Derived label="from Campaigns" />
}

// ── Save feedback ───────────────────────────────────────────────────────────────
/**
 * What a save is doing, shown beside the field that triggered it. A figure typed into a sheet
 * must never look accepted while the write is still in flight — or, worse, after it failed.
 * `saved` clears itself; `error` stays until the next attempt, with the reason on hover.
 */
type SaveState =
  | { phase: 'idle' }
  | { phase: 'saving' }
  | { phase: 'saved' }
  | { phase: 'error'; message: string }

/** `saved` is a flash, not a state to live in — it clears itself after a moment. */
function useSaveState(): [SaveState, (s: SaveState) => void] {
  const [state, setState] = useState<SaveState>({ phase: 'idle' })
  useEffect(() => {
    if (state.phase !== 'saved') return
    const t = setTimeout(() => setState({ phase: 'idle' }), 1600)
    return () => clearTimeout(t)
  }, [state.phase])
  return [state, setState]
}

function SaveMark({ state }: { state: SaveState }) {
  if (state.phase === 'idle') return null
  if (state.phase === 'saving') {
    return (
      <span title="Saving…" className="shrink-0 text-slate-400">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="animate-spin">
          <path d="M21 12a9 9 0 1 1-6.2-8.56" strokeLinecap="round" />
        </svg>
      </span>
    )
  }
  if (state.phase === 'saved') {
    return (
      <span title="Saved" className="shrink-0 text-emerald-400">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 13 4 4L19 7" />
        </svg>
      </span>
    )
  }
  return (
    <span title={state.message} className="shrink-0 rounded bg-red-500/20 px-1 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-300">
      Failed
    </span>
  )
}

/** Balance colouring, shared by the Initial Advance column and the summary: green when the
 *  vendor is holding our money (Advance), red when we owe them (Due). */
function balanceColor(n: number): string {
  if (Math.abs(n) < 0.005) return 'text-slate-400'
  return n > 0 ? 'text-emerald-400' : 'text-red-400'
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
  const [paid, setPaid] = useServerDraft(String(payment.amount_paid))
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)
  const [state, setState] = useSaveState()

  const nPaid = Number(paid) || 0
  const dirty = nPaid !== payment.amount_paid

  const save = async () => {
    if (saving.current) return
    // Enter on an untouched figure still answers: what is on screen IS what is stored, and
    // silence would read as a save that went nowhere.
    if (!dirty) { setState({ phase: 'saved' }); return }
    saving.current = true
    setState({ phase: 'saving' })
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
      setState({ phase: 'saved' })
      onChanged()
    } catch (err) {
      setState({ phase: 'error', message: (err as Error).message })
    } finally { saving.current = false }
  }

  // Only the payment can be removed; the campaign figures belong to the Campaigns page, so a
  // day that has activity keeps its row and simply returns to nothing paid.
  const remove = async () => {
    if (payment.payment_id === null) return
    if (!confirm(`Clear the amount paid on ${payment.entry_date}?`)) return
    setState({ phase: 'saving' })
    try {
      await api.deleteVendorPayment(payment.payment_id)
      setState({ phase: 'saved' })
      onChanged()
    } catch (err) { setState({ phase: 'error', message: (err as Error).message }) }
  }

  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)

  return (
    <tr
      ref={rowRef}
      onBlur={onRowBlur}
      // Enter saves where it is, without having to leave the row first. Without this, a
      // figure typed and confirmed with Enter sat on screen looking saved and never was.
      onKeyDown={(e) => { if (isEnterSubmit(e)) save() }}
      className="bg-[#0a0e17] text-slate-100"
    >
      <td className={roCell}>{payment.entry_date}</td>
      <td className={cx(cellCls, 'text-center font-medium text-blue-300')}>{vendorName}</td>
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
        <div className="flex items-center gap-1.5">
          <Input type="number" min="0" step="0.01" value={paid} className="text-right"
            onChange={(e) => setPaid(e.target.value)} />
          <SaveMark state={state} />
        </div>
      </td>
      <td className="p-0 text-center">
        <button onClick={remove} disabled={payment.payment_id === null}
          title={payment.payment_id === null ? 'Nothing paid on this day yet' : 'Clear the amount paid'}
          className="mx-auto flex h-7 w-7 items-center justify-center rounded text-slate-400 transition-colors hover:bg-red-500/20 hover:text-red-400 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-slate-400">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
          </svg>
        </button>
      </td>
    </tr>
  )
}

// ── Trailing "add entry" row ────────────────────────────────────────────────────
/**
 * Remounted (via its key) only when it saves or the date range changes — never because the
 * rows above it moved, which used to wipe a half-typed entry whenever a live re-read landed.
 * `defaultDate` may therefore change under a mounted row; that is deliberate, since a date
 * somebody is part way through choosing must not jump.
 */
function AddRow({
  vendorName, defaultDate, opening, onAdded,
}: { vendorName: string; defaultDate: string; opening: number; onAdded: () => void }) {
  const [date, setDate] = useState(defaultDate)
  const [paid, setPaid] = useState('')
  const saving = useRef(false)
  const [state, setState] = useSaveState()

  const nPaid = Number(paid) || 0
  // Converted Lead and Price aren't typed any more, so the only thing this row records is a
  // payment. Days the source actually ran already appear on their own.
  const canAdd = !!date && paid.trim() !== ''

  const add = async () => {
    if (saving.current || !canAdd) return
    saving.current = true
    setState({ phase: 'saving' })
    try {
      await api.createVendorPayment({ vendor: vendorName, entry_date: date, amount_paid: nPaid })
      onAdded() // reload + bump the nonce → this row remounts with the next default date
    } catch (err) {
      // Left on screen with the reason on hover: the entry is still here to correct and
      // retry, which an alert that wipes nothing but the user's place cannot offer.
      setState({ phase: 'error', message: (err as Error).message })
    } finally { saving.current = false }
  }

  return (
    <tr className="bg-[#0d1322] text-slate-100" onKeyDown={(e) => { if (isEnterSubmit(e)) add() }}>
      <td className={cellCls}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></td>
      <td className={cx(cellCls, 'text-center font-medium text-slate-400')}>{vendorName}</td>
      <td className={cx(roCell, 'text-right text-slate-400')} title="Comes from the Campaigns records">—</td>
      <td className={cx(roCell, 'text-right text-slate-400')} title="Comes from the Campaigns records">—</td>
      <td className={cx(roCell, 'text-slate-400')}>—</td>
      {/* What a new entry would open with = where the ledger currently stands. */}
      <td className={cx(roCell, 'text-slate-400')}>{money2(opening)}</td>
      <td className={cellCls}>
        <div className="flex items-center gap-1.5">
          <Input type="number" min="0" step="0.01" value={paid} placeholder="0.00" className="text-right" onChange={(e) => setPaid(e.target.value)} />
          <SaveMark state={state} />
        </div>
      </td>
      <td className="p-0 text-center">
        {/* Say WHY it is greyed out — an unexplained disabled button reads as broken. */}
        <button onClick={add} disabled={!canAdd}
          title={canAdd ? 'Record this payment' : !date ? 'Pick a date first' : 'Enter an amount paid'}
          className="mx-auto flex h-7 w-7 items-center justify-center rounded text-blue-400 transition-colors hover:bg-blue-500/20 disabled:opacity-30 disabled:hover:bg-transparent">
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
  const [amount, setAmount] = useServerDraft(initialAdvance ? String(initialAdvance) : '')
  const saving = useRef(false)
  const [state, setState] = useSaveState()

  const n = Number(amount) || 0
  const carried = Math.abs(priorNet) > 0.005

  const save = async () => {
    if (saving.current) return
    if (Math.abs(n - initialAdvance) < 0.005) { setState({ phase: 'saved' }); return }
    saving.current = true
    setState({ phase: 'saving' })
    try {
      // Store the seed, not the on-screen figure — see the note above.
      await api.saveVendorMeta({ name: vendor.name, opening_advance: n - priorNet })
      setState({ phase: 'saved' })
      onSaved()
    } catch (err) {
      setState({ phase: 'error', message: (err as Error).message })
    } finally { saving.current = false }
  }

  return (
    <div className="glass-input inline-flex items-center gap-3 self-start rounded-xl border border-white/10 px-4 py-2.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Initial Advance</span>
      <input
        type="number" step="0.01" value={amount} placeholder="0.00"
        onChange={(e) => setAmount(e.target.value)} onBlur={save}
        // The one other typed figure on this page, so it answers Enter the same way.
        onKeyDown={(e) => { if (isEnterSubmit(e)) save() }}
        className={cx('glass-input w-32 rounded-lg border border-white/10 px-2.5 py-1 text-right text-lg font-bold tabular-nums focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30',
          balanceColor(n))}
      />
      <SaveMark state={state} />
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
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Amount Due / Advance</div>
      <div className="flex items-center justify-end gap-2">
        <span className={cx('rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide',
          settled ? 'bg-white/[0.06] text-slate-400' : advance ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400')}>
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
