import { useRef, useState } from 'react'
import { api } from '../api/client'
import { PerformerBadge } from '../lib/performers'
import { SALARY_HOLD_STATUSES, salaryHoldStatus } from '../lib/staff'
import type { StaffMember, StaffSalaryHold } from '../types'
import {
  addBtnCls, addRowCls, cellCls, dateFieldCls, fieldCls, headCls, idxCell, removeBtnCls, rowCls, tableCls, theadCls,
} from './sheet'
import { PlusIcon, TrashIcon } from './sheetIcons'
import { EmptyState, cx } from './ui'

/**
 * Salary Hold — a running log of salaries held back and why:
 *
 *   SR. NO. · NAME · MONTH · REASON · STATUS
 *
 * The page's month picker filters WHAT IS SHOWN, the way it does on Leaves and Salaries, but
 * the log underneath still holds every month: each row carries its own month, and the MONTH
 * cell can file a row under any of them — including one you are not currently looking at,
 * which simply moves the row out of view. New rows default to the month being viewed so
 * that adding one lands where you can see it.
 *
 * Built like the Leaves sheet, cell for cell: NAME is a plain dropdown over the shared staff
 * roster, MONTH a native month field, REASON free text. They are deliberately unstyled
 * boxes — the app's global table rules strip the border and background off every cell
 * editor, so an editable cell reads exactly like a read-only one.
 *
 * STATUS is the one cell that keeps a box, and the only coloured thing on the sheet: amber
 * while the money is held, green once disbursed, with the dot-and-tint treatment the Staff
 * roster's own status column uses. That is the point of the column — the list should answer
 * "who is still waiting" without being read word by word.
 */
export default function StaffSalaryHoldSheet({
  month, holds, staff, onChanged,
}: {
  /** The month being shown, "YYYY-MM" — new rows default into it. */
  month: string
  holds: StaffSalaryHold[]
  staff: StaffMember[]
  onChanged: () => void
}) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className={cx(tableCls, 'min-w-3xl')}>
          <colgroup>
            <col style={{ width: '8%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '38%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '5%' }} />
          </colgroup>
          <thead>
            <tr className={theadCls}>
              <th className={headCls}>Sr. NO.</th>
              <th className={headCls}>Name</th>
              <th className={headCls}>Month</th>
              <th className={headCls}>Reason</th>
              <th className={headCls}>Status</th>
              <th className={headCls} aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {holds.map((hold, i) => (
              <Row key={hold.id} sr={i + 1} hold={hold} staff={staff} onChanged={onChanged} />
            ))}
            <AddRow month={month} staff={staff} onChanged={onChanged} />
          </tbody>
        </table>
      </div>

      {holds.length === 0 && (
        <div className="mt-3">
          <EmptyState message="No salary is on hold this month." />
        </div>
      )}
    </>
  )
}

// ── The editable half of a row, the same whether it is being added or edited ────

interface Draft {
  staff_id: number | ''
  /** "YYYY-MM" — what the month field reads and writes. */
  month: string
  reason: string
  status: string
}

const draftOf = (h: StaffSalaryHold): Draft => ({
  staff_id: h.staff_id,
  month: h.month.slice(0, 7),
  reason: h.reason,
  status: h.status,
})

/** What the API is sent for a draft — one place, so add and edit can't send different shapes. */
const payloadOf = (d: Draft & { staff_id: number }) => ({
  staff_id: d.staff_id,
  month: d.month,
  reason: d.reason.trim(),
  status: d.status,
})

