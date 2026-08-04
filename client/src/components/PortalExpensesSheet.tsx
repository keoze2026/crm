import { useRef, useState } from 'react'
import { api } from '../api/client'
import { money2 } from '../lib/format'
import type { PortalExpense } from '../types'
import { Input, cx } from './ui'

/** Number with thousands separators and up to 3 decimals (e.g. 157.785). */
const numFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })
const fmtNum = (n: number) => numFmt.format(n || 0)

/**
 * The editable component columns, in sheet order. `money` ones are USD amounts and are
 * formatted/totalled as currency; the rest are plain counts. "Other expenses" is the
 * catch-all bucket (payout, fixed float, …) and so comes last.
 */
const COMPONENTS = [
  { key: 'voice_minutes', label: 'Voice Minutes', money: false },
  { key: 'rejected_calls', label: 'Rejected Leads', money: false },
  { key: 'rent_values', label: 'Rent values', money: false },
  { key: 'call_recording', label: 'Call Recording (USD)', money: true },
  { key: 'voip_shield', label: 'Voip Shield (USD)', money: true },
  { key: 'other_expenses', label: 'Other expenses (USD)', money: true },
] as const

type ComponentKey = (typeof COMPONENTS)[number]['key']
/** One row's component cells as typed strings (the raw input values). */
type Values = Record<ComponentKey, string>

const blankValues = (): Values =>
  Object.fromEntries(COMPONENTS.map((c) => [c.key, ''])) as Values
const valuesOf = (e: PortalExpense): Values =>
  Object.fromEntries(COMPONENTS.map((c) => [c.key, String(e[c.key])])) as Values
const sumComponents = (v: Values) =>
  COMPONENTS.reduce((s, c) => s + (Number(v[c.key]) || 0), 0)

/**
 * Editable "Portal Expenses" sheet for a single month, mirroring the client
 * spreadsheet: Sr. No. · Name · the component columns above · Total Amount (Usd) ·
 * % of Total.
 *
 * Total Amount defaults to the sum of the component columns and follows edits to them,
 * but stays independently editable so a row can be a flat lump sum (e.g. a fixed BYOC
 * fee) with zero components. % of Total is derived from the month's grand total. Rows
 * auto-save on blur; the trailing row adds a new provider.
 */
