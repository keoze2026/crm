// Who is a month's top performer, and who is its lowest — app-wide.
//
// The Review page's Top Performer tab already decides both (lib/incentive.ts ranks the
// roster against the client's criteria and the manager's saved ticks). This carries that
// answer to every other page, so the two names are marked wherever a staff name is
// printed — the roster, the attendance sheets, Leaves, Salaries, Queues, the review
// sheets, the dashboards — instead of only on the tab that worked them out.
//
// Everything is MONTH-CONSTRAINED. A page that shows a month (the Review page, the Staff
// sheets, an attendance day or range, the Staff dashboard) wraps itself in a
// <PerformerScope month=…>, and every badge inside it speaks for THAT month — the May
// leaves sheet wears May's names, not last month's. A page with no month of its own (the
// sidebar, Users, Queues) falls back to the month a review is written about: the month
// BEFORE now, the one the Review page opens on. Each month is fetched once, on first use,
// and tolerated as optional — a viewer without the Staff or Review pages simply sees no
// badges rather than an error.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { currentMonth, formatMonth, shiftMonth } from '../components/MonthSelector'
import { cx } from '../components/ui'
import {
  INCENTIVE_USD,
  buildCandidates,
  fromWire,
  pickPerformers,
  rankCandidates,
  type RankedRow,
} from './incentive'
import { monthRange } from './staff'
import type { StaffMember } from '../types'

/** Green badge or red one. */
export type PerformerStatus = 'top' | 'low'

/** How a name is identified at the place it is printed — whatever that place happens to have. */
export interface PerformerRef {
  /** The staff roster id — the reliable one. */
  staffId?: number | null
  /** The attendance bot's user id, bridged through StaffMember.attendance_user_id. */
  userId?: string | null
  /** A last resort for the pages that carry only a printed name (attendance, the sidebar). */
  name?: string | null
}

/** One month's answer. */
export interface PerformerState {
  month: string
  monthLabel: string
  /** The ranked month, for anything that wants more than the badge. */
  rows: RankedRow[]
  top: RankedRow[]
  low: RankedRow[]
  incentive: number
  statusOf: (ref: PerformerRef) => PerformerStatus | null
  /** Re-read the month after the Top Performer sheet saves, so badges follow a tick. */
  reload: () => void
}

interface MonthData { staff: StaffMember[]; rows: RankedRow[] }

interface Store {
  /** Every month fetched so far, judged. */
  months: Record<string, PerformerState>
  /** Ask for a month; it is fetched once and kept. */
  want: (month: string) => void
  /** Re-read a month after its ticks change on the server. */
  reload: (month: string) => void
}

const StoreContext = createContext<Store | null>(null)
/** The month the badges inside a page speak for. */
const ScopeContext = createContext<string | null>(null)

const key = (name: string) => name.trim().toLowerCase()

/** The month a review is written about — the one every page without a month of its own uses. */
// eslint-disable-next-line react-refresh/only-export-components
export const defaultPerformerMonth = () => shiftMonth(currentMonth(), -1)

/** "YYYY-MM-DD" or "YYYY-MM" → "YYYY-MM"; anything else → null, so the scope falls back. */
const toMonth = (value: string | null | undefined): string | null =>
  value && /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : null

function judgeMonth(month: string, data: MonthData, reload: () => void): PerformerState {
  const { top, low } = pickPerformers(data.rows)
  const byId = new Map<number, PerformerStatus>()
  for (const r of low) byId.set(r.candidate.member.id, 'low')
  // Top wins any overlap, though the two can't both hold with a spread in play.
  for (const r of top) byId.set(r.candidate.member.id, 'top')
  // The attendance pages know people by the bot's user id, and a couple of places have
  // nothing but the printed name — both resolve through the roster.
  const byUser = new Map<string, PerformerStatus>()
  const byName = new Map<string, PerformerStatus>()
  for (const m of data.staff) {
    const status = byId.get(m.id)
    if (!status) continue
    if (m.attendance_user_id) byUser.set(m.attendance_user_id, status)
    if (m.name.trim()) byName.set(key(m.name), status)
  }
  return {
    month,
    monthLabel: formatMonth(month),
    rows: data.rows,
    top,
    low,
    incentive: INCENTIVE_USD,
    statusOf: ({ staffId, userId, name }: PerformerRef) =>
      (staffId != null ? byId.get(staffId) : undefined)
      ?? (userId ? byUser.get(userId) : undefined)
      ?? (name ? byName.get(key(name)) : undefined)
      ?? null,
    reload,
  }
}

/** A month nobody has fetched yet answers "nobody", so a badge simply doesn't render. */
const nobody = (month: string, reload: () => void): PerformerState =>
  judgeMonth(month, { staff: [], rows: [] }, reload)

