import { describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useAsync } from './useAsync'

// No testing-library dependency: hooks are
// mounted with a minimal renderHook over react-dom directly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function renderHook<R, P = undefined>(hook: (props: P) => R, opts: { initialProps?: P } = {}) {
  const result = { current: undefined as unknown as R }
  const root = createRoot(document.createElement('div'))
  function Probe({ props }: { props: P }) {
    result.current = hook(props)
    return null
  }
  const rerender = (props: P) => { act(() => { root.render(createElement(Probe, { props })) }) }
  rerender(opts.initialProps as P)
  return { result, rerender, unmount: () => { act(() => { root.unmount() }) } }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: Error) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** A fetcher whose every call hands back a promise the test settles by hand. */
function controlled<T>() {
  const calls: Deferred<T>[] = []
  const fn = vi.fn(() => {
    const d = deferred<T>()
    calls.push(d)
    return d.promise
  })
  return { fn, calls }
}

describe('useAsync', () => {
  it('starts loading, then exposes the resolved data', async () => {
    const { fn, calls } = controlled<string>()
    const { result } = renderHook(() => useAsync(fn, []))
    expect(result.current).toMatchObject({ data: null, loading: true, refreshing: false, error: null })

    await act(async () => { calls[0].resolve('hello') })
    expect(result.current).toMatchObject({ data: 'hello', loading: false, refreshing: false, error: null })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('surfaces a rejection as the error message', async () => {
    const { fn, calls } = controlled<string>()
    const { result } = renderHook(() => useAsync(fn, []))
    await act(async () => { calls[0].reject(new Error('Request failed (500)')) })
    expect(result.current).toMatchObject({ data: null, loading: false, refreshing: false, error: 'Request failed (500)' })
  })

  it('refreshes in the background on a dep change, keeping the old data on screen', async () => {
    const { fn, calls } = controlled<string>()
    const { result, rerender } = renderHook(({ month }) => useAsync(() => fn(), [month]), { initialProps: { month: '2026-08' } })
    await act(async () => { calls[0].resolve('august') })

    rerender({ month: '2026-09' })
    expect(result.current).toMatchObject({ data: 'august', loading: false, refreshing: true })

    await act(async () => { calls[1].resolve('september') })
    expect(result.current).toMatchObject({ data: 'september', loading: false, refreshing: false })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does not refetch when the deps are unchanged', async () => {
    const { fn, calls } = controlled<number>()
    const { rerender } = renderHook(({ id }) => useAsync(() => fn(), [id]), { initialProps: { id: 1 } })
    await act(async () => { calls[0].resolve(1) })
    rerender({ id: 1 })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('reload() runs the function again as a background refresh, with a stable identity', async () => {
    const { fn, calls } = controlled<number>()
    const { result } = renderHook(() => useAsync(fn, []))
    await act(async () => { calls[0].resolve(1) })

    const reload = result.current.reload
    act(() => result.current.reload())
    expect(fn).toHaveBeenCalledTimes(2)
    expect(result.current).toMatchObject({ data: 1, refreshing: true, loading: false })
    expect(result.current.reload).toBe(reload)

    await act(async () => { calls[1].resolve(2) })
    expect(result.current).toMatchObject({ data: 2, refreshing: false })
  })

  it('ignores a response that lands after the deps have moved on', async () => {
    const { fn, calls } = controlled<string>()
    const { result, rerender } = renderHook(({ q }) => useAsync(() => fn(), [q]), { initialProps: { q: 'a' } })
    rerender({ q: 'b' })
    await act(async () => { calls[1].resolve('b') })
    await act(async () => { calls[0].resolve('a') })
    expect(result.current).toMatchObject({ data: 'b', loading: false, refreshing: false })
  })

  it('ignores a stale rejection', async () => {
    const { fn, calls } = controlled<string>()
    const { result, rerender } = renderHook(({ q }) => useAsync(() => fn(), [q]), { initialProps: { q: 'a' } })
    rerender({ q: 'b' })
    await act(async () => { calls[0].reject(new Error('stale')) })
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(true)
    await act(async () => { calls[1].resolve('b') })
    expect(result.current).toMatchObject({ data: 'b', error: null, loading: false })
  })

  it('keeps the last good data when a refresh fails, and clears the error on the next run', async () => {
    const { fn, calls } = controlled<string>()
    const { result } = renderHook(() => useAsync(fn, []))
    await act(async () => { calls[0].resolve('ok') })

    act(() => result.current.reload())
    await act(async () => { calls[1].reject(new Error('boom')) })
    expect(result.current).toMatchObject({ data: 'ok', error: 'boom', refreshing: false, loading: false })

    act(() => result.current.reload())
    expect(result.current.error).toBeNull()
    await act(async () => { calls[2].resolve('again') })
    expect(result.current).toMatchObject({ data: 'again', error: null })
  })

  it('shows the blocking spinner again after a failed first load', async () => {
    const { fn, calls } = controlled<string>()
    const { result } = renderHook(() => useAsync(fn, []))
    await act(async () => { calls[0].reject(new Error('down')) })

    act(() => result.current.reload())
    expect(result.current).toMatchObject({ loading: true, refreshing: false, error: null })
    await act(async () => { calls[1].resolve('up') })
    expect(result.current).toMatchObject({ data: 'up', loading: false })
  })

  it('does not update state after unmount', async () => {
    const { fn, calls } = controlled<string>()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, unmount } = renderHook(() => useAsync(fn, []))
    unmount()
    await act(async () => { calls[0].resolve('late') })
    expect(result.current.data).toBeNull()
    expect(errors).not.toHaveBeenCalled()
  })

  it('works with an already-resolved promise', async () => {
    const { result } = renderHook(() => useAsync(() => Promise.resolve([1, 2]), []))
    await act(async () => {})
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toEqual([1, 2])
  })
})
