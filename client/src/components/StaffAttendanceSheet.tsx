import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api/client'
import type { DayView } from '../lib/attendanceDay'
import { PerformerBadge } from '../lib/performers'
import {
  ATTENDANCE_STATUSES, clockLabel, earlyBy, emptyLoginTally, gapLabel, hoursLabel,
  impliedStatus, lateBy, netHours, punctuality, type LoginTally, type Punctuality,
} from '../lib/staff'
import type { AttendanceDay, StaffAttendanceRow, StaffMember } from '../types'
import { EmptyState, cx } from './ui'

/**
 * One day's attendance for the whole roster — the Attendance page's day sheet, and the only
 * attendance table in the CRM.
 *
 * The table READS the day: plain clock times, with how far each missed the schedule
 * underneath, so a column can be scanned. The status pill on each row changes the day's
 * status in place; everything else is corrected through the ⋮ button, which opens the day in
 * an editor — login, logout, break and status, the bot's breaks, and the way back to the
 * bot's own record.
 *
 * What is keyed in REPLACES that day everywhere in the app — this page's cards, the Staff
 * Summary, the reports, the Dashboard. The bot's own tables are never written to, which is
 * what lets "Put back the bot's record" undo a correction.
 *
 * A row the bot and the clock times disagree about (online with no login, a break with no
 * login, a logout after midnight…) is tinted amber and its flag says what to check.
 *
 * Somebody on leave that day (on the Leaves sheet, or with the status set to "leave") is
 * never marked: an empty row reads "leave" rather than "absent", and no login on it is
 * called late — nor logout early.
 *
 * The Late column is the one figure here that is NOT about the day on screen: it is how many
 * times that person has logged in late so far this month, out of their logins.
 */
export default function StaffAttendanceSheet({
  date, days, monthTallies, monthLabel, monthShort, breakAllowanceMin = 60, onBreakDetail, onChanged,
}: {
  /** The day being shown, "YYYY-MM-DD". */
  date: string
  /** The rows to show, already filtered. */
  days: DayView[]
  /** Each person's late / on-time logins over the month this day falls in, by staff id. */
  monthTallies: Map<number, LoginTally>
  /** That month, worded — for tooltips. */
  monthLabel: string
  /** That month, short ("Nov") — for the column heading. */
  monthShort: string
  breakAllowanceMin?: number
  /** Open the break breakdown for a day the bot recorded breaks on. */
  onBreakDetail?: (row: AttendanceDay) => void
  onChanged: () => void
}) {
  // The day open for correction and the ⋮ button it hangs from. The same button closes it.
  const [editing, setEditing] = useState<{ day: DayView; anchor: HTMLElement } | null>(null)
  const toggleEdit = (day: DayView, anchor: HTMLElement) =>
    setEditing((cur) => (cur?.anchor === anchor ? null : { day, anchor }))

  return (
    <>
      <div className="overflow-x-auto">
        <table className="table-dash w-full min-w-[68rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="w-10 font-semibold">#</th>
              <th className="font-semibold">Name</th>
              <th className="font-semibold">Department</th>
              <th className="font-semibold">Login</th>
              <th className="font-semibold">Logout</th>
              <th className="font-semibold">Break</th>
              <th className="font-semibold">Hours</th>
              <th className="font-semibold" title={`Late logins in ${monthLabel}, out of the logins recorded`}>Late · {monthShort}</th>
              <th className="font-semibold">Flag</th>
              <th className="font-semibold">Status</th>
              <th className="w-8" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => (
              <DayRow
                key={`${d.person.id}-${date}`}
                index={i + 1}
                day={d}
                date={date}
                monthTally={monthTallies.get(d.person.id) ?? emptyLoginTally()}
                monthLabel={monthLabel}
                breakAllowanceMin={breakAllowanceMin}
                onBreakDetail={onBreakDetail}
                editOpen={editing?.day.person.id === d.person.id}
                onEdit={(anchor) => toggleEdit(d, anchor)}
                onChanged={onChanged}
              />
            ))}
          </tbody>
        </table>
      </div>

      {days.length === 0 && (
        <div className="mt-3">
          <EmptyState message="Nobody matches — clear the search or pick another tab." />
        </div>
      )}

      {editing && (
        <DayEditPopover
          // A new row is a new form: reopening on someone else starts from their record.
          key={editing.day.person.id}
          day={editing.day}
          anchor={editing.anchor}
          date={date}
          breakAllowanceMin={breakAllowanceMin}
          onBreakDetail={onBreakDetail}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged() }}
        />
      )}
    </>
  )
}

