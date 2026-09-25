import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { anchorTo, focusQuietly } from './popover'

const original = { innerWidth: window.innerWidth, scrollX: window.scrollX, scrollY: window.scrollY }

function setWindow(innerWidth: number, scrollX = 0, scrollY = 0) {
  Object.defineProperty(window, 'innerWidth', { value: innerWidth, configurable: true, writable: true })
  Object.defineProperty(window, 'scrollX', { value: scrollX, configurable: true, writable: true })
  Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true, writable: true })
}

function trigger(rect: { left: number; top: number; width: number; height: number }): HTMLElement {
  const el = document.createElement('button')
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    ...rect,
    x: rect.left,
    y: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => ({}),
  })
  return el
}

beforeEach(() => setWindow(1024))
afterEach(() => setWindow(original.innerWidth, original.scrollX, original.scrollY))

describe('anchorTo', () => {
  it('falls back to the origin with the full width when there is no trigger', () => {
    expect(anchorTo(null)).toEqual({ top: 0, left: 0, width: 280 })
    expect(anchorTo(null, 320)).toEqual({ top: 0, left: 0, width: 320 })
  })

  it('sits just under the trigger, left-aligned with it', () => {
    const el = trigger({ left: 100, top: 50, width: 80, height: 30 })
    expect(anchorTo(el)).toEqual({ top: 84, left: 100, width: 280 })
  })

  it('honours a custom width and gap', () => {
    const el = trigger({ left: 100, top: 50, width: 80, height: 30 })
    expect(anchorTo(el, 200, 10)).toEqual({ top: 90, left: 100, width: 200 })
  })

  it('adds the page scroll so the portal lands in page coordinates', () => {
    setWindow(1024, 15, 400)
    const el = trigger({ left: 100, top: 50, width: 80, height: 30 })
    expect(anchorTo(el)).toEqual({ top: 484, left: 115, width: 280 })
  })

  it('pulls a panel that would overflow the right edge back inside the margin', () => {
    const el = trigger({ left: 900, top: 0, width: 80, height: 20 })
    // 1024 - 8 margin - 280 width
    expect(anchorTo(el).left).toBe(736)
  })

  it('leaves a panel exactly touching the right margin where it is', () => {
    const el = trigger({ left: 736, top: 0, width: 80, height: 20 })
    expect(anchorTo(el).left).toBe(736)
  })

  it('never lets the panel start left of the margin', () => {
    const el = trigger({ left: -40, top: 0, width: 80, height: 20 })
    expect(anchorTo(el).left).toBe(8)
  })

  it('shrinks the panel to fit a narrow viewport', () => {
    setWindow(200)
    const el = trigger({ left: 50, top: 0, width: 80, height: 20 })
    expect(anchorTo(el)).toEqual({ top: 24, left: 8, width: 184 })
  })
})

describe('focusQuietly', () => {
  it('focuses without scrolling', () => {
    const el = document.createElement('input')
    const focus = vi.spyOn(el, 'focus')
    focusQuietly(el)
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('does nothing for a missing element', () => {
    expect(() => focusQuietly(null)).not.toThrow()
  })
})
