import { describe, expect, it } from 'vitest'
import type {
  ReviewEntry, StaffAttendanceRow, StaffLeave, StaffMember, TopPerformerState,
} from '../types'
import {
  COLUMNS,
  RATING_BANDS,
  SPANS,
  SPAN_MONTHS,
  accumulate,
  bandRating,
  buildSlices,
  cellValue,
  computedValue,
  defaultMinMonths,
  effectiveMonths,
  effectiveScore,
  fromWire,
  newRowKey,
  overrideOf,
  periodLabel,
  periodMonths,
  pickAnnual,
  rankAnnual,
  rowKeyOf,
  standingOf,
  toWire,
  type AnnualColumn,
  type AnnualContext,
  type AnnualOverrides,
  type AnnualRow,
  type AnnualTally,
  type MonthSlice,
} from './annualReview'
import type { RankedRow } from './incentive'
import { emptyLoginTally } from './staff'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const STAMP = '2026-01-01T00:00:00Z'

const member = (id: number, name: string, departments: string[] = []): StaffMember => ({
  id,
  name,
  departments: departments.map((d, i) => ({ id: i + 1, name: d })),
  attendance_user_id: null,
  status: 'active',
  expected_login: null,
  expected_logout: null,
  sort_order: id,
  created_at: STAMP,
  updated_at: STAMP,
})

const review = (
  kind: ReviewEntry['kind'], staffId: number | null, name: string, month: string | null,
  rating: string, percentage: number | null = null,
): ReviewEntry => ({
  id: Math.floor(Math.random() * 1e9),
  kind,
  department_id: null,
  staff_id: staffId,
  person_name: name,
  department_note: '',
  rating,
  percentage,
  notes: '',
  month,
  sort_order: 0,
  created_at: STAMP,
  updated_at: STAMP,
})

interface RowSpec {
  pct?: number | null
  met?: number
  total?: number
  allMet?: boolean
}

/** A month's ranked row, built directly: accumulate only reads the member, the %, met/total and allMet. */
const ranked = (m: StaffMember, spec: RowSpec = {}): RankedRow => {
  const total = spec.total ?? 8
  const met = spec.met ?? 0
  return {
    candidate: {
      member: m,
      behaviour: null,
      performance: spec.pct === undefined ? null : review('performance', m.id, m.name, null, 'Good', spec.pct),
      logins: emptyLoginTally(),
      earlyOuts: 0,
      judgedOuts: 0,
      presentDays: 0,
      halfDays: 0,
      lateMarks: 0,
    },
    verdicts: {} as RankedRow['verdicts'],
    met,
    total,
    allMet: spec.allMet ?? met === total,
    rank: 0,
  }
}

const tally = (over: Partial<AnnualTally> = {}): AnnualTally => ({
  key: 's:1',
  staffId: 1,
  name: 'Alice',
  departments: '',
  monthsIn: [],
  monthsReviewed: 0,
  perfPct: null,
  topMonths: 0,
  lowMonths: 0,
  eligibleMonths: 0,
  manual: false,
  ...over,
})

const row = (t: AnnualTally, score: number | null, months: number, covered = true): AnnualRow =>
  ({ tally: t, score, months, covered, rank: 0 })

const col = (id: string): AnnualColumn => {
  const c = COLUMNS.find((x) => x.id === id)
  if (!c) throw new Error(`no column ${id}`)
  return c
}

const ctxFor = (r: AnnualRow, over: Partial<AnnualContext> = {}): AnnualContext =>
  ({ minMonths: 6, standing: () => null, row: r, ...over })

const alice = member(1, 'Alice', ['Billing'])
const bob = member(2, 'Bob', ['Audits'])
const cara = member(3, 'Cara')

// ─── The period ───────────────────────────────────────────────────────────────

describe('spans', () => {
  it('are six and twelve months', () => {
    expect(SPAN_MONTHS).toEqual({ half: 6, year: 12 })
    expect(SPANS.map((s) => s.id)).toEqual(['half', 'year'])
  })

  it('default the coverage bar to half the window, rounded up', () => {
    expect(defaultMinMonths('half')).toBe(3)
    expect(defaultMinMonths('year')).toBe(6)
  })
})

describe('periodMonths', () => {
  it('lists a year ending on the selected month, oldest first', () => {
    expect(periodMonths('2026-09', 'year')).toEqual([
      '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
    ])
  })

  it('lists six months for a half year', () => {
    expect(periodMonths('2026-06', 'half')).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'])
  })

  it('crosses a year boundary for a half year ending early in the year', () => {
    expect(periodMonths('2026-02', 'half')).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'])
  })

  it('makes a calendar year out of a window ending in December', () => {
    const months = periodMonths('2025-12', 'year')
    expect(months[0]).toBe('2025-01')
    expect(months).toHaveLength(12)
    expect(new Set(months).size).toBe(12)
  })
})

