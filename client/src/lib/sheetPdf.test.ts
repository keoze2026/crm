import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CellHookData, UserOptions } from 'jspdf-autotable'
import type {
  Department, QueueAssignment, ReviewDepartment, ReviewEntry,
  StaffAttendanceRow, StaffLeave, StaffMember, StaffSalary, StaffSalaryHold,
} from '../types'
import type { AnnualExport } from '../components/AnnualReviewSheet'
import { CRITERIA, DEFAULT_SETTINGS, type CriterionId, type RankedRow, type Verdict } from './incentive'
import type { LoginTally } from './staff'
import {
  buildAnnualReviewPdf,
  buildBehaviourPdf,
  buildDepartmentsPdf,
  buildLeavesPdf,
  buildPerformancePdf,
  buildQueuesPdf,
  buildSalariesPdf,
  buildSalaryHoldsPdf,
  buildStaffAttendancePdf,
  buildStaffPdf,
  buildTopPerformerPdf,
} from './sheetPdf'

const h = vi.hoisted(() => {
  interface TextCall { text: string | string[]; x: number; y: number }
  class FakeDoc {
    orientation: string
    texts: TextCall[] = []
    lastAutoTable = { finalY: 0 }
    internal: { pageSize: { getWidth: () => number; getHeight: () => number } }
    constructor(opts: { orientation?: string } = {}) {
      this.orientation = opts.orientation ?? 'portrait'
      const land = this.orientation === 'landscape'
      this.internal = {
        pageSize: { getWidth: () => (land ? 841.89 : 595.28), getHeight: () => (land ? 595.28 : 841.89) },
      }
    }
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    setFillColor() {}
    roundedRect() {}
    text(text: string | string[], x: number, y: number) { this.texts.push({ text, x, y }) }
    splitTextToSize(t: string) { return [t] }
    addPage() {}
  }
  const state = { tables: [] as UserOptions[] }
  return { FakeDoc, state }
})

vi.mock('jspdf', () => ({ jsPDF: h.FakeDoc }))
vi.mock('jspdf-autotable', () => ({
  default: (doc: InstanceType<typeof h.FakeDoc>, opts: UserOptions) => {
    h.state.tables.push(opts)
    doc.lastAutoTable = { finalY: Number(opts.startY ?? 0) + 100 }
  },
}))

type FakeDoc = InstanceType<typeof h.FakeDoc>

const NAVY = [26, 54, 84]
const WHITE = [255, 255, 255]
const RED = [185, 28, 28]
const ROSE = [255, 228, 230]
const GREEN = [4, 120, 87]
const PALE_GREEN = [209, 250, 229]
const MUTED = [100, 116, 139]
const AMBER_TEXT = [146, 64, 14]
const AMBER_FILL = [254, 243, 199]

beforeEach(() => {
  h.state.tables.length = 0
})

const table = (): UserOptions => {
  expect(h.state.tables).toHaveLength(1)
  return h.state.tables[0]
}
const allText = (doc: unknown): string[] =>
  (doc as FakeDoc).texts.flatMap((t) => (Array.isArray(t.text) ? t.text : [t.text]))

function styleOf(opts: UserOptions, section: 'head' | 'body', row: number, col: number, raw: unknown = '') {
  const styles: Record<string, unknown> = {}
  opts.didParseCell?.({ section, row: { index: row }, column: { index: col }, cell: { styles, raw } } as unknown as CellHookData)
  return styles
}

const stamps = { created_at: '2026-09-01 00:00:00', updated_at: '2026-09-01 00:00:00' }

function member(id: number, name: string, over: Partial<StaffMember> = {}): StaffMember {
  return {
    id, name, departments: [], attendance_user_id: null, status: 'active',
    expected_login: null, expected_logout: null, sort_order: id, ...stamps, ...over,
  }
}

function attendance(staffId: number, over: Partial<StaffAttendanceRow> = {}): StaffAttendanceRow {
  return {
    id: null, source: 'fetched', edited: false, staff_id: staffId, staff_name: '', work_date: '2026-09-01',
    login_at: null, logout_at: null, break_min: 0, status: 'present', note: '', ...over,
  }
}

function entry(id: number, over: Partial<ReviewEntry> = {}): ReviewEntry {
  return {
    id, kind: 'performance', department_id: null, staff_id: null, person_name: `P${id}`, department_note: '',
    rating: 'Good', percentage: null, notes: '', month: '2026-08-01', sort_order: id, ...stamps, ...over,
  }
}

