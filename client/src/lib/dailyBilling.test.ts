import { describe, expect, it } from 'vitest'
import type { CallRecord } from '../types'
import {
  aggregateClientRows, aggregateTrafficRows, campCount, campsInCode, carryForward, sameLine,
  clientCount, clientCountFollowsFormula, clientFinalCount, clientRows, finalProfit, marginPct,
  sortByPrice, sourceCount, totalBill, totalsOf, trafficFinalCount, trafficRows,
} from './dailyBilling'

let nextId = 1
const rec = (over: Partial<CallRecord>): CallRecord => {
  const counted = over.counted ?? 0
  const rate = over.rate ?? 0
  return {
    id: nextId++, record_date: '2026-11-24', record_type: 'buyer',
    buyer_id: null, buyer_code: null, campaign_id: null, campaign_code: null, source: null,
    answered: 0, missed: 0, replacement: 0, counted, rate, total_bill: counted * rate,
    ...over,
  }
}
const client = (buyer_id: number, buyer_code: string, answered: number, missed: number, counted: number, rate: number, replacement = 0) =>
  rec({ record_type: 'buyer', buyer_id, buyer_code, answered, missed, replacement, counted, rate })
const traffic = (campaign_code: string, source: string, answered: number, missed: number, counted: number, rate: number, replacement = 0) =>
  rec({ record_type: 'campaign', campaign_id: 1, campaign_code, source, answered, missed, replacement, counted, rate })

describe('formulas', () => {
  it('client Final Count = Answered + Missed − Replaced, never below zero', () => {
    expect(clientFinalCount(292, 9, 0)).toBe(301)
    expect(clientFinalCount(24, 6, 2)).toBe(28)
    expect(clientFinalCount('3', '', '9')).toBe(0)
  })

  it('traffic Final Count = Answered − Replaced, never below zero', () => {
    expect(trafficFinalCount(339, 0)).toBe(339)
    expect(trafficFinalCount(16, 3)).toBe(13)
    expect(trafficFinalCount(2, 5)).toBe(0)
  })

  it('Total Bill = Final Count × Rate, to the cent and never rounded', () => {
    expect(totalBill(301, 55)).toBe(16555)
    expect(totalBill(153, 49)).toBe(7497)
    expect(totalBill('52', '48.5')).toBe(2522)
    expect(totalBill(3, 33.333)).toBeCloseTo(99.999, 6)
  })

  it('Final Profit = Client Billing − Traffic Source Cost, with its margin', () => {
    expect(finalProfit(64315.5, 51888)).toBeCloseTo(12427.5, 6)
    expect(marginPct(64315.5, 51888)).toBe(19.3)
    expect(marginPct(0, 10)).toBeNull()
    expect(marginPct(100, 150)).toBe(-50)
  })

  it('knows when a stored client count still follows the formula', () => {
    // RTG 06: 34 + 8 = 42 — formula. RTG 15: 100 + 8 billed as 100 — typed over.
    expect(clientCountFollowsFormula({ answered: 34, missed: 8, replacement: 0, counted: 42 })).toBe(true)
    expect(clientCountFollowsFormula({ answered: 100, missed: 8, replacement: 0, counted: 100 })).toBe(false)
  })
})

