import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '../src/api/client'
import {
  accumulate, buildSlices, defaultMinMonths, fromWire as annualFromWire, periodMonths, pickAnnual, rankAnnual,
  rowKeyOf, standingOf, toWire as annualToWire,
} from '../src/lib/annualReview'
import {
  DEFAULT_SETTINGS, buildCandidates, fromWire, pickPerformers, rankCandidates, toWire, type CriterionId,
} from '../src/lib/incentive'
import { asPercent } from '../src/lib/review'
import { monthRange } from '../src/lib/staff'
import { resetTables, sql, useServer, type Server } from './harness'
import {
  AnnualReviewSheetSpec, ReviewDepartmentSpec, ReviewEntrySpec, TopPerformerStateSpec, arrayOf, expectShape,
  lastStatus, rejectionOf,
} from './shape-staff'

// The Review page: department scorecard, Performance / Behaviour entries, the Top Performer
// tab's shared ticks and the Annual Reviews roll-up — and the incentive / annual-review
// logic run over exactly what the server answers.

const TABLES = [
  'staff', 'departments', 'staff_departments', 'staff_attendance', 'staff_leaves', 'review_entries',
  'department_reviews', 'top_performer_months', 'top_performer_ticks', 'annual_review_sheets',
  'annual_review_versions',
]

let server: Server
beforeEach(() => {
  resetTables(...TABLES)
  server = useServer()
})

describe('review departments', () => {
  it('scores a department per month without touching other months', async () => {
    const d = await api.createReviewDepartment({ month: '2026-08', name: 'Billing', performance: 'Good', percentage: 85 })
    expectShape(d, ReviewDepartmentSpec)
    expect(d).toMatchObject({ name: 'Billing', performance: 'Good', percentage: 85 })

    const july = await api.reviewDepartments('2026-07')
    expectShape(july, arrayOf(ReviewDepartmentSpec))
    expect(july).toEqual([expect.objectContaining({ id: d.id, performance: '', percentage: null })])
    expect(asPercent(july[0].percentage)).toBe('')

    const up = await api.updateReviewDepartment(d.id, { month: '2026-07', performance: 'Average', percentage: 120 })
    expect(up).toMatchObject({ performance: 'Average', percentage: 100 })
    const aug = await api.reviewDepartments('2026-08')
    expect(aug[0]).toMatchObject({ performance: 'Good', percentage: 85 })
    expect(asPercent(aug[0].percentage)).toBe('85%')
    // It is the same catalogue the Staff page reads.
    expect((await api.departments()).map((x) => x.name)).toEqual(['Billing'])
  })

  it('refuses a missing month, a blank or duplicate name, an unknown id', async () => {
    const d = await api.createReviewDepartment({ month: '2026-08', name: 'Ops' })
    const noMonth = { name: 'X' } as { name: string, month: string }
    expect(await rejectionOf(api.createReviewDepartment(noMonth)))
      .toBe('month must be YYYY-MM — a review always belongs to the month it is about')
    expect(lastStatus(server)).toBe(422)
    expect(await rejectionOf(api.createReviewDepartment({ month: '2026-08', name: ' ' }))).toBe('A department name is required')
    expect(await rejectionOf(api.createReviewDepartment({ month: '2026-08', name: 'ops' }))).toBe('That department is already listed')
    expect(lastStatus(server)).toBe(409)
    expect(await rejectionOf(api.updateReviewDepartment(99_999, { month: '2026-08', name: 'Y' }))).toBe('Department not found')
    expect(lastStatus(server)).toBe(404)
    expect(await api.deleteReviewDepartment(d.id)).toEqual({ deleted: true })
  })
})

