import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentMonth, formatMonth, shiftMonth } from './MonthSelector'

describe('currentMonth', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the local month as YYYY-MM with a zero-padded month', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 15, 12, 0))
    expect(currentMonth()).toBe('2026-03')
  })

  it('reads the local calendar, not UTC, just after local midnight on the 1st', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2027, 0, 1, 0, 1))
    expect(currentMonth()).toBe('2027-01')
  })

  it('handles December without rolling over', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 11, 31, 23, 59))
    expect(currentMonth()).toBe('2026-12')
  })
})

describe('shiftMonth', () => {
  it('returns the same month for n = 0', () => {
    expect(shiftMonth('2026-09', 0)).toBe('2026-09')
  })

  it('steps forward and back within a year', () => {
    expect(shiftMonth('2026-05', 1)).toBe('2026-06')
    expect(shiftMonth('2026-05', -1)).toBe('2026-04')
  })

  it('rolls over the year boundary in both directions', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })

  it('handles shifts larger than a year', () => {
    expect(shiftMonth('2026-09', 12)).toBe('2027-09')
    expect(shiftMonth('2026-09', -11)).toBe('2025-10')
    expect(shiftMonth('2026-09', -25)).toBe('2024-08')
    expect(shiftMonth('2026-09', 40)).toBe('2030-01')
  })

  it('zero-pads single-digit months', () => {
    expect(shiftMonth('2026-10', -1)).toBe('2026-09')
  })

  it('ignores a day part if one is passed', () => {
    expect(shiftMonth('2026-03-31', 1)).toBe('2026-04')
  })

  it('normalises an out-of-range month through the calendar', () => {
    expect(shiftMonth('2026-13', 0)).toBe('2027-01')
    expect(shiftMonth('2026-00', 0)).toBe('2025-12')
  })

  it('produces NaN parts rather than throwing on garbage', () => {
    expect(() => shiftMonth('not-a-month', 1)).not.toThrow()
    expect(shiftMonth('not-a-month', 1)).toContain('NaN')
  })
})

describe('formatMonth', () => {
  it('names the month in full with the year', () => {
    expect(formatMonth('2026-03')).toBe('March 2026')
  })

  it('covers the first and last months of the year', () => {
    expect(formatMonth('2025-01')).toBe('January 2025')
    expect(formatMonth('2025-12')).toBe('December 2025')
  })

  it('reads the month of a full ISO date', () => {
    expect(formatMonth('2026-09-01')).toBe('September 2026')
  })

  it('round-trips with shiftMonth across a year boundary', () => {
    expect(formatMonth(shiftMonth('2026-12', 1))).toBe('January 2027')
  })

  it('does not throw on an out-of-range month', () => {
    expect(() => formatMonth('2026-13')).not.toThrow()
  })
})