describe('rows and totals', () => {
  const day = [
    client(3, 'RTG 15', 100, 8, 100, 50),
    client(1, 'RTG 04', 292, 9, 301, 55),
    client(2, 'RTG 50', 47, 4, 51, 52),
  ]

  it('lists a day price high to low', () => {
    const rows = clientRows(day)
    expect(rows.map((r) => r.code)).toEqual(['RTG 04', 'RTG 50', 'RTG 15'])
    expect(rows[0]).toMatchObject({ answered: 292, missed: 9, replaced: 0, finalCount: 301, totalBill: 16555, records: 1 })
  })

  it('totals the columns and gives the average rate as bill ÷ count', () => {
    const t = totalsOf(clientRows(day))
    expect(t).toMatchObject({ answered: 439, missed: 21, replaced: 0, finalCount: 452, totalBill: 24207 })
    expect(t.avgRate).toBeCloseTo(24207 / 452, 10)
    expect(totalsOf([]).avgRate).toBe(0)
  })

  it('rolls a range up to one line per client at the weighted rate', () => {
    const range = [
      ...day,
      rec({ record_date: '2026-11-25', buyer_id: 1, buyer_code: 'RTG 04', answered: 10, missed: 0, counted: 10, rate: 50 }),
    ]
    const rows = aggregateClientRows(range)
    expect(rows).toHaveLength(3)
    const rtg04 = rows.find((r) => r.code === 'RTG 04')!
    expect(rtg04).toMatchObject({ answered: 302, missed: 9, finalCount: 311, totalBill: 17055, records: 2 })
    expect(rtg04.rate).toBeCloseTo(17055 / 311, 10)
  })

  it('shows traffic lines with the auto-filled Replaced and rolls them up by camp + source', () => {
    const recs = [
      traffic('L-11', 'TB-00', 294, 4, 294, 48),
      traffic('H-08 & 09', 'YY-01 & 02', 16, 3, 13, 46),
      traffic('PD', 'PDSO', 20, 0, 18, 10, 5),            // excluded source: Replaced stays as typed
      traffic('L-11', 'tb 00', 6, 0, 6, 48),               // same camp + source, keyed differently
    ]
    const dayRows = trafficRows(recs)
    expect(dayRows.map((r) => r.code)).toEqual(['L-11', 'L-11', 'H-08 & 09', 'PD'])
    expect(dayRows.find((r) => r.source === 'YY-01 & 02')!.replaced).toBe(3)
    expect(dayRows.find((r) => r.source === 'PDSO')!.replaced).toBe(5)

    const rolled = aggregateTrafficRows(recs)
    expect(rolled).toHaveLength(3)
    expect(rolled[0]).toMatchObject({ code: 'L-11', source: 'TB-00', answered: 300, finalCount: 300, totalBill: 14400, records: 2 })
  })

  it('sorts by rate, then bill, then code', () => {
    const rows = sortByPrice([
      { rate: 50, totalBill: 100, code: 'B' },
      { rate: 50, totalBill: 100, code: 'A' },
      { rate: 50, totalBill: 900, code: 'Z' },
      { rate: 55, totalBill: 1, code: 'Y' },
    ])
    expect(rows.map((r) => r.code)).toEqual(['Y', 'Z', 'A', 'B'])
  })
})

describe('heading counts', () => {
  it('counts distinct clients', () => {
    expect(clientCount([client(1, 'A', 1, 0, 1, 1), client(1, 'A', 1, 0, 1, 1), client(2, 'B', 1, 0, 1, 1)])).toBe(2)
  })

  it('counts every camp a code names', () => {
    expect(campsInCode('L-10')).toBe(1)
    expect(campsInCode('H-02 & 03')).toBe(2)
    expect(campsInCode('H-04, 05, 06 & 07')).toBe(4)
    expect(campsInCode('GOOGLE')).toBe(1)
    expect(campsInCode('')).toBe(1)
  })

  it('adds the camps of each distinct code, and the distinct sources, as the printed sheet does', () => {
    const recs = [
      traffic('L-10', 'MT-00', 1, 0, 1, 1), traffic('L-13', 'GG-00', 1, 0, 1, 1), traffic('L-11', 'TB-00', 1, 0, 1, 1),
      traffic('H-02 & 03', 'PD-02 & AA', 1, 0, 1, 1), traffic('M-01', 'MK-00', 1, 0, 1, 1),
      traffic('H-04, 05, 06 & 07', 'DS-01, 02, 03 & 04', 1, 0, 1, 1), traffic('H-08 & 09', 'YY-01 & 02', 1, 0, 1, 1),
      traffic('Z-00', 'DD-00', 1, 0, 1, 1),
      traffic('l 10', 'mt00', 1, 0, 1, 1),   // the same camp and source, keyed sloppily
    ]
    expect(campCount(recs)).toBe(13)
    expect(sourceCount(recs)).toBe(8)
  })
})

