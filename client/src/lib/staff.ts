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

/** What a hand-keyed attendance day can say. */
export const ATTENDANCE_STATUSES = ['present', 'absent', 'half day', 'leave', 'holiday']

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

/** "09:05" -> 545. Null for a blank or malformed cell. */
function minutesOf(hhmm: string): number | null {
  const [h, m] = hhmm.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}
