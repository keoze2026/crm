import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '../src/api/client'
import {
  impliedStatus, lateBy, earlyBy, loginTallies, monthRange, netHours, returnVerdict, clockLabel, tallyLogins,
} from '../src/lib/staff'
import { BOT_TABLES, seedBotBreak, seedBotDay, seedBotStaff } from './bot-staff'
import { resetTables, sql, useServer, type Server } from './harness'
import {
  DepartmentSpec, StaffAttendancePageSpec, StaffAttendanceRowSpec, StaffLeaveSpec, StaffMemberSpec,
  StaffSalaryHoldSpec, StaffSalarySpec, arrayOf, expectShape, lastStatus, obj, rejectionOf,
} from './shape-staff'

// Staff Management through the real api client: the roster, departments, the attendance
// day sheet (hand-keyed and bot-fetched), leaves, salaries and salary holds.

const TABLES = [
  'staff', 'departments', 'staff_departments', 'staff_attendance', 'staff_leaves', 'staff_salaries',
  'staff_salary_holds', ...BOT_TABLES,
]

let server: Server
beforeEach(() => {
  resetTables(...TABLES)
  server = useServer()
})

async function person(name: string): Promise<number> {
  const res = await api.createStaff([name])
  return (res.created[0] ?? res.existing[0]).id
}

describe('staff roster', () => {
  it('creates a pasted list, de-duplicated, filed under the departments it was added from', async () => {
    const dept = await api.createDepartment('Billing')
    const res = await api.createStaff(['Ada Lovelace', 'Ben Stone', 'ada lovelace'], [dept.id])

    expectShape(res, { object: { created: arrayOf(StaffMemberSpec), existing: arrayOf(StaffMemberSpec) } })
    expect(res.created.map((s) => s.name)).toEqual(['Ada Lovelace', 'Ben Stone'])
    expect(res.existing).toEqual([])
    expect(res.created[0]).toMatchObject({
      status: 'active', expected_login: null, expected_logout: null, attendance_user_id: null,
      departments: [{ id: dept.id, name: 'Billing' }],
    })
    expect(server.calls.at(-1)?.status).toBe(201)

    const again = await api.createStaff(['ADA LOVELACE'])
    expect(again.created).toEqual([])
    expect(again.existing.map((s) => s.id)).toEqual([res.created[0].id])

    const list = await api.staff()
    expectShape(list, arrayOf(StaffMemberSpec))
    expect(sql('SELECT count(*)::int AS n FROM staff_departments')).toEqual([{ n: 2 }])
  })

  it('links a new person to the check-in account carrying their name (bot tag ignored)', async () => {
    seedBotStaff(7001, 'Zack Brown |Audit|', 'zackb')
    const [zack] = (await api.createStaff(['Zack Brown'])).created
    expect(zack.attendance_user_id).toBe('7001')
    expect(typeof zack.attendance_user_id).toBe('string')
  })

  it('stores schedule, status and the complete department set the client sends', async () => {
    const a = await api.createDepartment('A')
    const b = await api.createDepartment('B')
    const id = await person('Cara Diaz')

    const updated = await api.updateStaff(id, {
      expected_login: '09:00', expected_logout: '17:30', status: 'leave', department_ids: [a.id, b.id],
    })
    expectShape(updated, StaffMemberSpec)
    expect(updated).toMatchObject({ expected_login: '09:00', expected_logout: '17:30', status: 'leave' })
    expect(updated.departments.map((d) => d.name)).toEqual(['A', 'B'])
    expect(sql('SELECT expected_login::text AS l, expected_logout::text AS o, status FROM staff WHERE id = ?', [id]))
      .toEqual([{ l: '09:00:00', o: '17:30:00', status: 'leave' }])

    // department_ids is the complete set, not an addition; null clears a schedule; omitted leaves it.
    const narrowed = await api.updateStaff(id, { department_ids: [b.id], expected_login: null })
    expect(narrowed.departments.map((d) => d.name)).toEqual(['B'])
    expect(narrowed.expected_login).toBeNull()
    expect(narrowed.expected_logout).toBe('17:30')

    const depts = await api.departments()
    expectShape(depts, arrayOf(DepartmentSpec))
    expect(depts.map((d) => [d.name, d.staff_count])).toEqual([['A', 0], ['B', 1]])
  })

  it('surfaces the server\'s 404 / 409 / 422 messages as rejections', async () => {
    const id = await person('Dee Eve')
    await person('Fay Gill')
    expect(await rejectionOf(api.updateStaff(id, { name: 'fay gill' }))).toBe('Another staff member is already called that')
    expect(lastStatus(server)).toBe(409)
    expect(await rejectionOf(api.updateStaff(id, { name: '  ' }))).toBe('A name is required')
    expect(lastStatus(server)).toBe(422)
    expect(await rejectionOf(api.updateStaff(999_999, { status: 'active' }))).toBe('Staff member not found')
    expect(lastStatus(server)).toBe(404)
    expect(await rejectionOf(api.createStaff([' , ']))).toBe('A name is required')
  })

  it('deletes, answering deleted:false the second time', async () => {
    const id = await person('Gus Hale')
    expect(await api.deleteStaff(id)).toEqual({ deleted: true })
    expect(await api.deleteStaff(id)).toEqual({ deleted: false })
  })
})