// ─── Status vocabulary ─────────────────────────────────────────────────────────

/** Sentence-case labels for the stored statuses. */
const STATUS_LABEL: Record<string, string> = {
  'present': 'Present',
  'still in': 'Still in',
  'half day': 'Half day',
  'leave': 'Leave',
  'holiday': 'Holiday',
  'absent': 'Absent',
}
const statusLabel = (s: string) => STATUS_LABEL[s.trim().toLowerCase()] ?? s

/**
 * The colour each status is worn in. Navy is somebody still at their desk, green a day
 * worked, amber a partial one, violet an agreed day off, and grey nothing recorded — absence
 * is the quiet default, and the red is saved for the things that need chasing.
 */
const PILL_TONE: Record<string, string> = {
  'still in': 'bg-brand/10 text-brand',
  'present':  'bg-emerald-50 text-emerald-800',
  'half day': 'bg-amber-50 text-amber-800',
  'leave':    'bg-violet-50 text-violet-700',
  'holiday':  'bg-slate-100 text-slate-600',
  'absent':   'bg-slate-100 text-slate-500',
}
const pillTone = (s: string) => PILL_TONE[s.trim().toLowerCase()] ?? 'bg-slate-100 text-slate-700'

/** The same status as a static tag, for anywhere a day is quoted outside the sheet. */
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
        'inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold',
        pillTone(status), implied && 'opacity-70', className,
      )}
    >
      {statusLabel(status)}
    </span>
  )
}

// ─── Saving ────────────────────────────────────────────────────────────────────

interface Draft {
  login_at: string
  logout_at: string
  break_min: string
  status: string
}

const draftOf = (row: StaffAttendanceRow | null): Draft => row === null
  ? { login_at: '', logout_at: '', break_min: '0', status: '' }
  : { login_at: row.login_at ?? '', logout_at: row.logout_at ?? '', break_min: String(row.break_min), status: row.status }

/**
 * Store a day. The whole row is sent every time, so the record that replaces a bot day is
 * complete from the moment it exists. A row saved before anyone picked a status stores the
 * one its clock times imply — the one that was on screen.
 */
async function saveDay(day: DayView, date: string, next: Draft): Promise<void> {
  const saved = draftOf(day.row)
  const fromBot = day.row?.source === 'fetched'
  // The break is only sent when it was changed. Blank means none of its own, so a bot day
  // keeps showing the bot's total; the first correction of an untouched bot day must not
  // freeze the bot's figure that was merely on display.
  const breakTyped = next.break_min !== saved.break_min
  const breakField: { break_min?: number | null } = breakTyped
    ? { break_min: next.break_min === '' ? null : Number(next.break_min) }
    : fromBot && !day.row?.edited ? { break_min: null } : {}
  const payload = {
    login_at: next.login_at === '' ? null : next.login_at,
    logout_at: next.logout_at === '' ? null : next.logout_at,
    ...breakField,
    status: next.status === ''
      ? impliedStatus(next.login_at || null, next.logout_at || null, day.leaveCovered)
      : next.status,
  }
  if (day.row?.id != null) await api.updateStaffAttendance(day.row.id, payload)
  else await api.createStaffAttendance({ staff_id: day.person.id, work_date: date, ...payload })
}

// ─── Row ───────────────────────────────────────────────────────────────────────