describe('periodLabel', () => {
  it('names the first and last month', () => {
    expect(periodLabel(periodMonths('2026-09', 'year'))).toBe('October 2025 – September 2026')
  })

  it('is empty for no months', () => {
    expect(periodLabel([])).toBe('')
  })

  it('repeats the month for a single-month list', () => {
    expect(periodLabel(['2026-01'])).toBe('January 2026 – January 2026')
  })
})

// ─── buildSlices ──────────────────────────────────────────────────────────────

describe('buildSlices', () => {
  const attendanceDay = (staffId: number, date: string, login: string | null): StaffAttendanceRow => ({
    id: null, source: 'fetched', edited: false, staff_id: staffId, staff_name: '', work_date: date,
    login_at: login, logout_at: null, break_min: 0, status: 'present', note: '',
  })

  const leave = (staffId: number, date: string, halfDay: string): StaffLeave => ({
    id: 1, staff_id: staffId, staff_name: '', department_id: null, department_name: null, leave_date: date,
    sick_leave: '', break_leave: '', half_day: halfDay, late_login: '', aob: '',
    expected_return: null, actual_return: null, sort_order: 0, created_at: STAMP, updated_at: STAMP,
  })

  const months = ['2026-07', '2026-08', '2026-09']
  const performance = [
    review('performance', 1, 'Alice', '2026-07-01', 'Excellent', 95),
    review('performance', 2, 'Bob', '2026-07-01', 'Poor', 40),
    review('performance', 1, 'Alice', '2026-08-01', 'Good', 85),
    review('performance', 3, 'Cara', null, 'Excellent', 99),
    review('performance', 3, 'Cara', '2026-06-01', 'Excellent', 99),
  ]
  const attendance = [
    attendanceDay(1, '2026-08-03', '09:00'),
    attendanceDay(1, '2026-08-04', '09:05'),
    attendanceDay(1, '2026-07-10', null),
    attendanceDay(2, 'garbage', '09:00'),
  ]
  const leaves = [leave(2, '2026-07-15', 'Approved'), leave(1, '2026-08-20', 'Approved')]
  const saved: TopPerformerState[] = [
    { month: '2026-07-01', settings: { additional: [], min_performance: 80 }, ticks: {} },
    { month: '2026-08-01', settings: { additional: ['goals'], min_performance: 80 }, ticks: { 1: ['documentation', 'participation'] } },
  ]

  const slices = buildSlices(months, [alice, bob, cara], attendance, leaves, performance, [], saved)
  const byMonth = new Map(slices.map((s) => [s.month, s]))

  it('returns one slice per month of the window, in order, even when a month is empty', () => {
    expect(slices.map((s) => s.month)).toEqual(months)
    expect(byMonth.get('2026-09')?.rows).toEqual([])
  })

  it('only ranks people reviewed in that month', () => {
    expect(byMonth.get('2026-07')?.rows.map((r) => r.candidate.member.name)).toEqual(['Alice', 'Bob'])
    expect(byMonth.get('2026-08')?.rows.map((r) => r.candidate.member.name)).toEqual(['Alice'])
  })

  it('ignores reviews with no month or from outside the window', () => {
    const names = slices.flatMap((s) => s.rows.map((r) => r.candidate.member.name))
    expect(names).not.toContain('Cara')
  })

  it('attaches the month’s own review to each candidate', () => {
    const julyAlice = byMonth.get('2026-07')?.rows.find((r) => r.candidate.member.id === 1)
    const augAlice = byMonth.get('2026-08')?.rows.find((r) => r.candidate.member.id === 1)
    expect(julyAlice?.candidate.performance?.percentage).toBe(95)
    expect(augAlice?.candidate.performance?.percentage).toBe(85)
  })

  it('splits attendance and leaves by month', () => {
    const july = byMonth.get('2026-07')?.rows ?? []
    const aug = byMonth.get('2026-08')?.rows ?? []
    expect(july.find((r) => r.candidate.member.id === 1)?.candidate.presentDays).toBe(0)
    expect(aug.find((r) => r.candidate.member.id === 1)?.candidate.presentDays).toBe(2)
    expect(july.find((r) => r.candidate.member.id === 2)?.candidate.halfDays).toBe(1)
    expect(aug.find((r) => r.candidate.member.id === 1)?.candidate.halfDays).toBe(1)
    expect(july.find((r) => r.candidate.member.id === 2)?.candidate.presentDays).toBe(0)
  })

  it('scores each month with that month’s saved settings and ticks', () => {
    const july = byMonth.get('2026-07')?.rows ?? []
    const aug = byMonth.get('2026-08')?.rows ?? []
    expect(july.every((r) => r.total === 7)).toBe(true)
    expect(aug[0].total).toBe(8)
    expect(aug[0].verdicts.documentation.met).toBe(true)
    expect(aug[0].verdicts.participation.met).toBe(true)
    expect(aug[0].verdicts.goals.met).toBe(true)
    expect(aug[0].met).toBe(3)
    expect(july.find((r) => r.candidate.member.id === 1)?.verdicts.documentation.met).toBe(false)
  })

  it('falls back to the default settings for a month with nothing saved', () => {
    const s = buildSlices(['2026-09'], [alice], [], [], [review('performance', 1, 'Alice', '2026-09-01', 'Good', 85)], [], [])
    expect(s[0].rows[0].total).toBe(8)
    expect(s[0].rows[0].verdicts.goals.met).toBe(true)
  })

  it('returns no slices for no months', () => {
    expect(buildSlices([], [alice], [], [], performance, [], saved)).toEqual([])
  })
})

