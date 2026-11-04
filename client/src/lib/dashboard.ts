// Pure helpers behind the Dashboard page — kept out of the component so they can be tested.

export type Granularity = 'day' | '4day' | 'week'

const DAY_MS = 86_400_000

/** ISO day → whole days since the Unix epoch, in UTC (so DST never shifts a bucket). */
function epochDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}

function isoOfEpochDay(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10)
}

/** 2000-01-01 — the anchor the API counts its fixed 4-day windows from. */
const FOUR_DAY_ANCHOR = epochDay('2000-01-01')

/**
 * The bucket a day falls in, keyed the way the trends API keys it: the day itself, the
 * start of its fixed 4-day window (anchored at 2000-01-01), or the Monday of its week.
 */
export function bucketKey(iso: string, g: Granularity): string {
  const n = epochDay(iso)
  if (g === '4day') return isoOfEpochDay(FOUR_DAY_ANCHOR + Math.floor((n - FOUR_DAY_ANCHOR) / 4) * 4)
  if (g === 'week') {
    // 1970-01-01 was a Thursday: (n + 3) mod 7 is 0 on a Monday.
    const sinceMonday = (((n + 3) % 7) + 7) % 7
    return isoOfEpochDay(n - sinceMonday)
  }
  return iso
}

/**
 * How many buckets the range touches — the "of 90 days" in "landed on 4 of 90 days".
 * Partial buckets at either end count. 0 for a missing or inverted range.
 */
export function bucketCount(from: string, to: string, g: Granularity): number {
  if (!from || !to) return 0
  const a = epochDay(from)
  const b = epochDay(to)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) return 0
  if (g === 'day') return b - a + 1
  const keys = new Set<string>()
  // A range is at most a few years of days — cheap to walk.
  for (let n = a; n <= b; n++) keys.add(bucketKey(isoOfEpochDay(n), g))
  return keys.size
}

/** "day" → "days", for "landed on 4 of 90 days". */
export const BUCKET_UNIT: Record<Granularity, { one: string; many: string; title: string }> = {
  day: { one: 'day', many: 'days', title: 'by day' },
  '4day': { one: '4-day period', many: '4-day periods', title: 'by 4 days' },
  week: { one: 'week', many: 'weeks', title: 'by week' },
}

/**
 * The value printed over a bar. The peak bar gets one decimal ("$138.7K"); every other bar
 * gets whole thousands with a "~" ("~$63K") — the "~" says out loud that it is rounded.
 * The tooltip always carries the exact figure.
 */
export function barLabel(v: number, kind: 'money' | 'count', peak: boolean): string {
  if (kind === 'count') return new Intl.NumberFormat('en-US').format(v)
  const sign = v < 0 ? '−' : ''
  const a = Math.abs(v)
  if (a < 1000) {
    const exact = Number.isInteger(a)
    return `${exact ? '' : '~'}${sign}$${Math.round(a)}`
  }
  const [div, unit] = a >= 1_000_000 ? [1_000_000, 'M'] : [1000, 'K']
  if (peak) return `${sign}$${(a / div).toFixed(1).replace(/\.0$/, '')}${unit}`
  const whole = a >= 1_000_000 ? (a / div).toFixed(1).replace(/\.0$/, '') : String(Math.round(a / div))
  return `~${sign}$${whole}${unit}`
}

/**
 * Split a ranked list into the rows a compact table shows: the first `n`, the last `n`,
 * and what sits between. With 2n rows or fewer nothing is hidden.
 */
export function splitEnds<T>(rows: T[], n = 5): { head: T[]; middle: T[]; tail: T[] } {
  if (rows.length <= n * 2) return { head: rows, middle: [], tail: [] }
  return { head: rows.slice(0, n), middle: rows.slice(n, rows.length - n), tail: rows.slice(rows.length - n) }
}

/** Percent of a whole, safe for a zero whole. */
export const shareOf = (part: number, whole: number): number => (whole > 0 ? (part / whole) * 100 : 0)

/** A share printed the way the tables print it: one decimal, two under 0.1%. */
export function shareLabel(pct: number): string {
  if (pct > 0 && pct < 0.1) return `${pct.toFixed(2)}%`
  return `${pct.toFixed(1)}%`
}
