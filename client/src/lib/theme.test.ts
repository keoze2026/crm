import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BRAND, BRAND_DARK } from './theme'

describe('theme', () => {
  it('exports the brand colours as six-digit hex', () => {
    expect(BRAND).toMatch(/^#[0-9a-f]{6}$/i)
    expect(BRAND_DARK).toMatch(/^#[0-9a-f]{6}$/i)
    expect(BRAND_DARK).not.toBe(BRAND)
  })

  it('stays in step with the CSS tokens in index.css', () => {
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8')
    const token = (name: string) =>
      css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase()
    expect(token('color-brand')).toBe(BRAND.toLowerCase())
    expect(token('color-brand-dark')).toBe(BRAND_DARK.toLowerCase())
  })
})