// ─── accumulate ───────────────────────────────────────────────────────────────

describe('accumulate', () => {
  it('returns nothing for no slices and no added rows', () => {
    expect(accumulate([])).toEqual([])
  })

  it('averages the performance percentage over the months that recorded one, to one decimal', () => {
    const slices: MonthSlice[] = [
      { month: '2026-01', rows: [ranked(alice, { pct: 80 })] },
      { month: '2026-02', rows: [ranked(alice, { pct: 85 })] },
      { month: '2026-03', rows: [ranked(alice, { pct: 86 })] },
      { month: '2026-04', rows: [ranked(alice, { pct: null })] },
    ]
    const [t] = accumulate(slices)
    expect(t.perfPct).toBe(83.7)
    expect(t.monthsReviewed).toBe(4)
    expect(t.monthsIn).toEqual(['2026-01', '2026-02', '2026-03', '2026-04'])
  })

  it('leaves the average null when no month recorded a percentage', () => {
    const [t] = accumulate([{ month: '2026-01', rows: [ranked(alice)] }])
    expect(t.perfPct).toBeNull()
    expect(t.monthsReviewed).toBe(1)
  })

  it('keeps a real zero percentage in the average', () => {
    const [t] = accumulate([
      { month: '2026-01', rows: [ranked(alice, { pct: 0 })] },
      { month: '2026-02', rows: [ranked(alice, { pct: 50 })] },
    ])
    expect(t.perfPct).toBe(25)
  })

  it('only counts the months a person was reviewed in', () => {
    const slices: MonthSlice[] = [
      { month: '2026-01', rows: [ranked(alice, { pct: 90 })] },
      { month: '2026-02', rows: [ranked(alice, { pct: 90 }), ranked(bob, { pct: 70 })] },
    ]
    const byName = new Map(accumulate(slices).map((t) => [t.name, t]))
    expect(byName.get('Bob')?.monthsReviewed).toBe(1)
    expect(byName.get('Bob')?.monthsIn).toEqual(['2026-02'])
    expect(byName.get('Bob')?.perfPct).toBe(70)
  })

  it('keys roster rows by staff id and records the id', () => {
    const [t] = accumulate([{ month: '2026-01', rows: [ranked(bob, { pct: 70 })] }])
    expect(t.key).toBe('s:2')
    expect(t.staffId).toBe(2)
    expect(t.manual).toBe(false)
  })

  it('shows the most recent name and departments even when slices arrive out of order', () => {
    const renamed = { ...alice, name: 'Alice Smith', departments: [{ id: 9, name: 'Audits' }, { id: 10, name: 'QA' }] }
    const slices: MonthSlice[] = [
      { month: '2026-03', rows: [ranked(renamed, { pct: 80 })] },
      { month: '2026-01', rows: [ranked(alice, { pct: 80 })] },
    ]
    const [t] = accumulate(slices)
    expect(t.name).toBe('Alice Smith')
    expect(t.departments).toBe('Audits, QA')
    expect(t.monthsIn).toEqual(['2026-01', '2026-03'])
  })

  it('does not reorder the slices passed in', () => {
    const slices: MonthSlice[] = [
      { month: '2026-03', rows: [ranked(alice)] },
      { month: '2026-01', rows: [ranked(alice)] },
    ]
    accumulate(slices)
    expect(slices.map((s) => s.month)).toEqual(['2026-03', '2026-01'])
  })

  it('tallies the monthly top, lowest and incentive months', () => {
    const slices: MonthSlice[] = [
      { month: '2026-01', rows: [ranked(alice, { met: 8 }), ranked(bob, { met: 4 })] },
      { month: '2026-02', rows: [ranked(alice, { met: 8 }), ranked(bob, { met: 2 })] },
      { month: '2026-03', rows: [ranked(alice, { met: 4 }), ranked(bob, { met: 4 })] },
    ]
    const byName = new Map(accumulate(slices).map((t) => [t.name, t]))
    expect(byName.get('Alice')).toMatchObject({ topMonths: 2, lowMonths: 0, eligibleMonths: 2 })
    expect(byName.get('Bob')).toMatchObject({ topMonths: 0, lowMonths: 2, eligibleMonths: 0 })
  })

  it('appends added rows at the end, in order, as manual rows with nothing behind them', () => {
    const out = accumulate(
      [{ month: '2026-01', rows: [ranked(alice, { pct: 90 })] }],
      [{ key: 'x:b', name: 'Zed' }, { key: 'x:a', name: 'Amy' }],
    )
    expect(out.map((t) => t.key)).toEqual(['s:1', 'x:b', 'x:a'])
    expect(out[1]).toEqual({
      key: 'x:b', staffId: null, name: 'Zed', departments: '', monthsIn: [], monthsReviewed: 0,
      perfPct: null, topMonths: 0, lowMonths: 0, eligibleMonths: 0, manual: true,
    })
  })

  it('does not let an added row replace a roster row with the same key, or appear twice', () => {
    const out = accumulate(
      [{ month: '2026-01', rows: [ranked(alice, { pct: 90 })] }],
      [{ key: 's:1', name: 'Imposter' }, { key: 'x:1', name: 'One' }, { key: 'x:1', name: 'Again' }],
    )
    expect(out.map((t) => [t.key, t.name, t.manual])).toEqual([['s:1', 'Alice', false], ['x:1', 'One', true]])
  })
})

