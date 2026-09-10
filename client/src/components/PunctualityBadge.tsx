import type { Punctuality } from '../lib/staff'
import { cx } from './ui'

/**
 * One day's punctuality verdict, worn the same way wherever a day is shown — the Complete
 * Attendance sheet, the Attendance roster, and the per-person day tables behind the Staff
 * Summary. Having one badge is the whole point: a supervisor reading the roster and a
 * supervisor reading a printed sheet should be looking at the same word.
 *
 * A day that missed BOTH ends carries two pips, so the doubly-bad day can be picked out of
 * a column at a glance without reading a single label.
 */
export default function PunctualityBadge({ flag, compact = false }: {
  /** null when the day had nothing to judge — no schedule, or no clock time recorded. */
  flag: Punctuality | null
  /** Use the shorter wording, for a narrow column. */
  compact?: boolean
}) {
  if (flag === null) return <span className="text-slate-300">—</span>
  return (
    <span
      title={flag.detail}
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase leading-4 tracking-wide',
        flag.cls,
      )}
    >
      {flag.marks > 0 && (
        <span aria-hidden className="tracking-tighter">{'!'.repeat(flag.marks)}</span>
      )}
      {compact ? flag.short : flag.label}
    </span>
  )
}
