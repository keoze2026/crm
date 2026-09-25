import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StaffMember, StaffStatus } from '../types'
import {
  addLogin,
  ATTENDANCE_STATUSES,
  clockLabel,
  earlyBy,
  emptyLoginTally,
  gapLabel,
  hoursLabel,
  impliedStatus,
  lateBy,
  loginTallies,
  monthRange,
  netHours,
  ORG_TZ,
  orgNowLabel,
  orgToday,
  punctuality,
  punctualityOf,
  returnVerdict,
  SALARY_HOLD_STATUSES,
  salaryHoldStatus,
  shortDay,
  staffStatus,
  sumLoginTallies,
  tallyLogins,
  tallyPunctuality,
} from './staff'

function member(over: Partial<StaffMember> = {}): StaffMember {
  return {
    id: 1,
    name: 'Anna',
    departments: [],
    attendance_user_id: null,
    status: 'active',
    expected_login: '09:00',
    expected_logout: '17:00',
    sort_order: 0,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
    ...over,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('status lookups', () => {
  it('finds a salary hold status by id and defaults to On Hold', () => {
    expect(salaryHoldStatus('Disbursed').label).toBe('Disbursed')
    expect(salaryHoldStatus('On Hold').label).toBe('On Hold')
    expect(salaryHoldStatus('something else')).toBe(SALARY_HOLD_STATUSES[0])
    expect(salaryHoldStatus('')).toBe(SALARY_HOLD_STATUSES[0])
  })

  it('stores the salary hold wording as its id', () => {
    for (const s of SALARY_HOLD_STATUSES) expect(s.id).toBe(s.label)
  })

  it('finds a staff status by id and defaults to Active', () => {
    expect(staffStatus('leave').label).toBe('Leave')
    expect(staffStatus('inactive').label).toBe('Inactive')
    expect(staffStatus('retired' as StaffStatus).label).toBe('Active')
  })

  it('includes the server-derived "still in" among the attendance statuses', () => {
    expect(ATTENDANCE_STATUSES).toContain('still in')
  })
})

describe('impliedStatus', () => {
  it('reads an empty row from its clock times', () => {
    expect(impliedStatus(null, null)).toBe('absent')
    expect(impliedStatus('', '17:00')).toBe('absent')
    expect(impliedStatus('09:00', null)).toBe('still in')
    expect(impliedStatus('09:00', '')).toBe('still in')
    expect(impliedStatus('09:00', '17:00')).toBe('present')
  })
})

describe('returnVerdict', () => {
  it('has nothing to judge without an expected date', () => {
    expect(returnVerdict(null, '2026-09-10', '2026-09-20')).toBeNull()
    expect(returnVerdict('', null, '2026-09-20')).toBeNull()
  })

  it('has nothing to judge for a malformed expected date', () => {
    expect(returnVerdict('soon', null, '2026-09-20')).toBeNull()
    expect(returnVerdict('2026-09', null, '2026-09-20')).toBeNull()
  })

  it('flags a late return with the day count', () => {
    const v = returnVerdict('2026-09-10', '2026-09-13', '2026-09-20')
    expect(v).toMatchObject({ id: 'late', days: 3, label: '3 days late' })
  })

  it('uses the singular for one day', () => {
    expect(returnVerdict('2026-09-10', '2026-09-11', '2026-09-20')?.label).toBe('1 day late')
    expect(returnVerdict('2026-09-10', '2026-09-09', '2026-09-20')?.label).toBe('1 day early')
  })

  it('flags an early return', () => {
    expect(returnVerdict('2026-09-10', '2026-09-07', '2026-09-20')).toMatchObject({ id: 'early', days: 3, label: '3 days early' })
  })

  it('marks a return on the day as on time', () => {
    expect(returnVerdict('2026-09-10', '2026-09-10', '2026-09-20')).toMatchObject({ id: 'on-time', days: 0, label: 'On time' })
  })

  it('counts across month ends and leap days', () => {
    expect(returnVerdict('2026-02-28', '2026-03-01', '2026-03-05')?.days).toBe(1)
    expect(returnVerdict('2028-02-28', '2028-03-01', '2028-03-05')?.days).toBe(2)
    expect(returnVerdict('2026-12-31', '2027-01-02', '2027-01-05')?.days).toBe(2)
  })

  it('is not thrown off by a daylight-saving change', () => {
    expect(returnVerdict('2026-03-07', '2026-03-09', '2026-03-20')?.days).toBe(2)
    expect(returnVerdict('2026-10-31', '2026-11-02', '2026-11-20')?.days).toBe(2)
  })

  it('marks someone not yet back as overdue once the due day has passed', () => {
    expect(returnVerdict('2026-09-10', null, '2026-09-11')).toMatchObject({ id: 'overdue', days: 1, label: '1 day overdue' })
    expect(returnVerdict('2026-09-10', null, '2026-09-15')).toMatchObject({ id: 'overdue', days: 5, label: '5 days overdue' })
  })

  it('says nothing while the due day is today or still ahead', () => {
    expect(returnVerdict('2026-09-10', null, '2026-09-10')).toBeNull()
    expect(returnVerdict('2026-09-10', null, '2026-09-01')).toBeNull()
  })

  it('says nothing for a malformed actual or today', () => {
    expect(returnVerdict('2026-09-10', 'back', '2026-09-20')).toBeNull()
    expect(returnVerdict('2026-09-10', null, 'whenever')).toBeNull()
  })

  it('judges "has passed" against the org day, not the browser day', () => {
    vi.useFakeTimers()
    // 02:00 UTC on the 12th is still 22:00 on the 11th in New York.
    vi.setSystemTime(new Date('2026-09-12T02:00:00Z'))
    expect(returnVerdict('2026-09-10', null)).toMatchObject({ id: 'overdue', days: 1 })
    expect(returnVerdict('2026-09-11', null)).toBeNull()
  })
})

describe('orgToday / orgNowLabel', () => {
  it('keeps attendance on New York time', () => {
    expect(ORG_TZ).toBe('America/New_York')
  })

  it('is still yesterday in New York when UTC has passed midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T03:30:00Z')) // 23:30 EDT on the 23rd
    expect(orgToday()).toBe('2026-09-23')
  })

  it('rolls over at New York midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T04:00:00Z')) // 00:00 EDT on the 24th
    expect(orgToday()).toBe('2026-09-24')
  })

  it('follows standard time in winter', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-01-01T04:59:00Z')) // 23:59 EST on 31 Dec
    expect(orgToday()).toBe('2026-12-31')
    vi.setSystemTime(new Date('2027-01-01T05:00:00Z'))
    expect(orgToday()).toBe('2027-01-01')
  })

  it('reaches a leap day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2028-02-29T12:00:00Z'))
    expect(orgToday()).toBe('2028-02-29')
  })

  it('stamps the New York wall clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-23T13:07:00Z')) // 09:07 EDT
    expect(orgNowLabel()).toMatch(/^9:07\sAM$/)
    vi.setSystemTime(new Date('2026-09-23T16:30:00Z')) // 12:30 EDT
    expect(orgNowLabel()).toMatch(/^12:30\sPM$/)
  })
})

