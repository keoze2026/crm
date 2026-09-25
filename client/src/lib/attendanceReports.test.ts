import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CellHookData, UserOptions } from 'jspdf-autotable'
import type { AttendanceDay } from '../types'
import {
  BREAK_ALLOWANCE_MIN,
  TARGET_LOGIN_MIN,
  aggregateBreaks,
  buildAllUsersBreakPdf,
  buildTeamBreakPdf,
  buildUserBreakPdf,
  fmtHm,
  hoursCell,
  isLateLogin,
  labelOf,
  loginLateMinutes,
  loginMonthSheet,
  monthName,
  periodLabel,
  tallyByMonth,
  teamBreakSheet,
  userBreakSheet,
  type BreakStat,
} from './attendanceReports'

const h = vi.hoisted(() => {
  interface TextCall { text: string | string[]; x: number; y: number }
  class FakeDoc {
    orientation: string
    texts: TextCall[] = []
    pages = 1
    lastAutoTable = { finalY: 0 }
    internal: { pageSize: { getWidth: () => number; getHeight: () => number } }
    constructor(opts: { orientation?: string } = {}) {
      this.orientation = opts.orientation ?? 'portrait'
      const land = this.orientation === 'landscape'
      this.internal = {
        pageSize: { getWidth: () => (land ? 841.89 : 595.28), getHeight: () => (land ? 595.28 : 841.89) },
      }
      state.docs.push(this)
    }
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    setFillColor() {}
    roundedRect() {}
    text(text: string | string[], x: number, y: number) { this.texts.push({ text, x, y }) }
    splitTextToSize(t: string) { return [t] }
    addPage() { this.pages += 1 }
  }
  const state = {
    docs: [] as FakeDoc[],
    tables: [] as { doc: FakeDoc; opts: UserOptions }[],
    finalY: null as number | null,
  }
  return { FakeDoc, state }
})

vi.mock('jspdf', () => ({ jsPDF: h.FakeDoc }))
vi.mock('jspdf-autotable', () => ({
  default: (doc: InstanceType<typeof h.FakeDoc>, opts: UserOptions) => {
    h.state.tables.push({ doc, opts })
    doc.lastAutoTable = { finalY: h.state.finalY ?? Number(opts.startY ?? 0) + 100 }
  },
}))

type FakeDoc = InstanceType<typeof h.FakeDoc>

beforeEach(() => {
  h.state.docs.length = 0
  h.state.tables.length = 0
  h.state.finalY = null
})

function day(over: Partial<AttendanceDay> = {}): AttendanceDay {
  return {
    user_id: 'u1',
    staff_name: 'Anna',
    username: 'anna',
    work_date: '2026-06-01',
    login_at: null,
    login_stated: null,
    logout_at: null,
    logout_stated: null,
    present: false,
    still_in: false,
    completed: false,
    status: 'absent',
    status_set: false,
    edited: false,
    bot_seen: true,
    staff_id: null,
    hours: null,
    net_hours: null,
    break_min: 0,
    break_count: 0,
    break_detail: '',
    over_break_min: 0,
    break_actual_min: 0,
    late_return_count: 0,
    late_return_min: 0,
    out_till_eod_count: 0,
    on_break: false,
    expected_login: null,
    expected_logout: null,
    late_min: null,
    early_min: null,
    ...over,
  }
}

/** A cell's styles after the table's didParseCell hook has run over it. */
function styleOf(opts: UserOptions, section: 'head' | 'body', row: number, col: number, raw: unknown = '') {
  const styles: Record<string, unknown> = {}
  opts.didParseCell?.({ section, row: { index: row }, column: { index: col }, cell: { styles, raw } } as unknown as CellHookData)
  return styles
}

const allText = (doc: FakeDoc): string[] => doc.texts.flatMap((t) => (Array.isArray(t.text) ? t.text : [t.text]))

