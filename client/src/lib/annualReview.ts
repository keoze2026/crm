/**
 * Annual Reviews — the Review page's half-yearly (6 month) and yearly (12 month) roll-ups,
 * and the top and lowest performer each period names.
 *
 * Nothing new is judged here. A period is simply its months added up: every month in the
 * window is scored exactly as the Top Performer tab scores it (lib/incentive.ts — the same
 * criteria, the same evidence, the same saved ticks), and this file accumulates those
 * monthly answers into one row per person. So a rating corrected on the Performance tab
 * moves the yearly standing with it, and the year can never disagree with the months it is
 * made of.
 *
 * THE PERIOD'S FIGURE IS THE AVERAGE PERFORMANCE PERCENTAGE — the mean of the percentages
 * on the monthly Performance tab, over the months one was recorded. It orders the ranking,
 * it bands the overall rating, and it names the top and lowest performer, so the one number
 * the sheet shows is the one number it acts on. That is deliberately NOT the monthly tab's
 * criteria-met score, which counts confirmations the CRM cannot read, so the annual answer
 * and the monthly one can name different people; the monthly counts a period carries over
 * (Incentive Months, and the top/low month tallies behind the tie-breaks) still come from
 * those criteria.
 *
 * What a period adds on top of the months is one rule: COVERAGE. A person reviewed in one
 * month of twelve has an average, but it is not a year's worth of evidence, so the roll-up
 * will not name them its best or its worst until they have been reviewed in at least
 * `min_months` of the window (half of it, rounded up, unless a manager sets otherwise).
 * They are still listed, with their months shown, so nothing is hidden — they are just not
 * crowned on one month's showing.
 *
 * Every figure below is also EDITABLE. The sheet stores the cells a manager typed over a
 * computed one (see AnnualReviewController), and a typed figure is what the ranking then
 * reads — a decision, not a suggestion. Clearing the cell hands it back to the accumulation.
 *
 * Pure data + rules; no React. The sheet owns the overrides and the saving.
 */

import { formatMonth, shiftMonth } from '../components/MonthSelector'
import {
  TOP_PERFORMER_PCT,
  buildCandidates,
  fromWire as incentiveFromWire,
  pickPerformers,
  rankCandidates,
  type RankedRow,
} from './incentive'
import type {
  ReviewEntry, StaffAttendanceRow, StaffLeave, StaffMember, TopPerformerState,
} from '../types'

// ─── The period ───────────────────────────────────────────────────────────────

/** Half-yearly or yearly — the two windows the tab offers. */
export type AnnualSpan = 'half' | 'year'

export const SPAN_MONTHS: Record<AnnualSpan, number> = { half: 6, year: 12 }

export const SPANS: { id: AnnualSpan; label: string; short: string }[] = [
  { id: 'half', label: 'Half-yearly · 6 months', short: 'Half-yearly' },
  { id: 'year', label: 'Yearly · 12 months', short: 'Yearly' },
]

/**
 * The months in the window, oldest first. A period is named by the month it ENDS on — the
 * month the page's selector is showing — so "year" ending 2026-09 is 2025-10 … 2026-09.
 */
export function periodMonths(endMonth: string, span: AnnualSpan): string[] {
  const n = SPAN_MONTHS[span]
  return Array.from({ length: n }, (_, i) => shiftMonth(endMonth, i - (n - 1)))
}

/** "October 2025 – September 2026". */
export function periodLabel(months: string[]): string {
  if (months.length === 0) return ''
  return `${formatMonth(months[0])} – ${formatMonth(months[months.length - 1])}`
}

/** The default coverage bar: half the window, rounded up. */
export const defaultMinMonths = (span: AnnualSpan): number => Math.ceil(SPAN_MONTHS[span] / 2)

// ─── Accumulation ─────────────────────────────────────────────────────────────

/** One month of the window, already scored the way the Top Performer tab scores it. */
export interface MonthSlice {
  /** "YYYY-MM". */
  month: string
  rows: RankedRow[]
}

/** A row added by hand for somebody the period's reviews produced no row for. */
export interface ExtraRow {
  key: string
  name: string
}

/** "YYYY-MM-DD…" → "YYYY-MM"; anything else → "". */
const monthOf = (iso: string | null | undefined): string =>
  typeof iso === 'string' && /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : ''

