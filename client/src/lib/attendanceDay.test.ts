import { describe, expect, it } from 'vitest'
import type { AttendanceDay, StaffAttendanceRow, StaffMember } from '../types'
import { buildDayViews, filterCounts, matchesFilter, overnightSchedule, reviewFlag } from './attendanceDay'

const base = { login: null, logout: null, breakMin: 0, botBreaks: 0, online: false, onLeave: false }

describe('reviewFlag', () => {
  it('flags somebody online with no login', () => {
    expect(reviewFlag({ ...base, online: true })?.id).toBe('online-no-login')
  })
  it('flags a break with no login, from either the sheet or the bot', () => {
    expect(reviewFlag({ ...base, breakMin: 30 })?.id).toBe('break-no-login')
    expect(reviewFlag({ ...base, botBreaks: 1 })?.id).toBe('break-no-login')
  })
  it('flags a logout with no login', () => {
    expect(reviewFlag({ ...base, logout: '17:00' })?.id).toBe('logout-no-login')
  })
  it('flags a logout earlier on the clock than the login', () => {
    expect(reviewFlag({ ...base, login: '07:47', logout: '00:06' })?.label).toBe('Logout after midnight')
  })
  it('does not flag one for somebody whose own hours cross midnight', () => {
    expect(reviewFlag({ ...base, login: '12:00', logout: '05:00', overnightSchedule: true })).toBeNull()
    // Nobody is excused by a schedule nobody set.
    expect(reviewFlag({ ...base, login: '12:00', logout: '05:00' })?.id).toBe('after-midnight')
  })
  it('leaves an ordinary day, an empty day and a leave day alone', () => {
    expect(reviewFlag({ ...base, login: '09:00', logout: '17:00', breakMin: 30, online: true })).toBeNull()
    expect(reviewFlag(base)).toBeNull()
    expect(reviewFlag({ ...base, online: true, onLeave: true })).toBeNull()
  })
})

describe('overnightSchedule', () => {
  it('is true only when the expected finish is earlier on the clock than the start', () => {
    expect(overnightSchedule({ expected_login: '12:00', expected_logout: '05:00' })).toBe(true)
    expect(overnightSchedule({ expected_login: '21:00', expected_logout: '06:00' })).toBe(true)
    expect(overnightSchedule({ expected_login: '09:00', expected_logout: '17:00' })).toBe(false)
  })
  it('is false when either half of the schedule is unset', () => {
    expect(overnightSchedule({ expected_login: '12:00', expected_logout: null })).toBe(false)
    expect(overnightSchedule({ expected_login: null, expected_logout: '05:00' })).toBe(false)
    expect(overnightSchedule({ expected_login: null, expected_logout: null })).toBe(false)
  })
})

const person = (id: number, account: string | null, expected: string | null = '09:00'): StaffMember => ({
  id, name: `P${id}`, departments: [], attendance_user_id: account, status: 'active' as StaffMember['status'],
  expected_login: expected, expected_logout: null, sort_order: id, created_at: '', updated_at: '',
})
const row = (staff_id: number, login: string | null, logout: string | null, status = ''): StaffAttendanceRow => ({
  id: staff_id, source: 'manual', edited: false, staff_id, staff_name: '', work_date: '2026-11-04',
  login_at: login, logout_at: logout, break_min: 0, status, note: '', on_leave: false,
})

describe('buildDayViews', () => {
  const people = [person(1, 'u1'), person(2, 'u2'), person(3, 'u3'), person(4, null)]
  const rows = [row(1, '09:10', null), row(2, '08:55', '17:00')]
  const days = buildDayViews(people, rows, new Map<number, AttendanceDay>(), new Set([4]), new Set(['u1', 'u3']))

  it('reads status, lateness and online state off one list', () => {
    expect(days[0]).toMatchObject({ status: 'still in', lateMin: 10, online: true, review: null })
    expect(days[1]).toMatchObject({ status: 'present', lateMin: 0, online: false })
    expect(days[2]).toMatchObject({ status: 'absent', online: true })
    expect(days[2].review?.id).toBe('online-no-login')
    expect(days[3]).toMatchObject({ status: 'leave', onLeave: true, lateMin: null, review: null })
  })

  it('counts the filter tabs from the same rows', () => {
    expect(filterCounts(days)).toEqual({ all: 4, 'still-in': 1, 'checked-out': 1, absent: 1, review: 1 })
    expect(days.filter((d) => matchesFilter(d, 'review')).map((d) => d.person.id)).toEqual([3])
  })
})