describe('row keys', () => {
  it('keys a roster row by staff id', () => {
    expect(rowKeyOf(42)).toBe('s:42')
  })

  it('makes distinct x: keys for added rows', () => {
    const keys = Array.from({ length: 50 }, () => newRowKey())
    for (const k of keys) expect(k).toMatch(/^x:[0-9a-z]+$/)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

// ─── Overrides ────────────────────────────────────────────────────────────────

describe('overrideOf', () => {
  const ov: AnnualOverrides = { 's:1': { performance: '90', notes: '' } }

  it('returns the typed text', () => {
    expect(overrideOf(ov, 's:1', 'performance')).toBe('90')
  })

  it('returns null when the row or the column was never typed in', () => {
    expect(overrideOf(ov, 's:2', 'performance')).toBeNull()
    expect(overrideOf(ov, 's:1', 'months')).toBeNull()
  })

  it('returns an empty typed string as it is', () => {
    expect(overrideOf(ov, 's:1', 'notes')).toBe('')
  })
})

describe('effectiveScore', () => {
  const t = tally({ perfPct: 72.5 })
  const typed = (text: string): AnnualOverrides => ({ 's:1': { performance: text } })

  it('uses the accumulated average when nothing is typed', () => {
    expect(effectiveScore(t, {})).toBe(72.5)
  })

  it('reads a typed figure, with or without a percent sign or spaces', () => {
    expect(effectiveScore(t, typed('91'))).toBe(91)
    expect(effectiveScore(t, typed('88.5%'))).toBe(88.5)
    expect(effectiveScore(t, typed('  about 64 % '))).toBe(64)
  })

  it('clamps a typed figure to 0–100', () => {
    expect(effectiveScore(t, typed('150'))).toBe(100)
    expect(effectiveScore(t, typed('-20'))).toBe(0)
    expect(effectiveScore(t, typed('0'))).toBe(0)
    expect(effectiveScore(t, typed('100'))).toBe(100)
  })

  it('falls back to the accumulation when the typed text holds no number', () => {
    expect(effectiveScore(t, typed('n/a'))).toBe(72.5)
    expect(effectiveScore(t, typed(''))).toBe(72.5)
  })

  it('gives an added row its score only by typing', () => {
    const manual = tally({ key: 'x:1', staffId: null, manual: true })
    expect(effectiveScore(manual, {})).toBeNull()
    expect(effectiveScore(manual, { 'x:1': { performance: '77' } })).toBe(77)
  })

  it('ignores overrides typed into other columns or rows', () => {
    expect(effectiveScore(t, { 's:1': { months: '90' }, 's:2': { performance: '10' } })).toBe(72.5)
  })
})

describe('effectiveMonths', () => {
  const t = tally({ monthsReviewed: 4 })
  const typed = (text: string): AnnualOverrides => ({ 's:1': { months: text } })

  it('uses the accumulated count when nothing is typed', () => {
    expect(effectiveMonths(t, {})).toBe(4)
  })

  it('reads a typed count', () => {
    expect(effectiveMonths(t, typed('9'))).toBe(9)
    expect(effectiveMonths(t, typed('0'))).toBe(0)
  })

  it('floors a typed count at zero', () => {
    expect(effectiveMonths(t, typed('-3'))).toBe(0)
  })

  it('falls back to the accumulation for non-numeric text', () => {
    expect(effectiveMonths(t, typed('several'))).toBe(4)
  })
})

// ─── Ranking ──────────────────────────────────────────────────────────────────

describe('rankAnnual', () => {
  it('orders by the average performance, best first', () => {
    const rows = rankAnnual([
      tally({ key: 's:1', name: 'A', perfPct: 70, monthsReviewed: 6 }),
      tally({ key: 's:2', name: 'B', perfPct: 90, monthsReviewed: 6 }),
      tally({ key: 's:3', name: 'C', perfPct: 80, monthsReviewed: 6 }),
    ], {}, 3)
    expect(rows.map((r) => r.tally.name)).toEqual(['B', 'C', 'A'])
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3])
  })

  it('breaks ties on incentive months, then top months, then months reviewed, then name', () => {
    const rows = rankAnnual([
      tally({ key: 'a', name: 'Zoe', perfPct: 80, eligibleMonths: 1, topMonths: 0, monthsReviewed: 6 }),
      tally({ key: 'b', name: 'Yan', perfPct: 80, eligibleMonths: 2, topMonths: 0, monthsReviewed: 6 }),
      tally({ key: 'c', name: 'Xia', perfPct: 80, eligibleMonths: 1, topMonths: 3, monthsReviewed: 6 }),
      tally({ key: 'd', name: 'Wes', perfPct: 80, eligibleMonths: 1, topMonths: 0, monthsReviewed: 7 }),
      tally({ key: 'e', name: 'Ava', perfPct: 80, eligibleMonths: 1, topMonths: 0, monthsReviewed: 6 }),
    ], {}, 3)
    expect(rows.map((r) => r.tally.name)).toEqual(['Yan', 'Xia', 'Wes', 'Ava', 'Zoe'])
  })

  it('shares a rank between equal figures, leaderboard style', () => {
    const rows = rankAnnual([
      tally({ key: 'a', name: 'A', perfPct: 90 }),
      tally({ key: 'b', name: 'B', perfPct: 90 }),
      tally({ key: 'c', name: 'C', perfPct: 80 }),
      tally({ key: 'd', name: 'D', perfPct: 80 }),
      tally({ key: 'e', name: 'E', perfPct: 70 }),
    ], {}, 0)
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3, 3, 5])
  })

  it('sorts a row with no figure last and leaves it unranked, below a real zero', () => {
    const rows = rankAnnual([
      tally({ key: 'x:1', name: 'Added', manual: true }),
      tally({ key: 's:1', name: 'Zero', perfPct: 0 }),
      tally({ key: 's:2', name: 'Some', perfPct: 55 }),
    ], {}, 0)
    expect(rows.map((r) => r.tally.name)).toEqual(['Some', 'Zero', 'Added'])
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 0])
    expect(rows[2].score).toBeNull()
  })

  it('ranks on typed figures and typed months over the accumulated ones', () => {
    const tallies = [
      tally({ key: 's:1', name: 'A', perfPct: 95, monthsReviewed: 2 }),
      tally({ key: 's:2', name: 'B', perfPct: 60, monthsReviewed: 2 }),
    ]
    const rows = rankAnnual(tallies, { 's:2': { performance: '99', months: '6' } }, 3)
    expect(rows.map((r) => r.tally.name)).toEqual(['B', 'A'])
    expect(rows[0]).toMatchObject({ score: 99, months: 6, covered: true })
    expect(rows[1]).toMatchObject({ score: 95, months: 2, covered: false })
  })

  it('marks a row covered exactly at the bar', () => {
    const rows = rankAnnual([
      tally({ key: 'a', name: 'A', perfPct: 80, monthsReviewed: 6 }),
      tally({ key: 'b', name: 'B', perfPct: 70, monthsReviewed: 5 }),
    ], {}, 6)
    expect(rows.map((r) => r.covered)).toEqual([true, false])
  })

  it('returns nothing for no tallies', () => {
    expect(rankAnnual([], {}, 3)).toEqual([])
  })
})