function reviewDept(id: number, name: string, over: Partial<ReviewDepartment> = {}): ReviewDepartment {
  return { id, name, performance: 'Good', percentage: null, sort_order: id, ...stamps, ...over }
}

describe('buildQueuesPdf', () => {
  const rows: QueueAssignment[] = [
    { id: 1, board: 'forwarding', person_id: 1, name: 'Anna', codes: [{ id: 1, code: 'BHS' }, { id: 2, code: 'Q04' }], sort_order: 0, ...stamps },
    { id: 2, board: 'forwarding', person_id: 2, name: 'Ben', codes: [{ id: 3, code: 'BOP' }], sort_order: 1, ...stamps },
  ]

  it('prints one numbered row per person, codes comma-joined, and a TOTAL row', () => {
    const doc = buildQueuesPdf(rows, 'Forwarding') as unknown as FakeDoc
    expect(doc.orientation).toBe('landscape')
    expect(allText(doc)).toEqual(expect.arrayContaining(['FORWARDING', '2 people · 3 queues assigned']))
    const t = table()
    expect(t.head).toEqual([['SR NO.', 'NAME', 'QUEUES', 'TOTAL']])
    expect(t.body?.slice(0, 2)).toEqual([['1', 'Anna', 'BHS, Q04', '2'], ['2', 'Ben', 'BOP', '1']])
    expect(t.body?.[2]).toEqual([
      expect.objectContaining({ content: 'TOTAL', colSpan: 3 }),
      expect.objectContaining({ content: '3' }),
    ])
  })

  it('defaults the title and handles a single person and an empty sheet', () => {
    expect(allText(buildQueuesPdf([rows[1]]))).toEqual(expect.arrayContaining(['QUEUES', '1 person · 1 queues assigned']))
    h.state.tables.length = 0
    expect(allText(buildQueuesPdf([]))).toContain('0 people · 0 queues assigned')
    expect(table().body).toHaveLength(1)
  })
})

describe('buildPerformancePdf', () => {
  const departments = [reviewDept(1, 'Billing'), reviewDept(2, 'Sales')]

  it('bands rows under their departments, drops empty bands and numbers continuously', () => {
    const entries = [
      entry(1, { department_id: 1, person_name: 'Anna', rating: 'Excellent', percentage: 95 }),
      entry(2, { person_name: 'Cy', rating: 'Average' }),
      entry(3, { department_id: 1, person_name: 'Ben', percentage: 0 }),
    ]
    const doc = buildPerformancePdf(entries, departments, 'August 2026')
    expect(allText(doc)).toEqual(expect.arrayContaining(['PERFORMANCE REVIEW', 'August 2026 · 3 people reviewed']))
    const t = table()
    expect(t.head).toEqual([['SR', 'NAME', 'PERFOMANCE', 'PERCENTAGE']])
    expect(t.body).toEqual([
      [expect.objectContaining({ content: 'Billing', colSpan: 4 })],
      ['1', 'Anna', 'Excellent', '95%'],
      ['2', 'Ben', 'Good', '0%'],
      [expect.objectContaining({ content: 'No department', colSpan: 4 })],
      ['3', 'Cy', 'Average', ''],
    ])
  })

  it('adds a NOTES column only when some entry has notes', () => {
    buildPerformancePdf([
      entry(1, { department_id: 2, person_name: 'Anna', notes: 'Great month' }),
      entry(2, { department_id: 2, person_name: 'Ben', notes: '  ' }),
    ], departments, 'August 2026')
    const t = table()
    expect(t.head).toEqual([['SR', 'NAME', 'PERFOMANCE', 'PERCENTAGE', 'NOTES']])
    expect(t.body).toEqual([
      [expect.objectContaining({ content: 'Sales', colSpan: 5 })],
      ['1', 'Anna', 'Good', '', 'Great month'],
      ['2', 'Ben', 'Good', '', '  '],
    ])
  })

  it('treats whitespace-only notes as no notes, and says "person" for one', () => {
    const doc = buildPerformancePdf([entry(1, { notes: '   ' })], [], 'August 2026')
    expect(allText(doc)).toContain('August 2026 · 1 person reviewed')
    expect(table().head?.[0]).toHaveLength(4)
  })
})

