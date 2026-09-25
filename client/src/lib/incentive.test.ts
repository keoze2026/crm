import { describe, expect, it } from 'vitest'
import type { ReviewEntry, StaffLeave, StaffMember } from '../types'
import {
  activeCriteria,
  type AttendanceDayLite,
  buildCandidates,
  type Candidate,
  CRITERIA,
  criterion,
  type CriterionId,
  DEFAULT_SETTINGS,
  fromWire,
  type IncentiveSettings,
  isReviewed,
  judge,
  pickPerformers,
  rankCandidates,
  type RankedRow,
  scorePct,
  toWire,
} from './incentive'
import { emptyLoginTally } from './staff'

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

function review(over: Partial<ReviewEntry> = {}): ReviewEntry {
  return {
    id: 1,
    kind: 'performance',
    department_id: null,
    staff_id: 1,
    person_name: 'Anna',
    department_note: '',
    rating: '',
    percentage: null,
    notes: '',
    month: '2026-08-01',
    sort_order: 0,
    created_at: '2026-09-01 00:00:00',
    updated_at: '2026-09-01 00:00:00',
    ...over,
  }
}

function leave(over: Partial<StaffLeave> = {}): StaffLeave {
  return {
    id: 1,
    staff_id: 1,
    staff_name: 'Anna',
    department_id: null,
    department_name: null,
    leave_date: '2026-08-10',
    sick_leave: '',
    break_leave: '',
    half_day: '',
    late_login: '',
    aob: '',
    expected_return: null,
    actual_return: null,
    sort_order: 0,
    created_at: '2026-08-10 00:00:00',
    updated_at: '2026-08-10 00:00:00',
    ...over,
  }
}

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    member: member(),
    behaviour: review({ kind: 'behaviour', rating: 'Good Standing' }),
    performance: review({ rating: 'Excellent', percentage: 95 }),
    logins: { late: 0, onTime: 20, judged: 20, lateMin: 0, worstLateMin: 0 },
    earlyOuts: 0,
    judgedOuts: 20,
    presentDays: 20,
    halfDays: 0,
    lateMarks: 0,
    ...over,
  }
}

const day = (staff_id: number, login_at: string | null, logout_at: string | null): AttendanceDayLite =>
  ({ staff_id, login_at, logout_at })

/** A ranked row with a given score, for pickPerformers. */
function row(id: number, met: number, total = 10): RankedRow {
  return {
    candidate: candidate({ member: member({ id, name: `P${id}` }) }),
    verdicts: {} as RankedRow['verdicts'],
    met,
    total,
    allMet: met === total,
    rank: 0,
  }
}

