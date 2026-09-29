import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangeSnapshot } from '../api/client'

// The poller keeps module state (one per tab), so every test imports a fresh copy.
const m = vi.hoisted(() => ({
  changes: vi.fn<() => Promise<ChangeSnapshot>>(),
  writeListener: null as ((phase: 'start' | 'end', ok: boolean) => void) | null,
}))
vi.mock('../api/client', () => ({
  api: { changes: m.changes },
  setWriteListener: (fn: typeof m.writeListener) => { m.writeListener = fn },
}))

const snap = (versions: Record<string, number>, bot: string | null = 'b0', tracking = true): ChangeSnapshot =>
  ({ tracking, versions, bot })

async function load() {
  vi.resetModules()
  return import('./live')
}

beforeEach(() => {
  vi.useFakeTimers()
  m.changes.mockReset()
  document.body.innerHTML = ''
})
afterEach(() => {
  vi.useRealTimers()
})

describe('areasOf', () => {
  it('maps a GET path to the areas its answer depends on', async () => {
    const { areasOf } = await load()
    expect(areasOf('/staff-leaves?from=2026-09-01&to=2026-09-30')).toEqual(['staff'])
    expect(areasOf('/analytics/summary?from=x')).toEqual(['calls'])
    expect(areasOf('/attendance/live')).toEqual(['attendance', 'bot', 'staff'])
    expect(areasOf('/auth/me')).toEqual([])
    // Unknown surfaces read everything: too eager, never stale.
    expect(areasOf('/something-new')).toEqual(['*'])
  })
})

describe('the poller', () => {
  it('tells only the subscribers whose area moved', async () => {
    const { subscribe } = await load()
    m.changes.mockResolvedValueOnce(snap({ calls: 1, queues: 1 }))
    m.changes.mockResolvedValueOnce(snap({ calls: 1, queues: 2 }))
    const calls = vi.fn()
    const queues = vi.fn()
    const stopA = subscribe(['calls'], calls)
    const stopB = subscribe(['queues', 'staff'], queues)

    await vi.advanceTimersByTimeAsync(0)       // first poll: the baseline, nobody is told
    expect(queues).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5_000)   // second poll: queues moved
    expect(queues).toHaveBeenCalledTimes(1)
    expect(calls).not.toHaveBeenCalled()
    stopA(); stopB()
  })

  it('treats a new bot fingerprint as an attendance change', async () => {
    const { subscribe } = await load()
    m.changes.mockResolvedValueOnce(snap({}, 'b0'))
    m.changes.mockResolvedValueOnce(snap({}, 'b1'))
    const fire = vi.fn()
    const stop = subscribe(['attendance', 'bot'], fire)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fire).toHaveBeenCalledTimes(1)
    stop()
  })

  it('holds a reload back while somebody is typing, and lets it through when they leave the field', async () => {
    const { subscribe } = await load()
    m.changes.mockResolvedValueOnce(snap({ staff: 1 }))
    m.changes.mockResolvedValue(snap({ staff: 2 }))
    const input = document.createElement('input')
    document.body.appendChild(input)
    const fire = vi.fn()
    const stop = subscribe(['staff'], fire)
    await vi.advanceTimersByTimeAsync(0)

    input.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fire).not.toHaveBeenCalled()

    input.blur()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fire).toHaveBeenCalledTimes(1)
    stop()
  })

  it('lets a reload through a field left focused but idle', async () => {
    const { subscribe } = await load()
    m.changes.mockResolvedValueOnce(snap({ staff: 1 }))
    m.changes.mockResolvedValue(snap({ staff: 2 }))
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    const fire = vi.fn()
    const stop = subscribe(['staff'], fire)
    await vi.advanceTimersByTimeAsync(0)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fire).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(fire).toHaveBeenCalledTimes(1)
    stop()
  })

  it('waits for a save in flight to settle', async () => {
    const { subscribe } = await load()
    m.changes.mockResolvedValueOnce(snap({ reviews: 1 }))
    m.changes.mockResolvedValue(snap({ reviews: 2 }))
    const fire = vi.fn()
    const stop = subscribe(['reviews'], fire)
    await vi.advanceTimersByTimeAsync(0)

    m.writeListener?.('start', false)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(fire).not.toHaveBeenCalled()
    m.writeListener?.('end', true)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(fire).toHaveBeenCalledTimes(1)
    stop()
  })

  it('re-reads everything on a timer until the server can count changes', async () => {
    const { subscribe } = await load()
    m.changes.mockResolvedValue(snap({}, null, false))
    const fire = vi.fn()
    const stop = subscribe(['calls'], fire)
    await vi.advanceTimersByTimeAsync(25_000)
    expect(fire).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fire).toHaveBeenCalledTimes(1)
    stop()
  })

  it('does not reload into an expired session', async () => {
    const { subscribe } = await load()
    m.changes.mockRejectedValue(Object.assign(new Error('Unauthenticated'), { status: 401 }))
    const fire = vi.fn()
    const stop = subscribe(['calls'], fire)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fire).not.toHaveBeenCalled()
    stop()
  })
})