describe('buildBehaviourPdf', () => {
  it('stamps the month once, on the first row only', () => {
    const doc = buildBehaviourPdf([
      entry(1, { kind: 'behaviour', department_id: 1, person_name: 'Anna', rating: 'Good Standing' }),
      entry(2, { kind: 'behaviour', person_name: 'Ben', rating: 'Low Performer' }),
    ], [reviewDept(1, 'Billing')], 'August 2026')
    expect(allText(doc)).toEqual(expect.arrayContaining(['BEHAVIOUR ANALYSIS', 'August 2026']))
    const t = table()
    expect(t.head).toEqual([['SR.NO', 'MONTH', 'NAME', 'BEHAVIOUR ANALYSIS']])
    expect(t.body).toEqual([
      [expect.objectContaining({ content: 'Billing', colSpan: 4 })],
      ['1', 'AUGUST 2026', 'Anna', 'Good Standing'],
      [expect.objectContaining({ content: 'No department' })],
      ['2', '', 'Ben', 'Low Performer'],
    ])
  })

  it('prints an empty table for no entries', () => {
    buildBehaviourPdf([], [reviewDept(1, 'Billing')], 'August 2026')
    expect(table().body).toEqual([])
  })
})

describe('buildDepartmentsPdf', () => {
  it('prints every department, blanking an unscored percentage', () => {
    const doc = buildDepartmentsPdf([
      reviewDept(1, 'Billing', { performance: 'Excellent', percentage: 90 }),
      reviewDept(2, 'Sales', { performance: 'Poor' }),
    ], 'August 2026') as unknown as FakeDoc
    expect(doc.orientation).toBe('portrait')
    expect(allText(doc)).toEqual(expect.arrayContaining(['DEPARTMENT REVIEW', 'August 2026 · 2 departments']))
    expect(table().body).toEqual([['1', 'Billing', 'Excellent', '90%'], ['2', 'Sales', 'Poor', '']])
  })
})

describe('buildStaffPdf', () => {
  it('lists the roster with departments, 12-hour schedule times and status labels', () => {
    const doc = buildStaffPdf([
      member(1, 'Anna', { departments: [{ id: 1, name: 'Billing' }, { id: 2, name: 'Audits' }], expected_login: '09:00', expected_logout: '17:30' }),
      member(2, 'Ben', { status: 'leave' }),
      member(3, 'Cy', { status: 'inactive' }),
    ])
    expect(allText(doc)).toEqual(expect.arrayContaining(['STAFF', '3 on the roster · 1 active']))
    expect(table().body).toEqual([
      ['1', 'Anna', 'Billing, Audits', '9:00 AM', '5:30 PM', 'Active'],
      ['2', 'Ben', '', '—', '—', 'Leave'],
      ['3', 'Cy', '', '—', '—', 'Inactive'],
    ])
  })
})

