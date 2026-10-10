/**
 * The Monthly Incentives sheet's statuses and sums. Amounts keep their cents — the only
 * rounding is back to whole cents after adding, so float noise never shows.
 *
 * Pure data; no React.
 */
import type { Incentive, IncentiveStatus } from '../types'

/**
 * The three states an incentive may be in — the server accepts nothing else. Coloured the
 * way the Salary Hold statuses are, so the column reads as a signal: amber while it is still
 * owed, green once paid, red when it was called off.
 */
export const INCENTIVE_STATUSES: { id: IncentiveStatus; label: string; cell: string; dot: string }[] = [
  { id: 'Pending', label: 'Pending', cell: 'bg-amber-50 text-amber-800 border-amber-300', dot: 'bg-amber-500' },
  { id: 'Fulfilled', label: 'Fulfilled', cell: 'bg-emerald-50 text-emerald-800 border-emerald-300', dot: 'bg-emerald-500' },
  { id: 'Cancelled', label: 'Cancelled', cell: 'bg-red-50 text-red-800 border-red-300', dot: 'bg-red-500' },
]

export const incentiveStatus = (id: string) =>
  INCENTIVE_STATUSES.find((s) => s.id === id) ?? INCENTIVE_STATUSES[0]

const cents = (n: number) => Math.round(n * 100) / 100

/** The sum of the rows given. */
export const sumOf = (rows: Pick<Incentive, 'amount'>[]): number =>
  cents(rows.reduce((sum, r) => sum + r.amount, 0))

/** What the month pays out: every row that hasn't been cancelled. */
export const payableTotal = (rows: Pick<Incentive, 'amount' | 'status'>[]): number =>
  sumOf(rows.filter((r) => r.status !== 'Cancelled'))

/**
 * What a typed amount means: "200", "$1,250.50", " 75 " → a number of dollars; blank,
 * negative or anything unreadable → null, so the cell can refuse it rather than save 0.
 */
export function parseAmount(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, '')
  if (clean === '' || !/^\d*\.?\d+$|^\d+\.$/.test(clean)) return null
  const n = Number(clean)
  return Number.isFinite(n) && n >= 0 ? n : null
}
