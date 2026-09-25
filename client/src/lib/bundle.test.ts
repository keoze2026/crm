import { describe, expect, it } from 'vitest'
import type { CallRecord } from '../types'
import {
  REPLACEMENT_AUTOFILL_EXCLUDED_SOURCES,
  autoReplacement,
  bundleCampaignRecords,
  effectiveCampaignReplacement,
  normalizeCode,
  replacementIsManual,
  standardizeCampaignCode,
} from './bundle'

let nextId = 1
const record = (over: Partial<CallRecord> = {}): CallRecord => ({
  id: nextId++,
  record_date: '2026-05-01',
  record_type: 'campaign',
  buyer_id: null,
  buyer_code: null,
  campaign_id: 1,
  campaign_code: 'C-03',
  source: 'BING',
  answered: 0,
  missed: 0,
  replacement: 0,
  counted: 0,
  rate: 0,
  total_bill: 0,
  ...over,
})

describe('normalizeCode', () => {
  it('collapses case, spaces and punctuation', () => {
    for (const s of ['C 03', 'C-03', 'c03', 'C03', ' c.0_3 ']) expect(normalizeCode(s)).toBe('C03')
    expect(normalizeCode('Bing')).toBe('BING')
  })

  it('keeps genuinely different codes apart', () => {
    expect(normalizeCode('C03')).not.toBe(normalizeCode('C3'))
  })

  it('returns an empty string for null, undefined and punctuation-only input', () => {
    expect(normalizeCode(null)).toBe('')
    expect(normalizeCode(undefined)).toBe('')
    expect(normalizeCode('')).toBe('')
    expect(normalizeCode(' - / ')).toBe('')
  })
})

describe('standardizeCampaignCode', () => {
  it('turns the documented variants into C-03', () => {
    for (const s of ['c03', 'c-3', 'C-3', 'Co3', 'c -03', 'C- 03', 'C 0 3', 'C_03', 'C.3']) {
      expect(standardizeCampaignCode(s)).toBe('C-03')
    }
  })

  it('keeps a multi-letter prefix split on its dash', () => {
    expect(standardizeCampaignCode('CO-05')).toBe('CO-05')
    expect(standardizeCampaignCode('abc12')).toBe('ABC-12')
  })

  it('does not pad numbers that already have two or more digits', () => {
    expect(standardizeCampaignCode('c123')).toBe('C-123')
    expect(standardizeCampaignCode('C-10')).toBe('C-10')
  })

  it('drops leading zeros beyond two digits', () => {
    expect(standardizeCampaignCode('C-007')).toBe('C-07')
  })

  it('reads a zero-only number as 00', () => {
    expect(standardizeCampaignCode('C0')).toBe('C-00')
    expect(standardizeCampaignCode('C-O0')).toBe('C-00')
  })

  it('returns non-code sources trimmed but otherwise untouched', () => {
    expect(standardizeCampaignCode('  GOOGLE ')).toBe('GOOGLE')
    expect(standardizeCampaignCode('bing')).toBe('bing')
    expect(standardizeCampaignCode('123')).toBe('123')
    expect(standardizeCampaignCode('C-OO')).toBe('C-OO')
    expect(standardizeCampaignCode('C-03-B')).toBe('C-03-B')
  })

  it('returns an empty string for empty input', () => {
    expect(standardizeCampaignCode(null)).toBe('')
    expect(standardizeCampaignCode(undefined)).toBe('')
    expect(standardizeCampaignCode('   ')).toBe('')
  })
})

describe('replacementIsManual', () => {
  it('matches the excluded sources ignoring case and surrounding whitespace', () => {
    expect(REPLACEMENT_AUTOFILL_EXCLUDED_SOURCES).toContain('PDSO')
    expect(replacementIsManual('PDSO')).toBe(true)
    expect(replacementIsManual(' pdso ')).toBe(true)
  })

  it('is false for other sources and for no source', () => {
    expect(replacementIsManual('BING')).toBe(false)
    expect(replacementIsManual('PDSO2')).toBe(false)
    expect(replacementIsManual(null)).toBe(false)
    expect(replacementIsManual(undefined)).toBe(false)
    expect(replacementIsManual('')).toBe(false)
  })
})

describe('autoReplacement', () => {
  it('is answered minus counted', () => {
    expect(autoReplacement(10, 7)).toBe(3)
  })

  it('clamps at zero', () => {
    expect(autoReplacement(5, 9)).toBe(0)
  })

  it('accepts numeric strings as the API sends decimals', () => {
    expect(autoReplacement('12', '4.5')).toBe(7.5)
  })

  it('treats non-numeric input as zero', () => {
    expect(autoReplacement('abc', 3)).toBe(0)
    expect(autoReplacement(4, 'x')).toBe(4)
  })
})

describe('effectiveCampaignReplacement', () => {
  it('auto-fills answered minus counted for ordinary sources, ignoring the stored value', () => {
    expect(effectiveCampaignReplacement({ source: 'BING', answered: 10, counted: 6, replacement: 99 })).toBe(4)
  })

  it('uses the stored value for excluded sources', () => {
    expect(effectiveCampaignReplacement({ source: 'pdso', answered: 10, counted: 6, replacement: 2 })).toBe(2)
  })

  it('reads a stored non-number as zero', () => {
    const r = { source: 'PDSO', answered: 10, counted: 6, replacement: Number.NaN }
    expect(effectiveCampaignReplacement(r)).toBe(0)
  })

  it('auto-fills when the source is missing', () => {
    expect(effectiveCampaignReplacement({ source: null, answered: 3, counted: 1, replacement: 0 })).toBe(2)
  })
})

