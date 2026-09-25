import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  daysAgo,
  daysBeforeIso,
  fileDateRange,
  formatDate,
  formatDmy,
  formatPeriod,
  money,
  money2,
  moneyCompact,
  num,
  pct,
  previousPeriod,
  rangeDays,
  today,
  todayRange,
} from './format'

/** Local YYYY-MM-DD of a Date — the reference the local-day helpers must agree with. */
const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

afterEach(() => {
  vi.useRealTimers()
})

describe('money', () => {
  it('formats with thousands separators and cents', () => {
    expect(money(1234567)).toBe('$1,234,567.00')
  })

  it('never rounds to whole dollars', () => {
    expect(money(1234.5)).toBe('$1,234.50')
    expect(money(37.5)).toBe('$37.50')
  })

  it('formats negatives with a leading minus', () => {
    expect(money(-50)).toBe('-$50.00')
  })

  it('treats zero and NaN as $0.00', () => {
    expect(money(0)).toBe('$0.00')
    expect(money(Number.NaN)).toBe('$0.00')
  })
})

describe('money2', () => {
  it('always shows two decimals', () => {
    expect(money2(5)).toBe('$5.00')
    expect(money2(1234.5)).toBe('$1,234.50')
  })

  it('rounds to cents', () => {
    expect(money2(0.125)).toBe('$0.13')
    expect(money2(-3.456)).toBe('-$3.46')
  })

  it('treats NaN as $0.00', () => {
    expect(money2(Number.NaN)).toBe('$0.00')
  })
})

describe('moneyCompact', () => {
  it('abbreviates thousands and millions', () => {
    expect(moneyCompact(250_000)).toBe('$250K')
    expect(moneyCompact(1_200_000)).toBe('$1.2M')
    expect(moneyCompact(-50_000)).toBe('-$50K')
  })

  it('keeps small values readable rather than collapsing them to zero', () => {
    expect(moneyCompact(920)).toBe('$920')
    expect(moneyCompact(0)).toBe('$0')
  })
})

describe('num', () => {
  it('adds thousands separators', () => {
    expect(num(1234567)).toBe('1,234,567')
  })

  it('treats zero and NaN as 0', () => {
    expect(num(0)).toBe('0')
    expect(num(Number.NaN)).toBe('0')
  })
})

describe('pct', () => {
  it('prefixes positive values with a plus', () => {
    expect(pct(12.345)).toBe('+12.3%')
  })

  it('leaves negatives with their own minus', () => {
    expect(pct(-4.25)).toBe('-4.3%')
  })

  it('shows zero without a sign', () => {
    expect(pct(0)).toBe('0.0%')
  })

  it('renders an em dash for missing values', () => {
    expect(pct(null)).toBe('—')
    expect(pct(undefined)).toBe('—')
  })
})

describe('formatDate', () => {
  it('formats an ISO day as "Mon DD, YYYY"', () => {
    expect(formatDate('2026-06-11')).toBe('Jun 11, 2026')
    expect(formatDate('2026-01-01')).toBe('Jan 01, 2026')
  })

  it('handles a leap day', () => {
    expect(formatDate('2028-02-29')).toBe('Feb 29, 2028')
  })

  it('renders an em dash for null or empty', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('')).toBe('—')
  })

  it('returns an unparseable string as-is', () => {
    expect(formatDate('not a date')).toBe('not a date')
  })
})

describe('formatDmy', () => {
  it('formats an ISO day as "D-Mon-YY"', () => {
    expect(formatDmy('2026-06-11')).toBe('11-Jun-26')
    expect(formatDmy('2026-06-01')).toBe('1-Jun-26')
    expect(formatDmy('2026-12-31')).toBe('31-Dec-26')
  })

  it('renders an em dash for null and passes garbage through', () => {
    expect(formatDmy(null)).toBe('—')
    expect(formatDmy('garbage')).toBe('garbage')
  })
})

describe('fileDateRange', () => {
  it('is "all" when neither end is set', () => {
    expect(fileDateRange(null, null)).toBe('all')
    expect(fileDateRange(undefined, undefined)).toBe('all')
    expect(fileDateRange('', '')).toBe('all')
  })

  it('labels a range with both ends', () => {
    expect(fileDateRange('2026-06-11', '2026-06-20')).toBe('11-Jun-26_to_20-Jun-26')
  })

  it('labels a single day once', () => {
    expect(fileDateRange('2026-06-11', '2026-06-11')).toBe('11-Jun-26')
  })

  it('falls back to whichever end is set', () => {
    expect(fileDateRange('2026-06-11', null)).toBe('11-Jun-26')
    expect(fileDateRange(null, '2026-06-20')).toBe('20-Jun-26')
  })
})

