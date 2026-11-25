import { describe, expect, it } from 'vitest'
import type { BillingRow } from './dailyBilling'
import { totalsOf } from './dailyBilling'
import { buildDailyBillingPdf } from './dailyBillingPdf'

const row = (over: Partial<BillingRow>): BillingRow => ({
  key: 'k', code: 'RTG 04', source: '', rate: 55, answered: 292, missed: 9, replaced: 0,
  finalCount: 301, totalBill: 16555, records: 1, ...over,
})

describe('buildDailyBillingPdf', () => {
  const client = [row({ key: 'a' }), row({ key: 'b', code: 'RTG 50', rate: 52, answered: 47, missed: 4, finalCount: 51, totalBill: 2652 })]
  const traffic = [row({ key: 'c', code: 'L-10', source: 'MT-00', rate: 49, answered: 128, missed: 6, finalCount: 128, totalBill: 6272 })]

  it('prints both sides, the profit and the formulas on one document', () => {
    const doc = buildDailyBillingPdf({
      dateLabel: '24 Nov 2026',
      client, clientTotals: totalsOf(client), clients: 2,
      traffic, trafficTotals: totalsOf(traffic), camps: 1, sources: 1,
      profit: 19207 - 6272, margin: 67.3,
    })
    expect(doc.getNumberOfPages()).toBe(1)
    const bytes = doc.output('arraybuffer').byteLength
    expect(bytes).toBeGreaterThan(2000)
  })

  it('prints client billing alone when the cost side is withheld', () => {
    const doc = buildDailyBillingPdf({
      dateLabel: '24 Nov 2026',
      client, clientTotals: totalsOf(client), clients: 2,
      traffic: null, trafficTotals: totalsOf([]), camps: 0, sources: 0,
      profit: 0, margin: null,
    })
    expect(doc.getNumberOfPages()).toBe(1)
  })

  it('spills a long sheet onto a second page rather than clipping it', () => {
    const many = Array.from({ length: 60 }, (_, i) => row({ key: `r${i}`, code: `RTG ${i}` }))
    const doc = buildDailyBillingPdf({
      dateLabel: '24 Nov 2026',
      client: many, clientTotals: totalsOf(many), clients: many.length,
      traffic, trafficTotals: totalsOf(traffic), camps: 1, sources: 1,
      profit: 1, margin: 1,
    })
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2)
  })
})
