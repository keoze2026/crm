import { bundleCampaignRecords, effectiveCampaignReplacement, normalizeCode } from './bundle'
import type { Buyer, CallRecord } from '../types'

/**
 * The AHT Daily Billing page: the client (buyer, revenue) side and the traffic-source
 * (campaign, cost) side of one day — or one date range — on a single sheet, with the
 * client's own formulas:
 *
 *   Client  Final Count = Answered + Missed − Replaced   (auto-filled; typed over for a
 *                                                          client whose missed calls don't count)
 *   Traffic Final Count = Answered − Replaced              (Replaced is derived from the Final
 *                                                          Count that is keyed in, see lib/bundle)
 *   Total Bill          = Final Count × Rate               (the stored total_bill)
 *   Final Profit        = Client Billing − Traffic Source Cost
 *
 * Everything here is a pure function of the records the API already returns, so the
 * numbers on this page are the same ones the Complete Report and the Dashboard show.
 */

// ── Formulas ──────────────────────────────────────────────────────────────────

const int = (v: number | string) => Math.max(0, Math.trunc(Number(v) || 0))

/** A client row's Final Count by formula: Answered + Missed − Replaced, never below 0. */
export function clientFinalCount(answered: number | string, missed: number | string, replaced: number | string): number {
  return Math.max(0, int(answered) + int(missed) - int(replaced))
}

/** A traffic row's Final Count by formula: Answered − Replaced, never below 0. */
export function trafficFinalCount(answered: number | string, replaced: number | string): number {
  return Math.max(0, int(answered) - int(replaced))
}

/**
 * True when a stored client record's Final Count is exactly what the formula gives, so the
 * sheet keeps deriving it as Answered / Missed / Replaced are edited. A record whose count
 * was typed over (a client whose missed calls are not billed) stays manual.
 */
export function clientCountFollowsFormula(r: Pick<CallRecord, 'answered' | 'missed' | 'replacement' | 'counted'>): boolean {
  return Number(r.counted) === clientFinalCount(r.answered, r.missed, r.replacement)
}

/** Total Bill = Final Count × Rate. Money never rounds here; the formatter shows 2 decimals. */
export function totalBill(finalCount: number | string, rate: number | string): number {
  return int(finalCount) * (Number(rate) || 0)
}

export function finalProfit(clientBilling: number, trafficCost: number): number {
  return clientBilling - trafficCost
}

/** Profit as a share of client billing, one decimal; null when nothing was billed. */
export function marginPct(clientBilling: number, trafficCost: number): number | null {
  if (clientBilling <= 0) return null
  return Math.round((finalProfit(clientBilling, trafficCost) / clientBilling) * 1000) / 10
}

// ── Rows ──────────────────────────────────────────────────────────────────────

/** One printed line of either table — a single record on a day, or a roll-up over a range. */
export interface BillingRow {
  key: string
  /** Destination (client) or Camp (traffic). */
  code: string
  /** The buyer's name, when one has been given (client side only). */
  name: string
  /** Traffic source (traffic side only). */
  source: string
  rate: number
  answered: number
  missed: number
  replaced: number
  finalCount: number
  totalBill: number
  /** How many records the line stands for (1 on a single day). */
  records: number
}

export interface BillingTotals {
  answered: number
  missed: number
  replaced: number
  finalCount: number
  totalBill: number
  /** Average rate = Total Bill ÷ Final Count; 0 when nothing was counted. */
  avgRate: number
}

/** Price high to low, as every billing sheet in the app is read; ties by bill, then code. */
export function sortByPrice<T extends { rate: number; totalBill: number; code: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.rate - a.rate || b.totalBill - a.totalBill || a.code.localeCompare(b.code))
}

/** The name a buyer was given, or '' when it only has a code (a name equal to the code is no name). */
export function buyerDisplayName(b: Pick<Buyer, 'code' | 'name'> | undefined): string {
  if (!b || !b.name) return ''
  return b.name.trim() === b.code.trim() ? '' : b.name
}

export function buyersById(buyers: Buyer[]): Map<number, Buyer> {
  return new Map(buyers.map((b) => [b.id, b]))
}

/** A client record as one line, exactly as stored. */
export function clientRecordRow(r: CallRecord, buyers: Map<number, Buyer>): BillingRow {
  return {
    key: String(r.id),
    code: r.buyer_code ?? '—',
    name: buyerDisplayName(r.buyer_id == null ? undefined : buyers.get(r.buyer_id)),
    source: '',
    rate: Number(r.rate) || 0,
    answered: Number(r.answered) || 0,
    missed: Number(r.missed) || 0,
    replaced: Number(r.replacement) || 0,
    finalCount: Number(r.counted) || 0,
    totalBill: Number(r.total_bill) || 0,
    records: 1,
  }
}

