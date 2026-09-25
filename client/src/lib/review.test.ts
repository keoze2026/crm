import { describe, expect, it } from 'vitest'
import { asPercent, BEHAVIOUR_RATINGS, NUMERIC, PERFORMANCE_RATINGS } from './review'

describe('rating vocabularies', () => {
  it('lists the performance ratings best to worst', () => {
    expect(PERFORMANCE_RATINGS).toEqual(['Excellent', 'Good', 'Average', 'Below Average', 'Poor'])
  })

  it('ends the behaviour ratings with Low Performer and has no repeats', () => {
    expect(BEHAVIOUR_RATINGS.at(-1)).toBe('Low Performer')
    expect(new Set(BEHAVIOUR_RATINGS).size).toBe(BEHAVIOUR_RATINGS.length)
  })
})

describe('asPercent', () => {
  it('is blank when not scored', () => {
    expect(asPercent(null)).toBe('')
  })

  it('shows whole numbers without a decimal', () => {
    expect(asPercent(85)).toBe('85%')
    expect(asPercent(0)).toBe('0%')
    expect(asPercent(100)).toBe('100%')
  })

  it('shows fractions to one decimal place', () => {
    expect(asPercent(85.5)).toBe('85.5%')
    expect(asPercent(12.34)).toBe('12.3%')
    expect(asPercent(12.36)).toBe('12.4%')
  })

  it('keeps a negative sign', () => {
    expect(asPercent(-5)).toBe('-5%')
  })
})

describe('NUMERIC', () => {
  it.each(['', '0', '85', '85.5', '.5', '5.', '100.25'])('accepts %j', (v) => {
    expect(NUMERIC.test(v)).toBe(true)
  })

  it.each(['-5', '85..5', '1.2.3', 'abc', '8a', ' 85', '85%', '1,000'])('rejects %j', (v) => {
    expect(NUMERIC.test(v)).toBe(false)
  })
})