describe('formatPeriod', () => {
  it('labels a day key as "DD Mon"', () => {
    expect(formatPeriod('2026-06-05')).toBe('Jun 05')
  })

  it('labels a month key as "Mon YY"', () => {
    expect(formatPeriod('2026-06')).toBe('Jun 26')
  })

  it('returns a year or any other key unchanged', () => {
    expect(formatPeriod('2026')).toBe('2026')
    expect(formatPeriod('Q3')).toBe('Q3')
  })
})

describe('rangeDays', () => {
  it('counts both ends', () => {
    expect(rangeDays('2026-06-01', '2026-06-30')).toBe(30)
    expect(rangeDays('2026-06-11', '2026-06-11')).toBe(1)
  })

  it('crosses month and leap-year boundaries', () => {
    expect(rangeDays('2028-02-28', '2028-03-01')).toBe(3)
    expect(rangeDays('2026-02-28', '2026-03-01')).toBe(2)
    expect(rangeDays('2026-01-01', '2026-12-31')).toBe(365)
    expect(rangeDays('2028-01-01', '2028-12-31')).toBe(366)
  })

  it('is not thrown off by a daylight-saving change inside the range', () => {
    expect(rangeDays('2026-03-01', '2026-03-31')).toBe(31)
    expect(rangeDays('2026-11-01', '2026-11-02')).toBe(2)
  })

  it('returns 0 for a missing, invalid or reversed range', () => {
    expect(rangeDays(null, '2026-06-01')).toBe(0)
    expect(rangeDays('2026-06-01', undefined)).toBe(0)
    expect(rangeDays('nope', '2026-06-01')).toBe(0)
    expect(rangeDays('2026-06-02', '2026-06-01')).toBe(0)
  })
})

describe('previousPeriod', () => {
  it('returns the equal-length window ending the day before', () => {
    expect(previousPeriod('2026-06-11', '2026-06-20')).toEqual({ from: '2026-06-01', to: '2026-06-10' })
  })

  it('handles a single day', () => {
    expect(previousPeriod('2026-06-11', '2026-06-11')).toEqual({ from: '2026-06-10', to: '2026-06-10' })
  })

  it('crosses into the previous month and year', () => {
    expect(previousPeriod('2026-03-01', '2026-03-31')).toEqual({ from: '2026-01-29', to: '2026-02-28' })
    expect(previousPeriod('2026-01-01', '2026-01-07')).toEqual({ from: '2025-12-25', to: '2025-12-31' })
  })

  it('lands on a leap day', () => {
    expect(previousPeriod('2028-03-01', '2028-03-01')).toEqual({ from: '2028-02-29', to: '2028-02-29' })
  })

  it('treats a reversed range as one day long', () => {
    expect(previousPeriod('2026-06-20', '2026-06-11')).toEqual({ from: '2026-06-19', to: '2026-06-19' })
  })
})

describe('daysBeforeIso', () => {
  it('steps back across month, year and leap boundaries', () => {
    expect(daysBeforeIso('2026-06-11', 10)).toBe('2026-06-01')
    expect(daysBeforeIso('2026-03-01', 1)).toBe('2026-02-28')
    expect(daysBeforeIso('2028-03-01', 1)).toBe('2028-02-29')
    expect(daysBeforeIso('2026-01-01', 1)).toBe('2025-12-31')
  })

  it('returns the same day for 0 and moves forward for a negative n', () => {
    expect(daysBeforeIso('2026-06-11', 0)).toBe('2026-06-11')
    expect(daysBeforeIso('2026-06-30', -1)).toBe('2026-07-01')
  })
})

describe('today / todayRange / daysAgo', () => {
  it('reports the local calendar day, not the UTC one', () => {
    vi.useFakeTimers()
    // 11:30 PM local time — past midnight UTC for anyone west of Greenwich.
    const lateEvening = new Date(2026, 8, 23, 23, 30)
    vi.setSystemTime(lateEvening)
    expect(today()).toBe('2026-09-23')
    expect(today()).toBe(localIso(lateEvening))
  })

  it('reports the local day just after local midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 24, 0, 5))
    expect(today()).toBe('2026-09-24')
  })

  it('opens the default window on today alone', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 1, 28, 12))
    expect(todayRange()).toEqual({ from: '2026-02-28', to: '2026-02-28' })
  })

  it('counts days back from the local today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2028, 2, 1, 9))
    expect(daysAgo(0)).toBe('2028-03-01')
    expect(daysAgo(1)).toBe('2028-02-29')
    expect(daysAgo(366)).toBe('2027-03-01')
  })
})
