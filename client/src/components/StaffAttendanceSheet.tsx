import { useRef, useState } from 'react'
import { api } from '../api/client'
import {
  ATTENDANCE_STATUSES, clockLabel, earlyBy, gapLabel, hoursLabel, impliedStatus, lateBy,
  netHours, punctuality,
} from '../lib/staff'
import type { StaffAttendanceRow, StaffMember } from '../types'
import PunctualityBadge from './PunctualityBadge'
import {
  addRowCls, cellCls, fieldCls, headCls, idxCell, removeBtnCls, rowCls, tableCls, theadCls,
} from './sheet'
import { RevertIcon, TrashIcon } from './sheetIcons'
import { EmptyState, cx } from './ui'

/**
 * One day's attendance for the whole roster — a row per staff member for the selected
 * date, the way the Attendance page's daily roster reads.
 *
 * EVERY row is editable, whether or not the check-in bot recorded the day. A day the bot
 * recorded arrives filled in from its record; the first edit stores a row beside it that
 * REPLACES that day, and the Attendance page reads the same replacement, so the two pages
 * never disagree. The bot's own tables are never written to, which is what lets the revert
 * button put its untouched record back.
 *
 * Everyone the bot didn't record gets an empty row that saves itself on the first edit —
 * an untouched row is never written, so looking at a roster of thirty doesn't create thirty
 * empty records.
 *
 * Each clock cell is marked against the hours that person is expected to keep, set on the
 * Staff tab. Anyone with no schedule there is never marked.
 *
 * The Flag column turns those two marks into one verdict per day — on time, late in, early
 * out, or both — so the sheet can be read down a single column, and the day that went wrong
 * at BOTH ends stands out from the day that only went wrong at one.
 *
 * Status shows what is stored for the day, and where nothing is, what the clock times imply
 * — greyed and italic, because it is a reading rather than a decision. That is what keeps
 * the column honest against the counts above it: a row nobody has touched says "absent",
 * not "present", and someone still at their desk says "still in".
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
            <col style={{ width: '5%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '5%' }} />
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
              <th className={headCls}>Flag</th>
              <th className={headCls}>Status</th>
              <th className={headCls} aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {staff.map((person, i) => (
              <DayRow
                // Remount when the day changes so no row keeps yesterday's draft.
                key={`${person.id}-${date}`}
                index={i + 1}
                person={person}
                row={byStaff.get(person.id) ?? null}
                date={date}
                onChanged={onChanged}
              />
            ))}
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

interface Draft {
  login_at: string
  logout_at: string
  break_min: string
  status: string
}

/**
 * An untouched row. The status is EMPTY rather than "present": nothing is on record for
 * this person yet, and a sheet that opens claiming the whole roster is present is the one
 * thing it must not do. What shows in the cell is read off the clock times instead — see
 * impliedStatus — until somebody stores a status of their own.
 */
const BLANK: Draft = { login_at: '', logout_at: '', break_min: '0', status: '' }

const draftOf = (row: StaffAttendanceRow | null): Draft => row === null ? { ...BLANK } : {
  login_at: row.login_at ?? '',
  logout_at: row.logout_at ?? '',
  break_min: String(row.break_min),
  status: row.status,
}

/**
 * One person's day. The row may be the bot's record, a record that replaces it, a
 * hand-keyed day, or nothing at all — and in every case it is edited the same way.
 */