describe('buildStaffAttendancePdf', () => {
  const staff = [
    member(1, 'Anna', { departments: [{ id: 1, name: 'Billing' }, { id: 2, name: 'Audits' }], expected_login: '09:00', expected_logout: '17:00' }),
    member(2, 'Ben', { expected_login: '09:00', expected_logout: '17:00' }),
    member(3, 'Cara'),
    member(4, 'Dan', { expected_login: '09:00' }),
    member(5, 'Eve', { expected_login: '08:00' }),
  ]
  const rows = [
    attendance(1, { login_at: '09:07', logout_at: '16:50', break_min: 30 }),
    attendance(2, { source: 'manual', id: 7, login_at: '08:55', logout_at: '17:05', break_min: 60 }),
    attendance(3, { edited: true, id: 8, login_at: '10:00', break_min: 15, status: 'still in' }),
    attendance(5, { login_at: '09:30' }),
  ]
  const tallies = new Map<number, LoginTally>([
    [1, { late: 2, onTime: 3, judged: 5, lateMin: 20, worstLateMin: 12 }],
    [2, { late: 0, onTime: 4, judged: 4, lateMin: 0, worstLateMin: 0 }],
  ])

  it('summarises the day and the month on the header and scorecards', () => {
    const doc = buildStaffAttendancePdf(staff, rows, 'Tue 1 Sep', tallies, 'September 2026')
    const text = allText(doc)
    expect(text).toContain('ATTENDANCE')
    expect(text).toContain('Tue 1 Sep · 4 of 5 logged in · 2 off schedule (1 at both ends)')
    expect(text).toEqual(expect.arrayContaining([
      'LATE LOGINS · TUE 1 SEP', 'of 4 logged in',
      'ON-TIME LOGINS · TUE 1 SEP',
      'LATE LOGINS · SEPTEMBER 2026', 'of 9 logins · 20m lost',
      'ON-TIME LOGINS · SEPTEMBER 2026', '7', 'of 9 logins',
      'STAFF LATE THIS MONTH', 'of 5 on the roster',
    ]))
    expect(text).toContain('Late in on Tue 1 Sep: Eve (1h 30m),  Anna (7m)')
  })

  it('prints everyone on the roster, blank lines included', () => {
    buildStaffAttendancePdf(staff, rows, 'Tue 1 Sep', tallies, 'September 2026')
    const t = table()
    expect(t.head?.[0]).toEqual([
      'SR. NO', 'NAME', 'DEPARTMENT', 'LOGIN', 'LOGOUT', 'LATE LOGINS\nSEPTEMBER 2026',
      'BREAK', 'HOURS', 'FLAG', 'STATUS', 'SOURCE',
    ])
    expect(t.body).toEqual([
      ['1', 'Anna', 'Billing, Audits', '9:07 AM (7m late)', '4:50 PM (10m early)', '2/5', '30m', '7.2h', 'Late in + early out', 'present', 'Fetched'],
      ['2', 'Ben', '', '8:55 AM', '5:05 PM', '0/4', '60m', '7.2h', 'On time', 'present', 'Keyed in'],
      ['3', 'Cara', '', '10:00 AM', '—', '—', '15m', '—', '—', 'still in', 'Corrected'],
      ['4', 'Dan', '', '—', '—', '—', '—', '—', '—', '—', '—'],
      ['5', 'Eve', '', '9:30 AM (1h 30m late)', '—', '—', '0m', '—', 'Late in', 'present', 'Fetched'],
    ])
  })

  it('colours late logins, the month count and the flag column', () => {
    buildStaffAttendancePdf(staff, rows, 'Tue 1 Sep', tallies, 'September 2026')
    const t = table()
    expect(styleOf(t, 'head', 0, 3)).toEqual({})
    expect(styleOf(t, 'body', 0, 3)).toEqual({ textColor: RED, fontStyle: 'bold', fillColor: ROSE })
    expect(styleOf(t, 'body', 4, 3)).toMatchObject({ textColor: RED })
    expect(styleOf(t, 'body', 1, 3)).toEqual({})
    expect(styleOf(t, 'body', 0, 5)).toEqual({ textColor: RED, fillColor: ROSE })
    expect(styleOf(t, 'body', 1, 5)).toEqual({ textColor: GREEN })
    expect(styleOf(t, 'body', 2, 5)).toEqual({})
    expect(styleOf(t, 'body', 0, 8)).toEqual({ textColor: [159, 18, 57], fillColor: ROSE })
    expect(styleOf(t, 'body', 4, 8)).toEqual({ textColor: AMBER_TEXT, fillColor: AMBER_FILL })
    expect(styleOf(t, 'body', 1, 8)).toEqual({})
    expect(styleOf(t, 'body', 2, 8)).toEqual({})
    expect(styleOf(t, 'body', 9, 3)).toEqual({})
  })

  it('falls back to "this month" wording without tallies and names nobody when none were late', () => {
    const doc = buildStaffAttendancePdf([staff[1]], [rows[1]], 'Tue 1 Sep')
    const text = allText(doc)
    expect(text).toContain('Tue 1 Sep · 1 of 1 logged in')
    expect(text).toEqual(expect.arrayContaining(['LATE LOGINS THIS MONTH', 'ON-TIME LOGINS THIS MONTH', 'of 0 logins · 0m lost']))
    expect(text).toContain('Late in on Tue 1 Sep: nobody')
    const t = table()
    expect(t.head?.[0]).toContain('LATE LOGINS\nTHIS MONTH')
    expect((t.body?.[0] as string[])[5]).toBe('—')
  })
})

