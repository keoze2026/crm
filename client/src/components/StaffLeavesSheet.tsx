import { useRef, useState } from 'react'
import { api } from '../api/client'
import { PerformerBadge } from '../lib/performers'
import { LEAVE_MARKERS, returnVerdict, type ReturnVerdict } from '../lib/staff'
import type { StaffLeave, StaffMember } from '../types'
import {
  addBtnCls, addRowCls, cellCls, dateFieldCls, fieldCls, headCls, removeBtnCls, rowCls, tableCls, theadCls,
} from './sheet'
import { PlusIcon, TrashIcon } from './sheetIcons'
import { EmptyState, cx } from './ui'

/**
 * The leaves sheet, column for column as the client keeps it:
 *
 *   DATE · NAME · DEPARTMENT · SICK LEAVES · BREAK LEAVES · HALF DAY · LATE LOGIN
 *   · EXPECTED RETURN · ACTUAL RETURN · AOB
 *
 * NAME is the shared staff roster and DEPARTMENT is narrowed to that person's departments,
 * so a row can never be filed under a department the person isn't in. The marker columns
 * are free text — the sheet holds statuses ("Approved") and short reasons, not counts —
 * with the common wordings offered as suggestions.
 *
 * The two RETURN columns are optional dates. When both are set the ACTUAL cell is tinted
 * by how the return went (`returnVerdict()`): rose for someone back late, sky for early,
 * green for on the day. An expected date that has passed with no actual return yet is
 * amber — "not back". Most rows have neither, and are left alone.
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
        <table className={cx(tableCls, "min-w-5xl")}>
          <colgroup>
            <col style={{ width: '9%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '3%' }} />
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
              <th className={headCls}>Expected Return</th>
              <th className={headCls}>Actual Return</th>
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
  /** "" while unset; sent as null. */
  expected_return: string
  actual_return: string
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
  expected_return: l.expected_return ?? '',
  actual_return: l.actual_return ?? '',
})

/** The free-text marker cells — kept as data so the save check covers the same set. */
const MARKER_FIELDS = ['sick_leave', 'break_leave', 'half_day', 'late_login', 'aob'] as const
type MarkerField = (typeof MARKER_FIELDS)[number]

/** What the API is sent for a draft — one place, so add and edit can't send different shapes. */
const payloadOf = (d: Draft & { staff_id: number }) => ({
  staff_id: d.staff_id,
  department_id: d.department_id === '' ? null : d.department_id,
  leave_date: d.leave_date,
  sick_leave: d.sick_leave.trim(),
  break_leave: d.break_leave.trim(),
  half_day: d.half_day.trim(),
  late_login: d.late_login.trim(),
  aob: d.aob.trim(),
  expected_return: d.expected_return || null,
  actual_return: d.actual_return || null,
})

/** The cells shared by both rows, so the add row can't drift from the saved one. */
function Cells({
  draft, onDraft, staff, onPick,
}: {
  draft: Draft
  onDraft: (d: Draft) => void
  staff: StaffMember[]
  /** Dropdowns and dates save at once rather than waiting for the row to lose focus. */
  onPick?: (over: Partial<Draft>) => void
}) {
  const person = staff.find((s) => s.id === draft.staff_id) ?? null
  const departments = person?.departments ?? []
  const verdict = returnVerdict(draft.expected_return || null, draft.actual_return || null)
  // "Not back" belongs under the date they were due; every other verdict under the day
  // they came back.
  const expectedVerdict = verdict?.id === 'overdue' ? verdict : null
  const actualVerdict = verdict && verdict.id !== 'overdue' ? verdict : null

  const setPerson = (id: number | '') => {
    // Moving the row to someone else drops a department they aren't in, defaulting to
    // their first one so the cell is never left pointing somewhere impossible.
    const next = staff.find((s) => s.id === id) ?? null
    const keep = next?.departments.some((d) => d.id === draft.department_id)
    const departmentId = keep ? draft.department_id : (next?.departments[0]?.id ?? '')
    onDraft({ ...draft, staff_id: id, department_id: departmentId })
    onPick?.({ staff_id: id, department_id: departmentId })
  }

  // A return date may be cleared (a Half Day row has nothing to return from), so an empty
  // value is a real change here, unlike the leave date.
  const setReturn = (field: 'expected_return' | 'actual_return', value: string) => {
    onDraft({ ...draft, [field]: value })
    onPick?.({ [field]: value })
  }

  const markerCell = (field: MarkerField) => (
    <td className={cellCls}>
      <input
        value={draft[field]}
        list={MARKERS_ID}
        placeholder="—"
        onChange={(e) => onDraft({ ...draft, [field]: e.target.value })}
        className={fieldCls}
      />
    </td>
  )

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
          className={dateFieldCls}
        />
      </td>
      <td className={cellCls}>
        <div className="flex items-center gap-1">
          <select
            value={draft.staff_id}
            onChange={(e) => setPerson(e.target.value === '' ? '' : Number(e.target.value))}
            className={cx(fieldCls, 'font-semibold', draft.staff_id === '' && 'text-slate-500')}
          >
            <option value="">Select name</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {typeof draft.staff_id === 'number' && <PerformerBadge staffId={draft.staff_id} compact />}
        </div>
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
      {markerCell('sick_leave')}
      {markerCell('break_leave')}
      {markerCell('half_day')}
      {markerCell('late_login')}
      <td className={cx(cellCls, expectedVerdict?.cell)}>
        <input
          type="date"
          value={draft.expected_return}
          min={draft.leave_date || undefined}
          onChange={(e) => setReturn('expected_return', e.target.value)}
          className={dateFieldCls}
          title="The day they were due back"
        />
        {expectedVerdict && <Badge verdict={expectedVerdict} />}
      </td>
      <td className={cx(cellCls, actualVerdict?.cell)}>
        <input
          type="date"
          value={draft.actual_return}
          min={draft.leave_date || undefined}
          onChange={(e) => setReturn('actual_return', e.target.value)}
          className={cx(dateFieldCls, actualVerdict?.id === 'late' && 'border-rose-400 font-semibold text-rose-800')}
          title="The day they actually came back"
        />
        {actualVerdict && <Badge verdict={actualVerdict} />}
      </td>
      {markerCell('aob')}
    </>
  )
}

/** The verdict under a return cell — "3 days late", "2 days overdue". */
function Badge({ verdict }: { verdict: ReturnVerdict }) {
  return (
    <span className={cx('mt-0.5 inline-block rounded border px-1 text-[10px] font-bold leading-4', verdict.cls)}>
      {verdict.label}
    </span>
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
      || (next.expected_return || null) !== leave.expected_return
      || (next.actual_return || null) !== leave.actual_return
    if (saving.current || !changed || next.staff_id === '') return
    saving.current = true
    try {
      await api.updateStaffLeave(leave.id, payloadOf({ ...next, staff_id: next.staff_id }))
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
    expected_return: '', actual_return: '',
  })
  const [draft, setDraft] = useState<Draft>(blank)
  const [seen, setSeen] = useState(month)
  const saving = useRef(false)

  if (seen !== month) { setSeen(month); setDraft(blank()) }

  const add = async () => {
    if (saving.current || draft.staff_id === '') return
    saving.current = true
    try {
      await api.createStaffLeave(payloadOf({ ...draft, staff_id: draft.staff_id }))
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
