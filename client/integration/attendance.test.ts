import { beforeEach, describe, expect, it } from 'vitest'
import { api, fmtAttendanceTime } from '../src/api/client'
import {
  aggregateBreaks, isLateLogin, loginLateMinutes, tallyByMonth,
} from '../src/lib/attendanceReports'
import { lateBy, earlyBy, orgToday as clientOrgToday } from '../src/lib/staff'
import type { AttendanceDay } from '../src/types'
import { BOT_TABLES, seedBotBreak, seedBotDay, seedBotStaff } from './bot-staff'
import { orgToday, resetTables, sql, useServer, type Server } from './harness'
import {
  AttendanceBreaksSpec, AttendanceDaySpec, AttendanceOnBreakSpec, AttendanceRosterSpec, AttendanceStaffSpec,
  arrayOf, expectShape, lastStatus, nullable, obj, optional, rejectionOf, type Spec,
} from './shape-staff'

// The Attendance page's bot-backed endpoints (/attendance/*), read through the real api
// client with the check-in bot's tables seeded directly, and the report logic run over
// exactly what they answer.

const TABLES = ['staff', 'departments', 'staff_departments', 'staff_attendance', 'staff_leaves', ...BOT_TABLES]
const DAY = '2026-08-04' // an EDT (-04) day

let server: Server
let rae: number
let tess: number

/**
 *  8001 Rae Stone — on the roster with a 09:00–17:00 schedule. In 9:07, out 16:50, two
 *                   breaks: 40 stated but back after 55 (5 past the 10 min grace), and 30.
 *  8002 Sam Tate  — a bot account nobody on the roster matches. In 8:30, never logged out.
 *  Tess Uma       — on the roster, no bot account; a Half Day keyed in by hand.
 */
async function seedDay(): Promise<void> {
  seedBotStaff(8001, 'Rae Stone', 'rae')
  seedBotStaff(8002, 'Sam Tate', 'sam')
  const created = (await api.createStaff(['Rae Stone', 'Tess Uma'])).created
  rae = created[0].id
  tess = created[1].id
  await api.updateStaff(rae, { expected_login: '09:00', expected_logout: '17:00' })
  seedBotDay(8001, DAY, `${DAY} 09:07:00-04`, `${DAY} 16:50:00-04`, 'Rae Stone')
  seedBotBreak(8001, DAY, `${DAY} 12:00:00-04`, `${DAY} 12:55:00-04`, 40, 'brb 40')
  seedBotBreak(8001, DAY, `${DAY} 15:00:00-04`, `${DAY} 15:30:00-04`, 30)
  seedBotDay(8002, DAY, `${DAY} 08:30:00-04`, null, 'Sam Tate')
  await api.createStaffAttendance({ staff_id: tess, work_date: DAY, login_at: '09:00', logout_at: '13:00', break_min: 0, status: 'half day' })
}

beforeEach(async () => {
  resetTables(...TABLES)
  server = useServer()
  await seedDay()
})

const byName = (rows: AttendanceDay[], name: string): AttendanceDay => {
  const row = rows.find((r) => r.staff_name === name)
  if (!row) throw new Error(`no row for ${name}`)
  return row
}

