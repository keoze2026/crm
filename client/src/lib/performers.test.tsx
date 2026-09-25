import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cloneElement, useEffect, type ReactElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { StaffMember, TopPerformerState } from '../types'
import type { Candidate, RankedRow } from './incentive'
import {
  PerformerBadge,
  PerformerProvider,
  PerformerScope,
  defaultPerformerMonth,
  usePerformerReload,
  usePerformers,
  type PerformerState,
} from './performers'

const m = vi.hoisted(() => ({
  auth: { authEnabled: true, user: { id: 1 } as unknown, loading: false },
  api: {
    staff: vi.fn(),
    staffAttendance: vi.fn(),
    staffLeaves: vi.fn(),
    reviewEntries: vi.fn(),
    topPerformer: vi.fn(),
  },
  buildCandidates: vi.fn(),
  rankCandidates: vi.fn(),
}))

vi.mock('../api/client', () => ({ api: m.api }))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => m.auth }))
vi.mock('./incentive', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./incentive')>()),
  buildCandidates: m.buildCandidates,
  rankCandidates: m.rankCandidates,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const stamps = { created_at: '', updated_at: '' }
const member = (id: number, name: string, userId: string | null = null): StaffMember => ({
  id, name, departments: [], attendance_user_id: userId, status: 'active',
  expected_login: null, expected_logout: null, sort_order: id, ...stamps,
})
const roster = [member(1, 'Anna', 'u-anna'), member(2, 'Ben', 'u-ben'), member(3, '  Cy Low ', 'u-cy')]
/** Criteria met out of 8, by staff id: Anna tops at 100%, Cy sits lowest at 25%. */
const score: Record<number, number> = { 1: 8, 2: 6, 3: 2 }

let root: Root | null = null
let container: HTMLDivElement

function mount(node: ReactNode) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root?.render(node) })
}

const rerender = (node: ReactNode) => { act(() => { root?.render(node) }) }

/** Mounts the way the app does: under an AuthProvider that is still loading, which then settles. */
function mountSettled(node: ReactElement) {
  const settled = m.auth
  m.auth = { ...settled, loading: true }
  mount(node)
  m.auth = settled
  rerender(cloneElement(node))
}

const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }

/** Captures the latest value a hook returned inside the tree. */
function Probe({ month, intoRef }: { month?: string | null; intoRef: { current: PerformerState | null } }) {
  const state = usePerformers(month)
  useEffect(() => { intoRef.current = state })
  return null
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-15T12:00:00'))
  m.auth = { authEnabled: true, user: { id: 1 }, loading: false }
  m.api.staff.mockResolvedValue(roster)
  m.api.staffAttendance.mockResolvedValue({ timezone: 'America/New_York', from: '', to: '', fetched: true, rows: [{ staff_id: 1 }] })
  m.api.staffLeaves.mockResolvedValue([{ id: 9 }])
  m.api.reviewEntries.mockImplementation(async (kind: string) => [{ id: kind === 'performance' ? 1 : 2 }])
  m.api.topPerformer.mockResolvedValue(null)
  m.buildCandidates.mockImplementation((staff: StaffMember[]) => staff.map((s) => ({ member: s }) as Candidate))
  m.rankCandidates.mockImplementation((candidates: Candidate[]) => candidates.map((candidate, i): RankedRow => {
    const met = score[candidate.member.id] ?? 0
    return { candidate, verdicts: {} as RankedRow['verdicts'], met, total: 8, allMet: met === 8, rank: i + 1 }
  }))
})

afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  container?.remove()
  vi.useRealTimers()
})

describe('defaultPerformerMonth', () => {
  it('is the month before now — the month a review is written about', () => {
    expect(defaultPerformerMonth()).toBe('2026-08')
    vi.setSystemTime(new Date('2026-01-10T12:00:00'))
    expect(defaultPerformerMonth()).toBe('2025-12')
  })
})

describe('usePerformers outside the provider', () => {
  it('answers "nobody" for the default month without fetching', () => {
    const out = { current: null as PerformerState | null }
    mount(<Probe intoRef={out} />)
    expect(out.current).toMatchObject({ month: '2026-08', monthLabel: 'August 2026', rows: [], top: [], low: [], incentive: 200 })
    expect(out.current?.statusOf({ staffId: 1, userId: 'u-anna', name: 'Anna' })).toBeNull()
    expect(() => out.current?.reload()).not.toThrow()
    expect(m.api.staff).not.toHaveBeenCalled()
  })

  it('narrows a date to its month and ignores a malformed one', () => {
    const out = { current: null as PerformerState | null }
    mount(<Probe month="2026-05-20" intoRef={out} />)
    expect(out.current?.month).toBe('2026-05')
    rerender(<Probe month="soon" intoRef={out} />)
    expect(out.current?.month).toBe('2026-08')
  })
})