describe('bundleCampaignRecords', () => {
  it('returns nothing for no records', () => {
    expect(bundleCampaignRecords([])).toEqual([])
  })

  it('merges typo variants of the same campaign and source into one summed row', () => {
    const rows = bundleCampaignRecords([
      record({ campaign_code: 'C-03', source: 'BING', answered: 10, missed: 1, counted: 8, total_bill: 80 }),
      record({ campaign_code: 'c03', source: 'bing', answered: 5, missed: 2, counted: 4, total_bill: 40 }),
      record({ campaign_code: 'C 03', source: 'Bing', answered: 1, missed: 0, counted: 0, total_bill: 0 }),
    ])
    expect(rows).toHaveLength(1)
    const [r] = rows
    expect(r.answered).toBe(16)
    expect(r.missed).toBe(3)
    expect(r.counted).toBe(12)
    expect(r.total_bill).toBe(120)
    expect(r.replacement).toBe(2 + 1 + 1)
    expect(r.rate).toBe(10)
    expect(r.count).toBe(3)
  })

  it('keeps different sources for the same campaign apart', () => {
    const rows = bundleCampaignRecords([
      record({ campaign_code: 'C-03', source: 'BING' }),
      record({ campaign_code: 'C-03', source: 'GOOGLE' }),
    ])
    expect(rows).toHaveLength(2)
  })

  it('does not collide when the campaign and source strings run into each other', () => {
    const rows = bundleCampaignRecords([
      record({ campaign_code: 'AB', source: 'C' }),
      record({ campaign_code: 'A', source: 'BC' }),
    ])
    expect(rows).toHaveLength(2)
  })

  it('shows the most-used raw spelling, breaking ties alphabetically', () => {
    const rows = bundleCampaignRecords([
      record({ campaign_code: 'c03', source: 'bing' }),
      record({ campaign_code: 'C-03', source: 'Bing' }),
      record({ campaign_code: 'C-03', source: 'bing' }),
    ])
    expect(rows[0].camp).toBe('C-03')
    expect(rows[0].source).toBe('bing')

    const tied = bundleCampaignRecords([
      record({ campaign_code: 'c03', source: 'BING' }),
      record({ campaign_code: 'C-03', source: 'Bing' }),
    ])
    expect(tied[0].camp).toBe('C-03')
    expect(tied[0].source).toBe('BING')
  })

  it('uses a dash placeholder for a missing campaign code or source', () => {
    const rows = bundleCampaignRecords([record({ campaign_code: null, source: null })])
    expect(rows[0].camp).toBe('—')
    expect(rows[0].source).toBe('—')
  })

  it('keeps the stored replacement for excluded sources and auto-fills the rest', () => {
    const rows = bundleCampaignRecords([
      record({ campaign_code: 'C-01', source: 'PDSO', answered: 10, counted: 2, replacement: 3 }),
      record({ campaign_code: 'C-01', source: 'pdso', answered: 10, counted: 2, replacement: 1 }),
      record({ campaign_code: 'C-02', source: 'BING', answered: 10, counted: 2, replacement: 50 }),
    ])
    const byCamp = new Map(rows.map((r) => [r.camp, r]))
    expect(byCamp.get('C-01')?.replacement).toBe(4)
    expect(byCamp.get('C-02')?.replacement).toBe(8)
  })

  it('sums numeric strings as numbers', () => {
    const loose = { answered: '3', missed: '1', counted: '2', total_bill: '10.5' } as unknown as Partial<CallRecord>
    const rows = bundleCampaignRecords([record(loose), record(loose)])
    expect(rows[0].answered).toBe(6)
    expect(rows[0].missed).toBe(2)
    expect(rows[0].total_bill).toBe(21)
    expect(rows[0].rate).toBe(5.25)
  })

  it('gives a zero rate when nothing was counted', () => {
    const rows = bundleCampaignRecords([record({ counted: 0, total_bill: 50 })])
    expect(rows[0].rate).toBe(0)
  })

  it('sorts by rate high to low, then by total bill', () => {
    const rows = bundleCampaignRecords([
      record({ campaign_code: 'C-01', counted: 10, total_bill: 50 }),
      record({ campaign_code: 'C-02', counted: 10, total_bill: 200 }),
      record({ campaign_code: 'C-03', counted: 2, total_bill: 10 }),
      record({ campaign_code: 'C-04', counted: 0, total_bill: 0 }),
    ])
    expect(rows.map((r) => r.camp)).toEqual(['C-02', 'C-01', 'C-03', 'C-04'])
  })

  it('does not modify the records passed in', () => {
    const input = [record({ campaign_code: 'c03', answered: 4, counted: 1, replacement: 0 })]
    const copy = structuredClone(input)
    bundleCampaignRecords(input)
    expect(input).toEqual(copy)
  })
})
