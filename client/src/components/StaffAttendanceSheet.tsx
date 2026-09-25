import { useRef, useState } from 'react'
import { api } from '../api/client'
import { PerformerBadge } from '../lib/performers'
import {
  ATTENDANCE_STATUSES, clockLabel, earlyBy, emptyLoginTally, gapLabel, hoursLabel,
  impliedStatus, lateBy, netHours, punctuality, type LoginTally,
} from '../lib/staff'
import type { AttendanceDay, StaffAttendanceRow, StaffMember } from '../types'
import PunctualityBadge from './PunctualityBadge'
import {
  addRowCls, cellCls, fieldCls, headCls, idxCell, removeBtnCls, rowCls, tableCls, theadCls,
} from './sheet'
import { RevertIcon, TrashIcon } from './sheetIcons'
import { EmptyState, cx } from './ui'

/**
 * One day's attendance for the whole roster — the Attendance page's day sheet, and the only
 * attendance table in the CRM.
 *
 * EVERY row is editable, whether or not the check-in bot recorded the day. A day the bot
 * recorded arrives filled in from its record; the first edit stores a row beside it that
 * REPLACES that day, and every other attendance figure in the app — this page's cards, the
 * Staff Summary, the reports, the Dashboard — reads the same replacement, so no two screens
 * can disagree about a day. The bot's own tables are never written to, which is what lets
 * the revert button put its untouched record back.
 *
 * Everyone the bot didn't record gets an empty row that saves itself on the first edit —
 * an untouched row is never written, so looking at a roster of thirty doesn't create thirty
 * empty records.
 *
 * Each clock cell is marked against the hours that person is expected to keep, set on the
 * Staff page. Anyone with no schedule there is never marked.
 *
 * The Flag column turns those two marks into one verdict per day — on time, late in, early
 * out, or both — so the sheet can be read down a single column, and the day that went wrong
 * at BOTH ends stands out from the day that only went wrong at one.
 *
 * Status shows what is stored for the day, and where nothing is, what the clock times imply
 * — greyed and italic, because it is a reading rather than a decision. That is what keeps
 * the column honest against the counts above it: a row nobody has touched says "absent",
 * not "present", and someone still at their desk says "still in".
 *
 * The Late column is the one figure here that is NOT about the day on screen: it is how
 * many times that person has logged in late so far this month. A single late morning is
 * rarely the point — the sixth one is — and reading it off a day sheet otherwise means
 * opening thirty of them.
 *
 * What the bot knows and this app doesn't — how many breaks were taken and for how long,
 * how late anyone came back from one, who is online right now — rides along in the Break
 * and Name cells, so the sheet carries the whole day rather than half of it.
 */
export default function StaffAttendanceSheet({
  date, rows, staff, monthTallies, monthLabel, bot, online, breakAllowanceMin = 60,
  onBreakDetail, onChanged,
}: {
  /** The day being shown, "YYYY-MM-DD". */
  date: string
  rows: StaffAttendanceRow[]
  staff: StaffMember[]
  /** Each person's late / on-time logins over the month this day falls in, by staff id. */
  monthTallies: Map<number, LoginTally>
  /** That month, worded — for the column heading and its tooltips. */
  monthLabel: string
  /** The bot's own record of the same day, by staff id — breaks, returns, its account. */
  bot?: Map<number, AttendanceDay>
  /** The bot accounts checked in right now. */
  online?: Set<string>
  breakAllowanceMin?: number
  /** Open the break breakdown for a day the bot recorded breaks on. */
  onBreakDetail?: (row: AttendanceDay) => void
  onChanged: () => void
}) {
  const byStaff = new Map(rows.map((r) => [r.staff_id, r]))

  return (
    <>
      <div className="overflow-x-auto">
        <table className={cx(tableCls, 'min-w-5xl')}>
          <colgroup>
            <col style={{ width: '4%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '4%' }} />
          </colgroup>
          <thead>
            <tr className={theadCls}>
              <th className={headCls}>Sr. No.</th>
              <th className={headCls}>Name</th>
              <th className={headCls}>Department</th>
              <th className={headCls}>Login</th>
              <th className={headCls}>Logout</th>
              <th className={headCls} title={`Late logins in ${monthLabel}`}>Late logins<br />{monthLabel}</th>
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
                // A row seeds its editable draft once, at mount, so the key has to change
                // whenever the values behind it do — not only on a new day, but every time
                // the server answers with something different for the SAME day. Without
                // the signature a row goes on showing what it showed before: Refresh
                // would pull a login the bot has since recorded and change nothing on
                // screen, and a day that rolled over would keep the previous day's times.
                key={`${person.id}-${date}-${signature(byStaff.get(person.id) ?? null)}`}
                index={i + 1}
                person={person}
                row={byStaff.get(person.id) ?? null}
                date={date}
                monthTally={monthTallies.get(person.id) ?? emptyLoginTally()}
                monthLabel={monthLabel}
                bot={bot?.get(person.id) ?? null}
                online={online}
                breakAllowanceMin={breakAllowanceMin}
                onBreakDetail={onBreakDetail}
                onChanged={onChanged}
              />
            ))}
          </tbody>
        </table>
      </div>

      {staff.length === 0 && (
        <div className="mt-3">
          <EmptyState message="No staff yet — add someone on the Staff Management page." />
        </div>
      )}
    </>
  )
}