export default function PortalExpensesSheet({
  month, expenses, onChanged,
}: { month: string; expenses: PortalExpense[]; onChanged: () => void }) {
  const totals = expenses.reduce(
    (a, e) => {
      COMPONENTS.forEach((c) => { a[c.key] += e[c.key] })
      a.total += e.total_amount
      return a
    },
    { ...(Object.fromEntries(COMPONENTS.map((c) => [c.key, 0])) as Record<ComponentKey, number>), total: 0 },
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-7xl border-collapse text-sm [&_td]:border [&_td]:border-white [&_th]:border [&_th]:border-white">
        <colgroup>
          <col style={{ width: '4%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '5%' }} />
          <col style={{ width: '3%' }} />
        </colgroup>
        <thead>
          <tr className="bg-[#1a3654] text-center text-xs font-bold uppercase tracking-wide text-white">
            <th className={headCls}>Sr. No.</th>
            <th className={headCls}>Name</th>
            {COMPONENTS.map((c) => <th key={c.key} className={headCls}>{c.label}</th>)}
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
            {COMPONENTS.map((c) => (
              <td key={c.key} className="px-3 py-2.5 text-center tabular-nums">
                {c.money ? money2(totals[c.key]) : fmtNum(totals[c.key])}
              </td>
            ))}
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

/** Digits with at most one decimal point — no letters, signs, spaces or exponents. */
const NUMERIC = /^\d*\.?\d*$/

/**
 * Numeric-only cell input. Keystrokes and pastes that would leave a non-numeric value
 * are rejected outright, so the field can only ever hold a plain positive number.
 */
function NumInput({
  value, onChange, placeholder, className, title,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  title?: string
}) {
  return (
    <Input
      type="text"
      inputMode="decimal"
      value={value}
      placeholder={placeholder}
      title={title}
      className={cx('text-right', className)}
      onChange={(e) => { if (NUMERIC.test(e.target.value)) onChange(e.target.value) }}
    />
  )
}

// ── Existing expense row ────────────────────────────────────────────────────────
function ExpenseRow({
  index, expense, grandTotal, onChanged,
}: { index: number; expense: PortalExpense; grandTotal: number; onChanged: () => void }) {
  const [name, setName] = useState(expense.name)
  const [values, setValues] = useState<Values>(() => valuesOf(expense))
  const [total, setTotal] = useState(String(expense.total_amount))
  // True once the total diverges from the component sum (a manual lump-sum override),
  // so component edits stop auto-driving it.
  const [overridden, setOverridden] = useState(
    Math.abs(expense.total_amount - sumComponents(valuesOf(expense))) > 0.005,
  )
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)

  const nums = Object.fromEntries(
    COMPONENTS.map((c) => [c.key, Number(values[c.key]) || 0]),
  ) as Record<ComponentKey, number>
  const nTotal = Number(total) || 0
  const pctOfTotal = grandTotal > 0 ? (nTotal / grandTotal) * 100 : 0

  // Edit a component; keep Total tracking the sum unless it has been overridden.
  const editComponent = (key: ComponentKey, value: string) => {
    const next = { ...values, [key]: value }
    setValues(next)
    if (!overridden) setTotal(String(sumComponents(next)))
  }

  const dirty =
    name.trim() !== expense.name ||
    COMPONENTS.some((c) => nums[c.key] !== expense[c.key]) ||
    nTotal !== expense.total_amount

  const save = async () => {
    if (saving.current || !dirty || name.trim() === '') return
    saving.current = true
    try {
      await api.updatePortalExpense(expense.id, { name: name.trim(), ...nums, total_amount: nTotal })
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
      {COMPONENTS.map((c) => (
        <td key={c.key} className={cellCls}>
          <NumInput value={values[c.key]} onChange={(v) => editComponent(c.key, v)} />
        </td>
      ))}
      <td className={cellCls}>
        <NumInput value={total} className="font-semibold"
          title="Defaults to the sum of the component columns; edit to set a flat amount"
          onChange={(v) => {
            setTotal(v)
            setOverridden(Math.abs((Number(v) || 0) - sumComponents(values)) > 0.005)
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
  const [values, setValues] = useState<Values>(blankValues)
  const [total, setTotal] = useState('')
  const saving = useRef(false)

  const nums = Object.fromEntries(
    COMPONENTS.map((c) => [c.key, Number(values[c.key]) || 0]),
  ) as Record<ComponentKey, number>
  const componentSum = sumComponents(values)
  // Blank total field -> fall back to the component sum on save.
  const effectiveTotal = total.trim() === '' ? componentSum : (Number(total) || 0)

  const reset = () => { setName(''); setValues(blankValues()); setTotal('') }

  const add = async () => {
    if (saving.current || name.trim() === '') return
    saving.current = true
    try {
      await api.createPortalExpense({ month, name: name.trim(), ...nums, total_amount: effectiveTotal })
      reset()
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') add() }

  return (
    <tr className="bg-[#eaf5fa] text-[#0f172a]" onKeyDown={onKeyDown}>
      <td className={cx(idxCell, 'text-slate-400')}>+</td>
      <td className={cellCls}><Input value={name} placeholder="Add provider…" onChange={(e) => setName(e.target.value)} /></td>
      {COMPONENTS.map((c) => (
        <td key={c.key} className={cellCls}>
          <NumInput value={values[c.key]} placeholder="0"
            onChange={(v) => setValues({ ...values, [c.key]: v })} />
        </td>
      ))}
      <td className={cellCls}>
        <NumInput value={total} placeholder={componentSum ? fmtNum(componentSum) : '0'} onChange={setTotal} />
      </td>
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
