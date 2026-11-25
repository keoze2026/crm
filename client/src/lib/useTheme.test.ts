import { beforeEach, describe, expect, it } from 'vitest'
import { THEME_KEY, applyTheme, readTheme, storeTheme } from './useTheme'

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('light')
  })

  it('is dark until a light choice is stored', () => {
    expect(readTheme()).toBe('dark')
    localStorage.setItem(THEME_KEY, 'nonsense')
    expect(readTheme()).toBe('dark')
    localStorage.setItem(THEME_KEY, 'light')
    expect(readTheme()).toBe('light')
  })

  it('remembers the choice', () => {
    storeTheme('light')
    expect(readTheme()).toBe('light')
    storeTheme('dark')
    expect(readTheme()).toBe('dark')
  })

  it('puts the light class on <html> and takes it off again', () => {
    applyTheme('light')
    expect(document.documentElement.classList.contains('light')).toBe(true)
    applyTheme('dark')
    expect(document.documentElement.classList.contains('light')).toBe(false)
  })
})