describe('departments', () => {
  it('creates, refuses duplicates, renames and deletes', async () => {
    const d = await api.createDepartment('Audits')
    expectShape(d, DepartmentSpec)
    expect(d).toMatchObject({ name: 'Audits', staff_count: 0, sort_order: 0 })
    expect(await rejectionOf(api.createDepartment('Audits'))).toBe('That department is already listed')
    expect(lastStatus(server)).toBe(409)
    await api.createDepartment('Sales')
    expect(await rejectionOf(api.renameDepartment(d.id, 'sales'))).toBe('Another department is already called that')

    const renamed = await api.renameDepartment(d.id, 'Audit Team')
    expect(renamed).toMatchObject({ id: d.id, name: 'Audit Team' })
    expect(await rejectionOf(api.renameDepartment(123_456, 'Nobody'))).toBe('Department not found')
    expect(await api.deleteDepartment(d.id)).toEqual({ deleted: true })
  })
})

describe('staff attendance day sheet', () => {
  it('stores a hand-keyed day exactly as the sheet sends it and reads it back in the declared shape', async () => {
    const id = await person('Hana Ito')
    await api.updateStaff(id, { expected_login: '09:00', expected_logout: '17:00' })

    // The payload StaffAttendanceSheet.save() builds for a fresh row.
    const login = '09:05', logout = '17:30'
    const created = await api.createStaffAttendance({
      staff_id: id, work_date: '2026-08-03', login_at: login, logout_at: logout, break_min: 30,
      status: impliedStatus(login, logout),
    })
    expectShape(created, StaffAttendanceRowSpec)
    expect(created).toMatchObject({
      source: 'manual', edited: true, staff_id: id, staff_name: 'Hana Ito', work_date: '2026-08-03',
      login_at: '09:05', logout_at: '17:30', break_min: 30, status: 'present', note: '',
    })
    expect(created.id).toEqual(expect.any(Number))
    expect(sql('SELECT login_at::text AS i, logout_at::text AS o, break_min, status FROM staff_attendance'))
      .toEqual([{ i: '09:05:00', o: '17:30:00', break_min: 30, status: 'present' }])

    const page = await api.staffAttendance(monthRange('2026-08'))
    expectShape(page, StaffAttendancePageSpec)
    expect(page).toMatchObject({ timezone: 'America/New_York', from: '2026-08-01', to: '2026-08-31', fetched: true })
    expect(page.rows).toHaveLength(1)

    // What the sheet derives from the row it was given.
    const row = page.rows[0]
    expect(netHours(row.login_at ?? '', row.logout_at ?? '', row.break_min)).toBeCloseTo(7.917, 2)
    expect(lateBy(row.login_at, '09:00')).toBe(5)
    expect(earlyBy(row.logout_at, '17:00')).toBe(0)
    expect(clockLabel(row.login_at)).toBe('9:05 AM')
    const staff = await api.staff()
    expect(loginTallies(staff, page.rows).get(id)).toEqual({ late: 1, onTime: 0, judged: 1, lateMin: 5, worstLateMin: 5 })

    // Re-keying the same day updates it; a cleared logout comes back null and the row can say "still in".
    const updated = await api.updateStaffAttendance(created.id as number, { logout_at: null, status: impliedStatus(login, null) })
    expect(updated).toMatchObject({ id: created.id, logout_at: null, status: 'still in', break_min: 30 })
    const rekeyed = await api.createStaffAttendance({ staff_id: id, work_date: '2026-08-03', login_at: '10:00', status: 'present' })
    expect(rekeyed.id).toBe(created.id)
    expect(rekeyed.login_at).toBe('10:00')

    expect(await api.deleteStaffAttendance(created.id as number)).toEqual({ deleted: true })
    expect((await api.staffAttendance(monthRange('2026-08'))).rows).toEqual([])
  })

  it('shows a bot-recorded day read-only (id null) in org-local clock time, and an override replaces it', async () => {
    seedBotStaff(7002, 'Ivy Jones', 'ivy')
    const id = await person('Ivy Jones')
    // 9:07 AM and 5:02 PM New York time on a summer (EDT) day, plus two breaks.
    seedBotDay(7002, '2026-08-04', '2026-08-04 09:07:00-04', '2026-08-04 17:02:00-04', 'Ivy Jones')
    seedBotBreak(7002, '2026-08-04', '2026-08-04 12:00:00-04', '2026-08-04 12:40:00-04', 40)
    seedBotBreak(7002, '2026-08-04', '2026-08-04 15:00:00-04', '2026-08-04 15:30:00-04', 30)

    const page = await api.staffAttendance({ from: '2026-08-04', to: '2026-08-04', staff_id: id })
    expectShape(page, StaffAttendancePageSpec)
    expect(page.rows).toEqual([{
      id: null, source: 'fetched', edited: false, staff_id: id, staff_name: 'Ivy Jones', work_date: '2026-08-04',
      login_at: '09:07', logout_at: '17:02', break_min: 70, status: 'present', note: '',
    }])
    expect(impliedStatus(page.rows[0].login_at, page.rows[0].logout_at)).toBe(page.rows[0].status)

    // The first edit of a bot day POSTs (no id); the answer is the fetched row carrying the override.
    const over = await api.createStaffAttendance({
      staff_id: id, work_date: '2026-08-04', login_at: '09:07', logout_at: '17:02', break_min: 45, status: 'present',
    })
    expectShape(over, StaffAttendanceRowSpec)
    expect(over).toMatchObject({ source: 'fetched', edited: true, break_min: 45, login_at: '09:07' })
    expect(over.id).toEqual(expect.any(Number))

    const after = await api.staffAttendance({ from: '2026-08-04', to: '2026-08-04' })
    expect(after.rows).toHaveLength(1) // the override never shows as a second, manual row
    expect(after.rows[0]).toMatchObject({ id: over.id, source: 'fetched', edited: true, break_min: 45 })

    // PUT on an override answers with the fetched row too; deleting it restores the bot's day.
    const half = await api.updateStaffAttendance(over.id as number, { status: 'half day' })
    expect(half).toMatchObject({ source: 'fetched', status: 'half day' })
    await api.deleteStaffAttendance(over.id as number)
    expect((await api.staffAttendance({ from: '2026-08-04', to: '2026-08-04' })).rows[0])
      .toMatchObject({ id: null, edited: false, break_min: 70, status: 'present' })
  })

  it('rejects what the server refuses with its message', async () => {
    const id = await person('Jo King')
    expect(await rejectionOf(api.createStaffAttendance({ staff_id: 0, work_date: '2026-08-03' }))).toBe('Pick a staff member')
    expect(lastStatus(server)).toBe(422)
    expect(await rejectionOf(api.createStaffAttendance({ staff_id: id, work_date: '2026-02-30' }))).toBe('A date is required')
    expect(await rejectionOf(api.updateStaffAttendance(424_242, { note: 'x' }))).toBe('Attendance row not found')
    expect(lastStatus(server)).toBe(404)
  })
})

