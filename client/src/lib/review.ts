/**
 * The Review page's vocabulary. Ratings are stored as the wording shown here, so this list
 * is the only place to extend it — no migration, no lookup table.
 */

/** Performance rating, used by both the Performance tab and the Department tab. */
export const PERFORMANCE_RATINGS = ['Excellent', 'Good', 'Average', 'Below Average', 'Poor']

/** Behaviour analysis, worded as the client's sheet words it. */
export const BEHAVIOUR_RATINGS = [
  'Consistent Performance',
  'Good Standing',
  'Meets Expectations',
  'On Track',
  'Satisfactory',
  'Low Performer',
]

/** A percentage cell: "85%" when scored, blank when not. */
export const asPercent = (n: number | null): string =>
  n === null ? '' : `${Number.isInteger(n) ? n : n.toFixed(1)}%`

/** Digits with at most one decimal point — what a percentage cell accepts. */
export const NUMERIC = /^\d*\.?\d*$/
