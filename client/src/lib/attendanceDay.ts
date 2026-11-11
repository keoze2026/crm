// One person's day on the Attendance day sheet, and everything the page derives from it.
//
// The cards, the status panel, the filter tabs and the table all read the same DayView list,
// so no figure above the table can contradict the row under it.
import type { AttendanceDay, StaffAttendanceRow, StaffMember } from '../types'
import { earlyBy, impliedStatus, lateBy, netHours, punctuality, type Punctuality } from './staff'

/** The statuses that count as a day at work — the same rule the server counts by. */
export const AT_WORK = ['present', 'half day', 'still in']

/**
 * Something about the day that the bot's record and the clock times disagree on, so a person
 * should look at it before it is trusted. Shown in amber on the row, and counted by the
 * "Needs review" tab.
 */
export type ReviewId = 'online-no-login' | 'break-no-login' | 'logout-no-login' | 'after-midnight'

export interface ReviewFlag {
  id: ReviewId
  /** The chip's wording, e.g. "Online, no login". */
  label: string
  /** What to check, for the tooltip. */
  detail: string
}

/** Minutes since midnight of an "HH:MM" clock time; null when it isn't one. */
function minutesOf(hhmm: string | null): number | null {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

/**
 * The first thing wrong with a day, in the order a supervisor would want to chase it:
 * somebody the bot sees online with nothing logged, a break taken before any login, a
 * logout with no login, and a logout earlier on the clock than the login (a shift that ran
 * past midnight, or a mistyped time). A day on leave is never flagged.
 *
 * That last one is judged against the PERSON, not the clock: somebody whose expected hours
 * cross midnight is meant to log out the next morning, so their every shift would otherwise
 * arrive needing review, and the one night that genuinely needs a look would be buried in
 * thirty that don't. Set their hours on the Staff page and the chip goes quiet for them
 * alone — everybody else still gets it, including anyone with no schedule set, since an
 * overnight shift nobody agreed to is exactly the thing worth checking.
 */
export function reviewFlag(d: {
  login: string | null
  logout: string | null
  breakMin: number
  /** Breaks the bot recorded for the day. */
  botBreaks: number
  /** The bot sees this person checked in right now. */
  online: boolean
  onLeave: boolean
  /** Their expected hours themselves cross midnight, so a logout the next morning is the plan. */
  overnightSchedule?: boolean
}): ReviewFlag | null {
  if (d.onLeave) return null
  if (!d.login) {
    if (d.online) {
      return { id: 'online-no-login', label: 'Online, no login', detail: 'The check-in bot shows them online, but no login is recorded for the day.' }
    }
    if (d.breakMin > 0 || d.botBreaks > 0) {
      return { id: 'break-no-login', label: 'Break, no login', detail: 'A break was recorded for the day, but no login.' }
    }
    if (d.logout) {
      return { id: 'logout-no-login', label: 'Logout, no login', detail: 'A logout was recorded for the day, but no login.' }
    }
    return null
  }
  const inAt = minutesOf(d.login)
  const outAt = minutesOf(d.logout)
  if (!d.overnightSchedule && inAt !== null && outAt !== null && outAt < inAt) {
    return { id: 'after-midnight', label: 'Logout after midnight', detail: 'The logout is earlier on the clock than the login: counted as a shift that ran past midnight. Worth a look, since it could be a mistyped time — if these are their hours, set them on the Staff page and this stops being flagged.' }
  }
  return null
}

/** Their expected hours cross midnight: out on the clock before in, so the shift is a night. */
export function overnightSchedule(person: Pick<StaffMember, 'expected_login' | 'expected_logout'>): boolean {
  const inAt = minutesOf(person.expected_login)
  const outAt = minutesOf(person.expected_logout)
  return inAt !== null && outAt !== null && outAt < inAt
}

export interface DayView {
  person: StaffMember
  /** The stored day: the bot's, or the row keyed in over it. Null when there is none. */
  row: StaffAttendanceRow | null
  /** The bot's own record, for breaks, returns and its account. Null when it has none. */
  bot: AttendanceDay | null
  login: string | null
  logout: string | null
  breakMin: number
  /** The status on record, or the one the clock times imply where none is stored. */
  status: string
  statusSet: boolean
  /** On leave this day — on the Leaves sheet, or with the status set to "leave". */
  onLeave: boolean
  /** The Leaves sheet has them on leave (as opposed to a status keyed in by hand). */
  leaveCovered: boolean
  lateMin: number | null
  earlyMin: number | null
  flag: Punctuality | null
  hours: number | null
  /** The bot sees them checked in right now. */
  online: boolean
  review: ReviewFlag | null
}

/** Build every person's day from the stored rows, the bot's roster and who is online. */
export function buildDayViews(
  people: StaffMember[],
  sheetRows: StaffAttendanceRow[],
  botByStaff: Map<number, AttendanceDay>,
  onLeaveToday: Set<number>,
  online: Set<string>,
): DayView[] {
  const byStaff = new Map(sheetRows.map((r) => [r.staff_id, r]))
  return people.map((person) => {
    const row = byStaff.get(person.id) ?? null
    const bot = botByStaff.get(person.id) ?? null
    const login = row?.login_at ?? null
    const logout = row?.logout_at ?? null
    const leaveCovered = onLeaveToday.has(person.id)
    const status = row?.status.trim() ? row.status.trim() : impliedStatus(login, logout, leaveCovered)
    const onLeave = leaveCovered || status === 'leave'
    const lateMin = onLeave ? null : lateBy(login, person.expected_login)
    const earlyMin = onLeave ? null : earlyBy(logout, person.expected_logout)
    const breakMin = row?.break_min ?? 0
    const account = person.attendance_user_id ?? bot?.user_id ?? null
    const isOnline = account != null && online.has(account)
    return {
      person,
      row,
      bot,
      login,
      logout,
      breakMin,
      status,
      statusSet: Boolean(row?.status.trim()),
      onLeave,
      leaveCovered,
      lateMin,
      earlyMin,
      flag: punctuality(lateMin, earlyMin),
      hours: netHours(login ?? '', logout ?? '', breakMin),
      online: isOnline,
      review: reviewFlag({
        login, logout, breakMin, botBreaks: bot?.break_count ?? 0, online: isOnline, onLeave,
        overnightSchedule: overnightSchedule(person),
      }),
    }
  })
}

/** The day sheet's filter tabs. */
export type DayFilter = 'all' | 'still-in' | 'checked-out' | 'absent' | 'review'

export function matchesFilter(d: DayView, f: DayFilter): boolean {
  switch (f) {
    case 'still-in': return d.status === 'still in'
    // Logged out for the day — literally checked out, whatever status was keyed in.
    case 'checked-out': return d.login !== null && d.logout !== null
    case 'absent': return d.status === 'absent'
    case 'review': return d.review !== null
    default: return true
  }
}

export function filterCounts(days: DayView[]): Record<DayFilter, number> {
  const out: Record<DayFilter, number> = { all: days.length, 'still-in': 0, 'checked-out': 0, absent: 0, review: 0 }
  for (const d of days) {
    for (const f of ['still-in', 'checked-out', 'absent', 'review'] as const) if (matchesFilter(d, f)) out[f] += 1
  }
  return out
}
