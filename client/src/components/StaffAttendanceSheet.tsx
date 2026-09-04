import { useRef, useState } from 'react'
import { api } from '../api/client'
import { ATTENDANCE_STATUSES, clockLabel, hoursLabel, netHours } from '../lib/staff'
import type { StaffAttendanceRow, StaffMember } from '../types'
import {
  addRowCls, cellCls, fieldCls, headCls, idxCell, lockedCls, removeBtnCls, rowCls, tableCls, theadCls,
} from './sheet'
import { LockIcon, RevertIcon, TrashIcon } from './sheetIcons'
import { EmptyState, cx } from './ui'

/**
 * One day's attendance for the whole roster — a row per staff member for the selected
 * date, the way the Attendance page's daily roster reads.
 *
 * Where the check-in bot recorded the day, its clock times are shown locked: they are the
 * bot's to change, not this page's. The BREAK is the exception — it can be corrected on
 * any row, because a mis-logged break is the thing that actually needs fixing by hand. A
 * correction is stored beside the bot's day rather than over it, and the Attendance page
 * reads the same figure, so the two pages never disagree. Clearing it (the revert button)
 * puts the bot's own total back.
 *
 * Everyone the bot didn't record gets an empty row that saves itself the moment something
 * is typed into it.
 */
export default function StaffAttendanceSheet({
  date, rows, staff, onChanged,
}: {
  /** The day being shown, "YYYY-MM-DD". */
  date: string
  rows: StaffAttendanceRow[]
  staff: StaffMember[]
  onChanged: () => void
}) {
  const byStaff = new Map(rows.map((r) => [r.staff_id, r]))

  return (
    <>
      <div className="overflow-x-auto">
        <table className={cx(tableCls, 'min-w-3xl')}>
          <colgroup>
            <col style={{ width: '6%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '19%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '6%' }} />
          </colgroup>
          <thead>
            <tr className={theadCls}>
              <th className={headCls}>Sr. No.</th>
              <th className={headCls}>Name</th>
              <th className={headCls}>Department</th>
              <th className={headCls}>Login</th>
              <th className={headCls}>Logout</th>
              <th className={headCls}>Break</th>
              <th className={headCls}>Hours</th>
              <th className={headCls}>Status</th>
              <th className={headCls} aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {staff.map((person, i) => {
              const row = byStaff.get(person.id) ?? null
              return row?.source === 'fetched'
                ? (
                  <FetchedRow
                    key={`${person.id}-${date}`}
                    index={i + 1}
                    person={person}
                    row={row}
                    date={date}
                    onChanged={onChanged}
                  />
                )
                : (
                  <KeyedRow
                    // Remount when the day changes so no row keeps yesterday's draft.
                    key={`${person.id}-${date}`}
                    index={i + 1}
                    person={person}
                    row={row}
                    date={date}
                    onChanged={onChanged}
                  />
                )
            })}
          </tbody>
        </table>
      </div>

      {staff.length === 0 && (
        <div className="mt-3">
          <EmptyState message="No staff yet — add someone on the Staff tab." />
        </div>
      )}
    </>
  )
}

/** The department chips, matching how the Queues sheet shows them. */
function DepartmentCell({ person }: { person: StaffMember }) {
  if (person.departments.length === 0) return <span className="text-slate-400">—</span>
  return (
    <div className="flex flex-wrap gap-0.5">
      {person.departments.map((d) => (
        <span key={d.id} className="rounded border border-slate-300 bg-slate-50 px-1 text-[10px] font-bold leading-4 text-slate-700">
          {d.name}
        </span>
      ))}
    </div>
  )
}

// ── A day the bot recorded: clock times locked, break correctable ────────────────

function FetchedRow({
  index, person, row, date, onChanged,
}: {
  index: number
  person: StaffMember
  row: StaffAttendanceRow
  date: string
  onChanged: () => void
}) {
  const [breakMin, setBreakMin] = useState(String(row.break_min))
  const saving = useRef(false)

  // Hours follow the break as it is typed, so the correction can be seen before saving.
  const hours = netHours(row.login_at ?? '', row.logout_at ?? '', Number(breakMin || 0))

  const save = async () => {
    const next = Number(breakMin || 0)
    if (saving.current || next === row.break_min) return
    saving.current = true
    try {
      // The correction is addressed to the day, not to a row — the server creates the
      // override the first time and updates it after that.
      if (row.id !== null) await api.updateStaffAttendance(row.id, { break_min: next })
      else await api.createStaffAttendance({ staff_id: person.id, work_date: date, break_min: next })
      onChanged()
    } catch (err) {
      alert((err as Error).message)
      setBreakMin(String(row.break_min))
    } finally { saving.current = false }
  }

  const revert = async () => {
    if (row.id === null) return
    if (!confirm(`Put back the check-in bot's own break for ${person.name}?`)) return
    try {
      await api.deleteStaffAttendance(row.id)
      onChanged()
    } catch (err) { alert((err as Error).message) }
  }

  return (
    <tr className={rowCls}>
      <td className={idxCell}>{index}</td>
      <td className={cx(cellCls, 'font-semibold')}>{person.name}</td>
      <td className={cellCls}><DepartmentCell person={person} /></td>
      <td className={cellCls}><span className={lockedCls}>{clockLabel(row.login_at)}</span></td>
      <td className={cellCls}><span className={lockedCls}>{clockLabel(row.logout_at)}</span></td>
      <td className={cellCls}>
        <input
          value={breakMin}
          inputMode="numeric"
          title={row.break_edited ? 'Corrected here — the bot recorded a different total' : undefined}
          onChange={(e) => { if (/^\d*$/.test(e.target.value)) setBreakMin(e.target.value) }}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          className={cx(fieldCls, 'text-right tabular-nums', row.break_edited && editedCls)}
        />
      </td>
      <td className={cx(cellCls, 'text-center font-semibold tabular-nums')}>{hoursLabel(hours)}</td>
      <td className={cx(cellCls, 'capitalize')}>{row.status}</td>
      <td className="p-0">
        <div className="flex items-center justify-center">
          {row.break_edited ? (
            <button
              onClick={revert}
              title="Put back the check-in bot's own break"
              aria-label={`Put back the bot's break for ${person.name}`}
              className={removeBtnCls}
            >
              <RevertIcon />
            </button>
          ) : (
            <span className="text-slate-400" title="Fetched from the check-in bot"><LockIcon /></span>
          )}
        </div>
      </td>
    </tr>
  )
}