describe('review entries', () => {
  it('stores Performance and Behaviour rows month-wise, linked to the roster by name', async () => {
    const [ada] = (await api.createStaff(['Ada Lovelace'])).created
    const dept = await api.createReviewDepartment({ month: '2026-08', name: 'Audits' })

    const perf = await api.createReviewEntry({
      kind: 'performance', month: '2026-08', person_name: 'ada lovelace', department_id: dept.id,
      department_note: 'Audits/QA', rating: 'Excellent', percentage: 92.5, notes: 'Line one\nline two',
    })
    expectShape(perf, ReviewEntrySpec)
    expect(perf).toMatchObject({ staff_id: ada.id, month: '2026-08-01', percentage: 92.5, notes: 'Line one\nline two' })
    expect(asPercent(perf.percentage)).toBe('92.5%')

    // A behaviour row never carries a percentage, whatever is sent.
    const beh = await api.createReviewEntry({ kind: 'behaviour', month: '2026-08', person_name: 'Nobody Known', rating: 'Good Standing', percentage: 50 })
    expect(beh).toMatchObject({ staff_id: null, percentage: null, department_id: null })

    await api.createReviewEntry({ kind: 'performance', month: '2026-07', person_name: 'Ada Lovelace', rating: 'Good', percentage: 80 })
    const aug = await api.reviewEntries('performance', '2026-08')
    expectShape(aug, arrayOf(ReviewEntrySpec))
    expect(aug.map((e) => e.month)).toEqual(['2026-08-01'])
    const all = await api.reviewEntriesAllMonths('performance')
    expect(all.map((e) => e.month).sort()).toEqual(['2026-07-01', '2026-08-01'])

    const up = await api.updateReviewEntry(perf.id, { percentage: null, rating: 'Good', department_id: null })
    expect(up).toMatchObject({ percentage: null, rating: 'Good', department_id: null, staff_id: ada.id, month: '2026-08-01' })

    // Deleting the department leaves the rows, unfiled.
    await api.updateReviewEntry(perf.id, { department_id: dept.id })
    await api.deleteReviewDepartment(dept.id)
    expect((await api.reviewEntries('performance', '2026-08'))[0].department_id).toBeNull()
    expect(sql('SELECT count(*)::int AS n FROM review_entries')).toEqual([{ n: 3 }])
  })

  it('surfaces 422 / 404 messages', async () => {
    const badKind = 'rating' as 'performance'
    expect(await rejectionOf(api.reviewEntries(badKind, '2026-08'))).toBe('kind must be performance or behaviour')
    expect(await rejectionOf(api.createReviewEntry({ kind: 'performance', month: '2026-08', person_name: ' ' }))).toBe('A name is required')
    expect(await rejectionOf(api.createReviewEntry({ kind: 'performance', month: 'Aug', person_name: 'A' })))
      .toBe('month must be YYYY-MM — a review always belongs to the month it is about')
    expect(await rejectionOf(api.updateReviewEntry(99_999, { rating: 'Good' }))).toBe('Review row not found')
    expect(lastStatus(server)).toBe(404)
  })
})

describe('top performer', () => {
  it('answers an untouched month with the defaults and ticks as an object, never []', async () => {
    const s = await api.topPerformer('2026-08')
    expectShape(s, TopPerformerStateSpec)
    expect(s).toEqual({ month: '2026-08-01', settings: { additional: ['goals'], min_performance: 80 }, ticks: {} })
    expect(fromWire(s)).toEqual({ settings: DEFAULT_SETTINGS, ticks: {} })
  })

  it('round-trips what toWire sends and fromWire reads back', async () => {
    const [ada, ben] = (await api.createStaff(['Ada', 'Ben'])).created
    const ticks: Record<number, CriterionId[]> = { [ada.id]: ['documentation', 'written'], [ben.id]: [] }
    const saved = await api.saveTopPerformer('2026-08', toWire({ additional: ['goals', 'learning'], minPerformance: 75 }, ticks))
    expectShape(saved, TopPerformerStateSpec)
    expect(saved.ticks).toEqual({ [String(ada.id)]: ['documentation', 'written'] })
    expect(fromWire(saved)).toEqual({ settings: { additional: ['goals', 'learning'], minPerformance: 75 }, ticks: { [ada.id]: ['documentation', 'written'] } })
    expect(sql('SELECT staff_id::int AS s, criterion FROM top_performer_ticks ORDER BY criterion'))
      .toEqual([{ s: ada.id, criterion: 'documentation' }, { s: ada.id, criterion: 'written' }])

    // Saving replaces the month's whole set.
    const cleared = await api.saveTopPerformer('2026-08', toWire(DEFAULT_SETTINGS, {}))
    expect(cleared.ticks).toEqual({})
  })

  it('answers a range oldest-first with one entry per month, and refuses bad input', async () => {
    const [ada] = (await api.createStaff(['Ada'])).created
    await api.saveTopPerformer('2026-08', toWire(DEFAULT_SETTINGS, { [ada.id]: ['written'] }))
    const range = await api.topPerformerRange('2026-09', '2026-07')
    expectShape(range, arrayOf(TopPerformerStateSpec))
    expect(range.map((r) => [r.month, Object.keys(r.ticks).length])).toEqual([['2026-07-01', 0], ['2026-08-01', 1], ['2026-09-01', 0]])

    expect(await rejectionOf(api.topPerformerRange('2024-01', '2026-08'))).toBe('A range may cover at most 24 months')
    expect(await rejectionOf(api.saveTopPerformer('2026-08', { settings: { additional: ['behaviour'], min_performance: 80 }, ticks: {} })))
      .toBe('settings.additional may only list criteria 8–12 by id')
    expect(await rejectionOf(api.saveTopPerformer('2026-08', { settings: { additional: [], min_performance: 80 }, ticks: { [ada.id]: ['charisma'] } })))
      .toBe('Unknown criterion in ticks')
    expect(await rejectionOf(api.saveTopPerformer('2026-08', { settings: { additional: [], min_performance: 80 }, ticks: { 999999: ['written'] } })))
      .toBe('One of the people ticked is no longer on the staff roster')
    expect(lastStatus(server)).toBe(422)
    expect(await rejectionOf(api.topPerformer('soon'))).toBe('month must be YYYY-MM — the month being judged')
  })
})

