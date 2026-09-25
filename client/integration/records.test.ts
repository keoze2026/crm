import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '../src/api/client'
import { bundleCampaignRecords } from '../src/lib/bundle'
import type { CallRecord } from '../src/types'
import { callRecordShape, deletedShape, paginated } from './contracts'
import { resetTables, sql, useServer } from './harness'
import { assertShape, rejection } from './shape'

// Records — the Daily Sheet rows (buyer = revenue side, campaign = cost side).
// 2026-06-01 is a Monday.

const TABLES = ['call_records', 'buyers', 'campaigns', 'destinations']

async function buyerRow(code: string, date: string, counted: number, rate: number, extra: Record<string, unknown> = {}) {
  return api.createRecord({ record_type: 'buyer', record_date: date, buyer_code: code, answered: counted + 2, missed: 1, counted, rate, ...extra })
}

async function campaignRow(code: string, source: string, date: string, counted: number, rate: number, extra: Record<string, unknown> = {}) {
  return api.createRecord({ record_type: 'campaign', record_date: date, campaign_code: code, source, answered: counted + 3, missed: 2, counted, rate, ...extra })
}

describe('records', () => {
  beforeEach(() => {
    resetTables(...TABLES)
    useServer()
  })

  it('creates a buyer row by code: find-or-create the buyer, seed its rate, answer a CallRecord', async () => {
    const rec = assertShape<CallRecord>(await buyerRow('RTG 04', '2026-06-01', 10, 25), callRecordShape)
    expect(rec).toMatchObject({
      record_date: '2026-06-01', record_type: 'buyer', buyer_code: 'RTG 04', campaign_id: null,
      campaign_code: null, source: null, answered: 12, missed: 1, counted: 10, rate: 25, total_bill: 250,
    })
    const [buyer] = sql<{ id: number; rate: string }>('SELECT id, rate FROM buyers WHERE code = ?', ['RTG 04'])
    expect(rec.buyer_id).toBe(buyer.id)
    expect(Number(buyer.rate)).toBe(25)

    // A second row for the same code reuses the buyer and bills at ITS rate, not the one sent.
    const again = await buyerRow('RTG 04', '2026-06-02', 4, 99)
    expect(again.buyer_id).toBe(buyer.id)
    expect(again.rate).toBe(25)
    expect(again.total_bill).toBe(100)
    expect(sql('SELECT count(*)::int AS n FROM buyers')).toEqual([{ n: 1 }])
  })

  it('creates a campaign row: code standardised to C-03, the source becomes a linked destination', async () => {
    const rec = assertShape<CallRecord>(await campaignRow('c3', 'AdsTerra', '2026-06-01', 8, 12), callRecordShape)
    expect(rec).toMatchObject({ record_type: 'campaign', campaign_code: 'C-03', source: 'AdsTerra', buyer_id: null, buyer_code: null, total_bill: 96 })
    const [dest] = sql<{ rate: string; campaign_id: number }>('SELECT rate, campaign_id FROM destinations WHERE name = ?', ['AdsTerra'])
    expect(Number(dest.rate)).toBe(12)
    expect(dest.campaign_id).toBe(rec.campaign_id)

    // "C 03" finds the same campaign; leaving the rate out inherits the source's.
    const inherit = await api.createRecord({ record_type: 'campaign', record_date: '2026-06-02', campaign_code: 'C 03', source: 'AdsTerra', counted: 2 })
    expect(inherit.campaign_id).toBe(rec.campaign_id)
    expect(inherit.rate).toBe(12)
  })

  it('rejects bad payloads with the server message', async () => {
    expect(await rejection(api.createRecord({ record_date: '2026-06-01' }))).toBe('record_type must be "buyer" or "campaign"')
    expect(await rejection(api.createRecord({ record_type: 'buyer' }))).toBe('record_date is required')
    expect(await rejection(api.createRecord({ record_type: 'buyer', record_date: '2026-06-01' }))).toBe('A buyer is required for buyer records')
    expect(await rejection(api.createRecord({ record_type: 'campaign', record_date: '2026-06-01', campaign_code: '  ' }))).toBe('A campaign is required for campaign records')
    expect(await rejection(api.updateRecord(999999, { counted: 1 }))).toBe('Record not found')
    expect(sql('SELECT count(*)::int AS n FROM call_records')).toEqual([{ n: 0 }])
  })

  it('updates only the fields sent and answers the fresh row', async () => {
    const rec = await campaignRow('C-05', 'Bing', '2026-06-01', 5, 10)
    const updated = assertShape<CallRecord>(await api.updateRecord(rec.id, { counted: 7, rate: 11 }), callRecordShape)
    expect(updated).toMatchObject({ id: rec.id, counted: 7, rate: 11, total_bill: 77, answered: rec.answered, source: 'Bing', record_date: '2026-06-01' })
    expect(sql('SELECT counted, answered FROM call_records WHERE id = ?', [rec.id])).toEqual([{ counted: 7, answered: 8 }])
  })

  it('lists a Paginated<CallRecord> honouring every RecordFilters field the UI sends', async () => {
    const a = await buyerRow('AAA', '2026-06-01', 10, 5)   // bill 50
    const b = await buyerRow('BBB', '2026-06-02', 3, 30)   // bill 90
    const c = await campaignRow('C-07', 'PDSO', '2026-06-03', 4, 10) // bill 40
    await buyerRow('AAA', '2026-06-10', 1, 5)

    const all = assertShape<{ data: CallRecord[]; meta: { total: number; pages: number; per_page: number; page: number } }>(
      await api.records({}), paginated(callRecordShape))
    expect(all.meta).toEqual({ page: 1, per_page: 35, total: 4, pages: 1 })
    // default order: total_bill DESC
    expect(all.data.map((r) => r.id).slice(0, 3)).toEqual([b.id, a.id, c.id])

    // Blank filters ('' as the UI's selects hold them) are dropped by the client, not sent.
    const blank = await api.records({ type: '', buyer_id: '', campaign_id: '', search: '' })
    expect(blank.meta.total).toBe(4)

    expect((await api.records({ type: 'campaign' })).data.map((r) => r.id)).toEqual([c.id])
    expect((await api.records({ buyer_id: a.buyer_id! })).meta.total).toBe(2)
    expect((await api.records({ campaign_id: c.campaign_id! })).data.map((r) => r.id)).toEqual([c.id])
    expect((await api.records({ from: '2026-06-02', to: '2026-06-03' })).data.map((r) => r.id).sort()).toEqual([b.id, c.id].sort())
    expect((await api.records({ search: 'pds' })).data.map((r) => r.id)).toEqual([c.id])
    expect((await api.records({ search: 'bb' })).data.map((r) => r.id)).toEqual([b.id])

    const byDate = await api.records({ sort: 'record_date', dir: 'asc' })
    expect(byDate.data.map((r) => r.record_date)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-10'])

    const page2 = await api.records({ sort: 'record_date', dir: 'asc', page: 2, per_page: 3 })
    expect(page2.meta).toEqual({ page: 2, per_page: 3, total: 4, pages: 2 })
    expect(page2.data.map((r) => r.record_date)).toEqual(['2026-06-10'])

    // An unknown sort key falls back rather than erroring.
    expect((await api.records({ sort: 'nope; DROP TABLE x' })).meta.total).toBe(4)
  })

  it('an empty result is still an array with pages = 0', async () => {
    const res = assertShape<{ data: CallRecord[] }>(await api.records({ from: '2030-01-01' }), paginated(callRecordShape))
    expect(res).toEqual({ data: [], meta: { page: 1, per_page: 35, total: 0, pages: 0 } })
  })

  it('deletes a record once', async () => {
    const rec = await buyerRow('DEL', '2026-06-01', 1, 1)
    expect(assertShape(await api.deleteRecord(rec.id), deletedShape)).toEqual({ deleted: true })
    expect(await api.deleteRecord(rec.id)).toEqual({ deleted: false })
    expect(sql('SELECT count(*)::int AS n FROM call_records')).toEqual([{ n: 0 }])
  })

  it('total_bill is Rate × Counted to the cent (the sheet shows it with money2)', async () => {
    // Rates are NUMERIC(10,2): $12.50 × 3 = $37.50. The Records sheet renders total_bill as
    // "$37.50" and sums it into the footer; the Dashboard / Complete Report use the stored
    // 37.50. The list must not round it to $38.
    const rec = await buyerRow('HALF', '2026-06-01', 3, 12.5)
    const listed = (await api.records({})).data[0]
    expect(sql('SELECT total_bill::float AS t FROM call_records WHERE id = ?', [rec.id])).toEqual([{ t: 37.5 }])
    const dashboard = await api.summary({ from: '2026-06-01', to: '2026-06-01' })
    expect(dashboard.revenue).toBe(37.5)
    // Records footer (Σ total_bill) must match the Dashboard's revenue for the same day.
    expect(listed.total_bill).toBe(dashboard.revenue)
    expect(listed.total_bill).toBe(listed.rate * listed.counted)
    expect(rec.total_bill).toBe(37.5)
  })

  it('export URL downloads the filtered records as CSV', async () => {
    await buyerRow('AAA', '2026-06-01', 10, 5)
    await campaignRow('C-07', 'Bing', '2026-06-03', 4, 10.25)
    await buyerRow('ZZZ', '2026-07-01', 1, 1)

    const url = api.recordsExportUrl({ from: '2026-06-01', to: '2026-06-30', type: '', search: '' })
    expect(url).toBe('/api/records/export?from=2026-06-01&to=2026-06-30')
    const res = await fetch(url, { credentials: 'include' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/csv/)
    expect(res.headers.get('content-disposition')).toContain('lead-records.csv')
    const lines = (await res.text()).trim().split(/\r?\n/)
    expect(lines).toEqual([
      'Date,Type,Buyer,Campaign,Answered,Missed,Replacement,Counted,Rate,"Total Bill"',
      '2026-06-01,buyer,AAA,,12,1,0,10,5.00,50.00',
      '2026-06-03,campaign,,C-07,7,2,0,4,10.25,41.00',
    ])

    const onlyCampaign = await (await fetch(api.recordsExportUrl({ type: 'campaign' }))).text()
    expect(onlyCampaign.trim().split(/\r?\n/)).toHaveLength(2)
  })

  it('bundleCampaignRecords over the real list agrees with the Complete Report cost table', async () => {
    // Variants of the same camp + source that the report bundles together.
    await campaignRow('C-03', 'AdsTerra', '2026-06-01', 10, 4)
    await campaignRow('C-03', 'adsterra', '2026-06-02', 6, 4)
    await campaignRow('C-04', 'PDSO', '2026-06-02', 5, 8, { replacement: 3 })
    await campaignRow('C-04', 'Bing', '2026-06-03', 2, 20)
    await buyerRow('B1', '2026-06-01', 5, 5)

    const list = await api.records({ type: 'campaign', per_page: 9999 })
    const bundled = bundleCampaignRecords(list.data)
    const report = await api.completeReport({ from: '2026-06-01', to: '2026-06-30' })

    expect(bundled.map((r) => ({ camp: r.camp, counted: r.counted, total_bill: r.total_bill, replacement: r.replacement, answered: r.answered, missed: r.missed, rate: r.rate })))
      .toEqual(report.campaigns.map((r) => ({ camp: r.camp, counted: r.counted, total_bill: r.total_bill, replacement: r.replacement, answered: r.answered, missed: r.missed, rate: r.rate })))
    expect(bundled.map((r) => r.source.toUpperCase())).toEqual(report.campaigns.map((r) => r.destination.toUpperCase()))
    expect(bundled.find((r) => r.source === 'PDSO')?.replacement).toBe(3) // manual source keeps the typed value
    expect(bundled.find((r) => r.camp === 'C-03')?.count).toBe(2)
  })
})
