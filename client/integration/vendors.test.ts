import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '../src/api/client'
import { money2 } from '../src/lib/format'
import type { Vendor, VendorLedger } from '../src/types'
import { deletedShape, paymentWriteShape, vendorLedgerShape, vendorShape } from './contracts'
import { resetTables, sql, useServer } from './harness'
import { arrayOf, assertShape, rejection } from './shape'

// Vendors page: one tab per traffic source, a per-day ledger derived from the campaign
// records plus the hand-entered amounts paid, and a carried-forward Due/Advance balance.

const TABLES = ['call_records', 'buyers', 'campaigns', 'destinations', 'vendors', 'vendor_payments']

async function campaignDay(source: string, date: string, counted: number, rate: number) {
  return api.createRecord({ record_type: 'campaign', record_date: date, campaign_code: 'C-01', source, counted, answered: counted, rate })
}

/** VendorSheet's running balance: each row opens at the previous row's close. */
function closingBalance(ledger: VendorLedger): number {
  let balance = ledger.initial_advance
  for (const p of ledger.rows) balance += p.amount_paid - p.payments
  return balance
}

async function seedLedger() {
  await campaignDay('DXTST', '2026-06-01', 10, 3)   // 30
  await campaignDay('dxtst', '2026-06-02', 4, 3)    // 12 — same vendor, other spelling
  await campaignDay('DXTST', '2026-06-10', 5, 3)    // 15
  await campaignDay('Other', '2026-06-01', 1, 1)
  await api.saveVendorMeta({ name: 'DXTST', opening_advance: 100 })
  await api.createVendorPayment({ vendor: 'DXTST', entry_date: '2026-06-01', amount_paid: 20 })
  await api.createVendorPayment({ vendor: 'dxtst', entry_date: '2026-06-05', amount_paid: 50 }) // a day with no traffic
}