/** A corrected break is tinted, so a glance down the column shows which are not the bot's. */
const editedCls = 'border-amber-400 bg-amber-50 font-bold text-amber-900'

// ── A day keyed in here ─────────────────────────────────────────────────────────

interface Draft {
  login_at: string
  logout_at: string
  break_min: string
  status: string
}

const BLANK: Draft = { login_at: '', logout_at: '', break_min: '0', status: ATTENDANCE_STATUSES[0] }

const draftOf = (row: StaffAttendanceRow | null): Draft => row === null ? { ...BLANK } : {
  login_at: row.login_at ?? '',
  logout_at: row.logout_at ?? '',
  break_min: String(row.break_min),
  status: row.status,
}

/**
 * A row for someone the bot has no record of today. It saves on the first edit — an
 * untouched row is never written, so a roster of thirty people doesn't create thirty empty
 * rows just by being looked at.
 */
function KeyedRow({
  index, person, row, date, onChanged,
}: {
  index: number
  person: StaffMember
  /** Their saved hand-keyed row, or null when nothing is recorded for the day yet. */
  row: StaffAttendanceRow | null
  date: string
  onChanged: () => void
}) {
  const saved = draftOf(row)
  const [draft, setDraft] = useState<Draft>(saved)
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)

  const hours = netHours(draft.login_at, draft.logout_at, Number(draft.break_min || 0))

  const save = async (over?: Partial<Draft>) => {
    const next = { ...draft, ...over }
    const changed = (Object.keys(next) as (keyof Draft)[]).some((k) => next[k] !== saved[k])
    if (saving.current || !changed) return
    saving.current = true
    try {
      const payload = {
        login_at: next.login_at === '' ? null : next.login_at,
        logout_at: next.logout_at === '' ? null : next.logout_at,
        break_min: Number(next.break_min || 0),
        status: next.status,
      }
      if (row?.id != null) await api.updateStaffAttendance(row.id, payload)
      else await api.createStaffAttendance({ staff_id: person.id, work_date: date, ...payload })
      onChanged()
    } catch (err) {
      alert((err as Error).message)
      setDraft(saved)
    } finally { saving.current = false }
  }

  const remove = async () => {
    if (row?.id == null) return
    if (!confirm(`Clear ${person.name}'s entry for this day?`)) return
    try {
      await api.deleteStaffAttendance(row.id)
      onChanged()
    } catch (err) { alert((err as Error).message) }
  }

  // Save once focus has left the row entirely, not on every cell-to-cell hop.
  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className={row === null ? addRowCls : rowCls}>
      <td className={cx(idxCell, row === null && 'text-slate-400')}>{index}</td>
      <td className={cx(cellCls, 'font-semibold')}>{person.name}</td>
      <td className={cellCls}><DepartmentCell person={person} /></td>
      <td className={cellCls}>
        <input
          type="time"
          value={draft.login_at}
          onChange={(e) => setDraft({ ...draft, login_at: e.target.value })}
          className={fieldCls}
        />
      </td>
      <td className={cellCls}>
        <input
          type="time"
          value={draft.logout_at}
          onChange={(e) => setDraft({ ...draft, logout_at: e.target.value })}
          className={fieldCls}
        />
      </td>
      <td className={cellCls}>
        <input
          value={draft.break_min}
          inputMode="numeric"
          onChange={(e) => { if (/^\d*$/.test(e.target.value)) setDraft({ ...draft, break_min: e.target.value }) }}
          className={cx(fieldCls, 'text-right tabular-nums')}
        />
      </td>
      <td className={cx(cellCls, 'text-center font-semibold tabular-nums')}>{hoursLabel(hours)}</td>
      <td className={cellCls}>
        <select
          value={draft.status}
          onChange={(e) => { setDraft({ ...draft, status: e.target.value }); save({ status: e.target.value }) }}
          className={cx(fieldCls, 'capitalize')}
        >
          {ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td className="p-0">
        <div className="flex items-center justify-center">
          {row !== null && (
            <button
              onClick={remove}
              title={`Clear ${person.name}'s entry`}
              aria-label={`Clear ${person.name}'s entry`}
              className={removeBtnCls}
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