// June is EDT (UTC-4): 13:20Z is 9:20 AM in New York.
const anna = [
  day({ work_date: '2026-06-02', login_at: '2026-06-02T13:20:00Z', logout_at: '2026-06-02T21:30:00Z', hours: 8, break_min: 70, over_break_min: 10 }),
  day({ work_date: '2026-06-01', login_at: '2026-06-01T12:50:00Z', logout_at: '2026-06-01T21:00:00Z', hours: 7.5, break_min: 30 }),
  day({ work_date: '2026-06-03' }),
]
const ben = [
  day({ user_id: 'u2', staff_name: null, username: 'ben', work_date: '2026-06-01', login_at: '2026-06-01T14:00:00Z', late_min: 0, hours: 9, break_min: 100, over_break_min: 40 }),
]

describe('constants', () => {
  it('uses a 60-minute break allowance and a 9:00 AM fallback login', () => {
    expect(BREAK_ALLOWANCE_MIN).toBe(60)
    expect(TARGET_LOGIN_MIN).toBe(540)
  })
})

describe('loginLateMinutes', () => {
  it('returns null when there is no login to judge', () => {
    expect(loginLateMinutes(day({ late_min: 15 }))).toBeNull()
  })

  it('prefers the server-computed late_min, including an explicit 0', () => {
    expect(loginLateMinutes(day({ login_at: '2026-06-01T15:00:00Z', late_min: 0 }))).toBe(0)
    expect(loginLateMinutes(day({ login_at: '2026-06-01T12:00:00Z', late_min: 12 }))).toBe(12)
  })

  it('falls back to minutes past 9:00 AM New York time', () => {
    expect(loginLateMinutes(day({ login_at: '2026-06-01T13:15:00Z' }))).toBe(15)
    // January is EST (UTC-5).
    expect(loginLateMinutes(day({ login_at: '2026-01-05T14:45:00Z' }))).toBe(45)
  })

  it('floors an early login at 0', () => {
    expect(loginLateMinutes(day({ login_at: '2026-06-01T12:30:00Z' }))).toBe(0)
    expect(loginLateMinutes(day({ login_at: '2026-06-01T13:00:00Z' }))).toBe(0)
  })

  it('reads midnight as minute 0, not 24:00', () => {
    expect(loginLateMinutes(day({ login_at: '2026-06-01T04:00:00Z' }))).toBe(0)
  })

  it('returns null for an unparseable timestamp rather than throwing', () => {
    expect(loginLateMinutes(day({ login_at: 'not-a-date' }))).toBeNull()
  })
})

describe('isLateLogin', () => {
  it('is true only for a positive lateness', () => {
    expect(isLateLogin(day({ login_at: '2026-06-01T13:01:00Z' }))).toBe(true)
    expect(isLateLogin(day({ login_at: '2026-06-01T13:00:00Z' }))).toBe(false)
    expect(isLateLogin(day())).toBe(false)
  })
})

describe('labelOf', () => {
  it('prefers the name, then @username, then the user id', () => {
    expect(labelOf({ staff_name: 'Anna', username: 'anna', user_id: 'u1' })).toBe('Anna')
    expect(labelOf({ staff_name: null, username: 'anna', user_id: 'u1' })).toBe('@anna')
    expect(labelOf({ staff_name: '', username: null, user_id: 'u1' })).toBe('u1')
  })
})

describe('fmtHm', () => {
  it('renders zero, empty and negative input as 0m', () => {
    expect(fmtHm(0)).toBe('0m')
    expect(fmtHm(null)).toBe('0m')
    expect(fmtHm(undefined)).toBe('0m')
    expect(fmtHm(Number.NaN)).toBe('0m')
    expect(fmtHm(-30)).toBe('0m')
  })

  it('renders minutes, whole hours and mixed durations', () => {
    expect(fmtHm(45)).toBe('45m')
    expect(fmtHm(60)).toBe('1h')
    expect(fmtHm(125)).toBe('2h 5m')
  })

  it('rounds fractional minutes', () => {
    expect(fmtHm(59.6)).toBe('1h')
    expect(fmtHm(0.4)).toBe('0m')
  })
})

describe('hoursCell', () => {
  it('prints one decimal place, or an em dash when unknown', () => {
    expect(hoursCell(12.66)).toBe('12.7h')
    expect(hoursCell(0)).toBe('0.0h')
    expect(hoursCell(null)).toBe('—')
    expect(hoursCell(undefined)).toBe('—')
  })
})

