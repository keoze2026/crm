import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '../src/api/client'
import { createEnrolledUser, loginAs, resetTables, sql, useServer } from './harness'
import { rejection } from './shape'

// With auth on, AuthMiddleware is documented as "the authoritative check — the frontend
// guards are UX only". A member's page permissions must therefore hold at the API too.

const TABLES = ['users', 'sessions', 'vendors', 'vendor_payments', 'portal_expenses', 'queue_codes', 'queue_assignments', 'staff']

describe('page permissions on this area (auth on)', () => {
  beforeEach(() => resetTables(...TABLES))

  it('anonymous callers get the server\'s 401 message', async () => {
    useServer({ auth: true })
    expect(await rejection(api.vendors())).toBe('Unauthorized')
    expect(await rejection(api.records({}))).toBe('Unauthorized')
  })

  it('a member with only Queues can use Queues', async () => {
    useServer({ auth: true })
    await loginAs(createEnrolledUser('queuesonly', 'member', ['queues']))
    expect(await api.queueCodes()).toEqual([])
    const res = await api.createQueueCodes(['Q1'])
    expect(res.created.map((c) => c.code)).toEqual(['Q1'])
  })

  it('a member with only Queues is refused the Vendors page API', async () => {
    useServer({ auth: true })
    await loginAs(createEnrolledUser('queuesonly', 'member', ['queues']))
    expect(await rejection(api.vendors())).toBe('Forbidden')
    expect(await rejection(api.saveVendorMeta({ name: 'Sneaky', opening_advance: 999 }))).toBe('Forbidden')
    expect(sql('SELECT count(*)::int AS n FROM vendors')).toEqual([{ n: 0 }])
  })

  it('a member with only Queues is refused the Portal Expenses page API', async () => {
    useServer({ auth: true })
    await loginAs(createEnrolledUser('queuesonly', 'member', ['queues']))
    expect(await rejection(api.portalExpenses('2026-06'))).toBe('Forbidden')
    expect(await rejection(api.createPortalExpense({ month: '2026-06', name: 'Sneaky', total_amount: 1 }))).toBe('Forbidden')
    expect(sql('SELECT count(*)::int AS n FROM portal_expenses')).toEqual([{ n: 0 }])
  })

  it('a member without Queues is refused the Queues API', async () => {
    useServer({ auth: true })
    await loginAs(createEnrolledUser('vendorsonly', 'member', ['vendors']))
    expect(await rejection(api.queueCodes())).toBe('Forbidden')
    expect(await rejection(api.queues('forwarding'))).toBe('Forbidden')
  })
})