describe('leaves sheet', () => {
  it('round-trips the payload StaffLeavesSheet sends and feeds returnVerdict', async () => {
    const dept = await api.createDepartment('Ops')
    const id = await person('Kai Lee')
    const created = await api.createStaffLeave({
      staff_id: id, department_id: dept.id, leave_date: '2026-08-10', sick_leave: 'Approved', break_leave: '',
      half_day: '', late_login: '', aob: '', expected_return: '2026-08-12', actual_return: '2026-08-14',
    })
    expectShape(created, StaffLeaveSpec)
    expect(created).toMatchObject({
      staff_name: 'Kai Lee', department_id: dept.id, department_name: 'Ops', leave_date: '2026-08-10',
      sick_leave: 'Approved', expected_return: '2026-08-12', actual_return: '2026-08-14',
    })
    expect(returnVerdict(created.expected_return, created.actual_return)).toMatchObject({ id: 'late', days: 2 })

    // An update clears a return date with null and leaves unsent markers alone.
    const cleared = await api.updateStaffLeave(created.id, { actual_return: null, department_id: null })
    expect(cleared).toMatchObject({ actual_return: null, expected_return: '2026-08-12', sick_leave: 'Approved', department_id: null, department_name: null })
    expect(returnVerdict(cleared.expected_return, cleared.actual_return, '2026-08-20')).toMatchObject({ id: 'overdue', days: 8 })

    await api.createStaffLeave({ staff_id: id, leave_date: '2026-09-01', half_day: 'Approved' })
    const aug = await api.staffLeaves(monthRange('2026-08'))
    expectShape(aug, arrayOf(StaffLeaveSpec))
    expect(aug.map((l) => l.leave_date)).toEqual(['2026-08-10'])
  })

  it('rejects an unknown person, a bad date and an unknown row', async () => {
    const id = await person('Lou Moss')
    expect(await rejectionOf(api.createStaffLeave({ staff_id: 99_999, leave_date: '2026-08-01' }))).toBe('Pick a staff member')
    expect(await rejectionOf(api.createStaffLeave({ staff_id: id, leave_date: '01/08/2026' }))).toBe('A date is required')
    expect(await rejectionOf(api.updateStaffLeave(99_999, { aob: 'x' }))).toBe('Leave row not found')
    expect(lastStatus(server)).toBe(404)
  })
})