describe('CRITERIA', () => {
  it('numbers the client list 1 to 12 in order', () => {
    expect(CRITERIA.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('has seven core and five additional criteria', () => {
    expect(CRITERIA.filter((c) => c.group === 'core').map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(CRITERIA.filter((c) => c.group === 'additional').map((c) => c.n)).toEqual([8, 9, 10, 11, 12])
  })

  it('explains every data-driven criterion', () => {
    for (const c of CRITERIA) if (c.source !== 'manual') expect(c.how).toBeTruthy()
  })

  it('looks a criterion up by id', () => {
    expect(criterion('goals')).toMatchObject({ n: 9, label: 'Goal Achievement', source: 'performance' })
    expect(criterion('login').n).toBe(4)
  })
})

describe('activeCriteria', () => {
  it('is the core seven plus Goal Achievement by default', () => {
    expect(activeCriteria(DEFAULT_SETTINGS).map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 9])
  })

  it('is the core seven alone with nothing additional switched on', () => {
    expect(activeCriteria({ additional: [], minPerformance: 80 })).toHaveLength(7)
  })

  it('keeps the client order however the additional ids are listed', () => {
    const s: IncentiveSettings = { additional: ['feedback', 'learning'], minPerformance: 80 }
    expect(activeCriteria(s).map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 12])
  })

  it('cannot switch a core criterion off by leaving it out', () => {
    const s: IncentiveSettings = { additional: ['behaviour'], minPerformance: 80 }
    expect(activeCriteria(s)).toHaveLength(7)
  })
})

describe('isReviewed', () => {
  it('needs a picked rating on either review', () => {
    expect(isReviewed(null, null)).toBe(false)
    expect(isReviewed(review({ rating: '' }), review({ rating: '   ' }))).toBe(false)
    expect(isReviewed(review({ rating: 'Good' }), null)).toBe(true)
    expect(isReviewed(null, review({ kind: 'behaviour', rating: 'On Track' }))).toBe(true)
  })

  it('does not count a percentage without a rating', () => {
    expect(isReviewed(review({ rating: '', percentage: 90 }), null)).toBe(false)
  })
})

describe('buildCandidates', () => {
  it('lists only reviewed people', () => {
    const staff = [member({ id: 1, name: 'Anna' }), member({ id: 2, name: 'Ben' }), member({ id: 3, name: 'Cara' })]
    const perf = [review({ staff_id: 1, rating: 'Good' }), review({ staff_id: 3, person_name: 'Cara', rating: '' })]
    const result = buildCandidates(staff, [day(2, '09:00', '17:00')], [], perf, [])
    expect(result.map((c) => c.member.id)).toEqual([1])
  })

  it('matches an unlinked review by name, ignoring case and spaces', () => {
    const staff = [member({ id: 7, name: 'Anna Smith' })]
    const beh = [review({ kind: 'behaviour', staff_id: null, person_name: '  anna smith ', rating: 'On Track' })]
    const [c] = buildCandidates(staff, [], [], [], beh)
    expect(c.behaviour?.rating).toBe('On Track')
    expect(c.performance).toBeNull()
  })

  it('prefers the staff-id link over a name match', () => {
    const staff = [member({ id: 1, name: 'Anna' })]
    const perf = [
      review({ id: 10, staff_id: null, person_name: 'Anna', rating: 'Poor' }),
      review({ id: 11, staff_id: 1, person_name: 'Anna B', rating: 'Excellent' }),
    ]
    expect(buildCandidates(staff, [], [], perf, [])[0].performance?.id).toBe(11)
  })

  it('keeps an inactive person who was reviewed for the month', () => {
    const staff = [member({ id: 1, status: 'inactive' })]
    expect(buildCandidates(staff, [], [], [review({ rating: 'Good' })], [])).toHaveLength(1)
  })

  it('gathers the month of attendance and leaves as evidence', () => {
    const staff = [member({ id: 1 }), member({ id: 2, name: 'Ben' })]
    const attendance = [
      day(1, '09:00', '17:00'),
      day(1, '09:20', '16:30'),
      day(1, '08:55', null),
      day(1, null, null),
      day(2, '10:00', '12:00'),
    ]
    const leaves = [
      leave({ staff_id: 1, half_day: 'Approved' }),
      leave({ staff_id: 1, late_login: 'Pending' }),
      leave({ staff_id: 1, half_day: '   ', late_login: 'Unpaid' }),
      leave({ staff_id: 2, half_day: 'Approved' }),
    ]
    const [c] = buildCandidates(staff, attendance, leaves, [review({ rating: 'Good' })], [])
    expect(c.presentDays).toBe(3)
    expect(c.logins).toEqual({ late: 1, onTime: 2, judged: 3, lateMin: 20, worstLateMin: 20 })
    expect(c.judgedOuts).toBe(2)
    expect(c.earlyOuts).toBe(1)
    expect(c.halfDays).toBe(1)
    expect(c.lateMarks).toBe(2)
  })

  it('judges no logins or logouts for somebody without a schedule', () => {
    const staff = [member({ expected_login: null, expected_logout: null })]
    const [c] = buildCandidates(staff, [day(1, '11:00', '12:00')], [], [review({ rating: 'Good' })], [])
    expect(c.presentDays).toBe(1)
    expect(c.logins).toEqual(emptyLoginTally())
    expect(c.judgedOuts).toBe(0)
  })

  it('returns nobody for an empty roster', () => {
    expect(buildCandidates([], [], [], [review({ rating: 'Good' })], [])).toEqual([])
  })
})

describe('judge', () => {
  const s = DEFAULT_SETTINGS

  describe('behaviour', () => {
    it('is met for any rating but Low Performer', () => {
      expect(judge(candidate(), 'behaviour', s, [])).toEqual({ met: true, note: 'Good Standing' })
      const low = candidate({ behaviour: review({ kind: 'behaviour', rating: 'Low Performer' }) })
      expect(judge(low, 'behaviour', s, [])).toEqual({ met: false, note: 'Low Performer' })
      const lower = candidate({ behaviour: review({ kind: 'behaviour', rating: 'low performer' }) })
      expect(judge(lower, 'behaviour', s, []).met).toBe(false)
    })

    it('is unknown without a behaviour analysis', () => {
      expect(judge(candidate({ behaviour: null }), 'behaviour', s, [])).toMatchObject({ met: false, unknown: true })
      const blank = candidate({ behaviour: review({ kind: 'behaviour', rating: '  ' }) })
      expect(judge(blank, 'behaviour', s, [])).toMatchObject({ met: false, unknown: true })
    })
  })

  describe('punctuality', () => {
    it('is met for a month of full days', () => {
      expect(judge(candidate(), 'punctuality', s, [])).toEqual({ met: true, note: 'Full days 20/20' })
    })

    it('fails on early logouts, worded in the singular and plural', () => {
      expect(judge(candidate({ earlyOuts: 1 }), 'punctuality', s, [])).toEqual({ met: false, note: '1 early logout of 20' })
      expect(judge(candidate({ earlyOuts: 3 }), 'punctuality', s, []).note).toBe('3 early logouts of 20')
    })

    it('fails on a Half Day on the Leaves sheet, even with no logouts to judge', () => {
      const c = candidate({ judgedOuts: 0, halfDays: 1 })
      expect(judge(c, 'punctuality', s, [])).toEqual({ met: false, note: '1 Half Day on Leaves' })
    })

    it('lists both problems together', () => {
      expect(judge(candidate({ earlyOuts: 2, halfDays: 1 }), 'punctuality', s, []).note)
        .toBe('2 early logouts of 20 · 1 Half Day on Leaves')
    })

    it('is unknown with no attendance, or nothing to judge it by', () => {
      expect(judge(candidate({ presentDays: 0 }), 'punctuality', s, [])).toMatchObject({ met: false, unknown: true })
      expect(judge(candidate({ judgedOuts: 0 }), 'punctuality', s, [])).toMatchObject({ met: false, unknown: true })
    })
  })

  describe('login', () => {
    it('is met with every login on time', () => {
      expect(judge(candidate(), 'login', s, [])).toEqual({ met: true, note: 'On time 20/20' })
    })

    it('fails on late logins and Late Login marks', () => {
      const late = candidate({ logins: { late: 1, onTime: 19, judged: 20, lateMin: 5, worstLateMin: 5 } })
      expect(judge(late, 'login', s, [])).toEqual({ met: false, note: '1 late login of 20' })
      const both = candidate({ logins: { late: 2, onTime: 18, judged: 20, lateMin: 9, worstLateMin: 5 }, lateMarks: 1 })
      expect(judge(both, 'login', s, []).note).toBe('2 late logins of 20 · 1 Late Login on Leaves')
    })

    it('fails on a Late Login mark with no expected login to judge by', () => {
      const c = candidate({ logins: emptyLoginTally(), lateMarks: 2 })
      expect(judge(c, 'login', s, [])).toEqual({ met: false, note: '2 Late Login on Leaves' })
    })

    it('is unknown with no attendance, or no expected login', () => {
      expect(judge(candidate({ presentDays: 0 }), 'login', s, [])).toMatchObject({ met: false, unknown: true })
      expect(judge(candidate({ logins: emptyLoginTally() }), 'login', s, [])).toMatchObject({ met: false, unknown: true })
    })
  })

  describe('goals', () => {
    it('is met by an Excellent or Good rating, whatever the score', () => {
      const good = candidate({ performance: review({ rating: 'good', percentage: 40 }) })
      expect(judge(good, 'goals', s, [])).toEqual({ met: true, note: 'good · 40%' })
      const excellent = candidate({ performance: review({ rating: 'Excellent', percentage: null }) })
      expect(judge(excellent, 'goals', s, [])).toEqual({ met: true, note: 'Excellent' })
    })

    it('is met by a percentage at or over the target', () => {
      const at = candidate({ performance: review({ rating: 'Average', percentage: 80 }) })
      expect(judge(at, 'goals', s, []).met).toBe(true)
      const under = candidate({ performance: review({ rating: 'Average', percentage: 79.9 }) })
      expect(judge(under, 'goals', s, [])).toEqual({ met: false, note: 'Average · 79.9%' })
    })

    it('follows the target set for the month', () => {
      const c = candidate({ performance: review({ rating: 'Average', percentage: 70 }) })
      expect(judge(c, 'goals', { ...s, minPerformance: 70 }, []).met).toBe(true)
      expect(judge(c, 'goals', { ...s, minPerformance: 71 }, []).met).toBe(false)
    })

    it('judges a score alone when there is no rating, including 0%', () => {
      const zero = candidate({ performance: review({ rating: '', percentage: 0 }) })
      expect(judge(zero, 'goals', s, [])).toEqual({ met: false, note: '0%' })
    })

    it('does not treat "Below Average" or "Good Standing" as good', () => {
      const c = candidate({ performance: review({ rating: 'Good Standing', percentage: null }) })
      expect(judge(c, 'goals', s, []).met).toBe(false)
    })

    it('is unknown with no performance review, or an empty one', () => {
      expect(judge(candidate({ performance: null }), 'goals', s, [])).toMatchObject({ met: false, unknown: true })
      const empty = candidate({ performance: review({ rating: ' ', percentage: null }) })
      expect(judge(empty, 'goals', s, [])).toMatchObject({ met: false, unknown: true })
    })
  })

  describe('manual criteria and ticks', () => {
    it('meets a manual criterion only when ticked', () => {
      expect(judge(candidate(), 'documentation', s, [])).toEqual({ met: false, note: 'Not confirmed yet' })
      expect(judge(candidate(), 'documentation', s, ['documentation'])).toEqual({ met: true, note: 'Confirmed by you' })
    })

    it('lets a tick overrule the data, keeping what the data said', () => {
      const low = candidate({ behaviour: review({ kind: 'behaviour', rating: 'Low Performer' }) })
      expect(judge(low, 'behaviour', s, ['behaviour'])).toEqual({
        met: true,
        confirmed: true,
        note: 'Confirmed by you · the data says: Low Performer',
      })
    })

    it('ignores ticks for other criteria', () => {
      expect(judge(candidate({ earlyOuts: 1 }), 'punctuality', s, ['login']).met).toBe(false)
    })
  })
})

describe('rankCandidates', () => {
  const allManual: CriterionId[] = ['documentation', 'participation', 'professional', 'written']

  it('scores every criterion and counts only the ones in play', () => {
    const [r] = rankCandidates([candidate()], DEFAULT_SETTINGS, { 1: allManual })
    expect(Object.keys(r.verdicts)).toHaveLength(12)
    expect(r.total).toBe(8)
    expect(r.met).toBe(8)
    expect(r.allMet).toBe(true)
    expect(r.rank).toBe(1)
  })

  it('does not credit a met criterion that is switched off', () => {
    const [r] = rankCandidates([candidate()], { additional: [], minPerformance: 80 }, {})
    expect(r.total).toBe(7)
    expect(r.met).toBe(3)
    expect(r.verdicts.goals.met).toBe(true)
  })

  it('orders by criteria met, then by the tie-breaks', () => {
    const a = candidate({ member: member({ id: 1, name: 'A', sort_order: 1 }) })
    const b = candidate({ member: member({ id: 2, name: 'B', sort_order: 2 }) })
    const c = candidate({ member: member({ id: 3, name: 'C', sort_order: 3 }) })
    const rows = rankCandidates([a, b, c], DEFAULT_SETTINGS, { 3: allManual })
    expect(rows.map((r) => r.candidate.member.id)).toEqual([3, 1, 2])
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 2])
  })

  it('breaks a tie on performance percentage, a missing one ranking last', () => {
    const lo = candidate({ member: member({ id: 1 }), performance: review({ rating: 'Good', percentage: 85 }) })
    const hi = candidate({ member: member({ id: 2 }), performance: review({ rating: 'Good', percentage: 90 }) })
    const none = candidate({ member: member({ id: 3 }), performance: review({ rating: 'Good', percentage: null }) })
    const rows = rankCandidates([none, lo, hi], DEFAULT_SETTINGS, {})
    expect(rows.map((r) => r.candidate.member.id)).toEqual([2, 1, 3])
  })

  it('breaks a tie on on-time share, then on minutes late', () => {
    // Each has one late login, so all fail Timely Login and tie on criteria met.
    const shaky = candidate({ member: member({ id: 1 }), logins: { late: 1, onTime: 1, judged: 2, lateMin: 5, worstLateMin: 5 } })
    const steady = candidate({ member: member({ id: 2 }), logins: { late: 1, onTime: 9, judged: 10, lateMin: 30, worstLateMin: 30 } })
    const steadier = candidate({ member: member({ id: 3 }), logins: { late: 1, onTime: 9, judged: 10, lateMin: 10, worstLateMin: 10 } })
    const rows = rankCandidates([shaky, steady, steadier], DEFAULT_SETTINGS, {})
    expect(rows.map((r) => r.candidate.member.id)).toEqual([3, 2, 1])
  })

  it('falls back to roster order, then name, for a stable list', () => {
    const b = candidate({ member: member({ id: 1, name: 'Ben', sort_order: 0 }) })
    const a = candidate({ member: member({ id: 2, name: 'Anna', sort_order: 0 }) })
    const first = candidate({ member: member({ id: 3, name: 'Zed', sort_order: -1 }) })
    const rows = rankCandidates([b, a, first], DEFAULT_SETTINGS, {})
    expect(rows.map((r) => r.candidate.member.name)).toEqual(['Zed', 'Anna', 'Ben'])
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 1])
  })

  it('shares ranks the way a leaderboard reads (1, 1, 3)', () => {
    const top1 = candidate({ member: member({ id: 1, sort_order: 1 }) })
    const top2 = candidate({ member: member({ id: 2, sort_order: 2 }) })
    const third = candidate({ member: member({ id: 3, sort_order: 3 }), behaviour: null })
    const rows = rankCandidates([third, top2, top1], DEFAULT_SETTINGS, {})
    expect(rows.map((r) => [r.candidate.member.id, r.rank])).toEqual([[1, 1], [2, 1], [3, 3]])
  })

  it('returns nothing for no candidates', () => {
    expect(rankCandidates([], DEFAULT_SETTINGS, {})).toEqual([])
  })
})