describe('PerformerProvider', () => {
  it('fetches the month once and marks its top and lowest performers', async () => {
    const out = { current: null as PerformerState | null }
    mountSettled(<PerformerProvider><Probe month="2026-08" intoRef={out} /></PerformerProvider>)
    await flush()

    expect(m.api.staffAttendance).toHaveBeenCalledWith({ from: '2026-08-01', to: '2026-08-31' })
    expect(m.api.staffLeaves).toHaveBeenCalledWith({ from: '2026-08-01', to: '2026-08-31' })
    expect(m.api.reviewEntries).toHaveBeenCalledWith('performance', '2026-08')
    expect(m.api.reviewEntries).toHaveBeenCalledWith('behaviour', '2026-08')
    expect(m.api.topPerformer).toHaveBeenCalledWith('2026-08')
    expect(m.buildCandidates).toHaveBeenCalledWith(roster, [{ staff_id: 1 }], [{ id: 9 }], [{ id: 1 }], [{ id: 2 }])

    const s = out.current as PerformerState
    expect(s.month).toBe('2026-08')
    expect(s.rows).toHaveLength(3)
    expect(s.top.map((r) => r.candidate.member.name)).toEqual(['Anna'])
    expect(s.low.map((r) => r.candidate.member.id)).toEqual([3])
  })

  it('resolves a name by staff id, then bot user id, then printed name', async () => {
    const out = { current: null as PerformerState | null }
    mountSettled(<PerformerProvider><Probe month="2026-08" intoRef={out} /></PerformerProvider>)
    await flush()
    const { statusOf } = out.current as PerformerState

    expect(statusOf({ staffId: 1 })).toBe('top')
    expect(statusOf({ staffId: 3 })).toBe('low')
    expect(statusOf({ staffId: 2 })).toBeNull()
    expect(statusOf({ userId: 'u-anna' })).toBe('top')
    expect(statusOf({ userId: 'u-cy' })).toBe('low')
    expect(statusOf({ name: ' anna ' })).toBe('top')
    expect(statusOf({ name: 'CY LOW' })).toBe('low')
    expect(statusOf({ name: 'Nobody' })).toBeNull()
    expect(statusOf({})).toBeNull()
    // An id that carries no badge falls through to the other keys.
    expect(statusOf({ staffId: 2, name: 'Anna' })).toBe('top')
    expect(statusOf({ staffId: 99, userId: 'u-cy' })).toBe('low')
  })

  it('passes the saved settings and ticks through to the ranking', async () => {
    const saved: TopPerformerState = {
      month: '2026-08-01', settings: { additional: ['learning'], min_performance: 70 }, ticks: { 1: ['documentation'] },
    }
    m.api.topPerformer.mockResolvedValue(saved)
    mountSettled(<PerformerProvider><Probe month="2026-08" intoRef={{ current: null }} /></PerformerProvider>)
    await flush()
    expect(m.rankCandidates).toHaveBeenCalledWith(
      expect.any(Array),
      { additional: ['learning'], minPerformance: 70 },
      { 1: ['documentation'] },
    )
  })

  it('tolerates every source failing and judges an empty month', async () => {
    for (const fn of Object.values(m.api)) fn.mockRejectedValue(new Error('403'))
    const out = { current: null as PerformerState | null }
    mountSettled(<PerformerProvider><Probe month="2026-08" intoRef={out} /></PerformerProvider>)
    await flush()
    expect(m.buildCandidates).toHaveBeenCalledWith([], [], [], [], [])
    expect(out.current).toMatchObject({ month: '2026-08', rows: [], top: [], low: [] })
  })

  it('fetches a month once however many badges ask for it', async () => {
    mountSettled(
      <PerformerProvider>
        <Probe month="2026-08" intoRef={{ current: null }} />
        <Probe month="2026-08-14" intoRef={{ current: null }} />
        <Probe month="2026-07" intoRef={{ current: null }} />
      </PerformerProvider>,
    )
    await flush()
    expect(m.api.topPerformer).toHaveBeenCalledTimes(2)
    expect(m.api.topPerformer.mock.calls.map(([month]) => month)).toEqual(['2026-08', '2026-07'])
  })

  it('waits for auth to settle before fetching, then fetches what was asked for', async () => {
    m.auth = { authEnabled: true, user: null, loading: true }
    const out = { current: null as PerformerState | null }
    const tree = () => <PerformerProvider><Probe month="2026-08" intoRef={out} /></PerformerProvider>
    mount(tree())
    await flush()
    expect(m.api.staff).not.toHaveBeenCalled()
    expect(out.current?.top).toEqual([])

    m.auth = { authEnabled: true, user: null, loading: false }
    rerender(tree())
    await flush()
    expect(m.api.staff).not.toHaveBeenCalled()

    m.auth = { authEnabled: true, user: { id: 1 }, loading: false }
    rerender(tree())
    await flush()
    expect(m.api.staff).toHaveBeenCalledTimes(1)
    expect(out.current?.top).toHaveLength(1)
  })

  it('fetches without a signed-in user when auth is disabled', async () => {
    m.auth = { authEnabled: false, user: null, loading: false }
    mountSettled(<PerformerProvider><Probe month="2026-08" intoRef={{ current: null }} /></PerformerProvider>)
    await flush()
    expect(m.api.staff).toHaveBeenCalledTimes(1)
  })

  it('fetches a month first asked for after auth has settled, once', async () => {
    const later = { current: null as PerformerState | null }
    mountSettled(<PerformerProvider><Probe month="2026-08" intoRef={{ current: null }} /></PerformerProvider>)
    await flush()
    rerender(
      <PerformerProvider>
        <Probe month="2026-08" intoRef={{ current: null }} />
        <Probe month="2026-05" intoRef={later} />
      </PerformerProvider>,
    )
    await flush()
    expect(m.api.topPerformer.mock.calls.map(([month]) => month)).toEqual(['2026-08', '2026-05'])
    expect(later.current?.top).toHaveLength(1)
  })

  it('re-reads a month on reload, from the state or from usePerformerReload', async () => {
    const out = { current: null as PerformerState | null }
    const reloaderRef = { current: null as ((month: string) => void) | null }
    function Reloader() {
      const reload = usePerformerReload()
      useEffect(() => { reloaderRef.current = reload })
      return null
    }
    mountSettled(<PerformerProvider><Probe month="2026-08" intoRef={out} /><Reloader /></PerformerProvider>)
    await flush()
    expect(m.api.topPerformer).toHaveBeenCalledTimes(1)

    score[2] = 8
    act(() => { out.current?.reload() })
    await flush()
    expect(m.api.topPerformer).toHaveBeenCalledTimes(2)
    expect(out.current?.top.map((r) => r.candidate.member.id)).toEqual([1, 2])

    act(() => { reloaderRef.current?.('2026-08') })
    await flush()
    expect(m.api.topPerformer).toHaveBeenCalledTimes(3)
    score[2] = 6
  })
})