describe('pickAnnual', () => {
  const t = (key: string): AnnualTally => tally({ key, name: key })

  it('names the best covered row once it clears 80%, and the worst when there is a real spread', () => {
    const rows = [row(t('a'), 92, 6), row(t('b'), 85, 6), row(t('c'), 60, 6)]
    const picks = pickAnnual(rows, 6)
    expect(picks.top.map((r) => r.tally.key)).toEqual(['a'])
    expect(picks.low.map((r) => r.tally.key)).toEqual(['c'])
    expect(picks.topPct).toBe(92)
    expect(picks.lowPct).toBe(60)
    expect(picks.uncovered).toEqual([])
  })

  it('names everyone tied at either end', () => {
    const picks = pickAnnual([row(t('a'), 90, 6), row(t('b'), 90, 6), row(t('c'), 50, 6), row(t('d'), 50, 6)], 6)
    expect(picks.top.map((r) => r.tally.key)).toEqual(['a', 'b'])
    expect(picks.low.map((r) => r.tally.key)).toEqual(['c', 'd'])
  })

  it('names top at exactly 80% but not below it', () => {
    expect(pickAnnual([row(t('a'), 80, 6), row(t('b'), 70, 6)], 6).top).toHaveLength(1)
    const below = pickAnnual([row(t('a'), 79.9, 6), row(t('b'), 60, 6)], 6)
    expect(below.top).toEqual([])
    expect(below.topPct).toBe(79.9)
    expect(below.low.map((r) => r.tally.key)).toEqual(['b'])
  })

  it('will not crown or blame a row without the coverage, and lists it as uncovered', () => {
    const rows = [row(t('star'), 100, 1, false), row(t('a'), 85, 6), row(t('b'), 70, 6), row(t('weak'), 10, 2, false)]
    const picks = pickAnnual(rows, 6)
    expect(picks.top.map((r) => r.tally.key)).toEqual(['a'])
    expect(picks.low.map((r) => r.tally.key)).toEqual(['b'])
    expect(picks.uncovered.map((r) => r.tally.key)).toEqual(['star', 'weak'])
  })

  it('names no lowest when everyone scored alike', () => {
    const picks = pickAnnual([row(t('a'), 60, 6), row(t('b'), 60, 6)], 6)
    expect(picks.low).toEqual([])
    expect(picks.top).toEqual([])
  })

  it('names no lowest when only one row is covered', () => {
    const picks = pickAnnual([row(t('a'), 40, 6), row(t('b'), 90, 2)], 6)
    expect(picks.low).toEqual([])
  })

  it('names no lowest when the worst is still at or above the bar', () => {
    const picks = pickAnnual([row(t('a'), 95, 6), row(t('b'), 80, 6)], 6)
    expect(picks.top.map((r) => r.tally.key)).toEqual(['a'])
    expect(picks.low).toEqual([])
  })

  it('leaves rows with no figure out of everything, including uncovered', () => {
    const picks = pickAnnual([row(t('blank'), null, 0, false), row(t('a'), 90, 6)], 6)
    expect(picks.uncovered).toEqual([])
    expect(picks.top.map((r) => r.tally.key)).toEqual(['a'])
  })

  it('names nobody and reports zeros when nothing is eligible', () => {
    expect(pickAnnual([], 6)).toEqual({ top: [], low: [], topPct: 0, lowPct: 0, uncovered: [] })
  })

  it('treats a real 0% as the lowest', () => {
    const picks = pickAnnual([row(t('a'), 90, 6), row(t('z'), 0, 6)], 6)
    expect(picks.low.map((r) => r.tally.key)).toEqual(['z'])
    expect(picks.lowPct).toBe(0)
  })

  it('agrees with rankAnnual end to end', () => {
    const rows = rankAnnual([
      tally({ key: 's:1', name: 'A', perfPct: 88, monthsReviewed: 12 }),
      tally({ key: 's:2', name: 'B', perfPct: 45, monthsReviewed: 10 }),
      tally({ key: 's:3', name: 'C', perfPct: 99, monthsReviewed: 1 }),
    ], {}, 6)
    const picks = pickAnnual(rows, 6)
    expect(picks.top.map((r) => r.tally.name)).toEqual(['A'])
    expect(picks.low.map((r) => r.tally.name)).toEqual(['B'])
    expect(picks.uncovered.map((r) => r.tally.name)).toEqual(['C'])
  })
})

