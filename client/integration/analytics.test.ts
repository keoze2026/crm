import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '../src/api/client'
import { formatPeriod, money, money2, pct, previousPeriod, rangeDays } from '../src/lib/format'
import { buildXlsx } from '../src/lib/xlsx'
import type { CompleteReport, Summary, TopBuyer, TopCampaign, TopSource, TrendPoint } from '../src/types'
import {
  completeReportShape, summaryShape, topBuyerShape, topCampaignShape, topSourceShape, trendShape,
} from './contracts'
import { resetTables, useServer } from './harness'
import { arrayOf, assertShape } from './shape'

// Dashboard + Reports: /analytics/*. 2026-06-01 is a Monday.

const TABLES = ['call_records', 'buyers', 'campaigns', 'destinations', 'portal_expenses']
const RANGE = { from: '2026-06-01', to: '2026-06-03' }

async function seed() {
  const b1 = await api.createBuyer({ code: 'B1', rate: 10 })
  const b2 = await api.createBuyer({ code: 'B2', rate: 20 })
  const rec = (data: Record<string, unknown>) => api.createRecord(data)
  // current window
  await rec({ record_type: 'buyer', record_date: '2026-06-01', buyer_id: b1.id, answered: 7, missed: 1, counted: 5 })
  await rec({ record_type: 'buyer', record_date: '2026-06-02', buyer_id: b1.id, answered: 3, missed: 1, counted: 3 })
  await rec({ record_type: 'buyer', record_date: '2026-06-03', buyer_id: b2.id, answered: 6, missed: 2, counted: 4 })
  await rec({ record_type: 'campaign', record_date: '2026-06-01', campaign_code: 'C-01', source: 'Bing', answered: 8, missed: 0, counted: 6, rate: 5 })
  await rec({ record_type: 'campaign', record_date: '2026-06-02', campaign_code: 'C-02', source: 'Yahoo', answered: 5, missed: 1, counted: 5, rate: 4 })
  // the previous window (05-29 .. 05-31)
  await rec({ record_type: 'buyer', record_date: '2026-05-30', buyer_id: b1.id, answered: 4, missed: 4, counted: 4 })
  // later in June, outside RANGE
  await rec({ record_type: 'buyer', record_date: '2026-06-20', buyer_id: b2.id, answered: 1, missed: 0, counted: 1 })
  await api.createPortalExpense({ month: '2026-06', name: 'Portal A', total_amount: 100 })
  await api.createPortalExpense({ month: '2026-05', name: 'Portal A', total_amount: 50 })
  return { b1, b2 }
}

