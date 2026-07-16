import { useRef, useState } from 'react'
import { api } from '../api/client'
import { money2 } from '../lib/format'
import type { PortalExpense } from '../types'
import { Input, cx } from './ui'

/** Number with thousands separators and up to 3 decimals (e.g. 157.785). */
const numFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })
const fmtNum = (n: number) => numFmt.format(n || 0)
const sumComponents = (vm: number, rc: number, rv: number, payout: number) => vm + rc + rv + payout

/**
 * Editable "Portal Expenses" sheet for a single month, mirroring the client
 * spreadsheet: Sr. No. · Name · Voice Minutes · Rejected calls · Rent values ·
 * Payout expenses · Total Amount (Usd) · % of Total.
 *
 * Total Amount defaults to the sum of the component columns (Voice + Rejected + Rent +
 * Payout) and follows edits to them, but stays independently editable so a row can be a
 * flat lump sum (e.g. a fixed BYOC fee) with zero components. % of Total is derived from
 * the month's grand total. Rows auto-save on blur; the trailing row adds a new provider.
 */
export default function PortalExpensesSheet({
  month, expenses, onChanged,
}: { month: string; expenses: PortalExpense[]; onChanged: () => void }) {
  const totals = expenses.reduce(
    (a, e) => ({
      vm: a.vm + e.voice_minutes,
      rc: a.rc + e.rejected_calls,
      rv: a.rv + e.rent_values,
      payout: a.payout + e.payout_expenses,
      total: a.total + e.total_amount,
    }),
    { vm: 0, rc: 0, rv: 0, payout: 0, total: 0 },
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-240 border-collapse text-sm [&_td]:border [&_td]:border-white [&_th]:border [&_th]:border-white">
        <colgroup>
          <col style={{ width: '5%' }} />
          <col style={{ width: '17%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '4%' }} />
        </colgroup>
        <thead>
          <tr className="bg-[#1a3654] text-center text-xs font-bold uppercase tracking-wide text-white">
            <th className={headCls}>Sr. No.</th>
            <th className={headCls}>Name</th>
            <th className={headCls}>Voice Minutes</th>
            <th className={headCls}>Rejected calls</th>
            <th className={headCls}>Rent values</th>
            <th className={headCls}>Payout expenses (USD)</th>
            <th className={headCls}>Total Amount (Usd)</th>
            <th className={headCls}>% of Total</th>
            <th className={headCls} aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {expenses.map((e, i) => (
            <ExpenseRow key={e.id} index={i + 1} expense={e} grandTotal={totals.total} onChanged={onChanged} />
          ))}
          <AddRow month={month} onChanged={onChanged} />
        </tbody>
        <tfoot>
          <tr className="bg-[#1a3654] font-bold text-white">
            <td className="px-3 py-2.5 text-center text-xs font-bold uppercase" colSpan={2}>Total</td>
            <td className="px-3 py-2.5 text-center tabular-nums">{fmtNum(totals.vm)}</td>
            <td className="px-3 py-2.5 text-center tabular-nums">{fmtNum(totals.rc)}</td>
            <td className="px-3 py-2.5 text-center tabular-nums">{fmtNum(totals.rv)}</td>
            <td className="px-3 py-2.5 text-center tabular-nums">{money2(totals.payout)}</td>
            <td className="px-3 py-2.5 text-center tabular-nums">{money2(totals.total)}</td>
            <td className="px-3 py-2.5 text-center tabular-nums">{totals.total > 0 ? '100.0' : '0.0'}</td>
            <td className="px-3 py-2.5" />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

const headCls = 'px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide'
const cellCls = 'px-2 py-1'
const roCell = cx(cellCls, 'text-center tabular-nums')
/** Sr. No. / index column — the darker label band, matching the report tables. */
const idxCell = cx(cellCls, 'bg-[#bfdeeb] text-center font-bold text-[#1a3654]')

// ── Existing expense row ────────────────────────────────────────────────────────
function ExpenseRow({
  index, expense, grandTotal, onChanged,
}: { index: number; expense: PortalExpense; grandTotal: number; onChanged: () => void }) {
  const [name, setName] = useState(expense.name)
  const [vm, setVm] = useState(String(expense.voice_minutes))
  const [rc, setRc] = useState(String(expense.rejected_calls))
  const [rv, setRv] = useState(String(expense.rent_values))
  const [payout, setPayout] = useState(String(expense.payout_expenses))
  const [total, setTotal] = useState(String(expense.total_amount))
  // True once the total diverges from the component sum (a manual lump-sum override),
  // so component edits stop auto-driving it.
  const [overridden, setOverridden] = useState(
    Math.abs(expense.total_amount - sumComponents(expense.voice_minutes, expense.rejected_calls, expense.rent_values, expense.payout_expenses)) > 0.005,
  )
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)

  const nVm = Number(vm) || 0
  const nRc = Number(rc) || 0
  const nRv = Number(rv) || 0
  const nPayout = Number(payout) || 0
  const nTotal = Number(total) || 0
  const pctOfTotal = grandTotal > 0 ? (nTotal / grandTotal) * 100 : 0

  // Edit a component; keep Total tracking the sum unless it has been overridden.
  const editComponent = (
    setter: (v: string) => void, value: string,
    next: { vm: number; rc: number; rv: number; payout: number },
  ) => {
    setter(value)
    if (!overridden) setTotal(String(sumComponents(next.vm, next.rc, next.rv, next.payout)))
  }

  const dirty =
    name.trim() !== expense.name ||
    nVm !== expense.voice_minutes ||
    nRc !== expense.rejected_calls ||
    nRv !== expense.rent_values ||
    nPayout !== expense.payout_expenses ||
    nTotal !== expense.total_amount

  const save = async () => {
    if (saving.current || !dirty || name.trim() === '') return
    saving.current = true
    try {
      await api.updatePortalExpense(expense.id, {
        name: name.trim(),
        voice_minutes: nVm,
        rejected_calls: nRc,
        rent_values: nRv,
        payout_expenses: nPayout,
        total_amount: nTotal,
      })
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  const remove = async () => {
    if (!confirm(`Delete "${expense.name}" from this month?`)) return
    try {
      await api.deletePortalExpense(expense.id)
      onChanged()
    } catch (err) { alert((err as Error).message) }
  }

  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className="bg-[#d4e9f2] text-[#0f172a]">
      <td className={idxCell}>{index}</td>
      <td className={cellCls}><Input value={name} onChange={(e) => setName(e.target.value)} /></td>
      <td className={cellCls}>
        <Input type="number" min="0" step="0.0001" value={vm} className="text-right"
          onChange={(e) => editComponent(setVm, e.target.value, { vm: Number(e.target.value) || 0, rc: nRc, rv: nRv, payout: nPayout })} />
      </td>
      <td className={cellCls}>
        <Input type="number" min="0" step="0.0001" value={rc} className="text-right"
          onChange={(e) => editComponent(setRc, e.target.value, { vm: nVm, rc: Number(e.target.value) || 0, rv: nRv, payout: nPayout })} />
      </td>
      <td className={cellCls}>
        <Input type="number" min="0" step="0.0001" value={rv} className="text-right"
          onChange={(e) => editComponent(setRv, e.target.value, { vm: nVm, rc: nRc, rv: Number(e.target.value) || 0, payout: nPayout })} />
      </td>
      <td className={cellCls}>
        <Input type="number" min="0" step="0.01" value={payout} className="text-right"
          onChange={(e) => editComponent(setPayout, e.target.value, { vm: nVm, rc: nRc, rv: nRv, payout: Number(e.target.value) || 0 })} />
      </td>
      <td className={cellCls}>
        <Input type="number" min="0" step="0.01" value={total} className="text-right font-semibold"
          title="Defaults to the sum of the component columns; edit to set a flat amount"
          onChange={(e) => {
            setTotal(e.target.value)
            setOverridden(Math.abs((Number(e.target.value) || 0) - sumComponents(nVm, nRc, nRv, nPayout)) > 0.005)
          }} />
      </td>
      <td className={cx(roCell, 'font-semibold')}>{pctOfTotal.toFixed(1)}</td>
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

// ── Trailing "add provider" row ─────────────────────────────────────────────────
function AddRow({ month, onChanged }: { month: string; onChanged: () => void }) {
  const [name, setName] = useState('')
  const [vm, setVm] = useState('')
  const [rc, setRc] = useState('')
  const [rv, setRv] = useState('')
  const [payout, setPayout] = useState('')
  const [total, setTotal] = useState('')
  const saving = useRef(false)

  const nVm = Number(vm) || 0
  const nRc = Number(rc) || 0
  const nRv = Number(rv) || 0
  const nPayout = Number(payout) || 0
  const componentSum = sumComponents(nVm, nRc, nRv, nPayout)
  // Blank total field -> fall back to the component sum on save.
  const effectiveTotal = total.trim() === '' ? componentSum : (Number(total) || 0)

  const reset = () => { setName(''); setVm(''); setRc(''); setRv(''); setPayout(''); setTotal('') }

  const add = async () => {
    if (saving.current || name.trim() === '') return
    saving.current = true
    try {
      await api.createPortalExpense({
        month,
        name: name.trim(),
        voice_minutes: nVm,
        rejected_calls: nRc,
        rent_values: nRv,
        payout_expenses: nPayout,
        total_amount: effectiveTotal,
      })
      reset()
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') add() }

  return (
    <tr className="bg-[#eaf5fa] text-[#0f172a]" onKeyDown={onKeyDown}>
      <td className={cx(idxCell, 'text-slate-400')}>+</td>
      <td className={cellCls}><Input value={name} placeholder="Add provider…" onChange={(e) => setName(e.target.value)} /></td>
      <td className={cellCls}><Input type="number" min="0" step="0.0001" value={vm} placeholder="0" className="text-right" onChange={(e) => setVm(e.target.value)} /></td>
      <td className={cellCls}><Input type="number" min="0" step="0.0001" value={rc} placeholder="0" className="text-right" onChange={(e) => setRc(e.target.value)} /></td>
      <td className={cellCls}><Input type="number" min="0" step="0.0001" value={rv} placeholder="0" className="text-right" onChange={(e) => setRv(e.target.value)} /></td>
      <td className={cellCls}><Input type="number" min="0" step="0.01" value={payout} placeholder="0" className="text-right" onChange={(e) => setPayout(e.target.value)} /></td>
      <td className={cellCls}><Input type="number" min="0" step="0.01" value={total} placeholder={componentSum ? fmtNum(componentSum) : '0'} className="text-right" onChange={(e) => setTotal(e.target.value)} /></td>
      <td className={roCell}>—</td>
      <td className="p-0 text-center">
        <button onClick={add} disabled={name.trim() === ''} title="Add row"
          className="mx-auto flex h-7 w-7 items-center justify-center rounded text-blue-600 transition-colors hover:bg-blue-100 disabled:opacity-30 disabled:hover:bg-transparent">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </td>
    </tr>
  )
}