describe('standingOf', () => {
  it('reads top, low or nothing per row key', () => {
    const a = row(tally({ key: 'a' }), 90, 6)
    const b = row(tally({ key: 'b' }), 50, 6)
    const standing = standingOf(pickAnnual([a, b, row(tally({ key: 'c' }), 70, 6)], 6))
    expect(standing('a')).toBe('top')
    expect(standing('b')).toBe('low')
    expect(standing('c')).toBeNull()
    expect(standing('unknown')).toBeNull()
  })

  it('lets top win if a row were somehow in both lists', () => {
    const a = row(tally({ key: 'a' }), 90, 6)
    const standing = standingOf({ top: [a], low: [a], topPct: 90, lowPct: 90, uncovered: [] })
    expect(standing('a')).toBe('top')
  })
})

// ─── Columns ──────────────────────────────────────────────────────────────────

describe('bandRating', () => {
  it('bands on the Performance tab’s own thresholds, inclusive at each floor', () => {
    expect(bandRating(100)).toBe('Excellent')
    expect(bandRating(90)).toBe('Excellent')
    expect(bandRating(89.9)).toBe('Good')
    expect(bandRating(80)).toBe('Good')
    expect(bandRating(79.9)).toBe('Average')
    expect(bandRating(65)).toBe('Average')
    expect(bandRating(64.9)).toBe('Below Average')
    expect(bandRating(50)).toBe('Below Average')
    expect(bandRating(49.9)).toBe('Poor')
    expect(bandRating(0)).toBe('Poor')
  })

  it('is empty for no figure', () => {
    expect(bandRating(null)).toBe('')
  })

  it('is empty for a figure below every band', () => {
    expect(bandRating(-1)).toBe('')
  })

  it('keeps its bands in descending order', () => {
    const mins = RATING_BANDS.map((b) => b.min)
    expect(mins).toEqual([...mins].sort((x, y) => y - x))
  })
})