describe('annual reviews sheet', () => {
  it('answers an untouched period with empty objects (not arrays) and nulls', async () => {
    const s = await api.annualReview('year', '2026-08')
    expectShape(s, AnnualReviewSheetSpec)
    expect(s).toEqual({
      span: 'year', period_end: '2026-08-01', months: 12, overrides: {}, extra_rows: [], settings: {},
      updated_at: null, reset_to: null,
    })
    expect(annualFromWire(s, 'year').settings.minMonths).toBe(defaultMinMonths('year'))
  })

  it('saves what toWire sends, drops blank cells, and resets to a day-old version', async () => {
    const first = await api.saveAnnualReview('half', '2026-08', annualToWire(
      { 's:1': { notes: 'Solid year', performance: '' } },
      [{ key: 'x:abc', name: 'Temp Row' }],
      { minMonths: 2 },
    ))
    expectShape(first, AnnualReviewSheetSpec)
    expect(first).toMatchObject({ overrides: { 's:1': { notes: 'Solid year' } }, extra_rows: [{ key: 'x:abc', name: 'Temp Row' }], settings: { min_months: 2 }, reset_to: null })
    expect(annualFromWire(first, 'half')).toEqual({
      overrides: { 's:1': { notes: 'Solid year' } }, extraRows: [{ key: 'x:abc', name: 'Temp Row' }], settings: { minMonths: 2 },
    })

    expect(await rejectionOf(api.resetAnnualReview('half', '2026-08')))
      .toBe('There is no saved version of this sheet older than 24 hours to go back to')
    expect(lastStatus(server)).toBe(409)

    // Age the first save past the 24-hour line, then edit again today.
    sql("UPDATE annual_review_versions SET saved_at = now() - interval '2 days'")
    const second = await api.saveAnnualReview('half', '2026-08', annualToWire({}, [], { minMonths: 5 }))
    expect(second.overrides).toEqual({})
    expect(second.reset_to).not.toBeNull()
    expectShape(second, AnnualReviewSheetSpec)

    const restored = await api.resetAnnualReview('half', '2026-08')
    expectShape(restored, AnnualReviewSheetSpec)
    expect(restored).toMatchObject({ overrides: { 's:1': { notes: 'Solid year' } }, settings: { min_months: 2 } })
    expect(Date.parse(restored.restored_from as string)).toBe(Date.parse(second.reset_to as string))
  })

  it('refuses a bad span, month or coverage rule', async () => {
    expect(await rejectionOf(api.annualReview('quarter', '2026-08'))).toBe('span must be half (6 months) or year (12 months)')
    expect(await rejectionOf(api.annualReview('year', '2026'))).toBe('month must be YYYY-MM — the month the period ends on')
    expect(await rejectionOf(api.saveAnnualReview('half', '2026-08', { overrides: {}, extra_rows: [], settings: { min_months: 7 } })))
      .toBe('settings.min_months must be a whole number from 0 to 6')
  })
})

