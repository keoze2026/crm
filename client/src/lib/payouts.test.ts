import { describe, expect, it } from 'vitest'
import type { IncentiveStatus } from '../types'
import { INCENTIVE_STATUSES, incentiveStatus, parseAmount, payableTotal, sumOf } from './payouts'

const row = (amount: number, status: IncentiveStatus = 'Pending') => ({ amount, status })

describe('statuses', () => {
  it('offers exactly the three the server accepts', () => {
    expect(INCENTIVE_STATUSES.map((s) => s.id).sort()).toEqual(['Cancelled', 'Fulfilled', 'Pending'])
  })

  it('falls back to Pending for anything unknown', () => {
    expect(incentiveStatus('Fulfilled').id).toBe('Fulfilled')
    expect(incentiveStatus('Paid').id).toBe('Pending')
  })
})

describe('sumOf and payableTotal', () => {
  it('keeps the cents without float noise', () => {
    expect(sumOf([row(0.1), row(0.1), row(0.1)])).toBe(0.3)
    expect(sumOf([])).toBe(0)
  })

  it('leaves cancelled rows out of what is paid', () => {
    expect(payableTotal([row(200, 'Fulfilled'), row(50.5), row(75, 'Cancelled')])).toBe(250.5)
  })
})

describe('parseAmount', () => {
  it('reads plain and formatted dollars', () => {
    expect(parseAmount('200')).toBe(200)
    expect(parseAmount(' $1,250.50 ')).toBe(1250.5)
    expect(parseAmount('.5')).toBe(0.5)
    expect(parseAmount('0')).toBe(0)
  })

  it('refuses blank, negative and unreadable amounts', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('-5')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('1.2.3')).toBeNull()
  })
})