describe('COLUMNS', () => {
  it('have unique ids in the sheet’s settled order', () => {
    expect(COLUMNS.map((c) => c.id)).toEqual(['name', 'department', 'months', 'performance', 'rating', 'eligible', 'standing', 'notes'])
  })

  it('leave only the notes column without a computed value', () => {
    expect(COLUMNS.filter((c) => !c.compute).map((c) => c.id)).toEqual(['notes'])
  })

  const t = tally({ name: 'Alice', departments: 'Billing, QA', monthsReviewed: 5, perfPct: 83.66, eligibleMonths: 2 })
  const r = row(t, 83.66, 5)

  it('fill name and department from the tally', () => {
    expect(computedValue(col('name'), t, ctxFor(r))).toBe('Alice')
    expect(computedValue(col('department'), t, ctxFor(r))).toBe('Billing, QA')
  })

  it('show the months count, blank only for an untouched added row', () => {
    expect(computedValue(col('months'), t, ctxFor(r))).toBe('5')
    expect(computedValue(col('months'), tally({ monthsReviewed: 0 }), ctxFor(r))).toBe('0')
    expect(computedValue(col('months'), tally({ manual: true, monthsReviewed: 0 }), ctxFor(r))).toBe('')
  })

  it('show the average as a bare figure with at most one decimal', () => {
    expect(computedValue(col('performance'), t, ctxFor(r))).toBe('83.7')
    expect(computedValue(col('performance'), tally({ perfPct: 80 }), ctxFor(r))).toBe('80')
    expect(computedValue(col('performance'), tally({ perfPct: 0 }), ctxFor(r))).toBe('0')
    expect(computedValue(col('performance'), tally({ perfPct: null }), ctxFor(r))).toBe('')
  })

  it('band the rating off the effective score, not the raw average', () => {
    const typedOver = row(tally({ perfPct: 40 }), 95, 6)
    expect(computedValue(col('rating'), typedOver.tally, ctxFor(typedOver))).toBe('Excellent')
    expect(computedValue(col('rating'), t, ctxFor(row(t, null, 5)))).toBe('')
  })

  it('show incentive months only for a row that has been reviewed', () => {
    expect(computedValue(col('eligible'), t, ctxFor(r))).toBe('2')
    expect(computedValue(col('eligible'), tally({ monthsReviewed: 1, eligibleMonths: 0 }), ctxFor(r))).toBe('0')
    expect(computedValue(col('eligible'), tally({ monthsReviewed: 0 }), ctxFor(r))).toBe('')
  })

  it('say Top, Lowest, a dash, or the coverage the row is missing', () => {
    const standing = col('standing')
    expect(computedValue(standing, t, ctxFor(r, { standing: () => 'top' }))).toBe('Top')
    expect(computedValue(standing, t, ctxFor(r, { standing: () => 'low' }))).toBe('Lowest')
    expect(computedValue(standing, t, ctxFor(row(t, 70, 6, true)))).toBe('—')
    expect(computedValue(standing, t, ctxFor(row(t, 70, 2, false), { minMonths: 6 }))).toBe('< 6 months')
    expect(computedValue(standing, t, ctxFor(row(t, null, 0, false)))).toBe('')
  })

  it('leave the notes cell empty until typed', () => {
    expect(computedValue(col('notes'), t, ctxFor(r))).toBe('')
  })
})

describe('cellValue', () => {
  const t = tally({ key: 's:1', name: 'Alice', perfPct: 70, monthsReviewed: 6 })
  const r = row(t, 70, 6)

  it('shows the computed value when nothing is typed', () => {
    expect(cellValue(col('performance'), t, ctxFor(r), {})).toBe('70')
  })

  it('shows typed text verbatim over the computed value', () => {
    const ov: AnnualOverrides = { 's:1': { performance: '88%', name: 'Alice (acting lead)', notes: 'Strong Q3' } }
    expect(cellValue(col('performance'), t, ctxFor(r), ov)).toBe('88%')
    expect(cellValue(col('name'), t, ctxFor(r), ov)).toBe('Alice (acting lead)')
    expect(cellValue(col('notes'), t, ctxFor(r), ov)).toBe('Strong Q3')
  })

  it('only reads the overrides of its own row', () => {
    expect(cellValue(col('name'), t, ctxFor(r), { 's:2': { name: 'Bob' } })).toBe('Alice')
  })
})

