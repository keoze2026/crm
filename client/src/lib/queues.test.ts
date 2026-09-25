import { describe, expect, it } from 'vitest'
import { entryDay, entryTime, matches, parseCodeList, parseNameList } from './queues'

/** Local YYYY-MM-DD of an instant — what entryDay must agree with in whatever zone the test runs. */
const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

describe('parseCodeList', () => {
  it('splits on commas, semicolons, slashes, pipes and whitespace', () => {
    expect(parseCodeList('BHS, BOP Q04')).toEqual(['BHS', 'BOP', 'Q04'])
    expect(parseCodeList('A;B/C|D\nE\tF')).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })

  it('drops blanks from doubled or trailing separators', () => {
    expect(parseCodeList(' ,, BHS ,  ; ')).toEqual(['BHS'])
  })

  it('collapses case-insensitive repeats, keeping the first spelling', () => {
    expect(parseCodeList('bhs, BHS, Bhs, Q04')).toEqual(['bhs', 'Q04'])
  })

  it('returns nothing for an empty or blank paste', () => {
    expect(parseCodeList('')).toEqual([])
    expect(parseCodeList('   ')).toEqual([])
  })
})

describe('parseNameList', () => {
  it('keeps the spaces inside a name', () => {
    expect(parseNameList('Anna, Camp Team')).toEqual(['Anna', 'Camp Team'])
  })

  it('splits on semicolons and newlines too', () => {
    expect(parseNameList('Anna; Ben\nCamp Team\r\n')).toEqual(['Anna', 'Ben', 'Camp Team'])
  })

  it('trims, drops blanks and dedupes case-insensitively', () => {
    expect(parseNameList('  Anna  ,, anna, ANNA ,Ben')).toEqual(['Anna', 'Ben'])
    expect(parseNameList('')).toEqual([])
  })
})

describe('matches', () => {
  it('is a case-insensitive substring test', () => {
    expect(matches('Camp Team', 'camp')).toBe(true)
    expect(matches('Camp Team', 'TEAM')).toBe(true)
    expect(matches('Camp Team', 'flow')).toBe(false)
  })

  it('trims the query', () => {
    expect(matches('Camp Team', '  team  ')).toBe(true)
  })

  it('matches everything for an empty query', () => {
    expect(matches('Anything', '')).toBe(true)
    expect(matches('', '   ')).toBe(true)
  })
})

describe('entryDay', () => {
  it('reads a Postgres timestamp with a two-digit offset', () => {
    const ts = '2026-09-03 09:13:33.062173-04'
    expect(entryDay(ts)).toBe(localIso(new Date(Date.UTC(2026, 8, 3, 13, 13, 33))))
  })

  it('places an evening entry on the local day of the instant, not the UTC day', () => {
    // 23:30 at UTC-4 is 03:30 UTC the next day.
    const ts = '2026-09-03 23:30:00-04'
    expect(entryDay(ts)).toBe(localIso(new Date(Date.UTC(2026, 8, 4, 3, 30))))
  })

  it('accepts an already-ISO timestamp and a full offset', () => {
    expect(entryDay('2026-09-03T12:00:00+00:00')).toBe(localIso(new Date(Date.UTC(2026, 8, 3, 12))))
    expect(entryDay('2026-09-03 12:00:00+05:30')).toBe(localIso(new Date(Date.UTC(2026, 8, 3, 6, 30))))
  })

  it('falls back to the first ten characters of an unparseable value', () => {
    expect(entryDay('2026-13-45 junk')).toBe('2026-13-45')
    expect(entryDay('garbage')).toBe('garbage')
  })
})

describe('entryTime', () => {
  it('renders the local clock time of the instant', () => {
    const ts = '2026-09-03 14:45:00-04'
    const expected = new Date(Date.UTC(2026, 8, 3, 18, 45))
      .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    expect(entryTime(ts)).toBe(expected)
    expect(entryTime(ts)).toMatch(/^\d{1,2}:45\s[AP]M$/)
  })

  it('renders an em dash for an unparseable value', () => {
    expect(entryTime('garbage')).toBe('—')
    expect(entryTime('')).toBe('—')
  })
})
