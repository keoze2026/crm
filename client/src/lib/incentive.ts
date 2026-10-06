/**
 * Top Performer of the Month — the incentive criteria and how each one is judged.
 *
 * The twelve criteria are the client's own list, kept in their numbering and wording. Four
 * of them are read off fields the CRM already keeps for the month:
 *   1 Exemplary Behavior  ← Review page · Behaviour tab (the behaviour analysis rating)
 *   2 Punctuality         ← Attendance day sheet (logout vs expected logout) + Leaves (Half Day)
 *   4 Timely Login        ← Attendance day sheet (login vs expected login) + Leaves (Late Login)
 *   9 Goal Achievement    ← Review page · Performance tab (rating and percentage)
 * The other eight are nothing the CRM records (documents, meetings, feedback…), so they
 * are confirmed by the manager per person.
 *
 * Criteria 1–7 always apply. 8–12 are the "if applicable" ones the manager switches on for
 * a month. Somebody who meets every criterion in play is Eligible; the month's top performer
 * is whoever a manager marks (see pickPerformers).
 *
 * Pure data + rules; no React. The sheet owns the ticks and the settings.
 */

import type { ReviewEntry, StaffLeave, StaffMember, TopPerformerState } from '../types'
import { earlyBy, type LoginTally, tallyLogins } from './staff'

export type CriterionId =
  | 'behaviour' | 'punctuality' | 'documentation' | 'login' | 'participation' | 'professional' | 'written'
  | 'learning' | 'goals' | 'collaboration' | 'innovation' | 'feedback'

/** Where a criterion's verdict comes from. */
export type CriterionSource = 'behaviour' | 'attendance' | 'performance' | 'manual'

export interface Criterion {
  id: CriterionId
  /** The number in the client's list, 1–12. */
  n: number
  /** The criterion exactly as the client words it. */
  label: string
  /** The client's one-line description, verbatim. */
  detail: string
  group: 'core' | 'additional'
  source: CriterionSource
  /** Which CRM fields a data-driven verdict is read from, in plain words. */
  how?: string
}

export const CRITERIA: Criterion[] = [
  { id: 'behaviour', n: 1, label: 'Exemplary Behavior', detail: 'Always demonstrate best practices in conduct.', group: 'core', source: 'behaviour', how: 'Their behaviour analysis on the Review page for this month is anything but "Low Performer".' },
  { id: 'punctuality', n: 2, label: 'Punctuality', detail: 'Consistently arrive and complete work on time.', group: 'core', source: 'attendance', how: 'Every day on the Attendance sheet ran to their expected logout, and the Leaves sheet has no Half Day against them.' },
  { id: 'documentation', n: 3, label: 'Documentation', detail: 'Record and submit all work in PDF format.', group: 'core', source: 'manual' },
  { id: 'login', n: 4, label: 'Timely Login', detail: 'Never delay in logging into work systems.', group: 'core', source: 'attendance', how: 'No login on the Attendance sheet is after their expected login, and the Leaves sheet has no Late Login against them.' },
  { id: 'participation', n: 5, label: 'Active Participation', detail: 'Engage in team meetings and contribute ideas for growth.', group: 'core', source: 'manual' },
  { id: 'professional', n: 6, label: 'Professional Interactions', detail: 'Maintain respectful relationships with seniors, management, and teammates.', group: 'core', source: 'manual' },
  { id: 'written', n: 7, label: 'Written Task Submission', detail: 'Submit all tasks in writing.', group: 'core', source: 'manual' },
  { id: 'learning', n: 8, label: 'Continuous Learning', detail: 'Actively seek opportunities for professional development.', group: 'additional', source: 'manual' },
  { id: 'goals', n: 9, label: 'Goal Achievement', detail: 'Meet or exceed performance targets and goals.', group: 'additional', source: 'performance', how: 'Their performance rating on the Review page for this month is Excellent or Good, or its percentage reaches the target you set.' },
  { id: 'collaboration', n: 10, label: 'Collaboration', detail: 'Work effectively with others to achieve team objectives.', group: 'additional', source: 'manual' },
  { id: 'innovation', n: 11, label: 'Innovation', detail: 'Propose and implement new ideas that enhance productivity or efficiency.', group: 'additional', source: 'manual' },
  { id: 'feedback', n: 12, label: 'Feedback Acceptance', detail: 'Openly receive and act on feedback for improvement.', group: 'additional', source: 'manual' },
]

export const criterion = (id: CriterionId): Criterion => CRITERIA.find((c) => c.id === id) as Criterion