describe('/attendance/roster', () => {
  it('answers the declared AttendanceRoster shape with every day source merged', async () => {
    const roster = await api.attendanceRoster(DAY)
    expectShape(roster, AttendanceRosterSpec)
    expect(roster).toMatchObject({ timezone: 'America/New_York', breakAllowanceMin: 60, date: DAY })
    expect(roster.rows.map((r) => r.staff_name).sort()).toEqual(['Rae Stone', 'Sam Tate', 'Tess Uma'])

    const r = byName(roster.rows, 'Rae Stone')
    expect(r).toMatchObject({
      user_id: '8001', staff_id: rae, present: true, still_in: false, status: 'present', status_set: false,
      edited: false, bot_seen: true, break_min: 70, break_count: 2, break_detail: '40, 30', over_break_min: 10,
      break_actual_min: 85, late_return_count: 1, late_return_min: 5, out_till_eod_count: 0, on_break: false,
      expected_login: '09:00', expected_logout: '17:00', late_min: 7, early_min: 10, hours: 7.72, net_hours: 6.55,
    })
    expect(Date.parse(r.login_at as string)).toBe(Date.parse('2026-08-04T13:07:00Z'))
    expect(fmtAttendanceTime(r.login_at)).toBe('09:07 AM')

    const s = byName(roster.rows, 'Sam Tate')
    expect(s).toMatchObject({ user_id: '8002', staff_id: null, still_in: true, status: 'still in', hours: null, late_min: null, expected_login: null })

    // A hand-keyed day for somebody the bot never saw is still a day — a half day, present.
    const t = byName(roster.rows, 'Tess Uma')
    expect(t).toMatchObject({ user_id: `staff-${tess}`, bot_seen: false, edited: true, status: 'half day', status_set: true, present: true, hours: 4 })
  })

  it('agrees with the Staff day sheet about the same person-day, and a correction moves both', async () => {
    const sheet = await api.staffAttendance({ from: DAY, to: DAY, staff_id: rae })
    const day = sheet.rows[0]
    const roster = byName((await api.attendanceRoster(DAY)).rows, 'Rae Stone')
    // The day sheet's HH:MM is the roster's timestamp in New York time.
    expect(fmtAttendanceTime(roster.login_at)).toBe('09:07 AM')
    expect(day.login_at).toBe('09:07')
    expect(day.break_min).toBe(roster.break_min)
    expect(lateBy(day.login_at, '09:00')).toBe(roster.late_min)
    expect(earlyBy(day.logout_at, '17:00')).toBe(roster.early_min)

    await api.createStaffAttendance({ staff_id: rae, work_date: DAY, login_at: '08:59', logout_at: '17:00', break_min: 50, status: 'present' })
    const fixed = byName((await api.attendanceRoster(DAY)).rows, 'Rae Stone')
    expect(fixed).toMatchObject({ edited: true, late_min: 0, early_min: 0, break_min: 50, over_break_min: 0, status_set: true })
    const fixedDay = (await api.staffAttendance({ from: DAY, to: DAY, staff_id: rae })).rows[0]
    expect(lateBy(fixedDay.login_at, '09:00')).toBe(fixed.late_min)
  })

  it('judges a winter (EST, -05) day in New York time too', async () => {
    seedBotDay(8001, '2026-01-15', '2026-01-15 09:07:00-05', '2026-01-15 17:00:00-05')
    const w = byName((await api.attendanceRoster('2026-01-15')).rows, 'Rae Stone')
    expect(w.late_min).toBe(7)
    expect(fmtAttendanceTime(w.login_at)).toBe('09:07 AM')
    const sheet = await api.staffAttendance({ from: '2026-01-15', to: '2026-01-15', staff_id: rae })
    expect(sheet.rows[0].login_at).toBe('09:07')
  })
})

describe('/attendance/days + report logic', () => {
  it('answers the declared shape and aggregates sanely in lib/attendanceReports', async () => {
    seedBotDay(8001, '2026-07-31', '2026-07-31 09:30:00-04', '2026-07-31 17:00:00-04', 'Rae Stone')
    const res = await api.attendanceDays({ from: '2026-07-01', to: '2026-08-31' })
    expectShape(res, obj<{ timezone: string, breakAllowanceMin: number, rows: AttendanceDay[] }>({
      timezone: 'string', breakAllowanceMin: 'int', rows: arrayOf(AttendanceDaySpec),
    }))
    expect(res.rows.map((r) => [r.work_date, r.staff_name])).toEqual([
      [DAY, 'Rae Stone'], [DAY, 'Sam Tate'], [DAY, 'Tess Uma'], ['2026-07-31', 'Rae Stone'],
    ])

    const stats = aggregateBreaks(res.rows)
    const rs = stats.find((s) => s.user_id === '8001')
    expect(rs).toMatchObject({
      daysPresent: 2, daysWithBreak: 1, totalBreakMin: 70, totalOverMin: 10, overDays: 1, worstOverMin: 10,
      lateDays: 2, onTimeDays: 0, totalLateMin: 37, worstLateMin: 30,
    })
    expect(rs?.totalHours).toBeCloseTo(7.72 + 7.5, 5)
    expect(stats[0].user_id).toBe('8001') // worst break overage first

    // Sam has no schedule, so the flat 9:00 applies: in at 8:30 is on time.
    const sam = res.rows.find((r) => r.user_id === '8002') as AttendanceDay
    expect(loginLateMinutes(sam)).toBe(0)
    expect(isLateLogin(sam)).toBe(false)

    expect(tallyByMonth(res.rows)).toEqual([
      { month: '2026-07', label: 'July 2026', late: 1, onTime: 0, lateMin: 30, days: 1 },
      { month: '2026-08', label: 'August 2026', late: 1, onTime: 2, lateMin: 7, days: 1 },
    ])

    const one = await api.attendanceDays({ from: '2026-07-01', to: '2026-08-31', user_id: '8001' })
    expect(one.rows.map((r) => r.work_date)).toEqual([DAY, '2026-07-31'])
  })
})