describe('monthRange', () => {
  it('spans the first to the last day of the month', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(monthRange('2026-01')).toEqual({ from: '2026-01-01', to: '2026-01-31' })
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' })
  })

  it('knows February in leap and common years', () => {
    expect(monthRange('2026-02').to).toBe('2026-02-28')
    expect(monthRange('2028-02').to).toBe('2028-02-29')
    expect(monthRange('2100-02').to).toBe('2100-02-28')
    expect(monthRange('2000-02').to).toBe('2000-02-29')
  })
})

describe('shortDay', () => {
  it('formats as "D-Mon"', () => {
    expect(shortDay('2026-08-31')).toBe('31-Aug')
    expect(shortDay('2026-09-01')).toBe('1-Sep')
    expect(shortDay('2028-02-29')).toBe('29-Feb')
  })

  it('passes an unparseable value through', () => {
    expect(shortDay('someday')).toBe('someday')
  })
})

describe('clockLabel', () => {
  it('renders 12-hour time', () => {
    expect(clockLabel('09:05')).toBe('9:05 AM')
    expect(clockLabel('13:30')).toBe('1:30 PM')
    expect(clockLabel('23:59')).toBe('11:59 PM')
  })

  it('handles midnight and noon', () => {
    expect(clockLabel('00:00')).toBe('12:00 AM')
    expect(clockLabel('12:00')).toBe('12:00 PM')
  })

  it('ignores seconds', () => {
    expect(clockLabel('09:05:30')).toBe('9:05 AM')
  })

  it('renders blank as an em dash and garbage as-is', () => {
    expect(clockLabel(null)).toBe('—')
    expect(clockLabel('')).toBe('—')
    expect(clockLabel('ab:cd')).toBe('ab:cd')
  })

  it('passes a value with no minutes through as-is', () => {
    expect(clockLabel('9')).toBe('9')
  })
})