/**
 * Everything about a row that a fresh fetch could have changed, as one string.
 *
 * It goes in the React key, so a row is rebuilt from the server's values whenever they
 * differ and left alone whenever they don't — which is what keeps a half-typed correction
 * from being thrown away by an unrelated reload, while still letting Refresh actually show
 * what it fetched.
 */
const signature = (row: StaffAttendanceRow | null): string => row === null ? 'none' : [
  row.id, row.source, row.edited, row.login_at, row.logout_at, row.break_min, row.status,
].join('|')

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

/**
 * The colour each status is worn in, everywhere a status is shown. Green is a full day at
 * work, amber a partial one, violet an agreed day off, rose an unexplained one, and blue
 * somebody still at their desk — so a column of statuses can be read down without reading
 * a single word of it.
 */
const STATUS_TONE: Record<string, string> = {
  'present':  'border-emerald-400 bg-emerald-50 text-emerald-800',
  'still in': 'border-sky-400 bg-sky-50 text-sky-800',
  'half day': 'border-amber-400 bg-amber-50 text-amber-900',
  'leave':    'border-violet-400 bg-violet-50 text-violet-800',
  'holiday':  'border-slate-300 bg-slate-100 text-slate-600',
  'absent':   'border-rose-400 bg-rose-50 text-rose-800',
}

const statusTone = (status: string): string =>
  STATUS_TONE[status.trim().toLowerCase()] ?? 'border-slate-300 bg-white text-slate-700'

