import { useCallback, useEffect, useState } from 'react'

/**
 * Dark or light, app-wide. The choice is kept in localStorage and applied as the `light`
 * class on <html>; index.css restyles every surface under it (see "Light theme" there),
 * and index.html applies the stored choice before the first paint so a light session
 * never flashes dark. Dark is the design's native theme and the default.
 */

export type Theme = 'dark' | 'light'

export const THEME_KEY = 'keoze-theme'

/** The stored choice; dark when nothing (or anything unexpected) is stored. */
export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Private mode or a full store: the page still switches, it just won't remember.
  }
}

/** Puts the theme on <html>, where the stylesheet reads it. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('light', theme === 'light')
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(readTheme)
  useEffect(() => { applyTheme(theme) }, [theme])
  const setTheme = useCallback((next: Theme) => {
    storeTheme(next)
    setThemeState(next)
  }, [])
  return [theme, setTheme]
}