describe('carryForward', () => {
  const d = (date: string, over: Partial<CallRecord>) => rec({ record_date: date, ...over })

  it('offers nothing when there is no earlier day', () => {
    expect(carryForward('client', [], [])).toEqual({ from: null, rows: [] })
  })

  it('carries the most recent earlier day, one line per client, at that day’s rate, price high to low', () => {
    const previous = [
      d('2026-11-21', { buyer_id: 1, buyer_code: 'RTG 04', counted: 10, rate: 50 }),   // older day — ignored
      d('2026-11-24', { buyer_id: 1, buyer_code: 'RTG 04', counted: 301, rate: 55 }),
      d('2026-11-24', { buyer_id: 2, buyer_code: 'CDM', counted: 52, rate: 48.5 }),
      d('2026-11-24', { buyer_id: 3, buyer_code: 'A49', counted: 153, rate: 49 }),
    ]
    const c = carryForward('client', previous, [])
    expect(c.from).toBe('2026-11-24')
    expect(c.rows.map((r) => [r.code, r.rate])).toEqual([['RTG 04', 55], ['A49', 49], ['CDM', 48.5]])
    expect(c.rows[0].source).toBe('')
  })

  it('leaves out what today already has, matching codes loosely', () => {
    const previous = [
      d('2026-11-24', { buyer_id: 1, buyer_code: 'RTG 04', counted: 1, rate: 55 }),
      d('2026-11-24', { buyer_id: 2, buyer_code: 'CDM', counted: 1, rate: 48.5 }),
    ]
    const today = [d('2026-11-25', { buyer_id: 9, buyer_code: 'rtg04', counted: 5, rate: 55 })]
    expect(carryForward('client', previous, today).rows.map((r) => r.code)).toEqual(['CDM'])
  })

  it('carries camp + source pairs on the traffic side, once each', () => {
    const previous = [
      d('2026-11-24', { record_type: 'campaign', campaign_id: 1, campaign_code: 'L-11', source: 'TB-00', counted: 294, rate: 48 }),
      d('2026-11-24', { record_type: 'campaign', campaign_id: 1, campaign_code: 'L-11', source: 'tb 00', counted: 6, rate: 48 }),
      d('2026-11-24', { record_type: 'campaign', campaign_id: 2, campaign_code: 'Z-00', source: 'DD-00', counted: 82, rate: 14 }),
      d('2026-11-24', { record_type: 'campaign', campaign_id: 3, campaign_code: 'L-10', source: 'MT-00', counted: 128, rate: 49 }),
    ]
    const c = carryForward('traffic', previous, [])
    expect(c.rows.map((r) => `${r.code}/${r.source}/${r.rate}`)).toEqual(['L-10/MT-00/49', 'L-11/TB-00/48', 'Z-00/DD-00/14'])
  })
})

describe('sameLine', () => {
  it('matches a client by code, ignoring case, spaces and punctuation', () => {
    expect(sameLine('client', { code: 'RTG 04' }, { code: 'rtg04' })).toBe(true)
    expect(sameLine('client', { code: 'RTG 04' }, { code: 'RTG 05' })).toBe(false)
    expect(sameLine('client', { code: '' }, { code: '' })).toBe(false)
  })

  it('matches a traffic line by camp and source, and a source keyed short one day and in full the next', () => {
    expect(sameLine('traffic', { code: 'H-02 & 03', source: 'PD' }, { code: 'H-02 & 03', source: 'PD-02 & AA' })).toBe(true)
    expect(sameLine('traffic', { code: 'H-04, 05, 06, & 07', source: 'DS' }, { code: 'H-04, 05, 06 & 07', source: 'DS-01, 02, 03 & 04' })).toBe(true)
    expect(sameLine('traffic', { code: 'L-11', source: 'TB-00' }, { code: 'L-11', source: 'tb 00' })).toBe(true)
    expect(sameLine('traffic', { code: 'C-03', source: 'Priority Y' }, { code: 'C-03', source: 'PDSO' })).toBe(false)
    expect(sameLine('traffic', { code: 'L-11', source: 'TB-00' }, { code: 'L-12', source: 'TB-00' })).toBe(false)
  })
})

describe('carryForward clears lines today already covers', () => {
  it('drops a carried traffic line whose camp was filled today under the fuller source name', () => {
    const d = (date: string, over: Partial<CallRecord>) => rec({ record_date: date, record_type: 'campaign', campaign_id: 1, ...over })
    const previous = [
      d('2026-11-19', { campaign_code: 'H-02 & 03', source: 'PD', counted: 1, rate: 48 }),
      d('2026-11-19', { campaign_code: 'L-12', source: 'CG-00', counted: 1, rate: 50 }),
    ]
    const today = [d('2026-11-24', { campaign_code: 'H-02 & 03', source: 'PD-02 & AA', counted: 228, rate: 48 })]
    expect(carryForward('traffic', previous, today).rows.map((r) => `${r.code}/${r.source}`)).toEqual(['L-12/CG-00'])
  })
})
