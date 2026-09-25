import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useOrgToday } from './useOrgToday'

// No testing-library dependency: the hook is
// mounted with a minimal renderHook over react-dom directly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function renderHook<R>(hook: () => R) {
  const result = { current: undefined as unknown as R }
  const root = createRoot(document.createElement('div'))
  function Probe() {
    result.current = hook()
    return null
  }
  act(() => { root.render(createElement(Probe)) })
  return { result, unmount: () => { act(() => { root.unmount() }) } }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useOrgToday', () => {
  it('answers with the New York date, not the UTC one', () => {
    // 02:30 UTC on the 24th is still 22:30 on the 23rd in New York (EDT).
    vi.setSystemTime(new Date('2026-09-24T02:30:00Z'))
    const { result } = renderHook(() => useOrgToday())
    expect(result.current).toBe('2026-09-23')
  })

  it('rolls over at New York midnight on the next minute tick', () => {
    vi.setSystemTime(new Date('2026-09-24T03:59:30Z'))
    const { result } = renderHook(() => useOrgToday())
    expect(result.current).toBe('2026-09-23')

    act(() => { vi.advanceTimersByTime(60_000) })
    expect(result.current).toBe('2026-09-24')
  })

  it('catches up after the machine sleeps through midnight', () => {
    vi.setSystemTime(new Date('2026-09-23T20:00:00Z'))
    const { result } = renderHook(() => useOrgToday())
    expect(result.current).toBe('2026-09-23')

    // The clock jumps two days without any timer firing, then one tick arrives.
    vi.setSystemTime(new Date('2026-09-25T15:00:00Z'))
    expect(result.current).toBe('2026-09-23')
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(result.current).toBe('2026-09-25')
  })

  it('does not re-render on ticks within the same day', () => {
    vi.setSystemTime(new Date('2026-09-23T14:00:00Z'))
    let renders = 0
    renderHook(() => { renders += 1; return useOrgToday() })
    const initial = renders
    act(() => { vi.advanceTimersByTime(10 * 60_000) })
    expect(renders).toBe(initial)
  })

  it('clears its interval on unmount', () => {
    vi.setSystemTime(new Date('2026-09-23T14:00:00Z'))
    const { unmount } = renderHook(() => useOrgToday())
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
