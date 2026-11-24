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

/**
 * A bucket's row label in the Revenue-by-day table: "Mon, Nov 02" for a day, "Nov 02 – Nov 05"
 * for a 4-day window, "Week of Nov 02" for a week. Built from UTC parts, so it never drifts.
 */
export function bucketLabel(period: string, g: Granularity): string {
  const n = epochDay(period)
  if (!Number.isFinite(n)) return period
  const md = (k: number) => new Date(k * DAY_MS).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: '2-digit' })
  if (g === 'week') return `Week of ${md(n)}`
  if (g === '4day') return `${md(n)} – ${md(n + 3)}`
  const wd = new Date(n * DAY_MS).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' })
  return `${wd}, ${md(n)}`
}

/**
 * A typed amount ("1,250.50", "$300", "") as a number: blank is 0, anything that isn't a
 * non-negative number is null so the field can show it is wrong.
 */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '')
  if (t === '') return 0
  if (!/^\d*\.?\d*$/.test(t) || t === '.') return null
  return Number(t)
}

/** Per-lead economics on the traffic-spend basis the KPI row and "What changed" use. */
export interface Basis {
  revenue: number
  cost: number
  counted: number
}

export function unitEconomics(b: Basis) {
  const profit = b.revenue - b.cost
  return {
    profit,
    /** % of revenue, null with nothing billed. */
    marginPct: b.revenue !== 0 ? (profit / b.revenue) * 100 : null,
    revenuePerLead: b.counted > 0 ? b.revenue / b.counted : null,
    costPerLead: b.counted > 0 ? b.cost / b.counted : null,
    profitPerLead: b.counted > 0 ? profit / b.counted : null,
  }
}

/** % change, null without a baseline to measure from. */
export function pctChange(prev: number | null, curr: number | null): number | null {
  if (prev === null || curr === null || prev === 0) return null
  return ((curr - prev) / Math.abs(prev)) * 100
}

/**
 * The one-sentence read of the period at the top of "What changed", e.g.
 * "Margin fell 6.4 pts. Revenue per lead held at about $50, but cost per lead rose 8.0% to
 * $44.06 and volume fell 21%." A movement under 1% (0.1 pts for margin) counts as "held".
 */
export function whatChanged(curr: Basis, prev: Basis, prevLabel: string): string {
  if (curr.counted === 0 && curr.revenue === 0) return 'Nothing was billed in this period.'
  if (prev.counted === 0 || prev.revenue === 0) return `Nothing was billed in the ${prevLabel}, so there is no baseline to compare against.`
  const c = unitEconomics(curr)
  const p = unitEconomics(prev)
  const usd = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const parts: string[] = []
  if (c.marginPct !== null && p.marginPct !== null) {
    const d = c.marginPct - p.marginPct
    parts.push(Math.abs(d) < 0.1 ? `Margin held at ${c.marginPct.toFixed(1)}%.` : `Margin ${d > 0 ? 'rose' : 'fell'} ${Math.abs(d).toFixed(1)} pts.`)
  }

  // Each clause and whether its movement is good (1), neutral (0) or bad (-1) news.
  const perLead = (what: string, prevV: number | null, currV: number | null, upGood: boolean): [string, number] => {
    const ch = pctChange(prevV, currV)
    if (ch === null || currV === null) return [`${what} is not comparable`, 0]
    if (Math.abs(ch) < 1) return [`${what} held at about $${Math.round(currV).toLocaleString('en-US')}`, 0]
    return [`${what} ${ch > 0 ? 'rose' : 'fell'} ${Math.abs(ch).toFixed(1)}% to ${usd(currV)}`, (ch > 0) === upGood ? 1 : -1]
  }
  const [rev, revTone] = perLead('revenue per lead', p.revenuePerLead, c.revenuePerLead, true)
  const [cost, costTone] = perLead('cost per lead', p.costPerLead, c.costPerLead, false)
  const vol = pctChange(prev.counted, curr.counted)
  const volume = vol === null || Math.abs(vol) < 1 ? 'volume held steady' : `volume ${vol > 0 ? 'rose' : 'fell'} ${Math.round(Math.abs(vol))}%`

  const joiner = revTone !== costTone ? ', but ' : ', '
  parts.push(`${rev.charAt(0).toUpperCase()}${rev.slice(1)}${joiner}${cost} and ${volume}.`)
  return parts.join(' ')
}

/** A buyer row as the price grouping needs it. */
export interface PricedRow {
  label: string
  value: number
  counted: number
}

export interface PriceGroup {
  /** The price per counted lead, to the cent; null for revenue with no counted leads. */
  price: number | null
  value: number
  counted: number
  /** Buyer labels at this price, biggest first. */
  members: string[]
}