describe('salary sheet', () => {
  it('stores one row per person per month with a numeric amount', async () => {
    const dept = await api.createDepartment('Finance')
    const id = await person('Mia Nash')
    const created = await api.createStaffSalary({ staff_id: id, department_id: dept.id, month: '2026-08', status: 'Received', amount: 1500.5 })
    expectShape(created, StaffSalarySpec)
    expect(created).toMatchObject({ month: '2026-08-01', status: 'Received', amount: 1500.5, department_name: 'Finance' })

    // Posting again for the same month updates the row rather than adding one.
    const again = await api.createStaffSalary({ staff_id: id, month: '2026-08-15', status: 'Pending' })
    expect(again.id).toBe(created.id)
    expect(again).toMatchObject({ status: 'Pending', amount: null, department_id: null })

    const updated = await api.updateStaffSalary(created.id, { amount: 1200 })
    expect(updated.amount).toBe(1200)
    expect(typeof updated.amount).toBe('number')

    const list = await api.staffSalaries('2026-08')
    expectShape(list, arrayOf(StaffSalarySpec))
    expect(list).toHaveLength(1)
    expect(await api.staffSalaries('2026-07')).toEqual([])
  })

  it('rejects a bad month and an unknown row', async () => {
    const id = await person('Ned Oak')
    expect(await rejectionOf(api.createStaffSalary({ staff_id: id, month: '2026-13' }))).toBe('month must be YYYY-MM')
    expect(await rejectionOf(api.staffSalaries('August'))).toBe('month must be YYYY-MM')
    expect(await rejectionOf(api.updateStaffSalary(99_999, { status: 'x' }))).toBe('Salary row not found')
  })
})