// ─── Settings & ticks ─────────────────────────────────────────────────────────

/** What the manager has switched on for the month, and the bars for Goal Achievement and Low. */
export interface IncentiveSettings {
  /** Which of criteria 8–12 are in play. 1–7 always are. */
  additional: CriterionId[]
  /** Performance % that counts as meeting Goal Achievement when the rating alone doesn't. */
  minPerformance: number
  /** Performance % under which a reviewed person wears the Low badge (see pickPerformers). */
  lowPerformance: number
}

export const DEFAULT_SETTINGS: IncentiveSettings = {
  additional: ['goals'],
  minPerformance: 80,
  lowPerformance: 40,
}

/**
 * A manager's word on the Low badge, kept among the person's ticks: 'low' marks them a Low
 * performer whatever their percentage, 'not-low' clears them of it.
 */
export type LowMark = 'low' | 'not-low'

/** A manager's pick for the month's top performer, kept among the person's ticks. */
export type TopMark = 'top'

/** What a person's ticks hold: the criteria confirmed by hand, and a Top or a Low mark. */
export type TickId = CriterionId | LowMark | TopMark

/** Manual ticks: which criteria each person (by staff id) has been credited with, and any mark. */
export type ManualTicks = Record<number, TickId[]>

/** The criteria in play for these settings, in the client's order. */
export function activeCriteria(settings: IncentiveSettings): Criterion[] {
  return CRITERIA.filter((c) => c.group === 'core' || settings.additional.includes(c.id))
}

// ─── Evidence ─────────────────────────────────────────────────────────────────

/** What the month's data says about one person, before any criterion is judged. */
export interface Candidate {
  member: StaffMember
  behaviour: ReviewEntry | null
  performance: ReviewEntry | null
  /** Late / on-time logins over the month, against the person's own expected login. */
  logins: LoginTally
  /** Days that ended before the expected logout. */
  earlyOuts: number
  /** Days with a logout recorded and an expected logout to judge it by. */
  judgedOuts: number
  /** Days with a login recorded. */
  presentDays: number
  /** Leaves sheet rows for the month with a Half Day marker. */
  halfDays: number
  /** Leaves sheet rows for the month with a Late Login marker. */
  lateMarks: number
}

/** A day of the month's attendance sheet, as far as the criteria care. */
export interface AttendanceDayLite {
  staff_id: number
  login_at: string | null
  logout_at: string | null
  /** On leave that day — its login and logout are never judged late or early. */
  on_leave?: boolean
}

/**
 * A review counts as DONE when an analysis has actually been picked — a performance rating
 * or a behaviour rating — not when the person's name merely appears on a review sheet. A
 * row somebody added and never filled in is not a review.
 */
export const isReviewed = (performance: ReviewEntry | null, behaviour: ReviewEntry | null): boolean =>
  (performance?.rating.trim() ?? '') !== '' || (behaviour?.rating.trim() ?? '') !== ''

/**
 * Build every person's evidence from the month's sheets.
 *
 * Only people whose review for the month is done (see isReviewed) are candidates at all.
 * Attendance and leaves are evidence about a reviewed person — they are not what puts
 * somebody on the list, so a perfect month of logins with no review yet ranks nobody, and
 * neither badge can land on them. The name appears in the ranking the moment a rating is
 * picked for them on the Review page.
 *
 * Within that, the roster is judged AS OF THE MONTH: somebody marked Inactive today is
 * still listed if the month holds a review for them — they were on the team that month and
 * rank with everyone else.
 */
export function buildCandidates(
  staff: StaffMember[],
  attendance: AttendanceDayLite[],
  leaves: StaffLeave[],
  performance: ReviewEntry[],
  behaviour: ReviewEntry[],
): Candidate[] {
  const days = new Map<number, AttendanceDayLite[]>()
  for (const d of attendance) days.set(d.staff_id, [...(days.get(d.staff_id) ?? []), d])
  const leaveRows = new Map<number, StaffLeave[]>()
  for (const l of leaves) leaveRows.set(l.staff_id, [...(leaveRows.get(l.staff_id) ?? []), l])
  // Reviews link by staff id; ones written before the person joined the roster carry only a name.
  const find = (entries: ReviewEntry[], m: StaffMember) =>
    entries.find((e) => e.staff_id === m.id) ?? entries.find((e) => e.person_name.trim().toLowerCase() === m.name.trim().toLowerCase()) ?? null

  return staff
    .filter((m) => isReviewed(find(performance, m), find(behaviour, m)))
    .map((m) => {
      const own = days.get(m.id) ?? []
      const present = own.filter((d) => d.login_at)
      // A day on leave is not held against Timely Login or Punctuality, whatever its clock says.
      const judged = own.filter((d) => !d.on_leave)
      const outs = judged.map((d) => earlyBy(d.logout_at, m.expected_logout)).filter((x): x is number => x !== null)
      const marks = leaveRows.get(m.id) ?? []
      return {
        member: m,
        behaviour: find(behaviour, m),
        performance: find(performance, m),
        logins: tallyLogins(judged.filter((d) => d.login_at).map((d) => d.login_at), m.expected_login),
        earlyOuts: outs.filter((x) => x > 0).length,
        judgedOuts: outs.length,
        presentDays: present.length,
        halfDays: marks.filter((l) => l.half_day.trim() !== '').length,
        lateMarks: marks.filter((l) => l.late_login.trim() !== '').length,
      }
    })
}

