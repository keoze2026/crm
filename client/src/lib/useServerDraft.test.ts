import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useServerDraft } from './useServerDraft'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function renderDraft<T>(initial: T) {
  const result = { current: undefined as unknown as ReturnType<typeof useServerDraft<T>> }
  const root = createRoot(document.createElement('div'))
  function Probe({ server }: { server: T }) {
    result.current = useServerDraft(server)
    return null
  }
  const rerender = (server: T) => { act(() => { root.render(createElement(Probe, { server })) }) }
  rerender(initial)
  return { result, rerender }
}

describe('useServerDraft', () => {
  it('starts from the server value', () => {
    const { result } = renderDraft('Anna')
    expect(result.current[0]).toBe('Anna')
  })

  it('follows the server while nobody is editing', () => {
    const { result, rerender } = renderDraft('Anna')
    rerender('Anna B')
    expect(result.current[0]).toBe('Anna B')
  })

  it('keeps a half-typed edit through a live update', () => {
    const { result, rerender } = renderDraft('Anna')
    act(() => { result.current[1]('Ann') })
    rerender('Anna B')
    expect(result.current[0]).toBe('Ann')
  })

  it('takes the other fields of a row from the server, keeping the one being typed', () => {
    const { result, rerender } = renderDraft({ reason: '', status: 'held' })
    act(() => { result.current[1]((d) => ({ ...d, reason: 'Missing timesheet' })) })
    rerender({ reason: '', status: 'released' })
    expect(result.current[0]).toEqual({ reason: 'Missing timesheet', status: 'released' })
  })

  it('follows the server again once the edit has been saved', () => {
    const { result, rerender } = renderDraft('Anna')
    act(() => { result.current[1]('Ann') })
    rerender('Ann')          // our own save comes back
    rerender('Anne')         // then somebody else renames her
    expect(result.current[0]).toBe('Anne')
  })

  it('ignores a re-render with an equal value', () => {
    const { result, rerender } = renderDraft({ a: 1 })
    act(() => { result.current[1]({ a: 2 }) })
    rerender({ a: 1 })
    expect(result.current[0]).toEqual({ a: 2 })
  })
})