describe('analytics', () => {
  beforeEach(() => {
    resetTables(...TABLES)
    useServer()
  })

  it('summary answers a Summary with numbers, deltas and point deltas', async () => {
    await seed()
    const s = assertShape<Summary>(await api.summary(RANGE), summaryShape)
    expect(s).toMatchObject({
      revenue: 160, cost: 50, portal_expenses: 0, margin: 110, margin_pct: 68.8,
      answered: 16, missed: 4, counted: 12, answer_rate: 80,
      buyer_records: 3, campaign_records: 2, active_buyers: 2, active_campaigns: 2,
    })
    // previous window: revenue 40, cost 0, counted 4, answered 4 of 8
    expect(s.deltas).toEqual({ revenue: 300, cost: null, margin: 175, counted: 200, answered: 300, active_buyers: 100, active_campaigns: null })
    expect(s.point_deltas).toEqual({ margin_pct: -31.2, answer_rate: 30 })

    // The client's own "previous period" is the window the server compared against.
    const prev = previousPeriod(RANGE.from, RANGE.to)
    expect(prev).toEqual({ from: '2026-05-29', to: '2026-05-31' })
    expect(rangeDays(prev.from, prev.to)).toBe(rangeDays(RANGE.from, RANGE.to))
    const p = await api.summary(prev)
    expect(Math.round((s.revenue - p.revenue) / Math.abs(p.revenue) * 1000) / 10).toBe(s.deltas.revenue)

    // The Dashboard's formatters take the payload directly.
    expect(money(s.revenue)).toBe('$160.00')
    expect(pct(s.deltas.revenue)).toBe('+300.0%')
    expect(pct(s.deltas.cost)).toBe('—')
  })

  it('summary charges portal expenses only for months the range covers in full', async () => {
    await seed()
    const june = await api.summary({ from: '2026-06-01', to: '2026-06-30' })
    expect(june.portal_expenses).toBe(100)
    expect(june.margin).toBe(june.revenue - june.cost - 100)
    const both = await api.summary({ from: '2026-05-01', to: '2026-06-30' })
    expect(both.portal_expenses).toBe(150)
  })

  it('summary without a closed range: every delta null, nothing missing', async () => {
    await seed()
    const s = assertShape<Summary>(await api.summary({}), summaryShape)
    expect(s.revenue).toBe(220)
    expect(s.portal_expenses).toBe(150)
    expect(Object.values(s.deltas).every((v) => v === null)).toBe(true)
    expect(s.point_deltas).toEqual({ margin_pct: null, answer_rate: null })

    const openEnded = assertShape<Summary>(await api.summary({ from: '2026-06-01' }), summaryShape)
    expect(openEnded.deltas.revenue).toBeNull()
  })

  it('an empty database answers zeros, not nulls or strings', async () => {
    const s = assertShape<Summary>(await api.summary(RANGE), summaryShape)
    expect(s).toMatchObject({ revenue: 0, cost: 0, margin: 0, margin_pct: 0, answer_rate: 0 })
    expect(s.deltas.revenue).toBe(0)
    expect(assertShape<TrendPoint[]>(await api.trends({ ...RANGE, granularity: 'day' }), arrayOf(trendShape))).toEqual([])
  })

  it('trends: one TrendPoint per bucket for every granularity the Dashboard offers', async () => {
    await seed()
    const day = assertShape<TrendPoint[]>(await api.trends({ ...RANGE, granularity: 'day' }), arrayOf(trendShape))
    expect(day.map((t) => t.period)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03'])
    expect(day[0]).toEqual({ period: '2026-06-01', revenue: 50, cost: 30, portal_expenses: 0, margin: 20, counted: 5, answered: 7, missed: 1 })
    expect(day.map((t) => formatPeriod(t.period))).toEqual(['Jun 01', 'Jun 02', 'Jun 03'])

    const wide = { from: '2026-05-01', to: '2026-06-30' }
    const month = assertShape<TrendPoint[]>(await api.trends({ ...wide, granularity: 'month' }), arrayOf(trendShape))
    expect(month.map((t) => [t.period, t.revenue, t.portal_expenses, t.margin])).toEqual([
      ['2026-05', 40, 50, -10],
      ['2026-06', 180, 100, 30],
    ])
    expect(formatPeriod(month[1].period)).toBe('Jun 26')

    const year = await api.trends({ ...wide, granularity: 'year' })
    expect(year).toEqual([{ period: '2026', revenue: 220, cost: 50, portal_expenses: 150, margin: 20, counted: 17, answered: 21, missed: 8 }])

    const week = await api.trends({ ...wide, granularity: 'week' })
    expect(week.map((t) => t.period)).toEqual(['2026-05-25', '2026-06-01', '2026-06-15'])
    expect(week.every((t) => t.portal_expenses === 0)).toBe(true)

    const four = await api.trends({ ...RANGE, granularity: '4day' })
    expect(four.reduce((a, t) => a + t.revenue, 0)).toBe(160)
    expect(four.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.period))).toBe(true)

    // The trend line and the headline agree over the same range.
    const total = day.reduce((a, t) => a + t.margin, 0)
    expect(total).toBe((await api.summary(RANGE)).margin)
  })

  it('top buyers / campaigns / sources: ranked, limited, typed', async () => {
    const { b1, b2 } = await seed()
    const buyers = assertShape<TopBuyer[]>(await api.topBuyers({ ...RANGE, limit: 50 }), arrayOf(topBuyerShape))
    expect([...buyers].sort((x, y) => x.code.localeCompare(y.code))).toEqual([
      { id: b1.id, code: 'B1', name: null, revenue: 80, counted: 8, answered: 10, missed: 2 },
      { id: b2.id, code: 'B2', name: null, revenue: 80, counted: 4, answered: 6, missed: 2 },
    ])
    expect(buyers.map((b) => b.revenue)).toEqual([80, 80])
    expect((await api.topBuyers({ ...RANGE, metric: 'counted' })).map((b) => b.code)).toEqual(['B1', 'B2'])
    expect(await api.topBuyers({ ...RANGE, limit: 1 })).toHaveLength(1)

    // The Dashboard keys previous-period lookups by id: the ids must match across calls.
    const prev = await api.topBuyers({ ...previousPeriod(RANGE.from, RANGE.to), limit: 50 })
    const before = new Map(prev.map((b) => [b.id, b.revenue]))
    expect(before.get(b1.id)).toBe(40)

    const camps = assertShape<TopCampaign[]>(await api.topCampaigns({ ...RANGE, limit: 50 }), arrayOf(topCampaignShape))
    expect(camps.map((c) => [c.code, c.cost, c.counted])).toEqual([['C-01', 30, 6], ['C-02', 20, 5]])

    const sources = assertShape<TopSource[]>(await api.topSources({ ...RANGE, limit: 20 }), arrayOf(topSourceShape))
    expect(sources).toEqual([{ source: 'Bing', cost: 30, counted: 6 }, { source: 'Yahoo', cost: 20, counted: 5 }])
  })

  it('report URL downloads the per-buyer CSV for the range', async () => {
    await seed()
    const url = api.reportUrl(RANGE)
    expect(url).toBe('/api/analytics/report?from=2026-06-01&to=2026-06-03')
    const res = await fetch(url, { credentials: 'include' })
    expect(res.headers.get('content-disposition')).toContain('buyer-performance.csv')
    const lines = (await res.text()).trim().split(/\r?\n/)
    expect(lines[0]).toBe('Buyer,Answered,Missed,Counted,Revenue')
    expect(lines.slice(1).sort()).toEqual(['B1,10,2,8,80.00', 'B2,6,2,4,80.00'])
  })

  it('complete report: typed rows, totals that add up, profit net of full-month portal costs', async () => {
    await seed()
    const r = assertShape<CompleteReport>(await api.completeReport({ from: '2026-06-01', to: '2026-06-30' }), completeReportShape)
    expect(r.from).toBe('2026-06-01')
    expect(r.to).toBe('2026-06-20')
    expect(r.buyers.map((b) => [b.code, b.counted, b.total_bill, b.rate])).toEqual([['B2', 5, 100, 20], ['B1', 8, 80, 10]])
    expect(r.buyer_totals).toEqual({ destinations: 2, answered: 17, missed: 4, replacement: 0, counted: 13, rate: 180 / 13, total_bill: 180 })
    expect(r.campaign_totals).toMatchObject({ camps: 2, destinations: 2, counted: 11, total_bill: 50, replacement: 2 })
    expect(r.revenue).toBe(r.buyer_totals.total_bill)
    expect(r.cost).toBe(r.campaign_totals.total_bill)
    expect(r.portal_expenses).toBe(100)
    expect(r.profit).toBe(180 - 50 - 100)

    // The Reports page's xlsx export keeps these as numeric cells.
    const bytes = buildXlsx([
      { name: 'Summary', head: ['Metric', 'Value'], formats: ['text', 'currency'], rows: [['Revenue', r.revenue], ['Profit', r.profit]] },
      {
        name: 'Revenue', head: ['DEST', 'COUNTED', 'RATE', 'TOTAL'], formats: ['text', 'integer', 'currency', 'currency'],
        rows: r.buyers.map((b) => [b.code, b.counted, b.rate, b.total_bill]),
        foot: ['TOTAL', r.buyer_totals.counted, r.buyer_totals.rate, r.buyer_totals.total_bill],
      },
    ])
    const xml = new TextDecoder().decode(bytes)
    expect(xml).toMatch(/<v>180<\/v>/)
    expect(xml).toMatch(/<v>30<\/v>/)
    expect(xml).not.toMatch(/inlineStr"><is><t xml:space="preserve">180</)
    expect(money2(r.buyer_totals.rate)).toBe('$13.85')
  })

  it('complete report on an empty range: arrays stay arrays, span is null', async () => {
    await seed()
    const r = assertShape<CompleteReport>(await api.completeReport({ from: '2030-01-01', to: '2030-01-31' }), completeReportShape)
    expect(r).toMatchObject({ from: null, to: null, buyers: [], campaigns: [], revenue: 0, cost: 0, profit: 0 })
    expect(r.buyer_totals).toEqual({ destinations: 0, answered: 0, missed: 0, replacement: 0, counted: 0, rate: 0, total_bill: 0 })
    // No range at all is the whole history.
    const all = await api.completeReport()
    expect(all.from).toBe('2026-05-30')
    expect(all.revenue).toBe(220)
  })
})