// ─── Wire shape ───────────────────────────────────────────────────────────────

describe('fromWire', () => {
  it('gives empty overrides, no rows and the default bar for no state', () => {
    for (const state of [null, undefined, {}]) {
      expect(fromWire(state, 'year')).toEqual({ overrides: {}, extraRows: [], settings: { minMonths: 6 } })
      expect(fromWire(state, 'half').settings.minMonths).toBe(3)
    }
  })

  it('keeps string cells, stringifies numbers, and drops blanks and other types', () => {
    const { overrides } = fromWire({
      overrides: {
        's:1': { performance: '90', months: 7, notes: '', rating: null, name: true, department: { x: 1 } },
        's:2': { notes: '' },
        's:3': 'not an object',
        's:4': ['90'],
        's:5': null,
      },
    }, 'year')
    expect(overrides).toEqual({ 's:1': { performance: '90', months: '7' } })
  })

  it('ignores overrides that are not an object', () => {
    expect(fromWire({ overrides: 'junk' }, 'year').overrides).toEqual({})
    expect(fromWire({ overrides: null }, 'year').overrides).toEqual({})
  })

  it('keeps added rows with a key, defaulting a missing name to empty', () => {
    const { extraRows } = fromWire({
      extra_rows: [
        { key: 'x:1', name: 'Amy' },
        { key: 'x:2' },
        { key: 'x:3', name: 5 },
        { key: '', name: 'No key' },
        { name: 'Also no key' },
        null,
        'x:4',
      ],
    }, 'year')
    expect(extraRows).toEqual([{ key: 'x:1', name: 'Amy' }, { key: 'x:2', name: '' }, { key: 'x:3', name: '' }])
  })

  it('ignores extra_rows that is not an array', () => {
    expect(fromWire({ extra_rows: { key: 'x:1' } }, 'year').extraRows).toEqual([])
  })

  it('accepts a coverage bar from zero up to the window length', () => {
    expect(fromWire({ settings: { min_months: 0 } }, 'year').settings.minMonths).toBe(0)
    expect(fromWire({ settings: { min_months: 12 } }, 'year').settings.minMonths).toBe(12)
    expect(fromWire({ settings: { min_months: 6 } }, 'half').settings.minMonths).toBe(6)
  })

  it('falls back to the default bar for one out of range or not a number', () => {
    expect(fromWire({ settings: { min_months: 7 } }, 'half').settings.minMonths).toBe(3)
    expect(fromWire({ settings: { min_months: 13 } }, 'year').settings.minMonths).toBe(6)
    expect(fromWire({ settings: { min_months: -1 } }, 'year').settings.minMonths).toBe(6)
    expect(fromWire({ settings: { min_months: '4' } }, 'year').settings.minMonths).toBe(6)
    expect(fromWire({ settings: { min_months: Number.NaN } }, 'year').settings.minMonths).toBe(6)
    expect(fromWire({ settings: [] }, 'year').settings.minMonths).toBe(6)
  })
})

describe('toWire', () => {
  it('drops blank cells and rows left with nothing typed', () => {
    const wire = toWire(
      { 's:1': { performance: '90', notes: '   ' }, 's:2': { notes: '' }, 's:3': { name: ' Al ' } },
      [],
      { minMonths: 4 },
    )
    expect(wire.overrides).toEqual({ 's:1': { performance: '90' }, 's:3': { name: ' Al ' } })
  })

  it('passes the added rows through and renames the setting', () => {
    const extra = [{ key: 'x:1', name: 'Amy' }]
    expect(toWire({}, extra, { minMonths: 0 })).toEqual({ overrides: {}, extra_rows: extra, settings: { min_months: 0 } })
  })

  it('does not mutate the overrides passed in', () => {
    const ov: AnnualOverrides = { 's:1': { notes: ' ' } }
    toWire(ov, [], { minMonths: 3 })
    expect(ov).toEqual({ 's:1': { notes: ' ' } })
  })

  it('round-trips through fromWire', () => {
    const ov: AnnualOverrides = { 's:1': { performance: '90', months: '7' }, 'x:1': { name: 'Amy', notes: 'n' } }
    const extra = [{ key: 'x:1', name: 'Amy' }]
    const back = fromWire(toWire(ov, extra, { minMonths: 5 }), 'year')
    expect(back).toEqual({ overrides: ov, extraRows: extra, settings: { minMonths: 5 } })
  })
})
