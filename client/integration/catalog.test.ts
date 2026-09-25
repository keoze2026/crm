import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '../src/api/client'
import type { Buyer, Campaign, CampaignSource, Destination } from '../src/types'
import { buyerShape, campaignShape, campaignSourceShape, deletedShape, destinationShape } from './contracts'
import { resetTables, sql, useServer } from './harness'
import { arrayOf, assertShape, int, nullable, num, object, rejection, str, timestamp } from './shape'

// Buyers, campaigns (+ their sources) and destinations — the Monthly Sheet catalogues.
// 2026-06-01 is a Monday; 06-06 / 06-07 are the weekend.

const TABLES = ['call_records', 'buyers', 'campaigns', 'destinations']

/** What POST/PUT /buyers actually carry: the stored row, without the range aggregates. */
const buyerRowShape = object<Pick<Buyer, 'id' | 'code' | 'name' | 'status' | 'notes' | 'rate' | 'created_at'>>({
  id: int, code: str, name: nullable(str), status: str, notes: nullable(str), rate: num, created_at: timestamp,
})

describe('buyers', () => {
  beforeEach(() => {
    resetTables(...TABLES)
    useServer()
  })

  it('lists Buyer[] with range aggregates that skip weekends', async () => {
    const created = await api.createBuyer({ code: 'RTG 04', name: 'Rattle', rate: 12.5, notes: 'vip' })
    await api.createBuyer({ code: 'IDLE' })
    for (const [date, counted] of [['2026-06-01', 10], ['2026-06-02', 4], ['2026-06-06', 100], ['2026-06-15', 7]] as const) {
      await api.createRecord({ record_type: 'buyer', record_date: date, buyer_id: created.id, counted, answered: counted, missed: 1 })
    }

    const list = assertShape<Buyer[]>(await api.buyers(undefined, { from: '2026-06-01', to: '2026-06-07' }), arrayOf(buyerShape))
    expect(list.map((b) => b.code)).toEqual(['RTG 04', 'IDLE'])
    expect(list[0]).toMatchObject({
      name: 'Rattle', notes: 'vip', status: 'active', rate: 12.5,
      counted: 14, revenue: 175, answered: 14, missed: 2, record_days: 2, records: 2, last_activity: '2026-06-02',
    })
    // A buyer with nothing in range: zeros (numbers, not "0" strings) and a null last activity.
    expect(list[1]).toMatchObject({ counted: 0, revenue: 0, record_days: 0, records: 0, last_activity: null, name: null, notes: null })

    // The Monthly Sheet's "avg a day" arithmetic works on the real payload.
    expect(list[0].counted / list[0].record_days).toBe(7)

    expect((await api.buyers('rtg')).map((b) => b.code)).toEqual(['RTG 04'])
    expect((await api.buyers('ratt')).map((b) => b.code)).toEqual(['RTG 04'])
    expect((await api.buyers(undefined, {})).find((b) => b.code === 'RTG 04')?.counted).toBe(21)
  })

  it('create answers the stored row; duplicate → 409, blank code → 422', async () => {
    const b = assertShape<Buyer>(await api.createBuyer({ code: 'NEW', rate: 3 }), buyerRowShape)
    expect(b).toMatchObject({ code: 'NEW', rate: 3, status: 'active', name: null })
    expect(await rejection(api.createBuyer({ code: 'NEW' }))).toBe('A buyer with that code already exists')
    expect(await rejection(api.createBuyer({ code: '   ' }))).toBe('Buyer code is required')
    expect(sql('SELECT code FROM buyers')).toEqual([{ code: 'NEW' }])
  })

  it('updating the rate (the BuyersSheet payload) re-stamps every record of that buyer', async () => {
    const b = await api.createBuyer({ code: 'RB', rate: 10 })
    const r = await api.createRecord({ record_type: 'buyer', record_date: '2026-06-01', buyer_id: b.id, counted: 3 })
    expect(r.total_bill).toBe(30)

    const updated = assertShape<Buyer>(await api.updateBuyer(b.id, { code: 'RB', name: 'RB', rate: 20 }), buyerRowShape)
    expect(updated).toMatchObject({ rate: 20, name: 'RB' })
    expect(sql('SELECT rate::float AS rate, total_bill::float AS bill FROM call_records')).toEqual([{ rate: 20, bill: 60 }])
    expect((await api.buyers())[0]).toMatchObject({ revenue: 60, rate: 20 })

    expect(await rejection(api.updateBuyer(999999, { rate: 1 }))).toBe('Buyer not found')
  })

  it('delete cascades to the buyer records', async () => {
    const b = await api.createBuyer({ code: 'GONE' })
    await api.createRecord({ record_type: 'buyer', record_date: '2026-06-01', buyer_id: b.id, counted: 1 })
    expect(assertShape(await api.deleteBuyer(b.id), deletedShape)).toEqual({ deleted: true })
    expect(await api.deleteBuyer(b.id)).toEqual({ deleted: false })
    expect(sql('SELECT count(*)::int AS n FROM call_records')).toEqual([{ n: 0 }])
  })
})