function DayRow({ index, day, date, monthTally, monthLabel, breakAllowanceMin, onBreakDetail, editOpen, onEdit, onChanged }: {
  index: number
  day: DayView
  date: string
  monthTally: LoginTally
  monthLabel: string
  breakAllowanceMin: number
  onBreakDetail?: (row: AttendanceDay) => void
  /** This row's correction popover is open. */
  editOpen: boolean
  /** Open (or close) the correction popover, anchored to the ⋮ button. */
  onEdit: (anchor: HTMLElement) => void
  onChanged: () => void
}) {
  const { person, bot, login, logout } = day
  const [busy, setBusy] = useState(false)
  const worked = login !== null

  const changeStatus = async (status: string) => {
    setBusy(true)
    try {
      await saveDay(day, date, { ...draftOf(day.row), status })
      onChanged()
    } catch (err) {
      alert((err as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <tr className={cx('border-b border-slate-100 last:border-b-0', day.review && 'bg-amber-50/70')}>
      <td className="text-xs tabular-nums text-slate-500">{index}</td>
      <td className="max-w-[13rem]">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            title={day.online ? 'Checked in right now' : undefined}
            className={cx('h-1.5 w-1.5 shrink-0 rounded-full', day.online ? 'bg-emerald-500' : worked ? 'bg-slate-300' : 'bg-transparent')}
          />
          <span
            className={cx('truncate text-[13px]', worked ? 'font-semibold text-slate-900' : 'text-slate-600')}
            title={bot?.username ? `@${bot.username}` : undefined}
          >
            {person.name}
          </span>
          <PerformerBadge staffId={person.id} compact />
        </span>
      </td>
      <td><DepartmentCell person={person} /></td>
      <td>
        <ClockCell at={login} />
        <ScheduleMark minutes={day.lateMin} word="late" expected={person.expected_login} tone="text-red-600" />
      </td>
      <td>
        {login && !logout ? <span className="text-[13px] text-slate-500">Not yet</span> : <ClockCell at={logout} />}
        <ScheduleMark minutes={day.earlyMin} word="early" expected={person.expected_logout} tone="text-amber-700" />
      </td>
      <td><BreakCell day={day} allowance={breakAllowanceMin} onOpen={onBreakDetail} /></td>
      <td className="text-[13px] tabular-nums text-slate-900">{hoursLabel(day.hours)}</td>
      <td><LateMonthCount tally={monthTally} monthLabel={monthLabel} name={person.name} /></td>
      <td><FlagCell day={day} /></td>
      <td>
        <label className="relative inline-flex">
          <select
            value={day.status}
            disabled={busy}
            onChange={(e) => changeStatus(e.target.value)}
            aria-label={`Status for ${person.name}`}
            title={day.statusSet
              ? `Stored for this day${day.row?.source === 'fetched' && day.row.edited ? ", replacing the bot's own record" : ''}`
              : day.leaveCovered
              ? 'On leave per the Leaves sheet — not counted as absent or late'
              : 'Nothing stored for this day — this is what its clock times mean'}
            className={cx(
              'cursor-pointer appearance-none rounded-md py-1 pl-2 pr-6 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:opacity-60',
              pillTone(day.status),
            )}
          >
            {ATTENDANCE_STATUSES.map((s) => <option key={s} value={s} className="bg-white text-slate-900">{statusLabel(s)}</option>)}
          </select>
          <svg className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 opacity-70" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </label>
      </td>
      <td className="text-right">
        <button
          type="button"
          onClick={(e) => onEdit(e.currentTarget)}
          data-day-anchor
          title={`Correct ${person.name}'s day`}
          aria-label={`Correct ${person.name}'s day`}
          aria-haspopup="dialog"
          aria-expanded={editOpen}
          className={cx(
            'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
            editOpen ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
          )}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
          </svg>
        </button>
      </td>
    </tr>
  )
}

/** Department chips: hairline outline, small, so a person in three departments still fits. */
function DepartmentCell({ person }: { person: StaffMember }) {
  if (person.departments.length === 0) return <span className="text-slate-400">—</span>
  return (
    <div className="flex max-w-[11rem] flex-wrap gap-1">
      {person.departments.map((d) => (
        <span key={d.id} className="whitespace-nowrap rounded border border-slate-200 bg-white px-1.5 text-[11px] leading-[18px] text-slate-600">
          {d.name}
        </span>
      ))}
    </div>
  )
}

function ClockCell({ at }: { at: string | null }) {
  if (!at) return <span className="text-slate-400">—</span>
  return <span className="whitespace-nowrap text-[13px] tabular-nums text-slate-900">{clockLabel(at).replace(/^(\d):/, '0$1:')}</span>
}

/**
 * How far a clock time missed the schedule, under the time it judges. Nothing for on time,
 * and nothing for a person with no schedule — a blank there means "not expected at any
 * particular hour", not "always on time".
 */
function ScheduleMark({ minutes, word, expected, tone }: {
  minutes: number | null
  word: 'late' | 'early'
  expected: string | null
  tone: string
}) {
  if (minutes === null || minutes === 0) return null
  return (
    <span title={`${gapLabel(minutes)} ${word} — expected ${clockLabel(expected)}`} className={cx('block whitespace-nowrap text-[11px] font-medium', tone)}>
      {gapLabel(minutes)} {word}
    </span>
  )
}

/** "30 min · 1" — minutes on break and how many breaks; red past the allowance or back late. */
function BreakCell({ day, allowance, onOpen }: { day: DayView; allowance: number; onOpen?: (row: AttendanceDay) => void }) {
  const count = day.bot?.break_count ?? 0
  if (day.breakMin === 0 && count === 0) return <span className="text-slate-400">—</span>
  const over = Math.max(0, day.breakMin - allowance)
  const back = day.bot?.late_return_min ?? 0
  const bad = over > 0 || back > 0
  const text = `${day.breakMin} min${count > 0 ? ` · ${count}` : ''}`
  const notes = [over > 0 && `+${gapLabel(over)} over`, back > 0 && `back +${gapLabel(back)}`, day.bot?.on_break && 'out now'].filter(Boolean).join(' · ')
  const body = (
    <>
      <span className={cx('whitespace-nowrap text-[13px] tabular-nums', bad ? 'font-semibold text-red-600' : 'text-slate-900')}>{text}</span>
      {notes && <span className={cx('block whitespace-nowrap text-[11px]', bad ? 'text-red-600' : 'text-slate-500')}>{notes}</span>}
    </>
  )
  if (!day.bot || count === 0 || !onOpen) return body
  return (
    <button
      type="button"
      onClick={() => onOpen(day.bot as AttendanceDay)}
      title={`Breaks: ${day.bot.break_detail || '—'} · ${allowance}m allowed · click for each one`}
      className="text-left decoration-dotted underline-offset-2 hover:underline"
    >
      {body}
    </button>
  )
}

/**
 * A review flag first (amber chip), otherwise the day's punctuality as words: green "On time",
 * red for a late login (it is counted against the person, like every late figure on the
 * page), amber for an early logout, red and bold for both. Nothing to judge reads "—".
 */
function FlagCell({ day }: { day: DayView }) {
  if (day.review) {
    return (
      <span title={day.review.detail} className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
        <span aria-hidden>⚠</span>{day.review.label}
      </span>
    )
  }
  return <PunctualityText flag={day.flag} />
}

function PunctualityText({ flag }: { flag: Punctuality | null }) {
  if (!flag) return <span className="text-slate-400">—</span>
  const tone = flag.id === 'on-time' ? 'text-emerald-700'
    : flag.id === 'both' ? 'font-semibold text-red-600'
    : flag.id === 'late' ? 'text-red-600'
    : 'text-amber-700'
  return <span title={flag.detail} className={cx('whitespace-nowrap text-xs', tone)}>{flag.short}</span>
}

/** Late logins so far this month out of the logins recorded: "0/3", red when any were late. */
function LateMonthCount({ tally, monthLabel, name }: { tally: LoginTally; monthLabel: string; name: string }) {
  if (tally.judged === 0) {
    return <span title={`No logins recorded for ${name} in ${monthLabel}`} className="text-slate-400">—</span>
  }
  if (tally.late === 0) {
    return <span title={`${name} was on time for all ${tally.judged} logins in ${monthLabel}`} className="text-[13px] tabular-nums text-slate-500">0/{tally.judged}</span>
  }
  return (
    <span
      title={`${name}: ${tally.late} late login${tally.late === 1 ? '' : 's'} of ${tally.judged} in ${monthLabel} · ${gapLabel(tally.lateMin)} lost · worst ${gapLabel(tally.worstLateMin)}`}
      className="text-[13px] font-semibold tabular-nums text-red-600"
    >
      {tally.late}<span className="font-normal text-red-400">/{tally.judged}</span>
    </span>
  )
}

// ─── Correction popover ────────────────────────────────────────────────────────

/** Room kept between the popover and the button, and from the window's edges. */
const GAP = 6
const EDGE = 8

/**
 * The day opened for correction, as a small panel hanging from its ⋮ button — not a
 * full-screen window: the row it corrects, and the table around it, stay in view.
 *
 * It slides down from the button, or up when there isn't room below; follows the button
 * while the page scrolls; and closes on Escape, a click outside, or the same button again.
 * Inside: login, logout, break and status, what they come to (hours and the flag, live as
 * they are typed), the bot's breaks, and the way back to the bot's record. Nothing is saved
 * until Save.
 */
function DayEditPopover({ day, anchor, date, breakAllowanceMin, onBreakDetail, onClose, onSaved }: {
  day: DayView
  /** The ⋮ button it opens from. */
  anchor: HTMLElement
  date: string
  breakAllowanceMin: number
  onBreakDetail?: (row: AttendanceDay) => void
  onClose: () => void
  onSaved: () => void
}) {
  const { person, row, bot } = day
  const [draft, setDraft] = useState<Draft>(() => draftOf(row))
  const [saving, setSaving] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const firstRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null)
  const [shown, setShown] = useState(false)

  // Place it under the button (right edges aligned), or over it when the space below is too
  // short; keep it inside the window. Re-placed on scroll and resize, so it rides with the row.
  useLayoutEffect(() => {
    const place = () => {
      const panel = panelRef.current
      if (!panel) return
      const r = anchor.getBoundingClientRect()
      const w = panel.offsetWidth
      const h = panel.offsetHeight
      const below = window.innerHeight - r.bottom
      const above = below < h + GAP + EDGE && r.top > below
      const top = above ? Math.max(EDGE, r.top - h - GAP) : Math.min(r.bottom + GAP, window.innerHeight - h - EDGE)
      const left = Math.min(Math.max(EDGE, r.right - w), window.innerWidth - w - EDGE)
      setPos((p) => (p && p.top === top && p.left === left && p.above === above ? p : { top, left, above }))
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchor])

  // Slide in once placed; focus the first field.
  useEffect(() => {
    if (!pos || shown) return
    const id = requestAnimationFrame(() => { setShown(true); firstRef.current?.focus({ preventScroll: true }) })
    return () => cancelAnimationFrame(id)
  }, [pos, shown])

  // Escape, or a press anywhere outside it (other than its own button, which toggles), closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose(); anchor.focus() } }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || anchor.contains(t)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [anchor, onClose])

  const status = draft.status === '' ? impliedStatus(draft.login_at || null, draft.logout_at || null, day.leaveCovered) : draft.status
  const onLeave = day.leaveCovered || status === 'leave'
  const hours = netHours(draft.login_at, draft.logout_at, Number(draft.break_min || 0))
  const flag = punctuality(
    onLeave ? null : lateBy(draft.login_at || null, person.expected_login),
    onLeave ? null : earlyBy(draft.logout_at || null, person.expected_logout),
  )
  const fromBot = row?.source === 'fetched'
  const overridden = fromBot && row.edited
  const source = !row ? 'Nothing recorded yet' : overridden ? 'Corrected by hand' : fromBot ? 'From the check-in bot' : 'Keyed in by hand'
  const dayLabel = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')

  const save = async () => {
    setSaving(true)
    try {
      await saveDay(day, date, draft)
      onSaved()
    } catch (err) {
      alert((err as Error).message)
      setSaving(false)
    }
  }

  const remove = async () => {
    if (row?.id == null) return
    if (!confirm(overridden ? `Put back the check-in bot's own record for ${person.name}?` : `Clear ${person.name}'s entry for this day?`)) return
    setSaving(true)
    try {
      await api.deleteStaffAttendance(row.id)
      onSaved()
    } catch (err) {
      alert((err as Error).message)
      setSaving(false)
    }
  }

  const field = 'w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[13px] text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'
  const label = 'mb-0.5 block text-[11px] font-medium text-slate-600'
  const hint = 'mt-0.5 block text-[10px] text-slate-500'

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Correct ${person.name}'s day`}
      onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); save() } }}
      style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, fontFamily: "'Inter', 'Poppins', ui-sans-serif, system-ui, sans-serif" }}
      className={cx(
        'z-50 w-76 rounded-xl border border-slate-200 bg-white p-3 shadow-lg shadow-slate-900/10',
        'transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
        shown ? 'translate-y-0 opacity-100' : cx('opacity-0', pos?.above ? 'translate-y-1.5' : '-translate-y-1.5'),
      )}
    >
      {/* Who, which day, where the record came from. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-slate-900">{person.name} · {dayLabel}</div>
          <div className="text-[11px] text-slate-500">{source}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 -mt-0.5 rounded-md p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {day.review && (
        <p title={day.review.detail} className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-900">⚠ {day.review.label}</p>
      )}

      <div className="mt-2.5 grid grid-cols-2 gap-x-2 gap-y-2">
        <label className="block">
          <span className={label}>Login</span>
          <input ref={firstRef} type="time" value={draft.login_at} onChange={(e) => setDraft({ ...draft, login_at: e.target.value })} className={field} />
          {person.expected_login && <span className={hint}>Expected {clockLabel(person.expected_login)}</span>}
        </label>
        <label className="block">
          <span className={label}>Logout</span>
          <input type="time" value={draft.logout_at} onChange={(e) => setDraft({ ...draft, logout_at: e.target.value })} className={field} />
          {person.expected_logout && <span className={hint}>Expected {clockLabel(person.expected_logout)}</span>}
        </label>
        <label className="block">
          <span className={label}>Break (min)</span>
          <input
            value={draft.break_min}
            inputMode="numeric"
            onChange={(e) => { if (/^\d*$/.test(e.target.value)) setDraft({ ...draft, break_min: e.target.value }) }}
            className={cx(field, 'tabular-nums')}
          />
          <span className={hint}>{breakAllowanceMin} min allowed</span>
        </label>
        <label className="block">
          <span className={label}>Status</span>
          <select value={status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} className={field}>
            {ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        </label>
      </div>

      {/* What the values come to, live. */}
      <div className="mt-2.5 flex items-center gap-3 border-t border-slate-100 pt-2 text-[11px] text-slate-600">
        <span>Hours <b className="tabular-nums text-slate-900">{hoursLabel(hours)}</b></span>
        <span className="truncate">Flag <PunctualityText flag={flag} /></span>
        {bot && bot.break_count > 0 && onBreakDetail && (
          <button type="button" onClick={() => { onClose(); onBreakDetail(bot) }} className="ml-auto shrink-0 font-semibold text-brand hover:underline">
            {bot.break_count} break{bot.break_count === 1 ? '' : 's'} →
          </button>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        {row?.id != null ? (
          <button type="button" onClick={remove} disabled={saving} className="text-[11px] font-medium text-red-600 hover:underline disabled:opacity-50">
            {overridden ? "Put back bot's record" : 'Clear entry'}
          </button>
        ) : <span />}
        <div className="flex gap-1.5">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={save} disabled={saving} className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