// ─── Judging ──────────────────────────────────────────────────────────────────

export interface Verdict {
  met: boolean
  /** Why, in a few words — "Good Standing", "2 late of 20", "Excellent · 95%", "Ticked". */
  note: string
  /** True when the data can't say either way (no review, no attendance) — shown greyed. */
  unknown?: boolean
  /**
   * True when a manager confirmed a DATA-DRIVEN criterion by hand, over whatever the data
   * said — the sheet shows it as theirs, and `note` keeps what the data would have said.
   */
  confirmed?: boolean
}

const GOOD_PERFORMANCE = /^(excellent|good)$/i
const BAD_BEHAVIOUR = /low performer/i

/**
 * One criterion's verdict for one person.
 *
 * The four data-driven criteria are read from the month's sheets, but a manager can still
 * confirm any of them by hand — a tick beats the data. That is for the day the record is
 * wrong or missing and the manager knows better: a login the bot never saw, a review not
 * yet typed up. Removing the tick hands the verdict back to the data. The manual criteria
 * are ticks and nothing else.
 */
export function judge(c: Candidate, id: CriterionId, settings: IncentiveSettings, ticks: TickId[]): Verdict {
  const auto = judgeFromData(c, id, settings)
  if (auto === null) {
    return { met: ticks.includes(id), note: ticks.includes(id) ? 'Confirmed by you' : 'Not confirmed yet' }
  }
  if (ticks.includes(id)) {
    return { met: true, confirmed: true, note: `Confirmed by you · the data says: ${auto.note}` }
  }
  return auto
}

/** What the month's data says about a criterion — null for the ones no data can judge. */
function judgeFromData(c: Candidate, id: CriterionId, settings: IncentiveSettings): Verdict | null {
  switch (id) {
    case 'behaviour': {
      const rating = c.behaviour?.rating.trim() ?? ''
      if (!rating) return { met: false, unknown: true, note: 'No behaviour analysis on the Review page for this month' }
      return { met: !BAD_BEHAVIOUR.test(rating), note: rating }
    }
    case 'punctuality': {
      if (c.presentDays === 0) return { met: false, unknown: true, note: 'No attendance recorded this month' }
      if (c.judgedOuts === 0 && c.halfDays === 0) return { met: false, unknown: true, note: 'No logout, or no expected logout on the Staff page, to judge' }
      const problems = [
        c.earlyOuts > 0 && `${c.earlyOuts} early logout${c.earlyOuts > 1 ? 's' : ''} of ${c.judgedOuts}`,
        c.halfDays > 0 && `${c.halfDays} Half Day on Leaves`,
      ].filter(Boolean)
      return { met: problems.length === 0, note: problems.length ? problems.join(' · ') : `Full days ${c.judgedOuts}/${c.judgedOuts}` }
    }
    case 'login': {
      if (c.presentDays === 0) return { met: false, unknown: true, note: 'No attendance recorded this month' }
      if (c.logins.judged === 0 && c.lateMarks === 0) return { met: false, unknown: true, note: 'No expected login on the Staff page to judge against' }
      const problems = [
        c.logins.late > 0 && `${c.logins.late} late login${c.logins.late > 1 ? 's' : ''} of ${c.logins.judged}`,
        c.lateMarks > 0 && `${c.lateMarks} Late Login on Leaves`,
      ].filter(Boolean)
      return { met: problems.length === 0, note: problems.length ? problems.join(' · ') : `On time ${c.logins.onTime}/${c.logins.judged}` }
    }
    case 'goals': {
      const p = c.performance
      if (!p || (!p.rating.trim() && p.percentage == null)) return { met: false, unknown: true, note: 'No performance review on the Review page for this month' }
      const byRating = GOOD_PERFORMANCE.test(p.rating.trim())
      const byScore = p.percentage != null && p.percentage >= settings.minPerformance
      const note = [p.rating.trim(), p.percentage != null ? `${p.percentage}%` : ''].filter(Boolean).join(' · ')
      return { met: byRating || byScore, note }
    }
    default:
      return null
  }
}