describe('scorePct', () => {
  it('rounds the share of criteria met to a whole percentage', () => {
    expect(scorePct(row(1, 7, 8))).toBe(88)
    expect(scorePct(row(1, 1, 3))).toBe(33)
    expect(scorePct(row(1, 8, 8))).toBe(100)
    expect(scorePct(row(1, 0, 8))).toBe(0)
  })

  it('does not divide by zero when nothing is in play', () => {
    expect(scorePct(row(1, 0, 0))).toBe(0)
  })
})

describe('pickPerformers', () => {
  it('names nobody for an empty month', () => {
    expect(pickPerformers([])).toEqual({ top: [], low: [], listed: [], topPct: 0, lowPct: 0 })
  })

  it('names the top scorer and the bottom scorer when there is a spread', () => {
    const rows = [row(1, 10), row(2, 9), row(3, 5), row(4, 2)]
    const p = pickPerformers(rows)
    expect(p.top.map((r) => r.candidate.member.id)).toEqual([1])
    expect(p.listed.map((r) => r.candidate.member.id)).toEqual([1, 2])
    expect(p.low.map((r) => r.candidate.member.id)).toEqual([4])
    expect(p.topPct).toBe(100)
    expect(p.lowPct).toBe(20)
  })

  it('lists exactly 80% as a top performer', () => {
    const p = pickPerformers([row(1, 8), row(2, 7)])
    expect(p.top.map((r) => r.candidate.member.id)).toEqual([1])
    expect(p.topPct).toBe(80)
  })

  it('names every person tied at either end', () => {
    const p = pickPerformers([row(1, 9), row(2, 9), row(3, 3), row(4, 3)])
    expect(p.top.map((r) => r.candidate.member.id)).toEqual([1, 2])
    expect(p.low.map((r) => r.candidate.member.id)).toEqual([3, 4])
  })

  it('names no top when nobody clears the bar, but still names the bottom', () => {
    const p = pickPerformers([row(1, 7), row(2, 2)])
    expect(p.top).toEqual([])
    expect(p.listed).toEqual([])
    expect(p.topPct).toBe(0)
    expect(p.low.map((r) => r.candidate.member.id)).toEqual([2])
  })

  it('counts a reviewed 0% as genuinely last', () => {
    const p = pickPerformers([row(1, 10), row(2, 0)])
    expect(p.low.map((r) => r.candidate.member.id)).toEqual([2])
    expect(p.lowPct).toBe(0)
  })

  it('names no bottom when everyone scored the same', () => {
    expect(pickPerformers([row(1, 5), row(2, 5)]).low).toEqual([])
  })

  it('names no bottom for a single person', () => {
    expect(pickPerformers([row(1, 2)]).low).toEqual([])
  })

  it('names no bottom when the lowest score still clears the bar', () => {
    const p = pickPerformers([row(1, 10), row(2, 8)])
    expect(p.low).toEqual([])
    expect(p.lowPct).toBe(80)
  })
})

