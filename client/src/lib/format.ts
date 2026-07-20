const currencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const currencyFmt2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const numberFmt = new Intl.NumberFormat('en-US')

export const money = (n: number): string => currencyFmt.format(n || 0)
export const money2 = (n: number): string => currencyFmt2.format(n || 0)
export const num = (n: number): string => numberFmt.format(n || 0)
export const pct = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`

/** Format an ISO date (YYYY-MM-DD) as e.g. "Jun 11, 2026". */
export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
}

/** Format an ISO date (YYYY-MM-DD) as e.g. "11-Jun-26" (matches the report layout). */
export function formatDmy(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return iso
  const month = d.toLocaleDateString('en-US', { month: 'short' })
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(-2)}`
}

/**
 * Filename-safe date label for downloads: a single day ("11-Jun-26") or a
 * range ("11-Jun-26_to_20-Jun-26"). Falls back to "all" when no dates are set.
 */
export function fileDateRange(from: string | null | undefined, to: string | null | undefined): string {
  if (!from && !to) return 'all'
  if (from && to && from !== to) return `${formatDmy(from)}_to_${formatDmy(to)}`
  return formatDmy(from ?? to ?? null)
}

/** Format a trend period key (day/month/year) into a short axis label. */
export function formatPeriod(period: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    const d = new Date(period + 'T00:00:00')
    return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' })
  }
  if (/^\d{4}-\d{2}$/.test(period)) {
    const d = new Date(period + '-01T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  }
  return period
}

/**
 * Count of weekdays (Mon–Fri) between two ISO dates (YYYY-MM-DD), inclusive.
 * Returns 0 for an empty, invalid, or reversed range. Used for the Vendors page's
 * "Average Calls a Day" = Σ converted calls ÷ weekdays in the selected range.
 */
export function weekdaysBetween(from: string | null | undefined, to: string | null | undefined): number {
  if (!from || !to) return 0
  const start = new Date(from + 'T00:00:00')
  const end = new Date(to + 'T00:00:00')
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return 0
  let count = 0
  const d = new Date(start)
  while (d <= end) {
    const day = d.getDay() // 0 = Sun, 6 = Sat
    if (day !== 0 && day !== 6) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}

/** Today as YYYY-MM-DD (local). */
export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** N days ago as YYYY-MM-DD. */
export function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}