describe('vendors', () => {
  beforeEach(() => {
    resetTables(...TABLES)
    useServer()
  })

  it('lists discovered sources and manual vendors as Vendor[] (id null until saved)', async () => {
    await campaignDay('DXTST', '2026-06-01', 1, 1)
    await campaignDay('dxtst ', '2026-06-02', 1, 1)
    await campaignDay('Alpha', '2026-06-01', 1, 1)
    const manual = assertShape<Vendor>(await api.createVendor('  Zeta Leads '), vendorShape)
    expect(manual).toMatchObject({ name: 'Zeta Leads', is_manual: true, opening_advance: 0, sort_order: 0 })

    const list = assertShape<Vendor[]>(await api.vendors(), arrayOf(vendorShape))
    expect(list.map((v) => [v.name.toUpperCase(), v.id === null, v.is_manual])).toEqual([
      ['ALPHA', true, false],
      ['DXTST', true, false],
      ['ZETA LEADS', false, true],
    ])
  })

  it('saveVendorMeta upserts by name: a discovered vendor gains an id, negatives mean Due', async () => {
    await campaignDay('DXTST', '2026-06-01', 1, 1)
    const saved = assertShape<Vendor>(await api.saveVendorMeta({ name: 'dxtst', opening_advance: -45.5 }), vendorShape)
    expect(saved).toMatchObject({ is_manual: false, opening_advance: -45.5 })
    expect(saved.id).toEqual(expect.any(Number))
    const again = await api.saveVendorMeta({ name: 'DXTST ' })
    expect(again).toMatchObject({ id: saved.id, opening_advance: -45.5 })
    expect((await api.vendors()).map((v) => v.id)).toEqual([saved.id])
  })

  it('create / delete errors come back with the server message', async () => {
    const v = await api.createVendor('Manual')
    expect(await rejection(api.createVendor('manual'))).toBe('A vendor with that name already exists')
    expect(await rejection(api.createVendor('   '))).toBe('Vendor name is required')
    expect(await rejection(api.saveVendorMeta({ name: '' }))).toBe('Vendor name is required')

    const discovered = await api.saveVendorMeta({ name: 'Discovered', opening_advance: 1 })
    expect(await rejection(api.deleteVendor(discovered.id!))).toBe('Only manually-added vendors can be deleted')
    expect(await rejection(api.deleteVendor(999999))).toBe('Vendor not found')

    await api.createVendorPayment({ vendor: 'Manual', entry_date: '2026-06-01', amount_paid: 5 })
    expect(assertShape(await api.deleteVendor(v.id!), deletedShape)).toEqual({ deleted: true })
    expect(sql('SELECT count(*)::int AS n FROM vendor_payments')).toEqual([{ n: 0 }])
  })

  it('ledger: one VendorPayment per day, derived from the campaign records', async () => {
    await seedLedger()
    const ledger = assertShape<VendorLedger>(await api.vendorPayments('DXTST', { from: '2026-06-01', to: '2026-06-30' }), vendorLedgerShape)
    expect(ledger.rows.map((r) => [r.entry_date, r.converted_calls, r.price, r.payments, r.amount_paid, r.payment_id === null])).toEqual([
      ['2026-06-01', 10, 3, 30, 20, false],
      ['2026-06-02', 4, 3, 12, 0, true],
      ['2026-06-05', 0, 0, 0, 50, false],
      ['2026-06-10', 5, 3, 15, 0, true],
    ])
    expect(ledger.rows.every((r) => r.vendor === 'DXTST')).toBe(true)
    expect(ledger).toMatchObject({ opening_advance: 100, prior_net: 0, initial_advance: 100 })
    expect(closingBalance(ledger)).toBe(113)
    expect(money2(closingBalance(ledger))).toBe('$113.00')

    // Unknown vendor: an envelope with empty rows, not a bare array or a 404.
    const none = assertShape<VendorLedger>(await api.vendorPayments('Nobody', {}), vendorLedgerShape)
    expect(none).toEqual({ rows: [], opening_advance: 0, prior_net: 0, initial_advance: 0 })
  })

  it('the balance carries forward: period 2 opens where period 1 closed', async () => {
    await seedLedger()
    const whole = await api.vendorPayments('DXTST', { from: '2026-06-01', to: '2026-06-30' })
    const p1 = await api.vendorPayments('DXTST', { from: '2026-06-01', to: '2026-06-04' })
    const p2 = await api.vendorPayments('DXTST', { from: '2026-06-05', to: '2026-06-30' })
    expect(closingBalance(p1)).toBe(78)
    expect(p2.prior_net).toBe(-22)
    expect(p2.initial_advance).toBe(closingBalance(p1))
    expect(closingBalance(p2)).toBe(closingBalance(whole))

    // Typing an opening balance on period 2 (VendorSheet sends value − prior_net) makes
    // period 2 open at exactly that figure.
    await api.saveVendorMeta({ name: 'DXTST', opening_advance: 200 - p2.prior_net })
    expect((await api.vendorPayments('DXTST', { from: '2026-06-05', to: '2026-06-30' })).initial_advance).toBe(200)
  })

  it('posting the same day twice sets the amount; update / delete by payment id', async () => {
    const first = assertShape<{ id: number }>(await api.createVendorPayment({ vendor: 'V', entry_date: '2026-06-03', amount_paid: 10 }), paymentWriteShape)
    const second = await api.createVendorPayment({ vendor: ' v ', entry_date: '2026-06-03', amount_paid: 12.75 })
    expect(second).toMatchObject({ id: first.id, amount_paid: 12.75, entry_date: '2026-06-03' })
    expect(sql('SELECT amount_paid::float AS a FROM vendor_payments')).toEqual([{ a: 12.75 }])

    // The VendorSheet row edit.
    const upd = assertShape<{ amount_paid: number }>(await api.updateVendorPayment(first.id, { amount_paid: 7 }), paymentWriteShape)
    expect(upd).toMatchObject({ id: first.id, amount_paid: 7, entry_date: '2026-06-03' })
    expect(await rejection(api.updateVendorPayment(999999, { amount_paid: 1 }))).toBe('Payment row not found')

    expect(await rejection(api.createVendorPayment({ vendor: 'V', entry_date: '2026-02-30', amount_paid: 1 }))).toBe('A valid entry date is required')
    expect(await rejection(api.createVendorPayment({ vendor: '', entry_date: '2026-06-01', amount_paid: 1 }))).toBe('A vendor is required')
    // The client drops an empty vendor from the query string; the server answers 422.
    expect(await rejection(api.vendorPayments('', {}))).toBe('A vendor is required')

    expect(await api.deleteVendorPayment(first.id)).toEqual({ deleted: true })
    expect(await api.deleteVendorPayment(first.id)).toEqual({ deleted: false })
  })

  it('moving a payment onto a day that already has one answers 409, not a 500 with raw SQL', async () => {
    // Not reachable from VendorSheet today (it only sends amount_paid), but the client
    // declares entry_date as writable.
    const server = useServer()
    const a = await api.createVendorPayment({ vendor: 'V', entry_date: '2026-06-03', amount_paid: 10 })
    await api.createVendorPayment({ vendor: 'V', entry_date: '2026-06-04', amount_paid: 5 })
    const message = await rejection(api.updateVendorPayment(a.id, { entry_date: '2026-06-04' }))
    expect(server.calls.at(-1)?.status).toBe(409)
    expect(message).not.toMatch(/SQLSTATE/)
  })
})