describe('buildLeavesPdf', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-23T16:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function leave(id: number, over: Partial<StaffLeave> = {}): StaffLeave {
    return {
      id, staff_id: id, staff_name: `P${id}`, department_id: null, department_name: null, leave_date: '2026-09-08',
      sick_leave: '', break_leave: '', half_day: '', late_login: '', aob: '',
      expected_return: null, actual_return: null, sort_order: id, ...stamps, ...over,
    }
  }
  const leaves = [
    leave(1, { department_name: 'Billing', sick_leave: 'Approved', aob: 'Doctor note', expected_return: '2026-09-10', actual_return: '2026-09-12' }),
    leave(2, { expected_return: '2026-09-20' }),
    leave(3, { half_day: 'Pending' }),
    leave(4, { expected_return: '2026-09-15', actual_return: '2026-09-15' }),
    leave(5, { expected_return: '2026-09-30' }),
    leave(6, { expected_return: '2026-09-15', actual_return: '2026-09-14' }),
  ]

  it('prints each row with the return verdict under the date it belongs to', () => {
    const doc = buildLeavesPdf(leaves, 'September 2026')
    expect(allText(doc)).toEqual(expect.arrayContaining(['LEAVES', 'September 2026 · 6 rows']))
    const body = table().body as string[][]
    expect(body[0]).toEqual(['8-Sep', 'P1', 'Billing', 'Approved', '', '', '', '10-Sep', '12-Sep\n2 days late', 'Doctor note'])
    expect(body.map((r) => [r[7], r[8]])).toEqual([
      ['10-Sep', '12-Sep\n2 days late'],
      ['20-Sep\n3 days overdue', ''],
      ['', ''],
      ['15-Sep', '15-Sep\nOn time'],
      ['30-Sep', ''],
      ['15-Sep', '14-Sep\n1 day early'],
    ])
  })

  it('says "row" for a single leave', () => {
    expect(allText(buildLeavesPdf([leave(1)], 'September 2026'))).toContain('September 2026 · 1 row')
  })

  it('colours late, on-time and overdue returns', () => {
    buildLeavesPdf(leaves, 'September 2026')
    const t = table()
    expect(styleOf(t, 'body', 0, 8)).toEqual({ textColor: RED, fontStyle: 'bold', fillColor: ROSE })
    expect(styleOf(t, 'body', 0, 7)).toEqual({})
    expect(styleOf(t, 'body', 1, 7)).toEqual({ textColor: AMBER_TEXT, fillColor: AMBER_FILL })
    expect(styleOf(t, 'body', 3, 8)).toEqual({ textColor: GREEN })
    expect(styleOf(t, 'body', 2, 8)).toEqual({})
    expect(styleOf(t, 'body', 5, 8)).toEqual({})
    expect(styleOf(t, 'head', 0, 8)).toEqual({})
  })
})

describe('buildSalariesPdf', () => {
  const dept = (id: number, name: string): Department => ({ id, name, sort_order: id, staff_count: 0, ...stamps })
  const salary = (id: number, name: string, departmentId: number | null, status: string): StaffSalary => ({
    id, staff_id: id, staff_name: name, department_id: departmentId, department_name: null,
    month: '2026-09-01', status, amount: null, note: '', sort_order: id, ...stamps,
  })

  it('stamps the month, bands by department and numbers continuously', () => {
    const doc = buildSalariesPdf([
      salary(1, 'Anna', 1, 'Received'),
      salary(2, 'Ben', null, 'Pending'),
      salary(3, 'Cy', 2, 'Received'),
      salary(4, 'Dee', 1, 'Not Paid'),
    ], [dept(1, 'Billing'), dept(2, 'Sales'), dept(3, 'Empty')], 'September 2026')
    expect(allText(doc)).toEqual(expect.arrayContaining(['SALARIES', 'September 2026 · 2 of 4 received']))
    expect(table().body).toEqual([
      [expect.objectContaining({ content: 'SEPTEMBER 2026', colSpan: 3 })],
      [expect.objectContaining({ content: 'Billing', colSpan: 3 })],
      ['1', 'Anna', 'Received'],
      ['2', 'Dee', 'Not Paid'],
      [expect.objectContaining({ content: 'Sales' })],
      ['3', 'Cy', 'Received'],
      [expect.objectContaining({ content: 'No department' })],
      ['4', 'Ben', 'Pending'],
    ])
  })

  it('prints just the month band for an empty month', () => {
    buildSalariesPdf([], [dept(1, 'Billing')], 'September 2026')
    expect(table().body).toHaveLength(1)
  })
})

