import { Fragment, useRef, useState } from 'react'
import { api } from '../api/client'
import { formatMonth } from './MonthSelector'
import { SALARY_STATUSES } from '../lib/staff'
import type { Department, StaffMember, StaffSalary } from '../types'
import {
  addBtnCls, addRowCls, bandCls, cellCls, fieldCls, headCls, idxCell, removeBtnCls, rowCls, tableCls, theadCls,
} from './sheet'
import { PlusIcon, TrashIcon } from './sheetIcons'
import { cx } from './ui'

/**
 * The salary sheet: Sr. NO · NAME · SALARY, exactly as the client's spreadsheet lays it
 * out — the month stamped once under the header, then a band per department with its
 * people beneath it, and Sr. No. running continuously across every band.
 *
 * Each band ends in a blank row that adds someone from THAT department, so the band you
 * type under decides where the row lands. Names come from the staff roster, which is also
 * where the departments the bands are built from live.
 *
 * A person can hold only one row per month, so the add row offers only the people in that
 * department who aren't on the sheet yet.
 */
export default function StaffSalariesSheet({
  month, salaries, staff, departments, onChanged,
}: {
  month: string
  salaries: StaffSalary[]
  staff: StaffMember[]
  departments: Department[]
  onChanged: () => void
}) {
  // One band per department, in the catalogue's order. "No department" only appears when
  // it holds rows — or when there are no departments at all, so entry is still possible.
  const orphans = salaries.filter((s) => s.department_id === null)
  const bands: { id: number | null; name: string }[] = [
    ...departments.map((d) => ({ id: d.id as number | null, name: d.name })),
    ...(orphans.length > 0 || departments.length === 0
      ? [{ id: null as number | null, name: 'No department' }]
      : []),
  ]

  const onSheet = new Set(salaries.map((s) => s.staff_id))
  let sr = 0

  return (
    <div className="overflow-x-auto">
      <table className={cx(tableCls, "min-w-lg")}>
        <colgroup>
          <col style={{ width: '12%' }} />
          <col style={{ width: '48%' }} />
          <col style={{ width: '34%' }} />
          <col style={{ width: '6%' }} />
        </colgroup>
        <thead>
          <tr className={theadCls}>
            <th className={headCls}>Sr. NO.</th>
            <th className={headCls}>Name</th>
            <th className={headCls}>Salary</th>
            <th className={headCls} aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {/* The month, stamped once under the header the way the sheet does it. */}
          <tr className="bg-[#bfdeeb]">
            <td className="px-2 py-1" />
            <td className="px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-[#1a3654]" colSpan={3}>
              {formatMonth(month)}
            </td>
          </tr>

          {bands.map((band) => {
            const rows = salaries.filter((s) => s.department_id === band.id)
            // Whoever is in this department and hasn't been paid a row yet.
            const free = (band.id === null
              ? staff.filter((p) => p.departments.length === 0)
              : staff.filter((p) => p.departments.some((d) => d.id === band.id))
            ).filter((p) => !onSheet.has(p.id))

            return (
              <Fragment key={`band-${band.id ?? 'none'}`}>
                <tr className={bandCls}>
                  <td className="px-2 py-1" />
                  <td className="px-2 py-1 text-[11px] font-bold uppercase tracking-wide" colSpan={3}>
                    {band.name}
                  </td>
                </tr>
                {rows.map((salary) => {
                  sr += 1
                  return <Row key={salary.id} sr={sr} salary={salary} onChanged={onChanged} />
                })}
                <AddRow
                  month={month}
                  departmentId={band.id}
                  free={free}
                  onChanged={onChanged}
                />
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Saved row ───────────────────────────────────────────────────────────────────

function Row({ sr, salary, onChanged }: { sr: number; salary: StaffSalary; onChanged: () => void }) {
  const [status, setStatus] = useState(salary.status)
  const saving = useRef(false)

  const save = async (next: string) => {
    if (saving.current || next === salary.status) return
    saving.current = true
    try {
      await api.updateStaffSalary(salary.id, { status: next })
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  const remove = async () => {
    if (!confirm(`Take ${salary.staff_name} off this month's salary sheet?`)) return
    try {
      await api.deleteStaffSalary(salary.id)
      onChanged()
    } catch (err) { alert((err as Error).message) }
  }

  return (
    <tr className={rowCls}>
      <td className={idxCell}>{sr}</td>
      <td className={cx(cellCls, 'font-semibold')}>{salary.staff_name}</td>
      <td className={cellCls}>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); save(e.target.value) }}
          className={cx(fieldCls, 'font-semibold', status === '' && 'text-slate-500')}
        >
          <option value="">Select</option>
          {SALARY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td className="p-0">
        <div className="flex items-center justify-center">
          <button
            onClick={remove}
            title={`Remove ${salary.staff_name}'s row`}
            aria-label={`Remove ${salary.staff_name}'s row`}
            className={removeBtnCls}
          >
            <TrashIcon />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Trailing "add to this department" row ───────────────────────────────────────

function AddRow({
  month, departmentId, free, onChanged,
}: {
  month: string
  /** The band this row is being added under — it sets the row's department. */
  departmentId: number | null
  /** The people in that department who don't hold a row for this month yet. */
  free: StaffMember[]
  onChanged: () => void
}) {
  const [staffId, setStaffId] = useState<number | ''>('')
  const [status, setStatus] = useState(SALARY_STATUSES[0])
  const saving = useRef(false)

  const add = async () => {
    if (saving.current || staffId === '') return
    saving.current = true
    try {
      await api.createStaffSalary({ staff_id: staffId, department_id: departmentId, month, status })
      setStaffId('')
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  return (
    <tr className={addRowCls} onKeyDown={(e) => { if (e.key === 'Enter') add() }}>
      <td className={cx(idxCell, 'text-slate-400')}>+</td>
      <td className={cellCls}>
        <select
          value={staffId}
          disabled={free.length === 0}
          onChange={(e) => setStaffId(e.target.value === '' ? '' : Number(e.target.value))}
          className={cx(fieldCls, 'font-semibold', staffId === '' && 'text-slate-500')}
        >
          <option value="">{free.length === 0 ? 'Everyone here is on the sheet' : 'Select name'}</option>
          {free.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </td>
      <td className={cellCls}>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={cx(fieldCls, 'font-semibold')}
        >
          {SALARY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td className="p-0">
        <div className="flex items-center justify-center">
          <button
            onClick={add}
            disabled={staffId === ''}
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