/** The cells shared by both rows, so the add row can't drift from the saved one. */
function Cells({
  draft, onDraft, staff, onPick,
}: {
  draft: Draft
  onDraft: (d: Draft) => void
  staff: StaffMember[]
  /** Dropdowns and the month save at once rather than waiting for the row to lose focus. */
  onPick?: (over: Partial<Draft>) => void
}) {
  const tone = salaryHoldStatus(draft.status)

  return (
    <>
      <td className={cellCls}>
        <div className="flex items-center gap-1">
          <select
            value={draft.staff_id}
            onChange={(e) => {
              const id = e.target.value === '' ? '' : Number(e.target.value)
              onDraft({ ...draft, staff_id: id })
              onPick?.({ staff_id: id })
            }}
            className={cx(fieldCls, 'font-semibold', draft.staff_id === '' && 'text-slate-500')}
          >
            <option value="">Select name</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {typeof draft.staff_id === 'number' && <PerformerBadge staffId={draft.staff_id} compact />}
        </div>
      </td>
      <td className={cellCls}>
        <input
          type="month"
          value={draft.month}
          onChange={(e) => {
            // A hold always belongs to a month, so an emptied field is ignored rather than
            // saved — the same way the Leaves sheet guards its date.
            if (!e.target.value) return
            onDraft({ ...draft, month: e.target.value })
            onPick?.({ month: e.target.value })
          }}
          className={dateFieldCls}
        />
      </td>
      <td className={cellCls}>
        <input
          value={draft.reason}
          placeholder="—"
          onChange={(e) => onDraft({ ...draft, reason: e.target.value })}
          className={fieldCls}
        />
      </td>
      <td className={cellCls}>
        {/* The wrapper keeps its border and tint: the global rule that strips those only
            reaches the <select> itself, which is exactly what makes this cell stand out. */}
        <div className={cx('flex items-center gap-1.5 rounded border px-1 py-0.5', tone.cell)}>
          <span className={cx('h-2 w-2 shrink-0 rounded-full', tone.dot)} />
          <select
            value={draft.status}
            aria-label="Status"
            onChange={(e) => {
              onDraft({ ...draft, status: e.target.value })
              onPick?.({ status: e.target.value })
            }}
            className="w-full cursor-pointer appearance-none bg-transparent text-xs font-bold focus:outline-none"
          >
            {SALARY_HOLD_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      </td>
    </>
  )
}

// ── Saved row ───────────────────────────────────────────────────────────────────

function Row({
  sr, hold, staff, onChanged,
}: { sr: number; hold: StaffSalaryHold; staff: StaffMember[]; onChanged: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(hold))
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)

  const save = async (over?: Partial<Draft>) => {
    const next = { ...draft, ...over }
    const changed = next.staff_id !== hold.staff_id
      || next.month !== hold.month.slice(0, 7)
      || next.reason.trim() !== hold.reason
      || next.status !== hold.status
    if (saving.current || !changed || next.staff_id === '') return
    saving.current = true
    try {
      await api.updateStaffSalaryHold(hold.id, payloadOf({ ...next, staff_id: next.staff_id }))
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  const remove = async () => {
    if (!confirm(`Remove this salary hold for ${hold.staff_name}?`)) return
    try {
      await api.deleteStaffSalaryHold(hold.id)
      onChanged()
    } catch (err) { alert((err as Error).message) }
  }

  // Save once focus has left the row entirely, not on every cell-to-cell hop.
  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className={rowCls}>
      <td className={idxCell}>{sr}</td>
      <Cells draft={draft} onDraft={setDraft} staff={staff} onPick={(over) => save(over)} />
      <td className="p-0">
        <div className="flex items-center justify-center">
          <button
            onClick={remove}
            title={`Remove this hold for ${hold.staff_name}`}
            aria-label={`Remove this hold for ${hold.staff_name}`}
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

/**
 * A new row lands in the month being viewed, so adding one does not immediately filter
 * itself out of sight. The MONTH cell is still free — file it under any month you like and
 * the row moves there, which is what keeps the log general while the view stays scoped.
 */
const blank = (month: string): Draft => ({
  staff_id: '',
  month,
  reason: '',
  status: SALARY_HOLD_STATUSES[0].id,
})

function AddRow({ month, staff, onChanged }: { month: string; staff: StaffMember[]; onChanged: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => blank(month))
  const saving = useRef(false)

  const add = async () => {
    if (saving.current || draft.staff_id === '') return
    saving.current = true
    try {
      await api.createStaffSalaryHold(payloadOf({ ...draft, staff_id: draft.staff_id }))
      setDraft(blank(month))
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  return (
    <tr className={addRowCls} onKeyDown={(e) => { if (e.key === 'Enter') add() }}>
      <td className={cx(idxCell, 'text-slate-400')}>+</td>
      <Cells draft={draft} onDraft={setDraft} staff={staff} />
      <td className="p-0">
        <div className="flex items-center justify-center">
          <button
            onClick={add}
            disabled={draft.staff_id === ''}
            title="Add row"
            aria-label="Add row"
            className={addBtnCls}
          >
            <PlusIcon />
          </button>
        </div>
      </td>
    </tr>
  )
}
