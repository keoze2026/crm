import { useRef, useState } from 'react'
import { api } from '../api/client'
import { money2 } from '../lib/format'
import { PerformerBadge } from '../lib/performers'
import { INCENTIVE_STATUSES, incentiveStatus, parseAmount, payableTotal } from '../lib/payouts'
import type { Incentive, IncentiveStatus, StaffMember } from '../types'
import {
  addBtnCls, addRowCls, cellCls, fieldCls, headCls, idxCell, isEnterSubmit, removeBtnCls, rowCls, tableCls, theadCls,
} from './sheet'
import { PlusIcon, TrashIcon } from './sheetIcons'
import { EmptyState, cx } from './ui'
import { useServerDraft } from '../lib/useServerDraft'

/**
 * Monthly Incentives — one row per person per incentive:
 *
 *   SR. NO. · STAFF · AMOUNT · STATUS
 *
 * Built like the Salary Hold sheet, cell for cell: STAFF is a plain dropdown over the shared
 * roster, AMOUNT is typed and saves when focus leaves the row, STATUS saves at once and is
 * the one boxed, coloured cell. Each row is one person; giving several people an incentive
 * means a row for each. The foot totals what the month pays out, leaving cancelled rows out.
 */
export default function IncentivesSheet({
  month, incentives, staff, onChanged,
}: {
  /** "YYYY-MM" — where new rows are added. */
  month: string
  incentives: Incentive[]
  staff: StaffMember[]
  onChanged: () => void
}) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className={cx(tableCls, 'min-w-xl')}>
          <colgroup>
            <col style={{ width: '8%' }} />
            <col style={{ width: '44%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '6%' }} />
          </colgroup>
          <thead>
            <tr className={theadCls}>
              <th className={headCls}>Sr. NO.</th>
              <th className={headCls}>Staff</th>
              <th className={headCls}>Amount (USD)</th>
              <th className={headCls}>Status</th>
              <th className={headCls} aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {incentives.map((incentive, i) => (
              <Row key={incentive.id} sr={i + 1} incentive={incentive} staff={staff} onChanged={onChanged} />
            ))}
            <AddRow month={month} staff={staff} onChanged={onChanged} />
          </tbody>
          {incentives.length > 0 && (
            <tfoot>
              <tr className={theadCls}>
                <td className={cx(headCls, 'text-left')} colSpan={2}>Total (excluding cancelled)</td>
                <td className={cx(headCls, 'text-right tabular-nums')}>{money2(payableTotal(incentives))}</td>
                <td className={headCls} colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {incentives.length === 0 && (
        <div className="mt-3">
          <EmptyState message="No incentives for this month yet — add one in the row above." />
        </div>
      )}
    </>
  )
}

const amountText = (n: number) => n.toFixed(2)

// ── Saved row ───────────────────────────────────────────────────────────────────

function Row({
  sr, incentive, staff, onChanged,
}: { sr: number; incentive: Incentive; staff: StaffMember[]; onChanged: () => void }) {
  const [amount, setAmount] = useServerDraft<string>(amountText(incentive.amount))
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)

  const send = async (data: { staff_id?: number; amount?: number; status?: IncentiveStatus }) => {
    if (saving.current) return
    saving.current = true
    try {
      await api.updateIncentive(incentive.id, data)
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  const saveAmount = () => {
    const value = parseAmount(amount)
    if (value === null) {
      alert('Enter the amount as a number, e.g. 200 or 150.50.')
      setAmount(amountText(incentive.amount))
      return
    }
    if (value !== incentive.amount) send({ amount: value })
  }

  const remove = async () => {
    if (!confirm(`Remove this ${money2(incentive.amount)} incentive for ${incentive.staff_name}?`)) return
    try {
      await api.deleteIncentive(incentive.id)
      onChanged()
    } catch (err) { alert((err as Error).message) }
  }

  // Save once focus has left the row entirely, not on every cell-to-cell hop.
  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) saveAmount()
  }, 0)

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className={rowCls}>
      <td className={idxCell}>{sr}</td>
      <td className={cellCls}>
        <StaffField
          value={incentive.staff_id}
          name={incentive.staff_name}
          staff={staff}
          onChange={(id) => { if (id !== '') send({ staff_id: id }) }}
        />
      </td>
      <td className={cellCls}>
        <AmountField value={amount} onChange={setAmount} />
      </td>
      <td className={cellCls}>
        <StatusField value={incentive.status} onChange={(status) => send({ status })} />
      </td>
      <td className="p-0">
        <div className="flex items-center justify-center">
          <button
            onClick={remove}
            title={`Remove this incentive for ${incentive.staff_name}`}
            aria-label={`Remove this incentive for ${incentive.staff_name}`}
            className={removeBtnCls}
          >
            <TrashIcon />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Trailing add row ────────────────────────────────────────────────────────────

function AddRow({ month, staff, onChanged }: { month: string; staff: StaffMember[]; onChanged: () => void }) {
  const [person, setPerson] = useState<number | ''>('')
  const [amount, setAmount] = useState('')
  const [status, setStatus] = useState<IncentiveStatus>('Pending')
  const saving = useRef(false)
  const value = parseAmount(amount)
  const ready = person !== '' && value !== null

  const add = async () => {
    if (saving.current || person === '' || value === null) return
    saving.current = true
    try {
      await api.createIncentives({ month, staff_ids: [person], amount: value, status })
      setPerson('')
      setAmount('')
      setStatus('Pending')
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  return (
    <tr className={addRowCls} onKeyDown={(e) => { if (isEnterSubmit(e)) add() }}>
      <td className={cx(idxCell, 'text-slate-400')}>+</td>
      <td className={cellCls}>
        <StaffField value={person} staff={staff} onChange={setPerson} />
      </td>
      <td className={cellCls}>
        <AmountField value={amount} placeholder="0.00" onChange={setAmount} />
      </td>
      <td className={cellCls}>
        <StatusField value={status} onChange={setStatus} />
      </td>
      <td className="p-0">
        <div className="flex items-center justify-center">
          <button
            onClick={add}
            disabled={!ready}
            title={person === '' ? 'Pick a staff member first' : value === null ? 'Enter an amount first' : 'Add row'}
            aria-label="Add incentive"
            className={addBtnCls}
          >
            <PlusIcon />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Cells ───────────────────────────────────────────────────────────────────────

/** One person, picked from the roster. Inactive people are offered only if already chosen. */
function StaffField({
  value, name, staff, onChange,
}: { value: number | ''; name?: string; staff: StaffMember[]; onChange: (id: number | '') => void }) {
  const options = staff.filter((s) => s.status !== 'inactive' || s.id === value)
  return (
    <div className="flex items-center gap-1">
      <select
        value={value}
        aria-label="Staff"
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        className={cx(fieldCls, 'font-semibold', value === '' && 'text-slate-500')}
      >
        {value === '' && <option value="">Select staff</option>}
        {/* Someone since taken off the roster's options still reads as themselves. */}
        {value !== '' && !options.some((s) => s.id === value) && <option value={value}>{name}</option>}
        {options.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {value !== '' && <PerformerBadge staffId={value} compact />}
    </div>
  )
}

function AmountField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex items-center gap-0.5">
      <span className="text-[11px] font-bold text-slate-500">$</span>
      <input
        value={value}
        inputMode="decimal"
        placeholder={placeholder}
        aria-label="Amount in US dollars"
        onChange={(e) => onChange(e.target.value)}
        className={cx(fieldCls, 'text-right font-semibold tabular-nums', value.trim() !== '' && parseAmount(value) === null && 'text-rose-600')}
      />
    </div>
  )
}

function StatusField({ value, onChange }: { value: IncentiveStatus; onChange: (s: IncentiveStatus) => void }) {
  const tone = incentiveStatus(value)
  return (
    // The wrapper keeps its border and tint: the global rule that strips those only reaches
    // the <select> itself, which is what makes this cell stand out.
    <div className={cx('flex items-center gap-1.5 rounded border px-1 py-0.5', tone.cell)}>
      <span className={cx('h-2 w-2 shrink-0 rounded-full', tone.dot)} />
      <select
        value={value}
        aria-label="Status"
        onChange={(e) => onChange(e.target.value as IncentiveStatus)}
        className="w-full cursor-pointer appearance-none bg-transparent text-xs font-bold focus:outline-none"
      >
        {INCENTIVE_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
    </div>
  )
}