/** What POST/PUT /campaigns carry: the stored row (typed totals), no record counts. */
const campaignRowShape = object<Pick<Campaign, 'id' | 'code' | 'name' | 'status' | 'notes' | 'created_at' | 'cost' | 'counted' | 'answered' | 'missed'>>({
  id: int, code: str, name: nullable(str), status: str, notes: nullable(str), created_at: timestamp,
  cost: num, counted: num, answered: num, missed: num,
})

describe('campaigns', () => {
  beforeEach(() => {
    resetTables(...TABLES)
    useServer()
  })

  it('create standardises the code and stores the typed Monthly Sheet totals', async () => {
    // Exactly what CampaignsSheet's new-row save sends.
    const c = assertShape<Campaign>(await api.createCampaign({ code: 'c 5', status: 'active', answered: 12, missed: 3, counted: 9, cost: 112.5 }), campaignRowShape)
    expect(c).toMatchObject({ code: 'C-05', answered: 12, missed: 3, counted: 9, cost: 112.5 })
    expect(sql('SELECT code, cost::float AS cost FROM campaigns')).toEqual([{ code: 'C-05', cost: 112.5 }])

    expect(await rejection(api.createCampaign({ code: 'C-5' }))).toBe('A campaign with that code already exists')
    expect(await rejection(api.createCampaign({ code: '' }))).toBe('Campaign code is required')
  })

  it('lists Campaign[] with record / source counts from the range', async () => {
    const c = await api.createCampaign({ code: 'C-01', cost: 50, counted: 5 })
    await api.createCampaign({ code: 'C-02' })
    await api.createRecord({ record_type: 'campaign', record_date: '2026-06-01', campaign_id: c.id, source: 'Bing', counted: 2, rate: 5 })
    await api.createRecord({ record_type: 'campaign', record_date: '2026-06-02', campaign_id: c.id, source: 'Yahoo', counted: 2, rate: 5 })
    await api.createRecord({ record_type: 'campaign', record_date: '2026-07-01', campaign_id: c.id, source: 'Bing', counted: 2, rate: 5 })

    const list = assertShape<Campaign[]>(await api.campaigns(undefined, { from: '2026-06-01', to: '2026-06-30' }), arrayOf(campaignShape))
    expect(list.map((x) => x.code)).toEqual(['C-01', 'C-02'])
    expect(list[0]).toMatchObject({ cost: 50, counted: 5, records: 2, sources: 2, last_activity: '2026-06-02' })
    expect(list[1]).toMatchObject({ records: 0, sources: 0, last_activity: null, cost: 0 })
    expect((await api.campaigns('02')).map((x) => x.code)).toEqual(['C-02'])
  })

  it('sources: the destinations linked to a campaign with their volume', async () => {
    const c = await api.createCampaign({ code: 'C-03' })
    await api.createDestination({ name: 'Unused', rate: 7, campaign_id: c.id })
    await api.createRecord({ record_type: 'campaign', record_date: '2026-06-01', campaign_id: c.id, source: 'Bing', counted: 4, rate: 12.25 })

    const sources = assertShape<CampaignSource[]>(await api.campaignSources(c.id), arrayOf(campaignSourceShape))
    expect(sources).toEqual([
      { destination_id: expect.any(Number), name: 'Bing', rate: 12.25, counted: 4, cost: 49 },
      { destination_id: expect.any(Number), name: 'Unused', rate: 7, counted: 0, cost: 0 },
    ])
    expect(await api.campaignSources(999999)).toEqual([])
  })

  it('update keeps unsent totals, answers 404 / 409 with the server message', async () => {
    const c = await api.createCampaign({ code: 'C-10', answered: 5, counted: 4, cost: 40 })
    await api.createCampaign({ code: 'C-11' })
    // RecordsGrid's status toggle: status + name + notes only.
    const u = assertShape<Campaign>(await api.updateCampaign(c.id, { status: 'inactive', name: c.name, notes: c.notes }), campaignRowShape)
    expect(u).toMatchObject({ status: 'inactive', answered: 5, counted: 4, cost: 40, code: 'C-10' })

    expect(await rejection(api.updateCampaign(c.id, { code: 'c11' }))).toBe('A campaign with that code already exists')
    expect(await rejection(api.updateCampaign(999999, { status: 'active' }))).toBe('Campaign not found')
  })

  it('delete removes its records and its linked sources', async () => {
    const c = await api.createCampaign({ code: 'C-20' })
    await api.createRecord({ record_type: 'campaign', record_date: '2026-06-01', campaign_id: c.id, source: 'Src', counted: 1, rate: 1 })
    expect(await api.deleteCampaign(c.id)).toEqual({ deleted: true })
    expect(sql('SELECT (SELECT count(*) FROM call_records)::int AS r, (SELECT count(*) FROM destinations)::int AS d')).toEqual([{ r: 0, d: 0 }])
    expect(await api.deleteCampaign(c.id)).toEqual({ deleted: false })
  })
})