describe('fromWire / toWire', () => {
  it('falls back to the defaults with no saved state', () => {
    expect(fromWire(null)).toEqual({ settings: DEFAULT_SETTINGS, ticks: {} })
    expect(fromWire(undefined)).toEqual({ settings: DEFAULT_SETTINGS, ticks: {} })
  })

  it('reads settings and ticks, keyed by numeric staff id', () => {
    const out = fromWire({
      month: '2026-08-01',
      settings: { additional: ['learning', 'goals'], min_performance: 75 },
      ticks: { 3: ['documentation', 'written'], 12: ['behaviour'] },
    })
    expect(out).toEqual({
      settings: { additional: ['learning', 'goals'], minPerformance: 75 },
      ticks: { 3: ['documentation', 'written'], 12: ['behaviour'] },
    })
  })

  it('drops ids it no longer recognises, and core ids from the additional list', () => {
    const out = fromWire({
      month: '2026-08-01',
      settings: { additional: ['goals', 'retired', 'behaviour'], min_performance: 80 },
      ticks: { 1: ['documentation', 'old-one'], 2: ['nope'], 3: [] },
    })
    expect(out.settings.additional).toEqual(['goals'])
    expect(out.ticks).toEqual({ 1: ['documentation'] })
  })

  it('keeps a 0% target rather than defaulting it', () => {
    const out = fromWire({ month: '2026-08-01', settings: { additional: [], min_performance: 0 }, ticks: {} })
    expect(out.settings).toEqual({ additional: [], minPerformance: 0 })
  })

  it('fills in a partial or malformed state from the defaults', () => {
    const partial = { month: '2026-08-01' } as unknown as Parameters<typeof fromWire>[0]
    expect(fromWire(partial)).toEqual({ settings: DEFAULT_SETTINGS, ticks: {} })
    const badTarget = { month: '2026-08-01', settings: { additional: ['goals'], min_performance: '90' }, ticks: {} } as unknown as Parameters<typeof fromWire>[0]
    expect(fromWire(badTarget).settings.minPerformance).toBe(80)
  })

  it('writes the API shape, leaving out people with no ticks', () => {
    const settings: IncentiveSettings = { additional: ['goals', 'feedback'], minPerformance: 85 }
    expect(toWire(settings, { 1: ['documentation'], 2: [] })).toEqual({
      settings: { additional: ['goals', 'feedback'], min_performance: 85 },
      ticks: { 1: ['documentation'] },
    })
  })

  it('round-trips through the wire unchanged', () => {
    const settings: IncentiveSettings = { additional: ['learning', 'goals'], minPerformance: 72 }
    const ticks = { 4: ['behaviour', 'written'] as CriterionId[], 9: ['feedback'] as CriterionId[] }
    expect(fromWire({ month: '2026-08-01', ...toWire(settings, ticks) })).toEqual({ settings, ticks })
  })
})