/**
 * Score every month of the window the way the Top Performer tab scores one.
 *
 * The window's raw data comes in whole — the attendance and leaves sheets over the period's
 * date range, every review row of each kind, and each month's saved switches and ticks —
 * and is split by month here, so a period is genuinely its months and not a separate
 * calculation that could drift from them.
 */
export function buildSlices(
  months: string[],
  staff: StaffMember[],
  attendance: StaffAttendanceRow[],
  leaves: StaffLeave[],
  performance: ReviewEntry[],
  behaviour: ReviewEntry[],
  topPerformer: TopPerformerState[],
): MonthSlice[] {
  const group = <T,>(rows: T[], dateOf: (row: T) => string): Map<string, T[]> => {
    const out = new Map<string, T[]>()
    for (const row of rows) {
      const m = monthOf(dateOf(row))
      if (m === '') continue
      const own = out.get(m)
      if (own) own.push(row)
      else out.set(m, [row])
    }
    return out
  }

  const days = group(attendance, (d) => d.work_date)
  const leaveRows = group(leaves, (l) => l.leave_date)
  const perf = group(performance, (e) => e.month ?? '')
  const behav = group(behaviour, (e) => e.month ?? '')
  const saved = new Map(topPerformer.map((s) => [monthOf(s.month), s]))

  return months.map((month) => {
    const { settings, ticks } = incentiveFromWire(saved.get(month) ?? null)
    const candidates = buildCandidates(
      staff,
      days.get(month) ?? [],
      leaveRows.get(month) ?? [],
      perf.get(month) ?? [],
      behav.get(month) ?? [],
    )
    return { month, rows: rankCandidates(candidates, settings, ticks) }
  })
}

/** One person over the whole period. */
export interface AnnualTally {
  /** The sheet's row key: `s:<staff id>` for the roster, the row's own key for added ones. */
  key: string
  staffId: number | null
  name: string
  /** Their departments, as of the most recent month they appear in. */
  departments: string
  /** The months of the window that carried a review for them, oldest first. */
  monthsIn: string[]
  monthsReviewed: number
  /**
   * The average of the performance percentages recorded over those months — THE PERIOD'S
   * FIGURE. It is what the sheet shows, what the ranking orders on, what the overall rating
   * bands off, and what decides the period's top and lowest performer.
   */
  perfPct: number | null
  /** Months they were the month's top performer / its lowest, by the monthly rules. */
  topMonths: number
  lowMonths: number
  /** Months they met every criterion in play — the months they earned the incentive. */
  eligibleMonths: number
  /** True for a row somebody added by hand: it has no accumulation behind it. */
  manual: boolean
}

const blankTally = (key: string, name: string, manual: boolean): AnnualTally => ({
  key,
  staffId: null,
  name,
  departments: '',
  monthsIn: [],
  monthsReviewed: 0,
  perfPct: null,
  topMonths: 0,
  lowMonths: 0,
  eligibleMonths: 0,
  manual,
})

export const rowKeyOf = (staffId: number): string => `s:${staffId}`