describe('destinations', () => {
  beforeEach(() => {
    resetTables(...TABLES)
    useServer()
  })

  it('create / list answer Destination with numeric rate and nullable campaign_id', async () => {
    const c = await api.createCampaign({ code: 'C-01' })
    // The CampaignRatesPopover payload.
    const d = assertShape<Destination>(await api.createDestination({ name: 'Bing', rate: 9.5, campaign_id: c.id }), destinationShape)
    expect(d).toMatchObject({ name: 'Bing', rate: 9.5, campaign_id: c.id, status: 'active' })
    const loose = assertShape<Destination>(await api.createDestination({ name: 'Loose' }), destinationShape)
    expect(loose).toMatchObject({ rate: 0, campaign_id: null })

    const list = assertShape<Destination[]>(await api.destinations(), arrayOf(destinationShape))
    expect(list.map((x) => x.name)).toEqual(['Bing', 'Loose'])
    expect((await api.destinations('bin')).map((x) => x.name)).toEqual(['Bing'])

    expect(await rejection(api.createDestination({ name: 'Bing' }))).toBe('A destination with that name already exists')
    expect(await rejection(api.createDestination({ name: ' ' }))).toBe('Destination name is required')
  })

  it('a rate change re-stamps that source\'s campaign records (the popover flow)', async () => {
    const c = await api.createCampaign({ code: 'C-01' })
    const rec = await api.createRecord({ record_type: 'campaign', record_date: '2026-06-01', campaign_id: c.id, source: 'Bing', counted: 4, rate: 5 })
    const [src] = await api.campaignSources(c.id)
    const upd = assertShape<Destination>(await api.updateDestination(src.destination_id!, { rate: 6 }), destinationShape)
    expect(upd.rate).toBe(6)
    expect(sql('SELECT total_bill::float AS b FROM call_records WHERE id = ?', [rec.id])).toEqual([{ b: 24 }])
    expect((await api.campaignSources(c.id))[0]).toMatchObject({ rate: 6, cost: 24 })

    expect(await rejection(api.updateDestination(999999, { rate: 1 }))).toBe('Destination not found')
    expect(await api.deleteDestination(src.destination_id!)).toEqual({ deleted: true })
    expect(await api.deleteDestination(src.destination_id!)).toEqual({ deleted: false })
  })
})
