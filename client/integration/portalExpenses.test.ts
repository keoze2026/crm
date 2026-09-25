import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '../src/api/client'
import { money2 } from '../src/lib/format'
import type { PortalExpense } from '../src/types'
import { deletedShape, portalExpenseShape } from './contracts'
import { resetTables, sql, useServer } from './harness'
import { arrayOf, assertShape, rejection } from './shape'

// Portal Expenses page: one provider's costs for one month.

const COMPONENTS = {
  voice_minutes: 120.5, rejected_calls: 3, rent_values: 40, call_recording: 9.99, voip_shield: 5, other_expenses: 1.51,
}

describe('portal expenses', () => {
  beforeEach(() => {
    resetTables('portal_expenses')
    useServer()
  })

  it('create (the AddRow payload) answers a PortalExpense with the month normalised', async () => {
    const row = assertShape<PortalExpense>(
      await api.createPortalExpense({ month: '2026-03', name: '  Twilio ', ...COMPONENTS, total_amount: 180 }),
      portalExpenseShape,
    )
    expect(row).toMatchObject({ month: '2026-03-01', name: 'Twilio', ...COMPONENTS, total_amount: 180, sort_order: 0 })
    const second = await api.createPortalExpense({ month: '2026-03-17', name: 'Telnyx' })
    expect(second).toMatchObject({ month: '2026-03-01', sort_order: 1, voice_minutes: 0, total_amount: 0 })
    expect(sql("SELECT to_char(month, 'YYYY-MM-DD') AS m, name, call_recording::float AS cr FROM portal_expenses ORDER BY id")).toEqual([
      { m: '2026-03-01', name: 'Twilio', cr: 9.99 },
      { m: '2026-03-01', name: 'Telnyx', cr: 0 },
    ])
  })

  it('lists one month in sort order; the sheet totals add up as numbers', async () => {
    await api.createPortalExpense({ month: '2026-03', name: 'A', total_amount: 10.25 })
    await api.createPortalExpense({ month: '2026-03', name: 'B', total_amount: 20.5, sort_order: -1 })
    await api.createPortalExpense({ month: '2026-04', name: 'C', total_amount: 99 })

    const march = assertShape<PortalExpense[]>(await api.portalExpenses('2026-03'), arrayOf(portalExpenseShape))
    expect(march.map((e) => e.name)).toEqual(['B', 'A'])
    expect(money2(march.reduce((a, e) => a + e.total_amount, 0))).toBe('$30.75')
    expect(await api.portalExpenses('2031-01')).toEqual([])
    // No month (the client drops '') lists every month.
    expect(await api.portalExpenses('')).toHaveLength(3)
  })

  it('update changes only what is sent; negatives clamp to 0', async () => {
    const row = await api.createPortalExpense({ month: '2026-03', name: 'A', ...COMPONENTS, total_amount: 180 })
    const upd = assertShape<PortalExpense>(await api.updatePortalExpense(row.id, { voip_shield: -4, total_amount: 175 }), portalExpenseShape)
    expect(upd).toMatchObject({ voip_shield: 0, total_amount: 175, voice_minutes: 120.5, name: 'A', month: '2026-03-01' })
    expect(sql('SELECT voip_shield::float AS v FROM portal_expenses')).toEqual([{ v: 0 }])
  })

  it('surfaces the server\'s 422 / 404 messages', async () => {
    expect(await rejection(api.createPortalExpense({ month: '2026-13', name: 'X' }))).toBe('A valid month is required')
    expect(await rejection(api.createPortalExpense({ name: 'X' }))).toBe('A valid month is required')
    expect(await rejection(api.createPortalExpense({ month: '2026-03', name: '  ' }))).toBe('Name is required')
    expect(await rejection(api.updatePortalExpense(999999, { name: 'Y' }))).toBe('Expense row not found')
    expect(sql('SELECT count(*)::int AS n FROM portal_expenses')).toEqual([{ n: 0 }])
  })

  it('deletes once', async () => {
    const row = await api.createPortalExpense({ month: '2026-03', name: 'A' })
    expect(assertShape(await api.deletePortalExpense(row.id), deletedShape)).toEqual({ deleted: true })
    expect(await api.deletePortalExpense(row.id)).toEqual({ deleted: false })
  })
})