describe('aggregateBreaks', () => {
  it('returns nothing for no rows', () => {
    expect(aggregateBreaks([])).toEqual([])
  })

  it('rolls each member up and ranks by break-time over the allowance', () => {
    const stats = aggregateBreaks([...anna, ...ben])
    expect(stats.map((s) => s.user_id)).toEqual(['u2', 'u1'])

    const a = stats[1]
    expect(a).toMatchObject({
      staff_name: 'Anna',
      username: 'anna',
      daysPresent: 2,
      daysWithBreak: 2,
      totalHours: 15.5,
      totalBreakMin: 100,
      totalOverMin: 10,
      overDays: 1,
      avgBreakMin: 50,
      worstOverMin: 10,
      lateDays: 1,
      onTimeDays: 1,
      totalLateMin: 20,
      worstLateMin: 20,
    })
    expect(a.rows.map((r) => r.work_date)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03'])

    expect(stats[0]).toMatchObject({ staff_name: null, username: 'ben', daysPresent: 1, lateDays: 0, onTimeDays: 1, totalOverMin: 40 })
  })

  it('gives a member with no logins a zero average rather than NaN', () => {
    const [s] = aggregateBreaks([day({ break_min: 20 })])
    expect(s.daysPresent).toBe(0)
    expect(s.avgBreakMin).toBe(0)
    expect(s.lateDays + s.onTimeDays).toBe(0)
  })

  it('breaks ties alphabetically by label', () => {
    const stats = aggregateBreaks([
      day({ user_id: 'z', staff_name: 'Carl' }),
      day({ user_id: 'y', staff_name: 'Abe' }),
      day({ user_id: 'x', staff_name: 'Bo', over_break_min: 5 }),
    ])
    expect(stats.map(labelOf)).toEqual(['Bo', 'Abe', 'Carl'])
  })
})

describe('periodLabel', () => {
  it('shows a single day once and a range with an en dash', () => {
    expect(periodLabel('2026-06-01', '2026-06-01')).toBe('1-Jun-26')
    expect(periodLabel('2026-06-01', '2026-06-30')).toBe('1-Jun-26  –  30-Jun-26')
  })
})

describe('monthName', () => {
  it('names a YYYY-MM month in full', () => {
    expect(monthName('2026-06')).toBe('June 2026')
    expect(monthName('2025-12')).toBe('December 2025')
  })
})

describe('tallyByMonth', () => {
  it('returns nothing for no rows', () => {
    expect(tallyByMonth([])).toEqual([])
  })

  it('splits late and on-time logins by month, oldest first, counting distinct dates', () => {
    const months = tallyByMonth([
      ...anna,
      ...ben,
      day({ work_date: '2026-05-29', login_at: '2026-05-29T13:45:00Z' }),
      day({ user_id: 'u2', work_date: '2026-05-29', login_at: '2026-05-29T12:00:00Z' }),
    ])
    expect(months).toEqual([
      { month: '2026-05', label: 'May 2026', late: 1, onTime: 1, lateMin: 45, days: 1 },
      { month: '2026-06', label: 'June 2026', late: 1, onTime: 2, lateMin: 20, days: 3 },
    ])
  })
})

describe('teamBreakSheet', () => {
  it('lays out one row per member plus a TOTAL footer', () => {
    const stats = aggregateBreaks([...anna, ...ben])
    const sheet = teamBreakSheet(stats)
    expect(sheet.name).toBe('Overall Staff Report')
    expect(sheet.head).toHaveLength(9)
    expect(sheet.formats).toHaveLength(9)
    expect(sheet.rows).toEqual([
      ['', '@ben', 1, 1, 0, 0, 100, 40, 9],
      ['Anna', '@anna', 2, 1, 1, 20, 100, 10, 15.5],
    ])
    expect(sheet.foot).toEqual(['TOTAL', '', 3, 2, 1, 20, 200, 50, 24.5])
  })

  it('marks only the late-login columns of members who were late', () => {
    const sheet = teamBreakSheet(aggregateBreaks([...anna, ...ben]))
    expect(sheet.red?.(1, 4)).toBe(true)
    expect(sheet.red?.(1, 5)).toBe(true)
    expect(sheet.red?.(1, 3)).toBe(false)
    expect(sheet.red?.(0, 4)).toBe(false)
    expect(sheet.red?.(9, 4)).toBe(false)
  })

  it('rounds hours to one decimal place', () => {
    const sheet = teamBreakSheet(aggregateBreaks([day({ login_at: '2026-06-01T12:00:00Z', hours: 7.46 }), day({ work_date: '2026-06-02', hours: 0.11 })]))
    expect(sheet.rows[0][8]).toBe(7.6)
    expect(sheet.foot?.[8]).toBe(7.6)
  })
})

describe('userBreakSheet', () => {
  it('lists each day with New York clock times and a TOTAL footer', () => {
    const [, a] = aggregateBreaks([...anna, ...ben])
    const sheet = userBreakSheet(a)
    expect(sheet.head).toHaveLength(8)
    expect(sheet.rows).toEqual([
      ['2026-06-01', '08:50 AM', 0, '05:00 PM', 7.5, 30, 60, 0],
      ['2026-06-02', '09:20 AM', 20, '05:30 PM', 8, 70, 60, 10],
      ['2026-06-03', '—', '', '—', '', 0, 60, 0],
    ])
    expect(sheet.foot).toEqual(['TOTAL', '', 20, '', 15.5, 100, '', 10])
  })

  it('marks the date and both login columns of a late day', () => {
    const [, a] = aggregateBreaks([...anna, ...ben])
    const sheet = userBreakSheet(a)
    expect([0, 1, 2].map((c) => sheet.red?.(1, c))).toEqual([true, true, true])
    expect(sheet.red?.(1, 3)).toBe(false)
    expect(sheet.red?.(0, 1)).toBe(false)
    expect(sheet.red?.(2, 0)).toBe(false)
    expect(sheet.red?.(7, 0)).toBe(false)
  })
})

describe('loginMonthSheet', () => {
  it('tabulates the month split with totals and reds the late columns of late months', () => {
    const sheet = loginMonthSheet([
      ...anna,
      day({ work_date: '2026-05-04', login_at: '2026-05-04T12:00:00Z' }),
    ])
    expect(sheet.name).toBe('Late Logins by Month')
    expect(sheet.rows).toEqual([
      ['May 2026', 1, 1, 0, 0],
      ['June 2026', 3, 1, 1, 20],
    ])
    expect(sheet.foot).toEqual(['TOTAL', 4, 2, 1, 20])
    expect(sheet.red?.(0, 3)).toBe(false)
    expect(sheet.red?.(1, 3)).toBe(true)
    expect(sheet.red?.(1, 4)).toBe(true)
    expect(sheet.red?.(1, 2)).toBe(false)
  })

  it('totals to zero for no rows', () => {
    expect(loginMonthSheet([]).foot).toEqual(['TOTAL', 0, 0, 0, 0])
  })
})

describe('buildTeamBreakPdf', () => {
  it('opens with the title, period and late-login scorecards', () => {
    const stats = aggregateBreaks([...anna, ...ben])
    const doc = buildTeamBreakPdf(stats, '2026-06-01', '2026-06-30') as unknown as FakeDoc
    expect(doc.orientation).toBe('portrait')
    const text = allText(doc)
    expect(text).toContain('OVERALL STAFF REPORT')
    expect(text).toContain('Period: 1-Jun-26  –  30-Jun-26')
    expect(text).toEqual(expect.arrayContaining([
      'LATE LOGINS', '1', 'of 3 logins',
      'ON-TIME LOGINS', '2',
      'TIME LOST TO LATE STARTS', '20m',
      'STAFF LOGGING IN LATE', 'of 2 active',
    ]))
    expect(text).toContain('Worked hours 24.5h   ·   Exceeding allowance 50m   ·   Members exceeding 2/2')
  })

  it('draws the month breakdown then the ranked team table with a TEAM TOTAL row', () => {
    const stats = aggregateBreaks([...anna, ...ben])
    buildTeamBreakPdf(stats, '2026-06-01', '2026-06-30')
    expect(h.state.tables).toHaveLength(2)

    const month = h.state.tables[0].opts
    expect(month.head).toEqual([['MONTH', 'OPERATIONAL DAYS', 'ON-TIME LOGINS', 'LATE LOGINS', 'TIME LOST']])
    expect(month.body).toEqual([['June 2026', '3', '2', '1', '20m']])

    const team = h.state.tables[1].opts
    expect(team.head?.[0]).toHaveLength(8)
    expect(team.body).toEqual([
      ['@ben', '1', '1', '0', '0m', '1h 40m', '40m', '9.0h'],
      ['Anna', '2', '1', '1', '20m', '1h 40m', '10m', '15.5h'],
      ['TEAM TOTAL', '3', '2', '1', '20m', '3h 20m', '50m', '24.5h'],
    ])
  })

  it('uses the raw rows passed for the month split when given', () => {
    const stats = aggregateBreaks(anna)
    buildTeamBreakPdf(stats, '2026-05-01', '2026-06-30', [day({ work_date: '2026-05-04', login_at: '2026-05-04T12:00:00Z' })])
    expect(h.state.tables[0].opts.body).toEqual([['May 2026', '1', '1', '0', '0m']])
  })

  it('prints a placeholder row and zero totals when nobody was active, without a month table', () => {
    buildTeamBreakPdf([], '2026-06-01', '2026-06-01')
    expect(h.state.tables).toHaveLength(1)
    expect(h.state.tables[0].opts.body).toEqual([
      ['No members active in this period', '0', '0', '0', '0m', '0m', '0m', '0.0h'],
      ['TEAM TOTAL', '0', '0', '0', '0m', '0m', '0m', '0.0h'],
    ])
  })

  it('colours late, on-time, overage and total cells', () => {
    const stats = aggregateBreaks([...anna, ...ben])
    buildTeamBreakPdf(stats, '2026-06-01', '2026-06-30')
    const team = h.state.tables[1].opts

    expect(styleOf(team, 'head', 0, 3)).toEqual({})
    expect(styleOf(team, 'body', 2, 0)).toEqual({ fillColor: [26, 54, 84], textColor: [255, 255, 255], fontStyle: 'bold' })
    // Anna (row 1) was late; Ben (row 0) was not.
    expect(styleOf(team, 'body', 1, 3)).toEqual({ textColor: [185, 28, 28], fontStyle: 'bold', fillColor: [255, 228, 230] })
    expect(styleOf(team, 'body', 1, 4)).toMatchObject({ textColor: [185, 28, 28] })
    expect(styleOf(team, 'body', 0, 3)).toEqual({})
    expect(styleOf(team, 'body', 0, 2)).toEqual({ textColor: [4, 120, 87] })
    expect(styleOf(team, 'body', 0, 6)).toEqual({ textColor: [185, 28, 28], fontStyle: 'bold' })

    const month = h.state.tables[0].opts
    expect(styleOf(month, 'body', 0, 2)).toEqual({ textColor: [4, 120, 87] })
    expect(styleOf(month, 'body', 0, 3)).toMatchObject({ textColor: [185, 28, 28], fillColor: [255, 228, 230] })
    expect(styleOf(month, 'body', 5, 3)).toEqual({})
  })
})

describe('buildUserBreakPdf', () => {
  it('prints one member day by day with their late-login summary', () => {
    const [, a] = aggregateBreaks([...anna, ...ben])
    const doc = buildUserBreakPdf(a, '2026-06-01', '2026-06-30') as unknown as FakeDoc
    const text = allText(doc)
    expect(text).toContain('Individual report — Anna')
    expect(text).toContain('Anna')
    expect(text).toContain('Days logged in 2     Worked hours 15.5h     Total break 1h 40m     Break-time exceeding allowance 10m on 1 day')
    expect(text).toContain('Late logins 1 of 2  ·  20m lost  ·  worst 20m')

    expect(h.state.tables).toHaveLength(2)
    const table = h.state.tables[1].opts
    expect(table.head).toEqual([['DATE', 'LOGIN', 'LATE BY', 'LOGOUT', 'WORKED HOURS', 'BREAK', 'ALLOWANCE', 'EXCEEDING\nALLOWANCE']])
    expect(table.body).toEqual([
      ['1-Jun-26', '08:50 AM', 'On time', '05:00 PM', '7.5h', '30m', '60m', '0m'],
      ['2-Jun-26', '09:20 AM', '20m', '05:30 PM', '8.0h', '70m', '60m', '10m'],
      ['3-Jun-26', '—', '—', '—', '—', '0m', '60m', '0m'],
      ['TOTAL', '', '1 late', '', '15.5h', '100m', '', '10m'],
    ])
  })

  it('says so when the member was never late, and pluralises overage days', () => {
    const [s] = aggregateBreaks([
      day({ login_at: '2026-06-01T12:00:00Z', over_break_min: 5 }),
      day({ work_date: '2026-06-02', login_at: '2026-06-02T12:00:00Z', over_break_min: 5 }),
    ])
    const text = allText(buildUserBreakPdf(s, '2026-06-01', '2026-06-02') as unknown as FakeDoc)
    expect(text).toContain('Late logins 0 of 2  ·  never late in this period')
    expect(text.some((t) => t.endsWith('10m on 2 days'))).toBe(true)
  })

  it('prints a placeholder row for a member with no days', () => {
    const stat: BreakStat = { ...aggregateBreaks(anna)[0], rows: [] }
    buildUserBreakPdf(stat, '2026-06-01', '2026-06-01')
    const body = h.state.tables.at(-1)?.opts.body
    expect(body?.[0]).toEqual(['—', '—', '—', '—', '—', '0m', '60m', '0m'])
    expect(body).toHaveLength(2)
  })

  it('colours a late day across both clock columns and an on-time day green', () => {
    const [, a] = aggregateBreaks([...anna, ...ben])
    buildUserBreakPdf(a, '2026-06-01', '2026-06-30')
    const table = h.state.tables[1].opts
    expect(styleOf(table, 'body', 1, 1)).toMatchObject({ textColor: [185, 28, 28], fillColor: [255, 228, 230] })
    expect(styleOf(table, 'body', 1, 2)).toMatchObject({ textColor: [185, 28, 28] })
    expect(styleOf(table, 'body', 0, 2)).toEqual({ textColor: [4, 120, 87] })
    expect(styleOf(table, 'body', 2, 2)).toEqual({})
    expect(styleOf(table, 'body', 1, 7)).toEqual({ textColor: [185, 28, 28], fontStyle: 'bold' })
    expect(styleOf(table, 'body', 3, 7)).toMatchObject({ fillColor: [26, 54, 84] })
  })
})

describe('buildAllUsersBreakPdf', () => {
  it('says nobody was active and draws no tables for an empty period', () => {
    const doc = buildAllUsersBreakPdf([], '2026-06-01', '2026-06-01') as unknown as FakeDoc
    expect(allText(doc)).toContain('No members were active in this period.')
    expect(h.state.tables).toHaveLength(0)
  })

  it('gives every member a section after the shared summary', () => {
    const stats = aggregateBreaks([...anna, ...ben])
    const doc = buildAllUsersBreakPdf(stats, '2026-06-01', '2026-06-30') as unknown as FakeDoc
    expect(h.state.tables).toHaveLength(3)
    expect(h.state.tables[0].opts.body).toEqual([['June 2026', '3', '2', '1', '20m']])
    expect(allText(doc)).toEqual(expect.arrayContaining(['@ben', 'Anna', 'Per-member breakdown for every active member']))
    expect(doc.pages).toBe(1)
  })

  it('starts a new page rather than orphaning a heading at the foot of one', () => {
    h.state.finalY = 800
    const stats = aggregateBreaks([...anna, ...ben])
    const doc = buildAllUsersBreakPdf(stats, '2026-06-01', '2026-06-30') as unknown as FakeDoc
    expect(doc.pages).toBe(3)
    expect(doc.texts.find((t) => t.text === 'Anna')).toMatchObject({ x: 40, y: 56 })
  })
})