/** A traffic record as one line; Replaced is the effective (auto-filled) value. */
export function trafficRecordRow(r: CallRecord): BillingRow {
  return {
    key: String(r.id),
    code: r.campaign_code ?? '—',
    name: '',
    source: r.source ?? '—',
    rate: Number(r.rate) || 0,
    answered: Number(r.answered) || 0,
    missed: Number(r.missed) || 0,
    replaced: effectiveCampaignReplacement(r),
    finalCount: Number(r.counted) || 0,
    totalBill: Number(r.total_bill) || 0,
    records: 1,
  }
}

/** Single-day client lines, price high to low. */
export function clientRows(records: CallRecord[], buyers: Map<number, Buyer>): BillingRow[] {
  return sortByPrice(records.map((r) => clientRecordRow(r, buyers)))
}

/** Single-day traffic lines, price high to low. */
export function trafficRows(records: CallRecord[]): BillingRow[] {
  return sortByPrice(records.map(trafficRecordRow))
}

/**
 * A date range rolled up to one line per client (buyer). Volumes and bills are summed;
 * the rate shown is the weighted average (Total Bill ÷ Final Count), which is the rate the
 * client was actually billed at across the days.
 */
export function aggregateClientRows(records: CallRecord[], buyers: Map<number, Buyer>): BillingRow[] {
  const groups = new Map<string, BillingRow>()
  for (const r of records) {
    const key = r.buyer_id != null ? `b${r.buyer_id}` : `c${normalizeCode(r.buyer_code)}`
    const line = clientRecordRow(r, buyers)
    const g = groups.get(key)
    if (!g) { groups.set(key, { ...line, key }); continue }
    g.answered += line.answered
    g.missed += line.missed
    g.replaced += line.replaced
    g.finalCount += line.finalCount
    g.totalBill += line.totalBill
    g.records += 1
  }
  const rows = [...groups.values()].map((g) => ({ ...g, rate: g.finalCount > 0 ? g.totalBill / g.finalCount : 0 }))
  return sortByPrice(rows)
}

/** A date range rolled up to one line per camp + source (lib/bundle does the matching). */
export function aggregateTrafficRows(records: CallRecord[]): BillingRow[] {
  return sortByPrice(bundleCampaignRecords(records).map((b) => ({
    key: b.key,
    code: b.camp,
    name: '',
    source: b.source,
    rate: b.rate,
    answered: b.answered,
    missed: b.missed,
    replaced: b.replacement,
    finalCount: b.counted,
    totalBill: b.total_bill,
    records: b.count,
  })))
}

export function totalsOf(rows: BillingRow[]): BillingTotals {
  const t = rows.reduce(
    (a, r) => ({
      answered: a.answered + r.answered,
      missed: a.missed + r.missed,
      replaced: a.replaced + r.replaced,
      finalCount: a.finalCount + r.finalCount,
      totalBill: a.totalBill + r.totalBill,
    }),
    { answered: 0, missed: 0, replaced: 0, finalCount: 0, totalBill: 0 },
  )
  return { ...t, avgRate: t.finalCount > 0 ? t.totalBill / t.finalCount : 0 }
}

// ── Counts for the section headings ───────────────────────────────────────────

/** Distinct clients (buyers) on the sheet. */
export function clientCount(records: CallRecord[]): number {
  return new Set(records.map((r) => (r.buyer_id != null ? `b${r.buyer_id}` : `c${normalizeCode(r.buyer_code)}`))).size
}

/**
 * How many camps a campaign code names. The team keys a run of camps on one line —
 * "H-02 & 03" is two camps, "H-04, 05, 06 & 07" four — so each number in the code is a
 * camp. A code with no number ("GOOGLE") is one camp.
 */
export function campsInCode(code: string | null | undefined): number {
  const numbers = (code ?? '').match(/\d+/g)
  return numbers && numbers.length > 0 ? numbers.length : 1
}

/** Camps on the sheet: the camps named by each distinct campaign code, added up. */
export function campCount(records: CallRecord[]): number {
  const codes = new Map<string, string>()
  for (const r of records) {
    const k = normalizeCode(r.campaign_code)
    if (k !== '' && !codes.has(k)) codes.set(k, r.campaign_code ?? '')
  }
  let n = 0
  for (const code of codes.values()) n += campsInCode(code)
  return n
}

/** Distinct traffic sources on the sheet (case, spaces and punctuation ignored). */
export function sourceCount(records: CallRecord[]): number {
  return new Set(records.map((r) => normalizeCode(r.source)).filter((s) => s !== '')).size
}
