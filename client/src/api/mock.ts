/* ───────────────────────────────────────────────────────────────────────────
 * TEMPORARY MOCK DATA — remove when the local backend is available.
 *
 * Lets the Leads Record table and Complete Report render without the
 * PHP/Postgres backend (502s).
 * To remove: delete this file and the two `// MOCK` lines in ./client.ts.
 * ─────────────────────────────────────────────────────────────────────────── */
import type { CallRecord, CompleteReport, Paginated, RecordFilters } from '../types'

// Destinations (buyer side) — codes mirror the real data in the screenshots.
const DESTINATIONS = [
  'RTG 04', 'RTG 24', 'RTG 50', 'L48', 'HOZ', 'CDM', 'MXX',
  'RTG 08', 'A49', 'BH5', 'RNY', 'ZZY', 'KBT', 'SHN',
]

const buyers = DESTINATIONS.map((code, i) => ({ id: i + 1, code }))

// Deterministic pseudo-random so the dataset is stable across reloads.
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

// Generate buyer call records across a range of dates (incl. today & 2026-06-11).
function buildRecords(): CallRecord[] {
  const rnd = seeded(20260617)
  const rows: CallRecord[] = []
  let id = 1
  const dates: string[] = []
  for (let d = 1; d <= 17; d++) dates.push(`2026-06-${String(d).padStart(2, '0')}`)

  for (const date of dates) {
    // Each day, a random subset of destinations has records.
    for (const b of buyers) {
      if (rnd() < 0.45) continue
      const answered = 480 + Math.floor(rnd() * 300)
      const missed = Math.floor(rnd() * 70)
      const counted = answered + Math.floor(rnd() * (missed + 1))
      const rate = Math.round((47 + rnd() * 11) * 100) / 100
      const total_bill = Math.round(counted * rate * 100) / 100
      rows.push({
        id: id++,
        record_date: date,
        record_type: 'buyer',
        buyer_id: b.id,
        buyer_code: b.code,
        campaign_id: null,
        campaign_code: null,
        source: null,
        answered,
        missed,
        counted,
        rate,
        total_bill,
      })
    }
  }
  return rows
}

const ALL_RECORDS = buildRecords()

function filterRecords(f: RecordFilters): Paginated<CallRecord> {
  let data = ALL_RECORDS.filter((r) => r.record_type === (f.type || 'buyer'))
  if (f.from) data = data.filter((r) => r.record_date >= f.from!)
  if (f.to) data = data.filter((r) => r.record_date <= f.to!)
  if (f.buyer_id) data = data.filter((r) => r.buyer_id === Number(f.buyer_id))
  if (f.search) {
    const q = f.search.toLowerCase()
    data = data.filter((r) => (r.buyer_code ?? '').toLowerCase().includes(q))
  }

  const sort = f.sort ?? 'total_bill'
  const dir = f.dir ?? 'desc'
  data = [...data].sort((a, b) => {
    const av = (a as unknown as Record<string, number | string>)[sort]
    const bv = (b as unknown as Record<string, number | string>)[sort]
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return dir === 'asc' ? cmp : -cmp
  })

  const total = data.length
  const per_page = Number(f.per_page ?? 35)
  const page = Number(f.page ?? 1)
  const pages = Math.max(1, Math.ceil(total / per_page))
  const start = (page - 1) * per_page
  return { data: data.slice(start, start + per_page), meta: { page, per_page, total, pages } }
}

// Campaign (cost side) codes for the complete report.
const CAMPAIGNS = ['C-01', 'C-02', 'C-03', 'C-04', 'C-05', 'C-06']

/** Build the complete report for a date range from the buyer records + generated cost rows. */
function buildCompleteReport(from?: string, to?: string): CompleteReport {
  // Revenue side: aggregate buyer records in range by destination.
  let recs = ALL_RECORDS
  if (from) recs = recs.filter((r) => r.record_date >= from)
  if (to) recs = recs.filter((r) => r.record_date <= to)

  const byCode = new Map<string, { answered: number; missed: number; counted: number; total_bill: number }>()
  for (const r of recs) {
    const k = r.buyer_code ?? '—'
    const a = byCode.get(k) ?? { answered: 0, missed: 0, counted: 0, total_bill: 0 }
    a.answered += r.answered; a.missed += r.missed; a.counted += r.counted; a.total_bill += r.total_bill
    byCode.set(k, a)
  }
  const buyerRows = [...byCode.entries()]
    .map(([code, a]) => ({ code, ...a, rate: a.counted ? a.total_bill / a.counted : 0 }))
    .sort((x, y) => y.total_bill - x.total_bill)

  const buyers_ = buyerRows.map((b) => ({
    code: b.code, answered: b.answered, missed: b.missed, counted: b.counted,
    rate: Math.round(b.rate * 100) / 100, total_bill: Math.round(b.total_bill * 100) / 100,
  }))
  const revenue = buyers_.reduce((s, b) => s + b.total_bill, 0)

  // Cost side: generate campaign rows (media buys) — lower rates than revenue.
  const rnd = seeded(from ? Number(from.replace(/-/g, '')) : 20260617)
  const campaigns = []
  for (let i = 0; i < 9; i++) {
    const camp = CAMPAIGNS[i % CAMPAIGNS.length]
    const destination = DESTINATIONS[Math.floor(rnd() * DESTINATIONS.length)]
    const answered = 380 + Math.floor(rnd() * 280)
    const missed = Math.floor(rnd() * 50)
    const counted = answered + Math.floor(rnd() * (missed + 1))
    const rate = Math.round((8 + rnd() * 27) * 100) / 100
    campaigns.push({ camp, destination, answered, missed, counted, rate, total_bill: Math.round(counted * rate * 100) / 100 })
  }
  const cost = campaigns.reduce((s, c) => s + c.total_bill, 0)

  const sum = <K extends 'answered' | 'missed' | 'counted' | 'total_bill'>(arr: { [P in K]: number }[], k: K) =>
    arr.reduce((s, x) => s + x[k], 0)

  return {
    from: from ?? null,
    to: to ?? null,
    buyers: buyers_,
    campaigns,
    buyer_totals: {
      destinations: buyers_.length,
      answered: sum(buyers_, 'answered'), missed: sum(buyers_, 'missed'), counted: sum(buyers_, 'counted'),
      rate: 0, total_bill: Math.round(revenue * 100) / 100,
    },
    campaign_totals: {
      camps: new Set(campaigns.map((c) => c.camp)).size,
      destinations: new Set(campaigns.map((c) => c.destination)).size,
      answered: sum(campaigns, 'answered'), missed: sum(campaigns, 'missed'), counted: sum(campaigns, 'counted'),
      rate: 0, total_bill: Math.round(cost * 100) / 100,
    },
    revenue: Math.round(revenue * 100) / 100,
    cost: Math.round(cost * 100) / 100,
    profit: Math.round((revenue - cost) * 100) / 100,
  }
}

/** Returns mock JSON for a given API path, or the sentinel MOCK_MISS to fall through. */
export const MOCK_MISS = Symbol('mock-miss')

export function mockRequest<T>(path: string): T | typeof MOCK_MISS {
  const [route, query = ''] = path.split('?')
  const params = Object.fromEntries(new URLSearchParams(query)) as RecordFilters

  if (route === '/records') return filterRecords(params) as unknown as T
  if (route === '/buyers') return buyers as unknown as T
  if (route === '/destinations') return [] as unknown as T
  if (route === '/campaigns') return [] as unknown as T
  if (route === '/analytics/complete-report') return buildCompleteReport(params.from, params.to) as unknown as T

  return MOCK_MISS
}