describe('usePerformerReload outside the provider', () => {
  it('is a harmless no-op', () => {
    const reloaderRef = { current: null as ((month: string) => void) | null }
    function Reloader() {
      const reload = usePerformerReload()
      useEffect(() => { reloaderRef.current = reload })
      return null
    }
    mount(<Reloader />)
    expect(() => reloaderRef.current?.('2026-08')).not.toThrow()
  })
})

describe('PerformerScope', () => {
  it('scopes the badges inside to the month (or day) it is given', async () => {
    const out = { current: null as PerformerState | null }
    mountSettled(<PerformerProvider><PerformerScope month="2026-06-03"><Probe intoRef={out} /></PerformerScope></PerformerProvider>)
    await flush()
    expect(out.current?.month).toBe('2026-06')
    expect(m.api.topPerformer).toHaveBeenCalledWith('2026-06')
  })

  it('falls back to the review month for a missing month, and yields to an explicit one', () => {
    const scoped = { current: null as PerformerState | null }
    const explicit = { current: null as PerformerState | null }
    mount(
      <PerformerScope month={null}>
        <Probe intoRef={scoped} />
        <Probe month="2026-02" intoRef={explicit} />
      </PerformerScope>,
    )
    expect(scoped.current?.month).toBe('2026-08')
    expect(explicit.current?.month).toBe('2026-02')
  })
})

describe('PerformerBadge', () => {
  async function badge(props: Parameters<typeof PerformerBadge>[0]) {
    mountSettled(<PerformerProvider><PerformerScope month="2026-08"><PerformerBadge {...props} /></PerformerScope></PerformerProvider>)
    await flush()
    return container.querySelector('span')
  }

  it('shows the incentive for the top performer', async () => {
    const el = await badge({ staffId: 1 })
    expect(el?.textContent).toBe('$200 incentive')
    expect(el?.getAttribute('title')).toBe('Top Performer of the Month — August 2026 · $200 incentive')
    expect(el?.className).toContain('bg-emerald-100')
  })

  it('marks the lowest performer in red', async () => {
    const el = await badge({ name: 'cy low', className: 'ml-1' })
    expect(el?.textContent).toBe('Low performer')
    expect(el?.getAttribute('aria-label')).toBe('Lowest performer of the month — August 2026')
    expect(el?.className).toContain('bg-rose-100')
    expect(el?.className).toContain('ml-1')
  })

  it('shortens to the figure alone when compact', async () => {
    expect((await badge({ userId: 'u-anna', compact: true }))?.textContent).toBe('$200')
    act(() => { root?.unmount() })
    root = null
    container.remove()
    expect((await badge({ staffId: 3, compact: true }))?.textContent).toBe('Low')
  })

  it('renders nothing for everybody else', async () => {
    expect(await badge({ staffId: 2 })).toBeNull()
    expect(container.innerHTML).toBe('')
  })

  it('speaks for the month passed rather than the scope', async () => {
    await badge({ staffId: 1, month: '2026-03' })
    expect(m.api.topPerformer).toHaveBeenCalledWith('2026-03')
    expect(container.querySelector('span')?.getAttribute('title')).toContain('March 2026')
  })
})