describe('salary hold log', () => {
  it('keeps every month, newest first, with only the two allowed statuses', async () => {
    const a = await person('Ola Park')
    const b = await person('Pia Quin')
    const first = await api.createStaffSalaryHold({ staff_id: a, month: '2026-07', reason: 'Missing timesheet\nfor week 2' })
    expectShape(first, StaffSalaryHoldSpec)
    expect(first).toMatchObject({ status: 'On Hold', month: '2026-07-01', reason: 'Missing timesheet\nfor week 2' })
    await api.createStaffSalaryHold({ staff_id: a, month: '2026-08', reason: 'Bank details', status: 'Disbursed' })

    const moved = await api.updateStaffSalaryHold(first.id, { staff_id: b, month: '2026-09', status: 'Disbursed' })
    expect(moved).toMatchObject({ staff_id: b, staff_name: 'Pia Quin', month: '2026-09-01', status: 'Disbursed' })

    const all = await api.staffSalaryHolds()
    expectShape(all, arrayOf(StaffSalaryHoldSpec))
    expect(all.map((h) => h.month)).toEqual(['2026-09-01', '2026-08-01'])

    expect(await rejectionOf(api.createStaffSalaryHold({ staff_id: a, month: '2026-08', status: 'Paid' })))
      .toBe('status must be "On Hold" or "Disbursed"')
    expect(await rejectionOf(api.updateStaffSalaryHold(first.id, { month: 'soon' }))).toBe('month must be YYYY-MM')
    expect(await rejectionOf(api.updateStaffSalaryHold(first.id, { staff_id: 0 }))).toBe('Pick a staff member')
    expect(await rejectionOf(api.updateStaffSalaryHold(99_999, { reason: 'x' }))).toBe('Salary hold row not found')
    expect(await api.deleteStaffSalaryHold(first.id)).toEqual({ deleted: true })
  })
})

describe('roster-wide lib figures from real rows', () => {
  it('tallyLogins over a month of fetched + hand-keyed days matches the per-day marks', async () => {
    seedBotStaff(7003, 'Quin Ray')
    const id = await person('Quin Ray')
    await api.updateStaff(id, { expected_login: '09:00' })
    seedBotDay(7003, '2026-08-03', '2026-08-03 08:55:00-04', '2026-08-03 17:00:00-04')
    seedBotDay(7003, '2026-08-04', '2026-08-04 09:20:00-04', '2026-08-04 17:00:00-04')
    await api.createStaffAttendance({ staff_id: id, work_date: '2026-08-05', login_at: '09:45', logout_at: '17:00', status: 'present' })

    const page = await api.staffAttendance(monthRange('2026-08'))
    const mine = page.rows.filter((r) => r.staff_id === id)
    expect(mine.map((r) => [r.work_date, r.source, r.login_at])).toEqual([
      ['2026-08-05', 'manual', '09:45'],
      ['2026-08-04', 'fetched', '09:20'],
      ['2026-08-03', 'fetched', '08:55'],
    ])
    expect(tallyLogins(mine.map((r) => r.login_at), '09:00')).toEqual({ late: 2, onTime: 1, judged: 3, lateMin: 65, worstLateMin: 45 })
    expectShape(page.rows, arrayOf(obj({ staff_id: 'int', login_at: { nullable: 'hhmm' } })))
  })
})