describe('hoursLabel', () => {
  it('shows one decimal with an h', () => {
    expect(hoursLabel(7.66)).toBe('7.7h')
    expect(hoursLabel(0)).toBe('0.0h')
    expect(hoursLabel(8)).toBe('8.0h')
  })

  it('renders unknown as an em dash', () => {
    expect(hoursLabel(null)).toBe('—')
  })
})

describe('netHours', () => {
  it('subtracts the break from the span', () => {
    expect(netHours('09:00', '17:00', 60)).toBe(7)
    expect(netHours('09:15', '17:45', 30)).toBe(8)
  })

  it('reads a logout before the login as an overnight shift', () => {
    expect(netHours('22:00', '06:00', 30)).toBe(7.5)
  })

  it('is zero for the same login and logout', () => {
    expect(netHours('09:00', '09:00', 0)).toBe(0)
  })

  it('never goes negative when the break outlasts the day', () => {
    expect(netHours('09:00', '09:30', 60)).toBe(0)
  })

  it('is null when a clock time is blank or malformed', () => {
    expect(netHours('', '17:00', 0)).toBeNull()
    expect(netHours('09:00', 'late', 0)).toBeNull()
    expect(netHours('9', '17:00', 0)).toBeNull()
  })
})

describe('lateBy / earlyBy', () => {
  it('counts minutes past the expected login', () => {
    expect(lateBy('09:07', '09:00')).toBe(7)
    expect(lateBy('10:35', '09:00')).toBe(95)
  })

  it('is 0, not null, for an on-time or early login', () => {
    expect(lateBy('09:00', '09:00')).toBe(0)
    expect(lateBy('08:30', '09:00')).toBe(0)
  })

  it('counts minutes short of the expected logout', () => {
    expect(earlyBy('16:45', '17:00')).toBe(15)
    expect(earlyBy('17:00', '17:00')).toBe(0)
    expect(earlyBy('18:00', '17:00')).toBe(0)
  })

  it('is null when there is no schedule or no clock time', () => {
    expect(lateBy(null, '09:00')).toBeNull()
    expect(lateBy('09:10', null)).toBeNull()
    expect(earlyBy(null, '17:00')).toBeNull()
    expect(earlyBy('16:00', null)).toBeNull()
    expect(lateBy('', '09:00')).toBeNull()
  })
})

describe('gapLabel', () => {
  it('shows minutes alone under an hour', () => {
    expect(gapLabel(0)).toBe('0m')
    expect(gapLabel(7)).toBe('7m')
    expect(gapLabel(59)).toBe('59m')
  })

  it('shows hours and zero-padded minutes from an hour up', () => {
    expect(gapLabel(60)).toBe('1h 00m')
    expect(gapLabel(95)).toBe('1h 35m')
    expect(gapLabel(605)).toBe('10h 05m')
  })
})

describe('punctuality', () => {
  it('gives no verdict when neither side can be judged', () => {
    expect(punctuality(null, null)).toBeNull()
  })

  it('is on time when nothing fired, including with one side unknown', () => {
    expect(punctuality(0, 0)).toMatchObject({ id: 'on-time', marks: 0, detail: 'On schedule' })
    expect(punctuality(0, null)).toMatchObject({ id: 'on-time', marks: 0 })
    expect(punctuality(null, 0)).toMatchObject({ id: 'on-time', marks: 0 })
  })

  it('marks a late login', () => {
    expect(punctuality(7, 0)).toMatchObject({ id: 'late', label: 'Late in', marks: 1, detail: '7m late in' })
    expect(punctuality(95, null)).toMatchObject({ id: 'late', detail: '1h 35m late in' })
  })

  it('marks an early logout', () => {
    expect(punctuality(0, 15)).toMatchObject({ id: 'early', label: 'Early out', marks: 1, detail: '15m early out' })
    expect(punctuality(null, 15)).toMatchObject({ id: 'early' })
  })

  it('marks both, with both minutes in the detail', () => {
    expect(punctuality(10, 20)).toMatchObject({
      id: 'both',
      label: 'Late in + early out',
      short: 'Late + early',
      marks: 2,
      detail: '10m late in · 20m early out',
    })
  })
})

