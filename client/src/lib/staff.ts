/**
 * The Staff page's vocabulary. Like the Review page's ratings, every value here is stored
 * as the wording shown, so this file is the only place to extend it — no migration, no
 * lookup table.
 */

import type { StaffStatus } from '../types'

/** The SALARY cell, worded as the client's sheet words it. */
export const SALARY_STATUSES = ['Received', 'Pending', 'Not Paid', 'On Hold']

/** Where a staff member stands, and the colour that says so at a glance. */
export const STAFF_STATUSES: { id: StaffStatus; label: string; cell: string; dot: string }[] = [
  { id: 'active', label: 'Active', cell: 'bg-emerald-50 text-emerald-800 border-emerald-300', dot: 'bg-emerald-500' },
  { id: 'inactive', label: 'Inactive', cell: 'bg-red-50 text-red-800 border-red-300', dot: 'bg-red-500' },
  { id: 'leave', label: 'Leave', cell: 'bg-amber-50 text-amber-800 border-amber-300', dot: 'bg-amber-500' },
]

export const staffStatus = (id: StaffStatus) =>
  STAFF_STATUSES.find((s) => s.id === id) ?? STAFF_STATUSES[0]

/** Suggestions for the leave columns; the cells stay free text, so anything else fits. */
export const LEAVE_MARKERS = ['Approved', 'Not Approved', 'Pending', 'Unpaid']

/**
 * What an attendance day can say.
 *
 * "still in" is the odd one out: nobody keys it, the SERVER derives it for a day with a
 * login and no logout yet (see StaffController::fetchedDaySelect). It has to be in this
 * list all the same, or the sheet's dropdown is handed a value it has no option for and
 * renders blank — which is what everyone currently at their desk looked like on today's
 * sheet. It sits last because it is the one nobody picks.
 */
export const ATTENDANCE_STATUSES = ['present', 'absent', 'half day', 'leave', 'holiday', 'still in']

/**
 * What a day with no status of its own should be read as, from its clock times alone: a
 * login and no logout is someone still at their desk, any login at all is present, and a
 * day with nothing recorded is an absence.
 *
 * This is only ever a reading of an empty row — the moment a status is stored, that is
 * what shows. It exists so the Status column agrees with the scorecards above it: a sheet
 * that says "5 of 15 in" cannot have fifteen rows reading "present".
 */
export const impliedStatus = (login: string | null, logout: string | null): string =>
  !login ? 'absent' : !logout ? 'still in' : 'present'

// ─── The organisation's clock ─────────────────────────────────────────────────

/**
 * The timezone attendance is kept in. Every `work_date` the API returns is a day as
 * reckoned HERE, not where the browser happens to be sitting — so this is the clock any
 * page showing "today's attendance" has to ask, and `StaffController::TZ` is the same
 * value on the server side.
 */
export const ORG_TZ = 'America/New_York'

/**
 * Today as the ORGANISATION reckons it, "YYYY-MM-DD".
 *
 * Deliberately not `today()` from lib/format, which answers with the browser's local day.
 * The two disagree for hours either side of midnight — a supervisor in Nairobi opening the
 * sheet at 7 a.m. is in a day New York has not begun — and the sheet would then read empty
 * with no hint as to why. Everything dated against attendance uses this.
 */
export const orgToday = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ORG_TZ }).format(new Date())

/** The wall clock in the org's timezone right now, "9:07 AM" — for an "as of" stamp. */
export const orgNowLabel = (): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: ORG_TZ, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date())

/** First and last day of a "YYYY-MM" month, as the API's from/to range. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

/** "2026-08-31" -> "31-Aug", the way the leaves sheet dates its rows. */
export function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getDate()}-${d.toLocaleDateString('en-US', { month: 'short' })}`
}

/** "09:05" -> "9:05 AM". Blank stays an em dash. */
export function clockLabel(hhmm: string | null): string {
  if (!hhmm) return '—'
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm
  const ampm = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

/** Hours as the attendance page renders them — "7.7h", or an em dash when unknown. */
export const hoursLabel = (n: number | null): string => (n === null ? '—' : `${n.toFixed(1)}h`)

/**
 * Hours worked from the clock times as typed, so the cell moves while the row is still
 * being keyed in rather than waiting for the server to answer. A logout earlier than the
 * login is read as an overnight shift, which is how a night desk records one.
 */
export function netHours(login: string, logout: string, breakMin: number): number | null {
  const start = minutesOf(login)
  const end = minutesOf(logout)
  if (start === null || end === null) return null
  const worked = (end - start + 24 * 60) % (24 * 60)
  return Math.max(0, worked - breakMin) / 60
}

/**
 * How a day sits against the hours the person is expected to keep: minutes past the
 * expected login, and minutes short of the expected logout.
 *
 * null means there is nothing to compare — either no schedule has been set for them, or
 * the clock time isn't recorded — and that is deliberately different from 0, which means
 * they were on time. Nobody is marked late against an expectation nobody agreed.
 *
 * Computed from the times on display rather than read back from the server, for the same
 * reason netHours() is: the mark then moves while a row is still being typed.
 */
export function lateBy(login: string | null, expected: string | null): number | null {
  return gap(expected, login)
}

export function earlyBy(logout: string | null, expected: string | null): number | null {
  return gap(logout, expected)
}

/** Minutes `b` runs past `a`, floored at 0; null when either is missing. */
function gap(a: string | null, b: string | null): number | null {
  const from = a ? minutesOf(a) : null
  const to = b ? minutesOf(b) : null
  if (from === null || to === null) return null
  return Math.max(0, to - from)
}

/** How far off a day is, worded: 7 -> "7m", 95 -> "1h 35m". */
export const gapLabel = (min: number): string =>
  min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`

