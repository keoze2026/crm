import { describe, expect, it } from 'vitest'
import { merge3, mergeDraft, same } from './merge'

describe('same', () => {
  it('ignores the order of map keys but not of list items', () => {
    expect(same({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(same([1, 2], [2, 1])).toBe(false)
    expect(same({ a: undefined }, {})).toBe(true)
  })
})

describe('merge3 — the whole-month sheets', () => {
  const base = {
    settings: { additional: ['goals'], min_performance: 80 },
    ticks: { '1': ['written'], '2': ['behaviour'] },
  }

  it('takes the server copy when nothing changed here', () => {
    const theirs = { ...base, ticks: { ...base.ticks, '3': ['login'] } }
    expect(merge3(base, base, theirs)).toEqual(theirs)
  })

  it('keeps this side when the server did not move', () => {
    const mine = { ...base, ticks: { ...base.ticks, '1': ['written', 'login'] } }
    expect(merge3(base, mine, base)).toEqual(mine)
  })

  it('keeps both managers\' ticks when they tick different people', () => {
    const mine = { ...base, ticks: { ...base.ticks, '1': ['written', 'login'] } }
    const theirs = { ...base, ticks: { ...base.ticks, '2': ['behaviour', 'feedback'] } }
    expect(merge3(base, mine, theirs).ticks).toEqual({ '1': ['written', 'login'], '2': ['behaviour', 'feedback'] })
  })

  it('merges ticks on the same person as sets: adds and removals from both sides', () => {
    const b = { ticks: { '1': ['a', 'b', 'c'] } }
    const mine = { ticks: { '1': ['a', 'c', 'd'] } }    // removed b, added d
    const theirs = { ticks: { '1': ['a', 'b', 'e'] } }  // removed c, added e
    expect(merge3(b, mine, theirs).ticks['1'].sort()).toEqual(['a', 'd', 'e'])
  })

  it('treats a person missing on one side as having no ticks', () => {
    const b = { ticks: { '1': ['a'] } }
    const mine = { ticks: {} as Record<string, string[]> }  // took Anna's only tick away
    const theirs = { ticks: { '1': ['a', 'b'] } }           // meanwhile somebody added one
    expect(merge3(b, mine, theirs).ticks).toEqual({ '1': ['b'] })
  })

  it('lets this side win a clash on the same scalar', () => {
    const mine = { ...base, settings: { ...base.settings, min_performance: 70 } }
    const theirs = { ...base, settings: { ...base.settings, min_performance: 90 } }
    expect(merge3(base, mine, theirs).settings.min_performance).toBe(70)
  })

  it('merges typed-over cells of the annual sheet cell by cell, and drops a cleared one', () => {
    const b = { overrides: { 's:1': { score: '80', note: 'x' } } }
    const mine = { overrides: { 's:1': { score: '85' } } }                       // edited score, cleared note
    const theirs = { overrides: { 's:1': { score: '80', note: 'x' }, 's:2': { score: '60' } } }
    expect(merge3(b, mine, theirs)).toEqual({ overrides: { 's:1': { score: '85' }, 's:2': { score: '60' } } })
  })

  it('keeps added rows from both sides', () => {
    const b = { extra_rows: [{ key: 'm:1', name: 'A' }] }
    const mine = { extra_rows: [{ key: 'm:1', name: 'A' }, { key: 'm:2', name: 'B' }] }
    const theirs = { extra_rows: [{ key: 'm:1', name: 'A' }, { key: 'm:3', name: 'C' }] }
    expect(merge3(b, mine, theirs).extra_rows.map((r) => r.key)).toEqual(['m:1', 'm:3', 'm:2'])
  })
})

describe('mergeDraft — one row being edited', () => {
  it('takes the server value when the draft was untouched', () => {
    expect(mergeDraft('Anna', 'Anna', 'Anna B')).toBe('Anna B')
  })

  it('keeps what is being typed', () => {
    expect(mergeDraft('Anna', 'Ann', 'Anna B')).toBe('Ann')
  })

  it('keeps only the edited fields of an object draft', () => {
    const base = { login: '09:00', logout: '17:00', note: '' }
    const draft = { ...base, note: 'dentist' }
    const server = { ...base, logout: '17:30' }
    expect(mergeDraft(base, draft, server)).toEqual({ login: '09:00', logout: '17:30', note: 'dentist' })
  })

  it('treats a list as one value, so a dragged order is kept whole', () => {
    expect(mergeDraft([1, 2, 3], [3, 1, 2], [1, 2, 3, 4])).toEqual([3, 1, 2])
    expect(mergeDraft([1, 2, 3], [1, 2, 3], [1, 2, 3, 4])).toEqual([1, 2, 3, 4])
  })
})