describe('buildSalaryHoldsPdf', () => {
  const hold = (id: number, over: Partial<StaffSalaryHold>): StaffSalaryHold => ({
    id, staff_id: id, staff_name: `P${id}`, month: '2026-08-01', reason: '', status: 'On Hold', sort_order: id, ...stamps, ...over,
  })

  it('prints every hold with its own short month and counts those still held', () => {
    const doc = buildSalaryHoldsPdf([
      hold(1, { staff_name: 'Anna', reason: 'Missing timesheet' }),
      hold(2, { staff_name: 'Ben', month: '2026-07-01', status: 'Disbursed' }),
      hold(3, { staff_name: 'Cy', month: 'bad' }),
    ], 'September 2026')
    expect(allText(doc)).toEqual(expect.arrayContaining(['SALARY HOLD', 'September 2026 · 2 of 3 still on hold']))
    expect(table().body).toEqual([
      ['1', 'Anna', 'Aug 2026', 'Missing timesheet', 'On Hold'],
      ['2', 'Ben', 'Jul 2026', '', 'Disbursed'],
      ['3', 'Cy', 'bad', '', 'On Hold'],
    ])
  })

  it('colours Disbursed green and anything else red in the status column only', () => {
    buildSalaryHoldsPdf([hold(1, {})], 'September 2026')
    const t = table()
    expect(styleOf(t, 'body', 0, 4, 'Disbursed')).toEqual({ textColor: GREEN, fontStyle: 'bold' })
    expect(styleOf(t, 'body', 0, 4, 'On Hold')).toEqual({ textColor: RED, fontStyle: 'bold' })
    expect(styleOf(t, 'body', 0, 3, 'On Hold')).toEqual({})
    expect(styleOf(t, 'head', 0, 4, 'STATUS')).toEqual({})
  })
})

describe('buildTopPerformerPdf', () => {
  function ranked(id: number, name: string, rank: number, met: CriterionId[], unknown: CriterionId[] = []): RankedRow {
    const verdicts = Object.fromEntries(CRITERIA.map((c) => [c.id, {
      met: met.includes(c.id), note: '', unknown: unknown.includes(c.id) || undefined,
    } satisfies Verdict])) as Record<CriterionId, Verdict>
    const total = 8
    const metCount = met.length
    return {
      candidate: {
        member: member(id, name, { departments: id === 1 ? [{ id: 1, name: 'Billing' }] : [] }),
        behaviour: null, performance: null,
        logins: { late: 0, onTime: 0, judged: 0, lateMin: 0, worstLateMin: 0 },
        earlyOuts: 0, judgedOuts: 0, presentDays: 0, halfDays: 0, lateMarks: 0,
      },
      verdicts, met: metCount, total, allMet: metCount === total, rank,
    }
  }
  const everything: CriterionId[] = ['behaviour', 'punctuality', 'documentation', 'login', 'participation', 'professional', 'written', 'goals']
  const rows = [
    ranked(1, 'Anna', 1, everything),
    ranked(2, 'Ben', 2, ['punctuality', 'login', 'participation', 'professional', 'written', 'goals'], ['behaviour']),
  ]

  it('prints one numbered column per criterion in play, the score and the incentive mark', () => {
    const doc = buildTopPerformerPdf(rows, DEFAULT_SETTINGS, 'August 2026')
    const text = allText(doc)
    expect(text).toContain('TOP PERFORMER OF THE MONTH')
    expect(text).toContain('August 2026 · 8 criteria in play · 1 eligible: Anna')
    const key = text.find((t) => t.startsWith('1. Exemplary Behavior *'))
    expect(key).toContain('3. Documentation   4. Timely Login *')
    expect(key).toContain('9. Goal Achievement *')
    expect(key).not.toContain('8. Continuous Learning')

    const t = table()
    expect(t.head).toEqual([['#', 'NAME', 'DEPARTMENTS', '1', '2', '3', '4', '5', '6', '7', '9', 'SCORE', 'INCENTIVE']])
    expect(t.body).toEqual([
      ['1', 'Anna', 'Billing', 'YES', 'YES', 'YES', 'YES', 'YES', 'YES', 'YES', 'YES', '8 / 8', 'ELIGIBLE'],
      ['2', 'Ben', '', '?', 'YES', 'no', 'YES', 'YES', 'YES', 'YES', 'YES', '6 / 8', '2 to go'],
    ])
    expect(t.columnStyles).toMatchObject({
      3: { halign: 'center', cellWidth: 34 },
      10: { halign: 'center', cellWidth: 34 },
      11: { cellWidth: 48 },
      12: { cellWidth: 64 },
    })
  })

  it('says nobody qualifies when no row meets every criterion', () => {
    expect(allText(buildTopPerformerPdf([rows[1]], DEFAULT_SETTINGS, 'August 2026')))
      .toContain('August 2026 · 8 criteria in play · nobody meets every criterion yet')
  })

  it('colours YES green, no red, unknown grey and ELIGIBLE green', () => {
    buildTopPerformerPdf(rows, DEFAULT_SETTINGS, 'August 2026')
    const t = table()
    expect(styleOf(t, 'body', 0, 3, 'YES')).toEqual({ textColor: GREEN, fontStyle: 'bold' })
    expect(styleOf(t, 'body', 1, 5, 'no')).toEqual({ textColor: RED, fillColor: ROSE })
    expect(styleOf(t, 'body', 1, 3, '?')).toEqual({ textColor: MUTED })
    expect(styleOf(t, 'body', 0, 12, 'ELIGIBLE')).toEqual({ textColor: GREEN })
    expect(styleOf(t, 'body', 1, 12, '2 to go')).toEqual({})
    expect(styleOf(t, 'body', 0, 1, 'YES')).toEqual({})
    expect(styleOf(t, 'head', 0, 3, 'YES')).toEqual({})
  })
})

