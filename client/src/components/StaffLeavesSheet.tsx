import { useRef, useState } from 'react'
import { api } from '../api/client'
import { LEAVE_MARKERS } from '../lib/staff'
import type { StaffLeave, StaffMember } from '../types'
import {
  addBtnCls, addRowCls, cellCls, fieldCls, headCls, removeBtnCls, rowCls, tableCls, theadCls,
} from './sheet'
import { PlusIcon, TrashIcon } from './sheetIcons'
import { EmptyState, cx } from './ui'

/**
 * The leaves sheet, column for column as the client keeps it:
 *
 *   DATE · NAME · DEPARTMENT · SICK LEAVES · BREAK LEAVES · HALF DAY · LATE LOGIN · AOB
 *
 * NAME is the shared staff roster and DEPARTMENT is narrowed to that person's departments,
 * so a row can never be filed under a department the person isn't in. Everything after it
 * is free text — the sheet holds statuses ("Approved") and short reasons, not counts — with
 * the common wordings offered as suggestions.
 */

const MARKERS_ID = 'leave-markers'

export default function StaffLeavesSheet({
  month, leaves, staff, onChanged,
}: {
  /** The month being shown, "YYYY-MM" — new rows default into it. */
  month: string
  leaves: StaffLeave[]
  staff: StaffMember[]
  onChanged: () => void
}) {
  return (
    <>
      {/* One shared suggestion list for every free-text cell on the sheet. */}
      <datalist id={MARKERS_ID}>
        {LEAVE_MARKERS.map((m) => <option key={m} value={m} />)}
      </datalist>

      <div className="overflow-x-auto">
        <table className={cx(tableCls, "min-w-4xl")}>
          <colgroup>
            <col style={{ width: '10%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '4%' }} />
          </colgroup>
          <thead>
            <tr className={theadCls}>
              <th className={headCls}>Date</th>
              <th className={headCls}>Name</th>
              <th className={headCls}>Department</th>
              <th className={headCls}>Sick Leaves</th>
              <th className={headCls}>Break Leaves</th>
              <th className={headCls}>Half Day</th>
              <th className={headCls}>Late Login</th>
              <th className={headCls}>AOB</th>
              <th className={headCls} aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {leaves.map((leave) => (
              <Row key={leave.id} leave={leave} staff={staff} onChanged={onChanged} />
            ))}
            <AddRow month={month} staff={staff} onChanged={onChanged} />
          </tbody>
        </table>
      </div>

      {leaves.length === 0 && (
        <div className="mt-3">
          <EmptyState message="Nothing recorded for this month yet." />
        </div>
      )}
    </>
  )
}

/** The editable half of a row, the same whether it is being added or edited. */
interface Draft {
  staff_id: number | ''
  department_id: number | ''
  leave_date: string
  sick_leave: string
  break_leave: string
  half_day: string
  late_login: string
  aob: string
}

const draftOf = (l: StaffLeave): Draft => ({
  staff_id: l.staff_id,
  department_id: l.department_id ?? '',
  leave_date: l.leave_date,
  sick_leave: l.sick_leave,
  break_leave: l.break_leave,
  half_day: l.half_day,
  late_login: l.late_login,
  aob: l.aob,
})

/** The marker cells, in sheet order — kept as data so both rows render the same set. */
const MARKER_FIELDS = ['sick_leave', 'break_leave', 'half_day', 'late_login', 'aob'] as const

/** The cells shared by both rows, so the add row can't drift from the saved one. */
function Cells({
  draft, onDraft, staff, onPick,
}: {
  draft: Draft
  onDraft: (d: Draft) => void
  staff: StaffMember[]
  /** Dropdowns save at once rather than waiting for the row to lose focus. */
  onPick?: (over: Partial<Draft>) => void
}) {
  const person = staff.find((s) => s.id === draft.staff_id) ?? null
  const departments = person?.departments ?? []

  const setPerson = (id: number | '') => {
    // Moving the row to someone else drops a department they aren't in, defaulting to
    // their first one so the cell is never left pointing somewhere impossible.
    const next = staff.find((s) => s.id === id) ?? null
    const keep = next?.departments.some((d) => d.id === draft.department_id)
    const departmentId = keep ? draft.department_id : (next?.departments[0]?.id ?? '')
    onDraft({ ...draft, staff_id: id, department_id: departmentId })
    onPick?.({ staff_id: id, department_id: departmentId })
  }

  return (
    <>
      <td className={cellCls}>
        <input
          type="date"
          value={draft.leave_date}
          onChange={(e) => {
            if (!e.target.value) return
            onDraft({ ...draft, leave_date: e.target.value })
            onPick?.({ leave_date: e.target.value })
          }}
          className={fieldCls}
        />
      </td>
      <td className={cellCls}>
        <select
          value={draft.staff_id}
          onChange={(e) => setPerson(e.target.value === '' ? '' : Number(e.target.value))}
          className={cx(fieldCls, 'font-semibold', draft.staff_id === '' && 'text-slate-500')}
        >
          <option value="">Select name</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </td>
      <td className={cellCls}>
        <select
          value={draft.department_id}
          disabled={person === null}
          onChange={(e) => {
            const id = e.target.value === '' ? '' : Number(e.target.value)
            onDraft({ ...draft, department_id: id })
            onPick?.({ department_id: id })
          }}
          className={cx(fieldCls, draft.department_id === '' && 'text-slate-500')}
          title={person === null ? 'Pick a name first' : undefined}
        >
          <option value="">{departments.length === 0 ? 'No department' : '—'}</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </td>
      {MARKER_FIELDS.map((field) => (
        <td key={field} className={cellCls}>
          <input
            value={draft[field]}
            list={MARKERS_ID}
            placeholder="—"
            onChange={(e) => onDraft({ ...draft, [field]: e.target.value })}
            className={fieldCls}
          />
        </td>
      ))}
    </>
  )
}

// ── Saved row ───────────────────────────────────────────────────────────────────

function Row({
  leave, staff, onChanged,
}: { leave: StaffLeave; staff: StaffMember[]; onChanged: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(leave))
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)

  const save = async (over?: Partial<Draft>) => {
    const next = { ...draft, ...over }
    const changed = MARKER_FIELDS.some((f) => next[f].trim() !== leave[f])
      || next.staff_id !== leave.staff_id
      || (next.department_id === '' ? null : next.department_id) !== leave.department_id
      || next.leave_date !== leave.leave_date
    if (saving.current || !changed || next.staff_id === '') return
    saving.current = true
    try {
      await api.updateStaffLeave(leave.id, {
        staff_id: next.staff_id,
        department_id: next.department_id === '' ? null : next.department_id,
        leave_date: next.leave_date,
        sick_leave: next.sick_leave.trim(),
        break_leave: next.break_leave.trim(),
        half_day: next.half_day.trim(),
        late_login: next.late_login.trim(),
        aob: next.aob.trim(),
      })
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  const remove = async () => {
    if (!confirm(`Delete ${leave.staff_name}'s row for ${leave.leave_date}?`)) return
    try {
      await api.deleteStaffLeave(leave.id)
      onChanged()
    } catch (err) { alert((err as Error).message) }
  }

  // Save once focus has left the row entirely, not on every cell-to-cell hop.
  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className={rowCls}>
      <Cells draft={draft} onDraft={setDraft} staff={staff} onPick={(over) => save(over)} />
      <td className="p-0">
        <div className="flex items-center justify-center">
          <button
            onClick={remove}
            title={`Delete ${leave.staff_name}'s row`}
            aria-label={`Delete ${leave.staff_name}'s row`}
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

function AddRow({
  month, staff, onChanged,
}: { month: string; staff: StaffMember[]; onChanged: () => void }) {
  // New rows open on the first of the month being shown, so a row can't land outside it
  // by accident and vanish from the sheet the moment it saves.
  const blank = (): Draft => ({
    staff_id: '', department_id: '', leave_date: `${month}-01`,
    sick_leave: '', break_leave: '', half_day: '', late_login: '', aob: '',
  })
  const [draft, setDraft] = useState<Draft>(blank)
  const [seen, setSeen] = useState(month)
  const saving = useRef(false)

  if (seen !== month) { setSeen(month); setDraft(blank()) }

  const add = async () => {
    if (saving.current || draft.staff_id === '') return
    saving.current = true
    try {
      await api.createStaffLeave({
        staff_id: draft.staff_id,
        department_id: draft.department_id === '' ? null : draft.department_id,
        leave_date: draft.leave_date,
        sick_leave: draft.sick_leave.trim(),
        break_leave: draft.break_leave.trim(),
        half_day: draft.half_day.trim(),
        late_login: draft.late_login.trim(),
        aob: draft.aob.trim(),
      })
      setDraft(blank())
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  return (
    <tr className={addRowCls} onKeyDown={(e) => { if (e.key === 'Enter') add() }}>
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