describe('/attendance/breaks', () => {
  it('lists the bot\'s breaks in the declared shape, and reports a keyed-in total as overridden', async () => {
    const b = await api.attendanceBreaks('8001', DAY)
    expectShape(b, AttendanceBreaksSpec)
    expect(b).toMatchObject({
      userId: '8001', date: DAY, allowanceMin: 60, graceMin: 10, eodCutoff: '07:00',
      totalMin: 70, overMin: 10, actualMin: 85, lateMin: 5, overridden: false,
    })
    expect(b.breaks.map((x) => [x.duration_min, x.actual_min, x.late_min, x.out_till_eod, x.still_out])).toEqual([
      [40, 55, 5, false, false], [30, 30, 0, false, false],
    ])
    expect(b.breaks[0].raw).toBe('brb 40')
    // The first 7:00 cutoff after the break started — the next morning.
    expect(Date.parse(b.breaks[0].eod_at)).toBe(Date.parse('2026-08-05T11:00:00Z'))

    await api.createStaffAttendance({ staff_id: rae, work_date: DAY, login_at: '09:07', logout_at: '16:50', break_min: 45, status: 'present' })
    const o = await api.attendanceBreaks('8001', DAY)
    expect(o).toMatchObject({ overridden: true, totalMin: 45, overMin: 0 })
    expect(o.breaks).toHaveLength(2)
  })

  it('rejects a missing user id with the server\'s 422 message', async () => {
    expect(await rejectionOf(api.attendanceBreaks('', DAY))).toBe('user_id is required')
    expect(lastStatus(server)).toBe(422)
  })
})

describe('/attendance/exceptions', () => {
  const ExceptionSpec: Spec = obj({
    user_id: 'string', staff_name: nullable('string'), work_date: 'date',
    login_at: optional('timestamp'), local_login: optional('string'), break_min: optional('int'), over_min: optional('int'),
    expected_login: optional('hhmm'), late_min: optional('int'), taken_at: optional('timestamp'),
    returned_at: optional(nullable('timestamp')), duration_min: optional('int'), actual_min: optional('int'),
    urgent: optional('boolean'), out_till_eod: optional('boolean'),
  })
  const range = { from: '2026-08-01', to: '2026-08-31' }

  it('finds each kind of exception in the declared shape', async () => {
    const missing = await api.attendanceExceptions('missing_logout', range.from, range.to)
    expectShape(missing, obj({ type: 'string', from: 'date', to: 'date', rows: arrayOf(ExceptionSpec) }))
    expect(missing.rows.map((r) => r.user_id)).toEqual(['8002'])

    const over = await api.attendanceExceptions('over_break', range.from, range.to)
    expectShape(over.rows, arrayOf(ExceptionSpec))
    expect(over.rows).toEqual([expect.objectContaining({ user_id: '8001', break_min: 70, over_min: 10 })])

    const late = await api.attendanceExceptions('late', range.from, range.to)
    expectShape(late.rows, arrayOf(ExceptionSpec))
    expect(late.rows).toEqual([expect.objectContaining({ user_id: '8001', local_login: '09:07:00', expected_login: '09:00', late_min: 7 })])

    const lateReturn = await api.attendanceExceptions('late_return', range.from, range.to)
    expectShape(lateReturn.rows, arrayOf(ExceptionSpec))
    expect(lateReturn.rows).toEqual([expect.objectContaining({ user_id: '8001', duration_min: 40, actual_min: 55, late_min: 5, out_till_eod: false, urgent: false })])
  })

  it('agrees with the client\'s late-login rule, including the flat 9:00 for somebody with no schedule', async () => {
    seedBotDay(8002, '2026-08-05', '2026-08-05 09:25:00-04', '2026-08-05 17:00:00-04', 'Sam Tate')
    const late = await api.attendanceExceptions('late', range.from, range.to)
    const days = (await api.attendanceDays(range)).rows
    for (const ex of late.rows) {
      const day = days.find((d) => d.user_id === ex.user_id && d.work_date === ex.work_date) as AttendanceDay
      expect(loginLateMinutes(day)).toBe(ex.late_min)
    }
    expect(late.rows.map((r) => [r.user_id, r.late_min])).toEqual([['8002', 25], ['8001', 7]])
  })

  it('rejects an unknown type', async () => {
    const bogus = 'bogus' as 'late'
    expect(await rejectionOf(api.attendanceExceptions(bogus))).toBe('Invalid type')
    expect(lastStatus(server)).toBe(422)
  })
})