export function PerformerProvider({ children }: { children: ReactNode }) {
  const { authEnabled, user, loading } = useAuth()
  // Nothing is fetched until auth has settled: on the login screen there is no session to
  // fetch with, and with auth disabled the app is ungated from the start.
  const ready = !loading && (!authEnabled || user !== null)
  const [data, setData] = useState<Record<string, MonthData>>({})
  // The months some scope has asked for — fetched once each, re-fetched on reload.
  const wanted = useRef(new Set<string>())

  const load = useCallback((month: string) => {
    const range = monthRange(month)
    Promise.all([
      api.staff().catch(() => [] as StaffMember[]),
      api.staffAttendance(range).catch(() => null),
      api.staffLeaves(range).catch(() => []),
      api.reviewEntries('performance', month).catch(() => []),
      api.reviewEntries('behaviour', month).catch(() => []),
      api.topPerformer(month).catch(() => null),
    ]).then(([staff, attendance, leaves, performance, behaviour, saved]) => {
      const { settings, ticks } = fromWire(saved)
      const candidates = buildCandidates(staff, attendance?.rows ?? [], leaves, performance, behaviour)
      setData((prev) => ({ ...prev, [month]: { staff, rows: rankCandidates(candidates, settings, ticks) } }))
    })
  }, [])

  // Stable: they land in the Top Performer sheet's autosave dependencies, and a fresh
  // identity each render would make that effect save, reload, and save again forever.
  const want = useCallback((month: string) => {
    if (wanted.current.has(month)) return
    wanted.current.add(month)
    if (ready) load(month)
  }, [ready, load])
  const reload = useCallback((month: string) => { if (ready) load(month) }, [ready, load])

  // Months asked for before auth settled are fetched the moment it does.
  useEffect(() => {
    if (!ready) return
    for (const m of wanted.current) load(m)
  }, [ready, load])

  // Every month is judged once when its data lands, not once per badge.
  const months = useMemo(() => {
    const out: Record<string, PerformerState> = {}
    for (const [month, d] of Object.entries(data)) out[month] = judgeMonth(month, d, () => reload(month))
    return out
  }, [data, reload])

  const store = useMemo<Store>(() => ({ months, want, reload }), [months, want, reload])
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

/**
 * The month the badges inside speak for. Pages hand it the month (or day) they are
 * showing; "YYYY-MM-DD" is fine. Null falls back to the month a review is written about.
 */
export function PerformerScope({ month, children }: { month: string | null | undefined; children: ReactNode }) {
  const resolved = toMonth(month) ?? defaultPerformerMonth()
  return <ScopeContext.Provider value={resolved}>{children}</ScopeContext.Provider>
}

/**
 * The month's answer for the scope the caller sits in (or the month given). Outside the
 * provider — a standalone screen, or a test mounting one component — it answers
 * "nobody", so a badge simply doesn't render rather than throwing.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function usePerformers(month?: string | null): PerformerState {
  const store = useContext(StoreContext)
  const scoped = useContext(ScopeContext)
  const resolved = toMonth(month) ?? scoped ?? defaultPerformerMonth()
  const want = store?.want
  useEffect(() => { want?.(resolved) }, [want, resolved])
  const reload = store?.reload
  const reloadThis = useCallback(() => reload?.(resolved), [reload, resolved])
  return store?.months[resolved] ?? nobody(resolved, reloadThis)
}

/** Tell the badges to re-read a month — for the sheet that changes its answer. */
// eslint-disable-next-line react-refresh/only-export-components
export function usePerformerReload(): (month: string) => void {
  const store = useContext(StoreContext)
  const reload = store?.reload
  return useCallback((month: string) => reload?.(month), [reload])
}

const IconCrown = ({ size = 10 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
    <path d="M3 8l4.4 3L12 5l4.6 6L21 8l-1.5 9.2a1 1 0 0 1-1 .8H5.5a1 1 0 0 1-1-.8L3 8z" />
  </svg>
)
const IconDown = ({ size = 10 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
    <path d="m19 14-7 7-7-7" /><path d="M12 21V3" />
  </svg>
)

/**
 * The badge itself: green with the incentive for the month's top performer, red for the
 * month's lowest. It renders nothing for everybody else, so it can be dropped beside any
 * name without a condition around it. The month is the enclosing PerformerScope's, or
 * the one passed.
 *
 * `compact` shortens the wording to the figure alone ("$200" / "Low", the whole sentence on
 * hover) for sheet cells where the full pill would push the columns about.
 */
export function PerformerBadge({ staffId, userId, name, month, compact = false, className }: PerformerRef & {
  month?: string | null
  compact?: boolean
  className?: string
}) {
  const { statusOf, monthLabel, incentive } = usePerformers(month)
  const status = statusOf({ staffId, userId, name })
  if (!status) return null
  const top = status === 'top'
  const title = top
    ? `Top Performer of the Month — ${monthLabel} · $${incentive} incentive`
    : `Lowest performer of the month — ${monthLabel}`
  const tone = top
    ? 'bg-emerald-100 text-emerald-700 ring-emerald-300'
    : 'bg-rose-100 text-rose-700 ring-rose-300'
  if (compact) {
    return (
      <span
        title={title}
        aria-label={title}
        className={cx('inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full px-1 py-px text-[9px] font-bold leading-none ring-1', tone, className)}
      >
        {top ? <IconCrown size={8} /> : <IconDown size={8} />}
        {top ? `$${incentive}` : 'Low'}
      </span>
    )
  }
  return (
    <span
      title={title}
      aria-label={title}
      className={cx(
        'inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ring-1',
        tone,
        className,
      )}
    >
      {top ? <IconCrown /> : <IconDown />}
      {top ? `$${incentive} incentive` : 'Low performer'}
    </span>
  )
}