/** A key for a row being added by hand — unique without a round-trip to the server. */
export const newRowKey = (): string => `x:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

/**
 * Every person the window reviewed, accumulated — plus the rows a manager added by hand,
 * which carry no accumulation and exist to be typed into.
 *
 * Only months that actually reviewed somebody count towards their averages: a person who
 * joined in March is scored on March onwards, not marked down for January. `monthsIn` is
 * what says so on the face of the sheet.
 */
export function accumulate(slices: MonthSlice[], extra: ExtraRow[] = []): AnnualTally[] {
  const out = new Map<string, AnnualTally>()
  const perf = new Map<string, { sum: number; n: number }>()

  // Oldest month first, so the name and departments a row ends up showing are the most
  // recent ones the window saw — a renamed or transferred person reads as they are now.
  for (const slice of [...slices].sort((a, b) => a.month.localeCompare(b.month))) {
    const { top, low } = pickPerformers(slice.rows)
    const topIds = new Set(top.map((r) => r.candidate.member.id))
    const lowIds = new Set(low.map((r) => r.candidate.member.id))

    for (const row of slice.rows) {
      const m = row.candidate.member
      const key = rowKeyOf(m.id)
      const t = out.get(key) ?? blankTally(key, m.name, false)

      t.staffId = m.id
      t.name = m.name
      t.departments = m.departments.map((d) => d.name).join(', ')
      t.monthsIn.push(slice.month)
      t.monthsReviewed += 1
      if (topIds.has(m.id)) t.topMonths += 1
      if (lowIds.has(m.id)) t.lowMonths += 1
      if (row.allMet) t.eligibleMonths += 1

      const p = row.candidate.performance?.percentage
      if (p != null) {
        const acc = perf.get(key) ?? { sum: 0, n: 0 }
        perf.set(key, { sum: acc.sum + p, n: acc.n + 1 })
      }

      out.set(key, t)
    }
  }

  for (const t of out.values()) {
    const p = perf.get(t.key)
    t.perfPct = p && p.n > 0 ? Math.round((p.sum / p.n) * 10) / 10 : null
  }

  // Added rows sit at the end, in the order they were added.
  for (const row of extra) {
    if (!out.has(row.key)) out.set(row.key, blankTally(row.key, row.name, true))
  }
  return [...out.values()]
}

// ─── Overrides ────────────────────────────────────────────────────────────────

/** The cells a manager typed over a computed one: row key → column id → text. */
export type AnnualOverrides = Record<string, Record<string, string>>

/** What is in a cell, whether it was computed or typed. */
export const overrideOf = (ov: AnnualOverrides, key: string, colId: string): string | null =>
  ov[key]?.[colId] ?? null

/** Digits, an optional decimal point, an optional % — what a percentage cell reads as a number. */
const numberIn = (text: string): number | null => {
  const m = /-?\d+(\.\d+)?/.exec(text)
  return m === null ? null : Number(m[0])
}

/**
 * The period's figure for one person: the average performance percentage, typed when a
 * manager has typed one and accumulated otherwise.
 *
 * This one number does all the period's work — it orders the ranking, it bands the overall
 * rating, and it decides the top and lowest performer. So typing into the Avg Performance
 * cell is a decision, not an annotation: everything on the sheet follows it, and clearing
 * the cell hands all of it back to the accumulation.
 */
export function effectiveScore(t: AnnualTally, ov: AnnualOverrides): number | null {
  const typed = overrideOf(ov, t.key, 'performance')
  if (typed !== null) {
    const n = numberIn(typed)
    if (n !== null) return Math.max(0, Math.min(100, n))
  }
  return t.perfPct
}

/** Months reviewed, likewise: an added row is given its coverage by typing it in. */
export function effectiveMonths(t: AnnualTally, ov: AnnualOverrides): number {
  const typed = overrideOf(ov, t.key, 'months')
  if (typed !== null) {
    const n = numberIn(typed)
    if (n !== null) return Math.max(0, n)
  }
  return t.monthsReviewed
}

// ─── Ranking and the period's two names ───────────────────────────────────────

export interface AnnualRow {
  tally: AnnualTally
  /** The average performance the row is ranked and named on — typed or accumulated. */
  score: number | null
  /** The months it is credited with — typed or accumulated. */
  months: number
  /** True when this row has enough of the window behind it to be named. */
  covered: boolean
  rank: number
}

/**
 * Order the period: best average performance first, then the tie-breaks a manager would
 * reach for — months they earned the incentive, months they topped, how much of the window
 * reviewed them at all — and finally the name, so the list is stable between renders.
 *
 * A row with no figure at all (an added row nobody has typed one into) sorts last rather
 * than as a zero: it has not been judged, it did not fail.
 */
export function rankAnnual(tallies: AnnualTally[], ov: AnnualOverrides, minMonths: number): AnnualRow[] {
  const rows: AnnualRow[] = tallies.map((tally) => {
    const score = effectiveScore(tally, ov)
    const months = effectiveMonths(tally, ov)
    return { tally, score, months, covered: months >= minMonths, rank: 0 }
  })
  rows.sort((a, b) =>
    (b.score ?? -1) - (a.score ?? -1)
    || b.tally.eligibleMonths - a.tally.eligibleMonths
    || b.tally.topMonths - a.tally.topMonths
    || b.months - a.months
    || a.tally.name.localeCompare(b.tally.name),
  )
  // Equal figures share a rank (1, 1, 3…), the way a leaderboard reads. A row with no
  // figure is not ranked at all.
  let last: number | null = null
  rows.forEach((r, i) => {
    r.rank = r.score === null ? 0 : (last !== null && last === r.score ? rows[i - 1].rank : i + 1)
    last = r.score
  })
  return rows
}

export interface AnnualPicks {
  /** Everyone tied at the best score, provided it clears the bar and they have the coverage. */
  top: AnnualRow[]
  /** Everyone tied at the worst score — empty unless naming somebody says something. */
  low: AnnualRow[]
  topPct: number
  lowPct: number
  /** Rows left out of both because the window has not reviewed them enough times. */
  uncovered: AnnualRow[]
}

/**
 * The period's two names — the half-yearly or yearly top and lowest performer.
 *
 * Both are read off the average performance percentage, and the shape of the rule is the
 * monthly one (lib/incentive.ts · pickPerformers) with COVERAGE added: only rows reviewed in
 * at least `minMonths` of the window are eligible to be named, so a single strong month
 * cannot win a year. Top must clear the same 80% bar the month uses. Bottom is only named
 * when naming it says something — at least two covered rows to compare, somebody who scored
 * better, and a figure under the bar — so a period where everyone scored alike names nobody
 * rather than pinning a red badge on whoever happens to sort last.
 */
export function pickAnnual(rows: AnnualRow[], minMonths: number): AnnualPicks {
  const eligible = rows.filter((r) => r.score !== null && r.months >= minMonths)
  const uncovered = rows.filter((r) => r.score !== null && r.months < minMonths)
  const scores = eligible.map((r) => r.score as number)
  const best = scores.length ? Math.max(...scores) : 0
  const worst = scores.length ? Math.min(...scores) : 0
  const spread = eligible.length > 1 && worst < best && worst < TOP_PERFORMER_PCT
  return {
    top: best >= TOP_PERFORMER_PCT ? eligible.filter((r) => r.score === best) : [],
    low: spread ? eligible.filter((r) => r.score === worst) : [],
    topPct: best,
    lowPct: worst,
    uncovered,
  }
}

/** Where a row stands in the period — what the Standing column and the badges say. */
export type AnnualStanding = 'top' | 'low' | null

export function standingOf(picks: AnnualPicks): (key: string) => AnnualStanding {
  const map = new Map<string, AnnualStanding>()
  for (const r of picks.low) map.set(r.tally.key, 'low')
  for (const r of picks.top) map.set(r.tally.key, 'top')
  return (key: string) => map.get(key) ?? null
}

// ─── Columns ──────────────────────────────────────────────────────────────────

/** How a cell is edited, and how it reads. */
export type AnnualCellKind = 'text' | 'percent' | 'number' | 'rating' | 'prose'

/** What the accumulation knows when it fills a cell. */
export interface AnnualContext {
  /** The coverage bar, so a cell can say why a row was not named. */
  minMonths: number
  standing: (key: string) => AnnualStanding
  /** The row's ranked figures, so a column can read the effective score rather than the raw one. */
  row: AnnualRow
}

/** One column of the sheet. */
export interface AnnualColumn {
  id: string
  label: string
  kind: AnnualCellKind
  /** colgroup width, so one long note cannot squeeze the figures. */
  width: string
  align?: 'left' | 'center' | 'right'
  /** What the accumulation puts in the cell. Absent = the cell is only ever typed in. */
  compute?: (t: AnnualTally, ctx: AnnualContext) => string
}

/** The overall rating an average performance lands in — the Performance tab's own words. */
export const RATING_BANDS: { min: number; rating: string }[] = [
  { min: 90, rating: 'Excellent' },
  { min: 80, rating: 'Good' },
  { min: 65, rating: 'Average' },
  { min: 50, rating: 'Below Average' },
  { min: 0, rating: 'Poor' },
]

export const bandRating = (pct: number | null): string =>
  pct === null ? '' : (RATING_BANDS.find((b) => pct >= b.min)?.rating ?? '')

/** A percentage column holds the bare figure; the cell and the PDF add the sign. */
const pct = (n: number | null): string => (n === null ? '' : String(Number.isInteger(n) ? n : n.toFixed(1)))

/**
 * The sheet's columns. Fixed — the period is a report with a settled shape, not a layout to
 * arrange. Every one of them can still be typed over per person; the ones with no `compute`
 * are only ever typed in.
 */
export const COLUMNS: AnnualColumn[] = [
  { id: 'name', label: 'Name', kind: 'text', width: '17%', compute: (t) => t.name },
  { id: 'department', label: 'Department', kind: 'text', width: '14%', compute: (t) => t.departments },
  {
    id: 'months', label: 'Months Reviewed', kind: 'number', width: '9%', align: 'center',
    // Just the count: how many months of the window carried a review for them. Only those
    // months feed their averages, and enough of them is what lets the period name somebody.
    compute: (t) => (t.manual && t.monthsReviewed === 0 ? '' : String(t.monthsReviewed)),
  },
  {
    id: 'performance', label: 'Avg Performance', kind: 'percent', width: '11%', align: 'right',
    compute: (t) => pct(t.perfPct),
  },
  {
    id: 'rating', label: 'Overall Rating', kind: 'rating', width: '12%',
    // Banded from the average performance beside it: 90+ Excellent, 80+ Good, 65+ Average,
    // 50+ Below Average, under 50 Poor — the Performance tab's own vocabulary.
    compute: (_t, ctx) => bandRating(ctx.row.score),
  },
  {
    id: 'eligible', label: 'Incentive Months', kind: 'number', width: '9%', align: 'center',
    compute: (t) => (t.monthsReviewed === 0 ? '' : String(t.eligibleMonths)),
  },
  {
    id: 'standing', label: 'Standing', kind: 'text', width: '10%',
    // A word each: the row is already banded green or rose, and a row the period will not
    // name says how much of the window it would need.
    compute: (t, ctx) => {
      const s = ctx.standing(t.key)
      if (s === 'top') return 'Top'
      if (s === 'low') return 'Lowest'
      if (ctx.row.score === null) return ''
      return ctx.row.covered ? '—' : `< ${ctx.minMonths} months`
    },
  },
  { id: 'notes', label: 'Notes', kind: 'prose', width: '12%' },
]

/** What a cell shows: the typed value when there is one, otherwise the accumulated one. */
export function cellValue(col: AnnualColumn, t: AnnualTally, ctx: AnnualContext, ov: AnnualOverrides): string {
  return overrideOf(ov, t.key, col.id) ?? computedValue(col, t, ctx)
}

export const computedValue = (col: AnnualColumn, t: AnnualTally, ctx: AnnualContext): string =>
  col.compute ? col.compute(t, ctx) : ''

// ─── The stored sheet ─────────────────────────────────────────────────────────

/** The one rule a period carries of its own. */
export interface AnnualSettings {
  /** Months of the window a person must have been reviewed in to be named its top or lowest. */
  minMonths: number
}

/** The server's shape, converted to the sheet's — dropping anything this build cannot use. */
export function fromWire(
  state: { overrides?: unknown; extra_rows?: unknown; settings?: unknown } | null | undefined,
  span: AnnualSpan,
): { overrides: AnnualOverrides; extraRows: ExtraRow[]; settings: AnnualSettings } {
  const overrides: AnnualOverrides = {}
  const raw = (state?.overrides ?? {}) as Record<string, unknown>
  for (const [key, cells] of Object.entries(typeof raw === 'object' && raw !== null ? raw : {})) {
    if (typeof cells !== 'object' || cells === null || Array.isArray(cells)) continue
    const own: Record<string, string> = {}
    for (const [colId, value] of Object.entries(cells as Record<string, unknown>)) {
      if (typeof value === 'string' && value !== '') own[colId] = value
      else if (typeof value === 'number') own[colId] = String(value)
    }
    if (Object.keys(own).length > 0) overrides[key] = own
  }

  const extraRows: ExtraRow[] = Array.isArray(state?.extra_rows)
    ? (state.extra_rows as unknown[]).flatMap((r) => {
      if (typeof r !== 'object' || r === null) return []
      const row = r as Record<string, unknown>
      return typeof row.key === 'string' && row.key !== ''
        ? [{ key: row.key, name: typeof row.name === 'string' ? row.name : '' }]
        : []
    })
    : []

  const min = (state?.settings as Record<string, unknown> | undefined)?.min_months
  const minMonths = typeof min === 'number' && min >= 0 && min <= SPAN_MONTHS[span]
    ? min
    : defaultMinMonths(span)

  return { overrides, extraRows, settings: { minMonths } }
}

/** The sheet's shape, converted to the server's. */
export function toWire(
  overrides: AnnualOverrides,
  extraRows: ExtraRow[],
  settings: AnnualSettings,
): { overrides: AnnualOverrides; extra_rows: ExtraRow[]; settings: { min_months: number } } {
  const clean: AnnualOverrides = {}
  for (const [key, cells] of Object.entries(overrides)) {
    const own = Object.fromEntries(Object.entries(cells).filter(([, v]) => v.trim() !== ''))
    if (Object.keys(own).length > 0) clean[key] = own
  }
  return {
    overrides: clean,
    extra_rows: extraRows,
    settings: { min_months: settings.minMonths },
  }
}