describe('/attendance/staff, /summary', () => {
  it('lists the bot accounts with string ids and parseable timestamps', async () => {
    const staff = await api.attendanceStaff()
    expectShape(staff, arrayOf(AttendanceStaffSpec))
    expect(staff.map((s) => s.user_id)).toEqual(['8001', '8002'])
  })

  it('answers the summary with the numeric types the client declares', async () => {
    const summary = await api.attendanceSummary({ from: '2026-08-01', to: '2026-08-31' })
    expectShape(summary, arrayOf(obj<(typeof summary)[number]>({
      user_id: 'string', staff_name: nullable('string'), days_present: 'int', days_complete: 'int',
      total_hours: 'number', first_day: 'date', last_day: 'date',
    })))
    const r = summary.find((s) => s.user_id === '8001')
    expect(r).toMatchObject({ days_present: 1, days_complete: 1, first_day: DAY, last_day: DAY })
    expect(r?.total_hours).toBeCloseTo(7.72, 2)
  })
})

describe('today: /attendance/live and /attendance/on-break', () => {
  it('shows who is in and who is out on a break right now', async () => {
    const today = orgToday()
    expect(clientOrgToday()).toBe(today)
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
    seedBotDay(8001, today, ago(120), null, 'Rae Stone')
    seedBotBreak(8001, today, ago(30), null, 5, 'lunch 5')

    const live = await api.attendanceLive()
    // /live answers a narrower row than the AttendanceDay it is typed as; these are the
    // fields the "Now online" strip and PerformerBadge read.
    expectShape(live, arrayOf(obj<Pick<AttendanceDay, 'user_id' | 'staff_name' | 'username' | 'login_at' | 'expected_login' | 'late_min'>>({
      user_id: 'string', staff_name: nullable('string'), username: nullable('string'), login_at: nullable('timestamp'),
      expected_login: nullable('hhmm'), late_min: nullable('int'),
    })))
    expect(live.map((m) => m.user_id)).toEqual(['8001'])

    const out = await api.attendanceOnBreak()
    expectShape(out, arrayOf(AttendanceOnBreakSpec))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ user_id: '8001', staff_name: 'Rae Stone', username: 'rae', duration_min: 5, urgent: false, raw: 'lunch 5' })
    expect(out[0].out_for_min).toBeGreaterThanOrEqual(29)
    expect(out[0].late_min).toBe(out[0].out_for_min - 5 - 10)

    const roster = byName((await api.attendanceRoster(today)).rows, 'Rae Stone')
    expect(roster).toMatchObject({ on_break: true, still_in: true, status: 'still in' })
    expect(sql('SELECT count(*)::int AS n FROM attendance_breaks WHERE returned_at IS NULL')).toEqual([{ n: 1 }])
  })
})
