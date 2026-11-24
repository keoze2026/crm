import { describe, expect, it } from 'vitest'
import { barLabel, bucketCount, bucketKey, bucketLabel, groupByPrice, parseAmount, parseCsv, parseRankCsv, roundedLike, roundingDrift, shareLabel, splitEnds, unitEconomics, whatChanged } from './dashboard'

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

describe('bucketLabel', () => {
  it('writes a day with its weekday', () => {
    expect(bucketLabel('2026-11-02', 'day')).toBe('Mon, Nov 02')
  })
  it('writes a 4-day window as its span and a week by its Monday', () => {
    expect(bucketLabel('2026-11-02', '4day')).toBe('Nov 02 – Nov 05')
    expect(bucketLabel('2026-11-02', 'week')).toBe('Week of Nov 02')
  })
})

describe('parseAmount', () => {
  it('reads blanks as 0 and strips $ and commas', () => {
    expect(parseAmount('')).toBe(0)
    expect(parseAmount(' $1,250.50 ')).toBe(1250.5)
    expect(parseAmount('.5')).toBe(0.5)
  })
  it('rejects anything that is not a non-negative number', () => {
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('-5')).toBeNull()
    expect(parseAmount('.')).toBeNull()
    expect(parseAmount('1.2.3')).toBeNull()
  })
})

describe('unitEconomics', () => {
  it('works out profit, margin and per-lead figures without rounding', () => {
    const u = unitEconomics({ revenue: 1054240.5, cost: 927476, counted: 21051 })
    expect(u.profit).toBeCloseTo(126764.5, 6)
    expect(u.marginPct!.toFixed(1)).toBe('12.0')
    expect(u.revenuePerLead!.toFixed(2)).toBe('50.08')
    expect(u.costPerLead!.toFixed(2)).toBe('44.06')
  })
  it('has no per-lead figures without counted leads', () => {
    const u = unitEconomics({ revenue: 0, cost: 10, counted: 0 })
    expect(u.marginPct).toBeNull()
    expect(u.revenuePerLead).toBeNull()
  })
})

describe('whatChanged', () => {
  it('reads the mock period the way the designer wrote it', () => {
    const curr = { revenue: 1054240.5, cost: 927476, counted: 21051 }
    const prev = { revenue: 1333562, cost: 1087333, counted: 26655 }
    expect(whatChanged(curr, prev, 'previous 23 days')).toBe(
      'Margin fell 6.4 pts. Revenue per lead held at about $50, but cost per lead rose 8.0% to $44.06 and volume fell 21%.',
    )
  })
  it('says so when there is no baseline', () => {
    expect(whatChanged({ revenue: 10, cost: 5, counted: 1 }, { revenue: 0, cost: 0, counted: 0 }, 'previous day'))
      .toBe('Nothing was billed in the previous day, so there is no baseline to compare against.')
  })
})

describe('groupByPrice', () => {
  it('groups buyers by price per lead, biggest revenue first', () => {
    const g = groupByPrice([
      { label: 'A', value: 500, counted: 10 },
      { label: 'B', value: 1100, counted: 20 },
      { label: 'C', value: 250, counted: 5 },
      { label: 'D', value: 40, counted: 0 },
    ])
    expect(g.map((x) => [x.price, x.value, x.counted, x.members])).toEqual([
      [55, 1100, 20, ['B']],
      [50, 750, 15, ['A', 'C']],
      [null, 40, 0, ['D']],
    ])
  })
})

describe('roundedLike / roundingDrift', () => {
  it('rounds the way the ~ labels print', () => {
    expect(roundedLike(106_812.5)).toBe(107_000)
    expect(roundedLike(2_740)).toBe(3_000)
    expect(roundedLike(563.4)).toBe(563)
    expect(roundedLike(1_234_567)).toBe(1_200_000)
  })
  it('measures how far the printed figures drift from the total', () => {
    // Peak printed exactly; the others rounded to $1K.
    expect(roundingDrift([107_781.5, 106_600, 2_400], 0, 216_781.5)).toBe(0)
    expect(roundingDrift([107_781.5, 106_400, 2_400], 0, 216_581.5)).toBe(800)
  })
})

describe('parseCsv', () => {
  it('splits cells, honours quotes and skips blank lines', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n\n1,2')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['1', '2']])
  })
})

describe('parseRankCsv', () => {
  it('reads a buyer list, biggest revenue first', () => {
    const r = parseRankCsv('buyer,revenue,leads,first,last\nDEE,50,1,Nov 17,Nov 17\nRTG 04,"$171,380.00",3116,Nov 02,Nov 19')
    expect(r).toEqual({
      kind: 'buyers',
      rows: [
        { label: 'RTG 04', buyer: null, value: 171380, counted: 3116, first: 'Nov 02', last: 'Nov 19' },
        { label: 'DEE', buyer: null, value: 50, counted: 1, first: 'Nov 17', last: 'Nov 17' },
      ],
    })
  })
  it('reads a campaign list with its buyer, columns in any order', () => {
    const r = parseRankCsv('revenue,campaign,leads,buyer\n900,C1,18,RTG 04')
    expect(r).toEqual({ kind: 'campaigns', rows: [{ label: 'C1', buyer: 'RTG 04', value: 900, counted: 18, first: '', last: '' }] })
  })
  it('explains what is wrong', () => {
    expect(parseRankCsv('')).toEqual({ error: 'Paste a CSV with a header row first.' })
    expect('error' in parseRankCsv('name,revenue\nA,1')).toBe(true)
    expect(parseRankCsv('buyer,revenue\nA,1')).toEqual({ error: 'The header row is missing the “leads” column.' })
    expect(parseRankCsv('buyer,revenue,leads\nA,lots,1')).toEqual({ error: 'Row 2: revenue “lots” is not an amount.' })
    expect(parseRankCsv('buyer,revenue,leads\nA,10,1.5')).toEqual({ error: 'Row 2: leads “1.5” is not a whole number.' })
    expect(parseRankCsv('buyer,revenue,leads')).toEqual({ error: 'There are no rows under the header.' })
  })
})