describe('punctualityOf', () => {
  it('judges straight from clock times', () => {
    expect(punctualityOf('09:10', '16:50', '09:00', '17:00')?.id).toBe('both')
    expect(punctualityOf('09:00', '17:00', '09:00', '17:00')?.id).toBe('on-time')
    expect(punctualityOf('09:10', null, '09:00', '17:00')?.id).toBe('late')
  })

  it('gives no verdict to somebody with no schedule', () => {
    expect(punctualityOf('09:10', '16:50', null, null)).toBeNull()
  })

  it('gives no verdict to an absent day', () => {
    expect(punctualityOf(null, null, '09:00', '17:00')).toBeNull()
  })
})

describe('tallyPunctuality', () => {
  it('is all zeros for no days', () => {
    expect(tallyPunctuality([])).toEqual({ onTime: 0, late: 0, early: 0, both: 0, flagged: 0, judged: 0 })
  })

  it('counts each verdict, with "both" also counted as late and early', () => {
    const days = [
      punctuality(0, 0),
      punctuality(5, 0),
      punctuality(0, 5),
      punctuality(5, 5),
      null,
      punctuality(0, null),
    ]
    expect(tallyPunctuality(days)).toEqual({ onTime: 2, late: 2, early: 2, both: 1, flagged: 3, judged: 5 })
  })
})

describe('login tallies', () => {
  it('starts empty', () => {
    expect(emptyLoginTally()).toEqual({ late: 0, onTime: 0, judged: 0, lateMin: 0, worstLateMin: 0 })
  })

  it('folds a day in place, skipping unjudged days', () => {
    const t = emptyLoginTally()
    expect(addLogin(t, null)).toBe(t)
    expect(t.judged).toBe(0)
    addLogin(t, 0)
    addLogin(t, 12)
    addLogin(t, 40)
    expect(t).toEqual({ late: 2, onTime: 1, judged: 3, lateMin: 52, worstLateMin: 40 })
  })

  it('tallies one person against their own expected login', () => {
    expect(tallyLogins(['09:00', '09:05', null, '08:55', '10:00'], '09:00'))
      .toEqual({ late: 2, onTime: 2, judged: 4, lateMin: 65, worstLateMin: 60 })
  })

  it('never judges somebody without an expected login', () => {
    expect(tallyLogins(['11:00', '12:00'], null)).toEqual(emptyLoginTally())
  })

  it('gives everyone on the roster an entry and ignores rows for nobody', () => {
    const staff = [member({ id: 1 }), member({ id: 2, expected_login: '08:00' }), member({ id: 3 })]
    const rows = [
      { staff_id: 1, login_at: '09:10' },
      { staff_id: 1, login_at: '09:00' },
      { staff_id: 2, login_at: '08:30' },
      { staff_id: 99, login_at: '12:00' },
    ]
    const tallies = loginTallies(staff, rows)
    expect([...tallies.keys()]).toEqual([1, 2, 3])
    expect(tallies.get(1)).toEqual({ late: 1, onTime: 1, judged: 2, lateMin: 10, worstLateMin: 10 })
    expect(tallies.get(2)).toEqual({ late: 1, onTime: 0, judged: 1, lateMin: 30, worstLateMin: 30 })
    expect(tallies.get(3)).toEqual(emptyLoginTally())
  })

  it('sums tallies, keeping the single worst day', () => {
    const a = { late: 1, onTime: 3, judged: 4, lateMin: 10, worstLateMin: 10 }
    const b = { late: 2, onTime: 1, judged: 3, lateMin: 50, worstLateMin: 45 }
    expect(sumLoginTallies([a, b])).toEqual({ late: 3, onTime: 4, judged: 7, lateMin: 60, worstLateMin: 45 })
    expect(sumLoginTallies(new Map([[1, a]]).values())).toEqual(a)
    expect(sumLoginTallies([])).toEqual(emptyLoginTally())
  })
})