describe('buildAnnualReviewPdf', () => {
  const state: AnnualExport = {
    span: 'half',
    periodLabel: 'Mar – Aug 2026',
    minMonths: 3,
    columns: [
      { id: 'name', label: 'Name' },
      { id: 'avg', label: 'Avg %', align: 'right' },
    ],
    rows: [
      { name: 'Anna', standing: 'top', cells: ['Anna', '92%'], typed: ['avg'] },
      { name: 'Ben', standing: null, cells: ['Ben', '70%'], typed: [] },
      { name: 'Cy', standing: 'low', cells: ['Cy', '40%'], typed: ['name'] },
    ],
  }

  it('prints the visible columns, marking typed-over cells with a degree ring', () => {
    const doc = buildAnnualReviewPdf(state)
    const text = allText(doc)
    expect(text).toContain('HALF-YEARLY REVIEW')
    expect(text).toContain('Mar – Aug 2026 · 6 months accumulated · 3 people · ranked on average performance · named only on 3+ months reviewed')
    expect(text).toContain('Top performer: Anna   Lowest performer: Cy   (° a figure typed in by hand, over the accumulation)')
    const t = table()
    expect(t.head).toEqual([['#', 'NAME', 'AVG %']])
    expect(t.body).toEqual([
      ['1', 'Anna', '92%°'],
      ['2', 'Ben', '70%'],
      ['3', 'Cy°', '40%'],
    ])
    expect(t.columnStyles).toMatchObject({
      1: { halign: 'left', fontStyle: 'bold' },
      2: { halign: 'right', fontStyle: 'normal' },
    })
  })

  it('titles a yearly roll-up and says when neither end is named', () => {
    const text = allText(buildAnnualReviewPdf({
      ...state, span: 'year', rows: [{ name: 'Ben', standing: null, cells: ['Ben', '70%'], typed: [] }],
    }))
    expect(text).toContain('YEARLY REVIEW')
    expect(text.some((t) => t.includes('12 months accumulated · 1 person'))).toBe(true)
    expect(text.some((t) => t.startsWith('Neither end of the period is named yet'))).toBe(true)
  })

  it('bands the top and lowest rows, solid in the Sr. No. cell', () => {
    buildAnnualReviewPdf(state)
    const t = table()
    expect(styleOf(t, 'body', 0, 0)).toEqual({ fillColor: GREEN, textColor: WHITE })
    expect(styleOf(t, 'body', 0, 2)).toEqual({ fillColor: PALE_GREEN })
    expect(styleOf(t, 'body', 1, 1)).toEqual({})
    expect(styleOf(t, 'body', 2, 0)).toEqual({ fillColor: RED, textColor: WHITE })
    expect(styleOf(t, 'body', 2, 1)).toEqual({ fillColor: ROSE })
    expect(styleOf(t, 'head', 0, 0)).toEqual({})
  })
})

describe('shared styling', () => {
  it('uses the navy head on every sheet', () => {
    buildDepartmentsPdf([], 'August 2026')
    expect(table().headStyles).toMatchObject({ fillColor: NAVY, textColor: WHITE, fontStyle: 'bold' })
  })
})