function DayRow({
  index, person, row, date, onChanged,
}: {
  index: number
  person: StaffMember
  /** What is on record for this person and day, from either source; null if nothing is. */
  row: StaffAttendanceRow | null
  date: string
  onChanged: () => void
}) {
  const saved = draftOf(row)
  const [draft, setDraft] = useState<Draft>(saved)
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)

  // Hours and the schedule marks all follow the clock times as they are typed, so a
  // correction can be seen before it saves.
  const hours = netHours(draft.login_at, draft.logout_at, Number(draft.break_min || 0))
  const late = lateBy(draft.login_at || null, person.expected_login)
  const early = earlyBy(draft.logout_at || null, person.expected_logout)
  const flag = punctuality(late, early)

  // The status on show: the one stored for this day, or — where none is — the one the
  // clock times imply, which moves with them as the row is typed. Either way it is a real
  // value, so what saves is what was on screen.
  const status = draft.status === ''
    ? impliedStatus(draft.login_at || null, draft.logout_at || null)
    : draft.status

  // A day the bot recorded that nobody has touched yet: the revert control has nothing to
  // undo, and a first edit will create the record that replaces it.
  const fromBot = row?.source === 'fetched'
  const overridden = fromBot && row.edited

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
        // A row saved before anyone picked a status stores the one its clock times imply —
        // the one that was showing in the cell. The column never records something other
        // than what the person keying it in was looking at.
        status: next.status === ''
          ? impliedStatus(next.login_at || null, next.logout_at || null)
          : next.status,
      }
      // The whole row is sent every time, so the record that replaces a bot day is complete
      // from the moment it exists rather than a patch that has to be merged.
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
    const question = overridden
      ? `Put back the check-in bot's own record for ${person.name}?`
      : `Clear ${person.name}'s entry for this day?`
    if (!confirm(question)) return
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
          className={cx(fieldCls, overridden && editedCls)}
        />
        <ScheduleMark minutes={late} word="late" expected={person.expected_login} />
      </td>
      <td className={cellCls}>
        <input
          type="time"
          value={draft.logout_at}
          onChange={(e) => setDraft({ ...draft, logout_at: e.target.value })}
          className={cx(fieldCls, overridden && editedCls)}
        />
        <ScheduleMark minutes={early} word="early" expected={person.expected_logout} />
      </td>
      <td className={cellCls}>
        <input
          value={draft.break_min}
          inputMode="numeric"
          onChange={(e) => { if (/^\d*$/.test(e.target.value)) setDraft({ ...draft, break_min: e.target.value }) }}
          className={cx(fieldCls, 'text-right tabular-nums', overridden && editedCls)}
        />
      </td>
      <td className={cx(cellCls, 'text-center font-semibold tabular-nums')}>{hoursLabel(hours)}</td>
      <td className={cx(cellCls, 'text-center')}><PunctualityBadge flag={flag} compact /></td>
      <td className={cellCls}>
        <select
          value={status}
          onChange={(e) => { setDraft({ ...draft, status: e.target.value }); save({ status: e.target.value }) }}
          className={cx(
            fieldCls, 'capitalize', overridden && editedCls,
            // An implied status is greyed: it says what the clock times mean, not what
            // anybody decided, and nothing has been written for this day.
            draft.status === '' && 'text-slate-500 italic',
          )}
        >
          {ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td className="p-0">
        <div className="flex items-center justify-center">
          {row !== null && (
            <button
              onClick={remove}
              title={overridden
                ? "Put back the check-in bot's own record"
                : `Clear ${person.name}'s entry`}
              aria-label={overridden
                ? `Put back the bot's record for ${person.name}`
                : `Clear ${person.name}'s entry`}
              className={removeBtnCls}
            >
              {overridden ? <RevertIcon /> : <TrashIcon />}
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

/**
 * A day that has been corrected over the bot's record is tinted, so a glance down the sheet
 * shows which figures are no longer the bot's own.
 */
const editedCls = 'border-amber-400 bg-amber-50 font-semibold text-amber-900'

/**
 * How far a clock time missed the hours the person is expected to keep, sitting under the
 * cell it judges. It is deliberately separate from the amber tint above: that says WHO
 * wrote the figure, this says whether the figure is on schedule, and a corrected day can
 * of course still be late.
 *
 * Nothing is shown for a day that is on time, and nothing at all for a person with no
 * schedule set — a blank cell there means "not expected at any particular hour", not
 * "always on time".
 */
function ScheduleMark({ minutes, word, expected }: {
  minutes: number | null
  word: 'late' | 'early'
  /** The time being judged against, for the tooltip; null when no schedule is set. */
  expected: string | null
}) {
  if (minutes === null || minutes === 0) return null
  return (
    <span
      title={`${gapLabel(minutes)} ${word} — expected ${clockLabel(expected)}`}
      className="mt-0.5 block truncate text-center text-[10px] font-bold leading-3 text-rose-700"
    >
      {gapLabel(minutes)} {word}
    </span>
  )
}