// ─── Ranking ──────────────────────────────────────────────────────────────────

export interface RankedRow {
  candidate: Candidate
  verdicts: Record<CriterionId, Verdict>
  /** Criteria met, out of the ones in play. */
  met: number
  total: number
  /** Every criterion in play is met — Eligible for the incentive (a manager still picks the winner). */
  allMet: boolean
  rank: number
  /** Their performance % on the Review page is under the month's Low performer threshold. */
  underLow: boolean
  /** A manager's Low mark: true = marked Low, false = cleared of it, null = left to the rules. */
  lowMark: boolean | null
  /** A manager picked them as a top performer of the month — the only way to get the badge. */
  topMark: boolean
}

/**
 * Score everyone and order them: most criteria met first, then the data-driven tie-breaks
 * a manager would reach for — performance %, on-time login share, fewer minutes late —
 * and finally the roster order so the list is stable.
 */
export function rankCandidates(candidates: Candidate[], settings: IncentiveSettings, ticks: ManualTicks): RankedRow[] {
  const active = activeCriteria(settings)
  const rows = candidates.map((candidate) => {
    const own = ticks[candidate.member.id] ?? []
    const verdicts = Object.fromEntries(CRITERIA.map((c) => [c.id, judge(candidate, c.id, settings, own)])) as Record<CriterionId, Verdict>
    const met = active.filter((c) => verdicts[c.id].met).length
    const pct = candidate.performance?.percentage
    // One person is never both: a Top mark sets any Low mark aside (the sheet won't set
    // both, but two managers marking at once could).
    const topMark = own.includes('top')
    return {
      candidate, verdicts, met, total: active.length, allMet: met === active.length, rank: 0,
      underLow: pct != null && pct < settings.lowPerformance,
      lowMark: topMark ? null : own.includes('low') ? true : own.includes('not-low') ? false : null,
      topMark,
    }
  })
  const onTimeShare = (c: Candidate) => (c.logins.judged ? c.logins.onTime / c.logins.judged : 0)
  rows.sort((a, b) =>
    b.met - a.met
    || (b.candidate.performance?.percentage ?? -1) - (a.candidate.performance?.percentage ?? -1)
    || onTimeShare(b.candidate) - onTimeShare(a.candidate)
    || a.candidate.logins.lateMin - b.candidate.logins.lateMin
    || a.candidate.member.sort_order - b.candidate.member.sort_order
    || a.candidate.member.name.localeCompare(b.candidate.member.name),
  )
  // Equal scores share a rank (1, 1, 3…), the way a leaderboard reads.
  rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].met === r.met ? rows[i - 1].rank : i + 1 })
  return rows
}

// ─── Wire shape ───────────────────────────────────────────────────────────────
//
// The month's settings and ticks live on the server (/top-performer) so every manager
// sees the same confirmations. These two convert between the API's shape and the sheet's,
// dropping anything the client no longer recognises.

const isAdditional = (id: string): id is CriterionId => CRITERIA.some((c) => c.id === id && c.group === 'additional')
const isTickId = (id: string): id is TickId =>
  id === 'top' || id === 'low' || id === 'not-low' || CRITERIA.some((c) => c.id === id)

export function fromWire(state: TopPerformerState | null | undefined): { settings: IncentiveSettings; ticks: ManualTicks } {
  if (!state) return { settings: DEFAULT_SETTINGS, ticks: {} }
  const ticks: ManualTicks = {}
  for (const [staffId, ids] of Object.entries(state.ticks ?? {})) {
    const own = (ids ?? []).filter(isTickId)
    if (own.length) ticks[Number(staffId)] = own
  }
  return {
    settings: {
      additional: (state.settings?.additional ?? DEFAULT_SETTINGS.additional).filter(isAdditional),
      minPerformance: typeof state.settings?.min_performance === 'number' ? state.settings.min_performance : DEFAULT_SETTINGS.minPerformance,
      lowPerformance: typeof state.settings?.low_performance === 'number' ? state.settings.low_performance : DEFAULT_SETTINGS.lowPerformance,
    },
    ticks,
  }
}