/**
 * Buyers grouped by what they pay per counted lead (revenue ÷ leads, to the cent), biggest
 * revenue first — the "By price" tab of the ranking.
 */
export function groupByPrice(rows: PricedRow[]): PriceGroup[] {
  const map = new Map<string, PriceGroup>()
  for (const r of rows) {
    const price = r.counted > 0 ? Math.round((r.value / r.counted) * 100) / 100 : null
    const key = price === null ? 'none' : price.toFixed(2)
    const g = map.get(key) ?? { price, value: 0, counted: 0, members: [] }
    g.value += r.value
    g.counted += r.counted
    g.members.push(r.label)
    map.set(key, g)
  }
  return [...map.values()].sort((a, b) => b.value - a.value || (b.price ?? 0) - (a.price ?? 0))
}

/**
 * The amount a non-peak bar label stands for once rounded the way `barLabel` rounds it:
 * whole dollars under $1K, whole thousands under $1M, tenths of a million above.
 */
export function roundedLike(v: number): number {
  const a = Math.abs(v)
  const r = a < 1000 ? Math.round(a) : a < 1_000_000 ? Math.round(a / 1000) * 1000 : Math.round(a / 100_000) * 100_000
  return v < 0 ? -r : r
}

/**
 * How far the printed figures of a "Revenue by day" table (the peak exact, the rest rounded)
 * add up from the true total — the "within about $3K" in the footnote.
 */
export function roundingDrift(values: number[], peakIdx: number, total: number): number {
  const shown = values.reduce((s, v, i) => s + (i === peakIdx ? v : roundedLike(v)), 0)
  return Math.abs(shown - total)
}

/** CSV text → rows of cells. Handles quoted cells with commas, newlines and "" escapes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''))
}

/** One buyer or campaign line from an imported CSV. */
export interface ImportedRow {
  label: string
  /** The buyer a campaign sells to; null on a buyer list. */
  buyer: string | null
  value: number
  counted: number
  first: string
  last: string
}

export interface RankImport {
  kind: 'buyers' | 'campaigns'
  rows: ImportedRow[]
}

/**
 * A pasted buyer list (buyer, revenue, leads, first, last) or campaign list (campaign, buyer,
 * revenue, leads, first, last), biggest revenue first. The header row names the columns in any
 * order; first/last are optional. Anything unreadable comes back as an `error` sentence.
 */
export function parseRankCsv(text: string): RankImport | { error: string } {
  const rows = parseCsv(text)
  if (rows.length === 0) return { error: 'Paste a CSV with a header row first.' }
  const head = rows[0].map((h) => h.toLowerCase())
  const kind = head.includes('campaign') ? 'campaigns' : head.includes('buyer') ? 'buyers' : null
  if (!kind) return { error: 'The first row must name the columns: buyer, revenue, leads, first, last — or campaign, buyer, revenue, leads, first, last.' }
  const nameCol = kind === 'campaigns' ? 'campaign' : 'buyer'
  for (const need of [nameCol, 'revenue', 'leads']) {
    if (!head.includes(need)) return { error: `The header row is missing the “${need}” column.` }
  }
  const col = (r: string[], name: string) => {
    const i = head.indexOf(name)
    return i >= 0 ? (r[i] ?? '').trim() : ''
  }
  const out: ImportedRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const label = col(r, nameCol)
    if (!label) return { error: `Row ${i + 1} has no ${nameCol} name.` }
    const value = parseAmount(col(r, 'revenue'))
    if (value === null) return { error: `Row ${i + 1}: revenue “${col(r, 'revenue')}” is not an amount.` }
    const leads = parseAmount(col(r, 'leads'))
    if (leads === null || !Number.isInteger(leads)) return { error: `Row ${i + 1}: leads “${col(r, 'leads')}” is not a whole number.` }
    out.push({
      label,
      buyer: kind === 'campaigns' ? col(r, 'buyer') || null : null,
      value,
      counted: leads,
      first: col(r, 'first'),
      last: col(r, 'last'),
    })
  }
  if (out.length === 0) return { error: 'There are no rows under the header.' }
  out.sort((a, b) => b.value - a.value)
  return { kind, rows: out }
}

/** Percent of a whole, safe for a zero whole. */
export const shareOf = (part: number, whole: number): number => (whole > 0 ? (part / whole) * 100 : 0)

/** A share printed the way the tables print it: one decimal, two under 0.1%. */
export function shareLabel(pct: number): string {
  if (pct > 0 && pct < 0.1) return `${pct.toFixed(2)}%`
  return `${pct.toFixed(1)}%`
}