describe('Top Performer + Annual Reviews logic over real server data', () => {
  /**
   * Two reviewed months (July, August 2026) for two people:
   *  Ada — Excellent / Good Standing, on time every day, every manual criterion ticked → 8/8
   *  Ben — Average 60–70% / Low Performer, no attendance, a Half Day on leaves      → 0/8
   */
  async function seed(): Promise<{ ada: number, ben: number }> {
    const dept = await api.createDepartment('Audits')
    const [adaRow, benRow] = (await api.createStaff(['Ada Lovelace', 'Ben Stone'], [dept.id])).created
    const ada = adaRow.id, ben = benRow.id
    await api.updateStaff(ada, { expected_login: '09:00', expected_logout: '17:00' })
    const manual: CriterionId[] = ['documentation', 'participation', 'professional', 'written']
    for (const [month, adaPct, benPct] of [['2026-07', 90, 60], ['2026-08', 80, 70]] as const) {
      await api.createReviewEntry({ kind: 'performance', month, person_name: 'Ada Lovelace', rating: 'Excellent', percentage: adaPct })
      await api.createReviewEntry({ kind: 'behaviour', month, person_name: 'Ada Lovelace', rating: 'Good Standing' })
      await api.createReviewEntry({ kind: 'performance', month, person_name: 'Ben Stone', rating: 'Average', percentage: benPct })
      await api.createReviewEntry({ kind: 'behaviour', month, person_name: 'Ben Stone', rating: 'Low Performer' })
      await api.createStaffAttendance({ staff_id: ada, work_date: `${month}-06`, login_at: '08:58', logout_at: '17:05', break_min: 30, status: 'present' })
      await api.saveTopPerformer(month, toWire(DEFAULT_SETTINGS, { [ada]: manual }))
    }
    await api.createStaffLeave({ staff_id: ben, leave_date: '2026-08-12', half_day: 'Approved' })
    return { ada, ben }
  }

  it('ranks a month the way the Top Performer tab does', async () => {
    const { ada, ben } = await seed()
    const month = '2026-08'
    const staff = await api.staff()
    const attendance = await api.staffAttendance(monthRange(month))
    const leaves = await api.staffLeaves(monthRange(month))
    const performance = await api.reviewEntries('performance', month)
    const behaviour = await api.reviewEntries('behaviour', month)
    const { settings, ticks } = fromWire(await api.topPerformer(month))

    const candidates = buildCandidates(staff, attendance.rows, leaves, performance, behaviour)
    expect(candidates.map((c) => [c.member.id, c.presentDays, c.halfDays, c.logins.onTime])).toEqual([[ada, 1, 0, 1], [ben, 0, 1, 0]])
    const ranked = rankCandidates(candidates, settings, ticks)
    expect(ranked.map((r) => [r.candidate.member.name, r.met, r.total, r.allMet, r.rank]))
      .toEqual([['Ada Lovelace', 8, 8, true, 1], ['Ben Stone', 0, 8, false, 2]])
    expect(ranked[1].verdicts.punctuality).toMatchObject({ met: false })
    const picks = pickPerformers(ranked)
    expect(picks.top.map((r) => r.candidate.member.id)).toEqual([ada])
    expect(picks.low.map((r) => r.candidate.member.id)).toEqual([ben])
  })

  it('accumulates a half-year from the window endpoints the Review page calls, and names by coverage', async () => {
    const { ada, ben } = await seed()
    const months = periodMonths('2026-08', 'half')
    expect(months).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'])
    const windowRange = { from: monthRange(months[0]).from, to: monthRange(months[5]).to }

    const slices = buildSlices(
      months,
      await api.staff(),
      (await api.staffAttendance(windowRange)).rows,
      await api.staffLeaves(windowRange),
      await api.reviewEntriesAllMonths('performance'),
      await api.reviewEntriesAllMonths('behaviour'),
      await api.topPerformerRange(months[0], months[5]),
    )
    expect(slices.map((s) => [s.month, s.rows.length])).toEqual([
      ['2026-03', 0], ['2026-04', 0], ['2026-05', 0], ['2026-06', 0], ['2026-07', 2], ['2026-08', 2],
    ])

    const sheet = await api.saveAnnualReview('half', '2026-08', annualToWire({}, [{ key: 'x:temp', name: 'Contractor' }], { minMonths: 2 }))
    const { overrides, extraRows, settings } = annualFromWire(sheet, 'half')
    const tallies = accumulate(slices, extraRows)
    expect(tallies.map((t) => [t.key, t.monthsReviewed, t.perfPct, t.topMonths, t.lowMonths, t.eligibleMonths, t.departments])).toEqual([
      [rowKeyOf(ada), 2, 85, 2, 0, 2, 'Audits'],
      [rowKeyOf(ben), 2, 65, 0, 2, 0, 'Audits'],
      ['x:temp', 0, null, 0, 0, 0, ''],
    ])

    const rows = rankAnnual(tallies, overrides, settings.minMonths)
    const picks = pickAnnual(rows, settings.minMonths)
    const standing = standingOf(picks)
    expect([standing(rowKeyOf(ada)), standing(rowKeyOf(ben)), standing('x:temp')]).toEqual(['top', 'low', null])

    // With the default coverage (3 of 6 months) nobody has enough of the window to be named.
    const strict = pickAnnual(rankAnnual(tallies, overrides, defaultMinMonths('half')), defaultMinMonths('half'))
    expect([strict.top, strict.low, strict.uncovered.length]).toEqual([[], [], 2])
  })
})