/** "09:05" -> 545. Null for a blank or malformed cell. */
function minutesOf(hhmm: string): number | null {
  const [h, m] = hhmm.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

// ─── Punctuality ──────────────────────────────────────────────────────────────

/**
 * How a day sat against the hours the person is expected to keep, as ONE verdict.
 *
 * The two clock cells are already marked individually wherever a day is shown, but a
 * sheet of thirty rows is read down, not across, and what a supervisor is looking for is
 * the day that went wrong twice — in late AND out early. That is `both`, and it is the
 * only verdict carrying two marks, which is why it is the one coloured to be found.
 */
export type PunctualityId = 'on-time' | 'late' | 'early' | 'both'

export interface Punctuality {
  id: PunctualityId
  /** The badge's own wording, e.g. "Late in + early out". */
  label: string
  /** The same verdict in the room a table cell has, e.g. "Late + early". */
  short: string
  /** How many marks fired: 0 for on time, 1 for one of them, 2 for both. */
  marks: number
  /** Badge colours — the same palette the rest of the staff sheets use. */
  cls: string
  /** The minutes behind the verdict, worded for a tooltip. */
  detail: string
}

/**
 * The verdict for one day, from minutes late in and minutes early out.
 *
 * Each argument is null when there was nothing to judge — no schedule agreed for that
 * person, or no clock time recorded — and null for BOTH returns null: an absent day, or a
 * person with no schedule, is never given a verdict. That is deliberately different from
 * 0, which means they were on time and is worth saying out loud.
 */
export function punctuality(lateMin: number | null, earlyMin: number | null): Punctuality | null {
  if (lateMin === null && earlyMin === null) return null
  const late = (lateMin ?? 0) > 0
  const early = (earlyMin ?? 0) > 0
  const parts: string[] = []
  if (late) parts.push(`${gapLabel(lateMin as number)} late in`)
  if (early) parts.push(`${gapLabel(earlyMin as number)} early out`)
  const detail = parts.length ? parts.join(' · ') : 'On schedule'

  if (late && early) {
    return {
      id: 'both',
      label: 'Late in + early out',
      short: 'Late + early',
      marks: 2,
      cls: 'border-rose-300 bg-rose-100 text-rose-800',
      detail,
    }
  }
  if (late) {
    return { id: 'late', label: 'Late in', short: 'Late in', marks: 1, cls: 'border-amber-300 bg-amber-50 text-amber-800', detail }
  }
  if (early) {
    return { id: 'early', label: 'Early out', short: 'Early out', marks: 1, cls: 'border-amber-300 bg-amber-50 text-amber-800', detail }
  }
  return { id: 'on-time', label: 'On time', short: 'On time', marks: 0, cls: 'border-emerald-300 bg-emerald-50 text-emerald-800', detail }
}

/**
 * A day's verdict straight from the clock times, for the sheets that hold "HH:MM" strings
 * rather than the roster's pre-computed minutes.
 */
export const punctualityOf = (
  login: string | null, logout: string | null, expectedLogin: string | null, expectedLogout: string | null,
): Punctuality | null => punctuality(lateBy(login, expectedLogin), earlyBy(logout, expectedLogout))

/** Counts of each verdict over a run of days — what the summaries tally. */
export interface PunctualityTally {
  onTime: number
  late: number
  early: number
  /** Days that were late in AND early out. These are also counted in `late` and `early`. */
  both: number
  /** Every day that carried at least one mark. */
  flagged: number
  /** Days that got a verdict at all — the denominator the rates are out of. */
  judged: number
}

export function tallyPunctuality(days: (Punctuality | null)[]): PunctualityTally {
  const t: PunctualityTally = { onTime: 0, late: 0, early: 0, both: 0, flagged: 0, judged: 0 }
  for (const d of days) {
    if (d === null) continue
    t.judged += 1
    if (d.id === 'on-time') { t.onTime += 1; continue }
    t.flagged += 1
    if (d.id === 'both') { t.both += 1; t.late += 1; t.early += 1 }
    else if (d.id === 'late') t.late += 1
    else t.early += 1
  }
  return t
}
