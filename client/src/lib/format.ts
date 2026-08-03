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

/**
 * Compact currency for chart axes — "$250K", "-$50K", "$1.2M", "$920".
 * Preferred over hand-rolled `$${v / 1000}k`, which collapses every value under
 * $500 to "$0k" and produces an axis of repeated zeroes on low-volume ranges.
 */
const currencyCompactFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

export const money = (n: number): string => currencyFmt.format(n || 0)
export const money2 = (n: number): string => currencyFmt2.format(n || 0)
export const moneyCompact = (n: number): string => currencyCompactFmt.format(n || 0)
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

/** Inclusive length of an ISO date range, in days. Returns 0 for an invalid range. */
export function rangeDays(from: string | null | undefined, to: string | null | undefined): number {
  if (!from || !to) return 0
  const start = new Date(from + 'T00:00:00')
  const end = new Date(to + 'T00:00:00')
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return 0
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
}

/**
 * The immediately preceding period of the same length — the baseline every
 * "vs previous period" comparison on the Dashboard is measured against. Mirrors the
 * server-side window in AnalyticsController::summary(), so client-computed deltas
 * (per buyer, per campaign) line up with the API's headline deltas.
 */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const days = rangeDays(from, to) || 1
  const end = new Date(from + 'T00:00:00')
  end.setDate(end.getDate() - 1)
  const start = new Date(end)
  start.setDate(start.getDate() - (days - 1))
  return { from: isoLocal(start), to: isoLocal(end) }
}

/** N days before an ISO date (YYYY-MM-DD). Pure — used to anchor a window to real data. */
export function daysBeforeIso(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() - n)
  return isoLocal(d)
}

/** An ISO YYYY-MM-DD string from a Date's *local* parts (never UTC-shifted). */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Today as YYYY-MM-DD (local). Uses local date parts rather than `toISOString()`,
 * which reports the UTC day and so rolls over to "tomorrow" for US users every
 * evening — the default filter window must match the day the user is actually on.
 */
export function today(): string {
  return isoLocal(new Date())
}

/**
 * The app-wide default filter window: the current day only. Every page that carries a
 * date filter opens on today, so the CRM always lands on "what happened today" and a
 * wider window is an explicit choice (a preset or a calendar pick), never the default.
 * The shape matches `Range` in components/DateRange.
 */
export function todayRange(): { from: string; to: string } {
  const d = today()
  return { from: d, to: d }
}

/** N days ago as YYYY-MM-DD (local). */
export function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return isoLocal(d)
}