export function toWire(settings: IncentiveSettings, ticks: ManualTicks): Pick<TopPerformerState, 'settings' | 'ticks'> {
  const out: Record<string, string[]> = {}
  for (const [staffId, ids] of Object.entries(ticks)) if (ids.length) out[staffId] = ids
  return {
    settings: { additional: settings.additional, min_performance: settings.minPerformance, low_performance: settings.lowPerformance },
    ticks: out,
  }
}

/**
 * Someone's ticks after a manager sets their Low badge to `low`. A mark is kept only while
 * it disagrees with what the rules say (`byRules`), so flipping the badge back to the rules'
 * answer removes the mark and hands the badge back to them.
 */
export function withLowMark(own: TickId[], low: boolean, byRules: boolean): TickId[] {
  const rest = own.filter((x) => x !== 'low' && x !== 'not-low')
  return low === byRules ? rest : [...rest, low ? 'low' : 'not-low']
}

/**
 * Someone's ticks after a manager marks them top performer (`top`) or unmarks them. A Low
 * mark can't stand beside a Top one, so marking drops it; unmarking hands Low back to the rules.
 */
export function withTopMark(own: TickId[], top: boolean): TickId[] {
  const rest = own.filter((x) => x !== 'top' && x !== 'low' && x !== 'not-low')
  return top ? [...rest, 'top'] : rest
}

// ─── Who is top, who is bottom ────────────────────────────────────────────────
//
// The month's two names, decided from the same ranking the sheet shows, so the Review tab,
// the scorecards and the badges worn beside staff names everywhere else can never disagree.

/** What the month's incentive is worth — the green badge says so. */
export const INCENTIVE_USD = 200

/** The score that puts someone in the running for top performer, and the bar the lowest-score rule uses. */
export const TOP_PERFORMER_PCT = 80

/** A person's score as a whole percentage of the criteria in play. */
export const scorePct = (r: RankedRow) => Math.round((r.met / Math.max(1, r.total)) * 100)

export interface PerformerPicks {
  /** Everyone a manager has marked top performer (RankedRow.topMark) — nobody else. */
  top: RankedRow[]
  /** Everyone wearing the Low badge — the rules' answer, or a manager's mark over it (see below). */
  low: RankedRow[]
  /** Who the rules alone would badge Low, before any manager's mark. */
  lowByRules: RankedRow[]
  /** Everyone at or above TOP_PERFORMER_PCT and not Low — who the scores put in the running. */
  listed: RankedRow[]
  /** The best score among the marked top performers. */
  topPct: number
  /** The worst score among everyone not marked top. */
  lowPct: number
}

/**
 * The month's ends.
 *
 * Top is a manager's choice and nothing else: whoever is marked top performer, however
 * they scored. Nobody gets the badge automatically.
 *
 * Low leaves the marked top performers out, so one person never wears both. By the rules,
 * a person is Low when their performance % on the Review page is under the month's
 * threshold (IncentiveSettings.lowPerformance), or when they are the month's lowest scorer,
 * zero included — a reviewed person at 0% is genuinely last, not "unmarked", because only
 * reviewed people are in `rows` to begin with (see buildCandidates; that is what keeps the
 * not-yet-reviewed out of this). The lowest scorer is only named when naming them says
 * something: at least two people to compare, somebody who scored better, and a score under
 * the bar — a month where everyone scored the same doesn't pin a red badge on whoever
 * happens to sort last. A manager's mark beats the rules either way (RankedRow.lowMark):
 * marked Low whatever the percentage, or cleared of it.
 */
export function pickPerformers(rows: RankedRow[]): PerformerPicks {
  const top = rows.filter((r) => r.topMark)
  const pool = rows.filter((r) => !r.topMark)
  const lowPct = pool.length ? Math.min(...pool.map(scorePct)) : 0
  const best = rows.length ? Math.max(...rows.map(scorePct)) : 0
  const spread = rows.length > 1 && lowPct < best && lowPct < TOP_PERFORMER_PCT
  const lowByRules = pool.filter((r) => r.underLow || (spread && scorePct(r) === lowPct))
  const low = pool.filter((r) => r.lowMark ?? lowByRules.includes(r))
  return {
    top,
    low,
    lowByRules,
    listed: rows.filter((r) => !low.includes(r) && scorePct(r) >= TOP_PERFORMER_PCT),
    topPct: top.length ? Math.max(...top.map(scorePct)) : 0,
    lowPct,
  }
}