/** The same tag outside the sheet — the cards above it, and anywhere a day is quoted. */
export function StatusTag({ status, implied = false, className }: {
  status: string
  /** True when nothing is stored and this is only what the clock times mean. */
  implied?: boolean
  className?: string
}) {
  if (!status) return <span className="text-slate-300">—</span>
  return (
    <span
      title={implied ? `Nothing stored for this day — its times read as "${status}"` : undefined}
      className={cx(
        'inline-flex items-center whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase leading-4 tracking-wide',
        statusTone(status), implied && 'opacity-60', className,
      )}
    >
      {status}
    </span>
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
  index, person, row, date, monthTally, monthLabel, bot, online, breakAllowanceMin,
  onBreakDetail, onChanged,
}: {
  index: number
  person: StaffMember
  /** What is on record for this person and day, from either source; null if nothing is. */
  row: StaffAttendanceRow | null
  date: string
  /** This person's late / on-time logins across the whole month — see the Late column. */
  monthTally: LoginTally
  monthLabel: string
  /** The bot's own record of this day, for the things only it knows. */
  bot: AttendanceDay | null
  online?: Set<string>
  breakAllowanceMin: number
  onBreakDetail?: (row: AttendanceDay) => void
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
  const isOnline = bot?.user_id != null && (online?.has(bot.user_id) ?? false)
  const overBreak = Math.max(0, Number(draft.break_min || 0) - breakAllowanceMin)

  const save = async (over?: Partial<Draft>) => {
    const next = { ...draft, ...over }
    const changed = (Object.keys(next) as (keyof Draft)[]).some((k) => next[k] !== saved[k])
    if (saving.current || !changed) return
    saving.current = true
    try {
      // The break is only sent when it was typed. Blank means none of its own, so a
      // bot-recorded day keeps showing the bot's total; and the first correction of an
      // untouched bot day must not freeze the bot's figure that was merely on display.
      const breakTyped = next.break_min !== saved.break_min
      const breakField: { break_min?: number | null } = breakTyped
        ? { break_min: next.break_min === '' ? null : Number(next.break_min) }
        : fromBot && !row.edited ? { break_min: null } : {}
      const payload = {
        login_at: next.login_at === '' ? null : next.login_at,
        logout_at: next.logout_at === '' ? null : next.logout_at,
        ...breakField,
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
      <td className={cx(cellCls, 'font-semibold')}>
        <span className="flex items-center gap-1">
          {/* The bot's live state, where it knows this person at all. */}
          {bot && (
            <span
              title={isOnline ? `${person.name} is checked in right now` : `Not checked in · bot account ${bot.user_id}`}
              className={cx('h-1.5 w-1.5 shrink-0 rounded-full', isOnline ? 'bg-emerald-500' : 'bg-slate-300')}
            />
          )}
          <span className="truncate" title={bot?.username ? `@${bot.username}` : undefined}>{person.name}</span>
          <PerformerBadge staffId={person.id} compact />
        </span>
      </td>
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
      <td className={cx(cellCls, 'text-center')}>
        <LateMonthCount tally={monthTally} monthLabel={monthLabel} name={person.name} />
      </td>
      <td className={cellCls}>
        <input
          value={draft.break_min}
          inputMode="numeric"
          title={`Minutes on break · ${breakAllowanceMin}m allowed`}
          onChange={(e) => { if (/^\d*$/.test(e.target.value)) setDraft({ ...draft, break_min: e.target.value }) }}
          className={cx(
            fieldCls, 'text-right tabular-nums',
            overridden ? editedCls : overBreak > 0 && 'border-rose-400 bg-rose-50 font-semibold text-rose-800',
          )}
        />
        <BreakNote bot={bot} overMin={overBreak} onOpen={onBreakDetail} />
      </td>
      <td className={cx(cellCls, 'text-center font-semibold tabular-nums')}>{hoursLabel(hours)}</td>
      <td className={cx(cellCls, 'text-center')}><PunctualityBadge flag={flag} compact /></td>
      <td className={cellCls}>
        <select
          value={status}
          onChange={(e) => { setDraft({ ...draft, status: e.target.value }); save({ status: e.target.value }) }}
          title={draft.status === ''
            ? 'Nothing stored for this day — this is what its clock times mean'
            : `Stored for this day${overridden ? ", replacing the bot's own record" : ''}`}
          className={cx(
            fieldCls, 'border font-bold uppercase tracking-wide', statusTone(status),
            // An implied status is faded: it says what the clock times mean, not what
            // anybody decided, and nothing has been written for this day.
            draft.status === '' && 'opacity-60 italic',
          )}
        >
          {ATTENDANCE_STATUSES.map((s) => <option key={s} value={s} className="bg-white font-semibold normal-case text-slate-900">{s}</option>)}
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
 * What the bot logged under the break cell: how many breaks were taken, how far past the
 * allowance the day ran, and how late anyone came back from one.
 *
 * The minutes above are editable and the correction decides the day's total; these are the
 * bot's own record of how that total was spent, which no correction re-times. Click to see
 * each break.
 */
function BreakNote({ bot, overMin, onOpen }: {
  bot: AttendanceDay | null
  /** Minutes past the allowance, from the figure in the cell above. */
  overMin: number
  onOpen?: (row: AttendanceDay) => void
}) {
  const parts = [
    bot && bot.break_count > 0 && `${bot.break_count} break${bot.break_count > 1 ? 's' : ''}`,
    overMin > 0 && `+${gapLabel(overMin)} over`,
    bot && bot.late_return_min > 0 && `back +${gapLabel(bot.late_return_min)}`,
    bot?.on_break && 'out now',
  ].filter(Boolean) as string[]
  if (parts.length === 0) return null
  const label = parts.join(' · ')
  const tone = overMin > 0 || (bot?.late_return_min ?? 0) > 0 ? 'text-rose-700' : 'text-slate-500'
  if (!bot || bot.break_count === 0 || !onOpen) {
    return <span className={cx('mt-0.5 block truncate text-center text-[10px] font-bold leading-3', tone)}>{label}</span>
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(bot)}
      title={`Breaks: ${bot.break_detail || '—'} · click for each one`}
      className={cx('mt-0.5 block w-full truncate text-center text-[10px] font-bold leading-3 underline decoration-dotted underline-offset-2 hover:text-brand', tone)}
    >
      {label}
    </button>
  )
}

/**
 * How many times this person has logged in late so far this month, out of the logins they
 * have recorded in it.
 *
 * It is the one red-filled cell on the sheet, and deliberately so: the day's own marks are
 * small rose captions under the clock cells, which is right for something that may be a
 * one-off, while a month's worth of late mornings is a pattern and should be the thing the
 * eye lands on. Nobody late reads as a quiet dash rather than a green badge, so the column
 * stays empty-looking until there is something in it to find.
 */
function LateMonthCount({ tally, monthLabel, name }: {
  tally: LoginTally
  monthLabel: string
  name: string
}) {
  if (tally.judged === 0) {
    return <span title={`No logins recorded for ${name} in ${monthLabel}`} className="text-slate-400">—</span>
  }
  if (tally.late === 0) {
    return (
      <span title={`${name} was on time for all ${tally.judged} logins in ${monthLabel}`} className="font-semibold text-emerald-700">
        0<span className="font-normal text-slate-400">/{tally.judged}</span>
      </span>
    )
  }
  return (
    <span
      title={`${name}: ${tally.late} late login${tally.late === 1 ? '' : 's'} of ${tally.judged} in ${monthLabel}`
        + ` · ${gapLabel(tally.lateMin)} lost · worst ${gapLabel(tally.worstLateMin)}`}
      className="inline-flex items-center rounded border border-rose-400 bg-rose-100 px-1.5 py-0.5 font-bold tabular-nums text-rose-800"
    >
      {tally.late}
      <span className="font-medium text-rose-500">/{tally.judged}</span>
    </span>
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
