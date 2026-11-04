import { describe, expect, it } from 'vitest'
import { barLabel, bucketCount, bucketKey, shareLabel, splitEnds } from './dashboard'

describe('bucketKey', () => {
  it('keeps a day as itself', () => {
    expect(bucketKey('2026-09-29', 'day')).toBe('2026-09-29')
  })
  it('maps a day to the Monday of its week', () => {
    expect(bucketKey('2026-09-29', 'week')).toBe('2026-09-28') // Tuesday → Monday
    expect(bucketKey('2026-09-28', 'week')).toBe('2026-09-28') // Monday stays
    expect(bucketKey('2026-10-04', 'week')).toBe('2026-09-28') // Sunday → previous Monday
  })
  it('maps a day to the start of its 4-day window anchored at 2000-01-01', () => {
    expect(bucketKey('2000-01-01', '4day')).toBe('2000-01-01')
    expect(bucketKey('2000-01-04', '4day')).toBe('2000-01-01')
    expect(bucketKey('2000-01-05', '4day')).toBe('2000-01-05')
  })
})

describe('bucketCount', () => {
  it('counts days inclusively', () => {
    expect(bucketCount('2026-08-07', '2026-11-04', 'day')).toBe(90)
    expect(bucketCount('2026-11-04', '2026-11-04', 'day')).toBe(1)
  })
  it('counts partial weeks at both ends', () => {
    // Wed 4 Nov – Tue 10 Nov touches two Monday-weeks.
    expect(bucketCount('2026-11-04', '2026-11-10', 'week')).toBe(2)
  })
  it('returns 0 for an inverted or empty range', () => {
    expect(bucketCount('2026-11-05', '2026-11-04', 'day')).toBe(0)
    expect(bucketCount('', '2026-11-04', 'day')).toBe(0)
  })
})

describe('barLabel', () => {
  it('rounds non-peak money to whole thousands with a tilde', () => {
    expect(barLabel(63_120.5, 'money', false)).toBe('~$63K')
  })
  it('gives the peak one decimal and no tilde', () => {
    expect(barLabel(138_698.5, 'money', true)).toBe('$138.7K')
    expect(barLabel(140_000, 'money', true)).toBe('$140K')
  })
  it('keeps small money exact when it is whole', () => {
    expect(barLabel(250, 'money', false)).toBe('$250')
    expect(barLabel(249.5, 'money', false)).toBe('~$250')
  })
  it('marks negatives', () => {
    expect(barLabel(-4_200, 'money', false)).toBe('~−$4K')
  })
  it('prints counts exactly', () => {
    expect(barLabel(1390, 'count', false)).toBe('1,390')
  })
})

describe('splitEnds', () => {
  const rows = Array.from({ length: 52 }, (_, i) => i + 1)
  it('keeps the first and last five and hides the middle', () => {
    const { head, middle, tail } = splitEnds(rows)
    expect(head).toEqual([1, 2, 3, 4, 5])
    expect(tail).toEqual([48, 49, 50, 51, 52])
    expect(middle).toHaveLength(42)
  })
  it('hides nothing at ten rows or fewer', () => {
    const { head, middle, tail } = splitEnds(rows.slice(0, 10))
    expect(head).toHaveLength(10)
    expect(middle).toHaveLength(0)
    expect(tail).toHaveLength(0)
  })
})

describe('shareLabel', () => {
  it('uses one decimal, two for slivers', () => {
    expect(shareLabel(17.22)).toBe('17.2%')
    expect(shareLabel(0.0357)).toBe('0.04%')
    expect(shareLabel(0)).toBe('0.0%')
  })
})
