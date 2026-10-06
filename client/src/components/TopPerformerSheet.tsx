// Top Performer of the Month — the Staff page's incentive tab.
//
// Everyone still on the roster is scored against the client's twelve criteria for the
// month (see lib/incentive.ts). Four verdicts are read off the month's data — behaviour
// analysis, the attendance sheet (full days; on-time logins) and the performance review —
// and show their evidence on hover; the rest are ticks the manager gives. Criteria 8–12
// are optional and switched on above the list. The list is ranked by criteria met, with
// the data as tie-breaks; whoever meets every criterion in play is Eligible, and the month's
// top performer is whoever the manager marks — nobody gets that badge automatically. Ticks,
// marks and the month's settings are kept on the server, so every manager sees the same
// confirmations; the sheet autosaves a moment after each change.
//
// The list is a div grid rather than a <table>: the app's global table rules give every
// cell the Excel-like density the sheets want, and this is a leaderboard, not a sheet —
// it wants labelled pills instead of numbered columns, and chips you can tap. It is sized
// to show every column without scrolling in a 1280px-wide window at 100% zoom; narrower
// than that, the list scrolls sideways rather than squeezing the chips.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import { cx } from './ui'
import { PerformerBadge, usePerformerReload } from '../lib/performers'
import { merge3 } from '../lib/merge'
import {
  CRITERIA,
  activeCriteria,
  buildCandidates,
  criterion,
  fromWire,
  pickPerformers,
  rankCandidates,
  scorePct,
  toWire,
  withLowMark,
  withTopMark,
  type AttendanceDayLite,
  type Criterion,
  type CriterionId,
  type IncentiveSettings,
  type ManualTicks,
  type RankedRow,
} from '../lib/incentive'
import type { ReviewEntry, StaffLeave, StaffMember, TopPerformerState } from '../types'

/** Where each verdict comes from, named after the CRM page it is read on. */
const SOURCE_LABEL = {
  behaviour: 'Checked from Review · Behaviour',
  attendance: 'Checked from Attendance · Leaves',
  performance: 'Checked from Review · Performance',
  manual: 'You confirm this',
} as const

/** People have no photo — on the scorecards, their initials stand in. */
const initials = (name: string) => {
  const w = name.trim().split(/\s+/).filter(Boolean)
  return (w.length >= 2 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase()
}

const IconCheck = ({ size = 11 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>
)
const IconCross = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
)
const IconAward = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="8" r="6" /><path d="M15.5 13 17 22l-5-3-5 3 1.5-9" /></svg>
)
const IconDownArrow = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></svg>
)
const IconCrown = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M3 8l4.4 3L12 5l4.6 6L21 8l-1.5 9.2a1 1 0 0 1-1 .8H5.5a1 1 0 0 1-1-.8L3 8z" /></svg>
)

// ─── Pieces ───────────────────────────────────────────────────────────────────

/**
 * A data-driven verdict as a labelled pill — green met, red not met, grey can't say — that
 * is also a control: tap it to confirm the criterion by hand when the record is wrong or
 * missing. A confirmed one is filled navy like the manual chips, because it is now the
 * manager's word rather than the data's; tap again to hand it back to the data.
 */
function VerdictPill({ c, row, name, onToggle }: { c: Criterion; row: RankedRow; name: string; onToggle: () => void }) {
  const v = row.verdicts[c.id]
  const confirmed = v.confirmed ?? false
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={confirmed}
      aria-label={`${name}: ${c.label}`}
      title={`${c.n}. ${c.label} — ${v.note}${confirmed ? ' · tap to hand back to the data' : ' · tap to confirm by hand'}`}
      onClick={onToggle}
      className={cx(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap transition-colors',
        confirmed ? 'border-brand bg-brand text-white'
          : v.unknown ? 'border-transparent bg-slate-100 text-slate-500 hover:border-brand'
          : v.met ? 'border-transparent bg-emerald-50 text-emerald-700 hover:border-brand'
          : 'border-transparent bg-rose-50 text-rose-600 hover:border-brand',
      )}
    >
      <span className={cx('inline-flex h-3.5 w-3.5 items-center justify-center rounded-full', confirmed ? 'bg-white/25' : v.unknown ? 'bg-slate-200' : v.met ? 'bg-emerald-100' : 'bg-rose-100')}>
        {confirmed || v.met ? <IconCheck size={9} /> : v.unknown ? <span className="text-[9px] font-bold leading-none">?</span> : <IconCross />}
      </span>
      {c.label}
    </button>
  )
}

/** A manual criterion as a tap-to-toggle chip — filled blue when credited. */
function TickChip({ c, on, onToggle, name }: { c: Criterion; on: boolean; onToggle: () => void; name: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={`${name}: ${c.label}`}
      title={`${c.n}. ${c.label} — ${c.detail}`}
      onClick={onToggle}
      className={cx(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap transition-colors',
        on ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-brand hover:text-brand',
      )}
    >
      <span className={cx('inline-flex h-3.5 w-3.5 items-center justify-center rounded-full', on ? 'bg-white/25' : 'bg-slate-100')}>
        {on && <IconCheck size={9} />}
      </span>
      {c.label}
    </button>
  )
}

function StatusPill({ row }: { row: RankedRow }) {
  if (row.allMet) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
        <IconCheck /> Eligible
      </span>
    )
  }
  const left = row.total - row.met
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', left <= 2 ? 'bg-white text-brand ring-brand/30' : 'bg-slate-50 text-slate-500 ring-slate-200')}>
      <span className={cx('h-1.5 w-1.5 rounded-full', left <= 2 ? 'bg-brand' : 'bg-slate-400')} />
      {left} to go
    </span>
  )
}

const MARK_BUTTON = 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap transition-colors'
const MARK_BLOCKED = 'cursor-not-allowed border-slate-100 bg-white text-slate-300'

/**
 * The Top badge as a switch — the only way anyone gets it. It can't be set on somebody
 * wearing Low (clear that first), so one person is never both.
 */
function TopToggle({ row, low, name, onToggle }: { row: RankedRow; low: boolean; name: string; onToggle: () => void }) {
  const on = row.topMark
  const blocked = !on && low
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${name}: Top performer`}
      disabled={blocked}
      title={on ? 'Top performer of the month — tap to unmark' : blocked ? `${name} is Low — clear Low first` : `Mark ${name} top performer of the month`}
      onClick={onToggle}
      className={cx(
        MARK_BUTTON,
        on ? 'border-emerald-600 bg-emerald-600 text-white'
          : blocked ? MARK_BLOCKED
          : 'border-slate-200 bg-white text-slate-400 hover:border-emerald-500 hover:text-emerald-600',
      )}
    >
      <IconCrown size={10} />
      {on ? 'Top' : 'Mark top'}
    </button>
  )
}

/**
 * The Low badge as a switch. It shows what the rules say — performance under the month's
 * threshold, or the month's lowest score — until a manager flips it: a solid red "Low" is
 * their mark, a navy "Not low" their clearing, the same navy-means-yours the verdict pills
 * use. Flipping it back to what the rules say hands it back to them. A marked top performer
 * can't be marked Low (unmark Top first), and the rules leave them out.
 */
function LowToggle({ row, byRules, threshold, name, onToggle }: {
  row: RankedRow
  byRules: boolean
  threshold: number
  name: string
  onToggle: () => void
}) {
  const low = row.lowMark ?? byRules
  const manual = row.lowMark !== null
  const blocked = row.topMark
  const pct = row.candidate.performance?.percentage
  const why = row.underLow ? `performance ${pct}% is under ${threshold}%` : byRules ? 'the lowest score of the month' : null
  const title = blocked ? `${name} is marked Top — unmark Top first`
    : row.lowMark === true ? `Marked Low by you${why ? ` (the rules agree: ${why})` : ''} — tap to clear`
    : row.lowMark === false ? `Cleared by you — the rules say Low: ${why} — tap to mark Low again`
    : low ? `Low: ${why} — tap to clear`
    : `Not Low — tap to mark ${name} Low whatever the percentage`
  return (
    <button
      type="button"
      role="switch"
      aria-checked={low}
      aria-label={`${name}: Low performer`}
      disabled={blocked}
      title={title}
      onClick={onToggle}
      className={cx(
        MARK_BUTTON,
        blocked ? MARK_BLOCKED
          : low && manual ? 'border-rose-600 bg-rose-600 text-white'
          : low ? 'border-transparent bg-rose-50 text-rose-700 hover:border-rose-400'
          : manual ? 'border-brand bg-white text-brand'
          : 'border-slate-200 bg-white text-slate-400 hover:border-rose-400 hover:text-rose-600',
      )}
    >
      <IconDownArrow size={10} />
      {low ? 'Low' : manual ? 'Not low' : 'Mark low'}
    </button>
  )
}

/**
 * One criterion on one line: its number, its name, and whether the CRM checks it or the
 * manager does. The client's sentence and the exact rule are a hover away.
 */
function CriterionLine({ c, on, onToggle }: { c: Criterion; on: boolean; onToggle?: () => void }) {
  const auto = c.source !== 'manual'
  return (
    <li
      title={`${c.detail}${c.how ? ` ${SOURCE_LABEL[c.source]}: ${c.how}` : ' Nothing in the CRM records this — you confirm it per person in the ranking.'}`}
      className={cx('flex items-center gap-2 py-1', !on && 'opacity-50')}
    >
      <span className={cx('inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', auto ? 'bg-brand text-white' : 'border border-brand/40 text-brand')}>{c.n}</span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800">{c.label}</span>
      <span className="shrink-0 text-[10px] text-slate-400">{auto ? SOURCE_LABEL[c.source].replace('Checked from ', '') : 'You confirm'}</span>
      {onToggle && (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={onToggle}
          className={cx('relative ml-1 h-4 w-7 shrink-0 rounded-full transition-colors', on ? 'bg-brand' : 'bg-slate-300')}
          aria-label={`${on ? 'Remove' : 'Include'} ${c.label}`}
        >
          <span className={cx('absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all', on ? 'left-3.5' : 'left-0.5')} />
        </button>
      )}
    </li>
  )
}

/** A white panel with a header that folds its body away; the fold is remembered per panel. */
function FoldPanel({ id, title, meta, children }: { id: string; title: string; meta: string; children: React.ReactNode }) {
  const key = `top-performer:panel:${id}`
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(key) !== 'closed' } catch { return true }
  })
  const toggle = () => {
    const next = !open
    setOpen(next)
    try { localStorage.setItem(key, next ? 'open' : 'closed') } catch { /* storage unavailable */ }
  }
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        <span className="text-sm font-semibold text-brand">{title}</span>
        <span className="text-[11px] text-slate-400">{meta}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cx('ml-auto shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} aria-hidden>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="border-t border-slate-100 px-4 pb-3 pt-1">{children}</div>}
    </section>
  )
}

// ─── Scorecards ───────────────────────────────────────────────────────────────
//
// The month's two answers in one glance, beside the card title where the header otherwise
// sat empty under the month picker. The green card names whoever the manager marked top
// performer; the red card, its mirror, everyone wearing the Low badge. A name and a score,
// nothing else; the evidence is the ranking below.
//
// Both cards read the same rules the app-wide badges do (lib/incentive.ts · pickPerformers),
// so the Review tab and the badges worn beside staff names can never name different people.

/** The palette and the wording for each end — everything else about the two cards is shared. */
const ENDS = {
  top: {
    frame: 'border-emerald-200 bg-gradient-to-r from-emerald-50 to-white shadow-sm shadow-emerald-100',
    badge: 'bg-emerald-600 text-white shadow-sm',
    kicker: 'text-emerald-700',
    chip: 'ring-emerald-200',
    dot: 'bg-emerald-600',
    pill: 'bg-emerald-50 text-emerald-700',
    ring: 'text-emerald-500',
    figure: 'text-emerald-700',
  },
  low: {
    frame: 'border-rose-200 bg-gradient-to-r from-rose-50 to-white shadow-sm shadow-rose-100',
    badge: 'bg-rose-600 text-white shadow-sm',
    kicker: 'text-rose-700',
    chip: 'ring-rose-200',
    dot: 'bg-rose-600',
    pill: 'bg-rose-50 text-rose-700',
    ring: 'text-rose-500',
    figure: 'text-rose-700',
  },
} as const

/** One named person on a scorecard, whatever period worked them out. */
export interface EndPerson {
  key: string | number
  name: string
  /** Their score as a whole percentage. */
  pct: number
}

/**
 * One end's scorecard. Shared by the monthly tab and the Annual Reviews roll-up, so a
 * half-yearly winner is presented exactly like a monthly one — `periodLabel` is the only
 * thing that differs ("August 2026" against "October 2025 – September 2026").
 */
export function PerformerEndCard({ end, people, title, empty, periodLabel, tied = true }: {
  end: 'top' | 'low'
  people: EndPerson[]
  title: string
  empty: string
  periodLabel: string
  /** Several names are a tie at one score (the default), or simply a list. */
  tied?: boolean
}) {
  const any = people.length > 0
  const t = ENDS[end]
  return (
    <div
      className={cx('flex overflow-hidden rounded-xl border', any ? t.frame : 'border-slate-200 bg-white')}
      aria-label={`${title}, ${periodLabel}`}
    >
      {/* Who */}
      <div className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3">
        <span className={cx('mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full', any ? t.badge : 'bg-slate-100 text-slate-400')}>
          {end === 'top' ? <IconCrown size={15} /> : <IconDownArrow />}
        </span>
        <div className="min-w-0">
          <div className={cx('text-[10px] font-bold uppercase tracking-wider', any ? t.kicker : 'text-slate-400')}>
            {title}{people.length > 1 ? (tied ? 's · tied' : 's') : ''} · {periodLabel}
          </div>
          {any ? (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {people.map((w) => (
                <li key={w.key} className={cx('inline-flex items-center gap-1.5 rounded-full bg-white py-0.5 pl-0.5 pr-1 text-xs font-semibold text-slate-800 shadow-sm ring-1', t.chip)}>
                  <span className={cx('inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white', t.dot)}>{initials(w.name)}</span>
                  {w.name}
                  <span className={cx('rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums', t.pill)}>{w.pct}%</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm font-medium text-slate-500">{empty}</p>
          )}
        </div>
      </div>
    </div>
  )
}

/** A month's ranked row as a scorecard entry. */
const asEndPerson = (r: RankedRow, pct: number): EndPerson =>
  ({ key: r.candidate.member.id, name: r.candidate.member.name, pct })

/** The month's incentive: whoever the manager marked top performer, each with their score. */
export function TopPerformerHeadline({ rows, monthLabel }: { rows: RankedRow[]; monthLabel: string }) {
  const { top } = pickPerformers(rows)
  return (
    <PerformerEndCard
      end="top"
      people={top.map((r) => asEndPerson(r, scorePct(r)))}
      title="Top performer"
      empty="No one marked yet"
      periodLabel={monthLabel}
      tied={false}
    />
  )
}

/**
 * The other end: everyone wearing the Low badge — under the month's performance threshold,
 * the lowest scorer, or marked by a manager (see pickPerformers) — each with their score.
 */
export function LowPerformerHeadline({ rows, monthLabel }: { rows: RankedRow[]; monthLabel: string }) {
  const { low } = pickPerformers(rows)
  return (
    <PerformerEndCard
      end="low"
      people={low.map((r) => asEndPerson(r, scorePct(r)))}
      title="Low performer"
      empty={rows.length > 1 ? 'No one behind the rest' : 'Not enough of a roster to say'}
      periodLabel={monthLabel}
      tied={false}
    />
  )
}

/** Both ends, the way the Review page's header shows them. */
export function PerformerHeadlines({ rows, monthLabel }: { rows: RankedRow[]; monthLabel: string }) {
  return (
    <div className="grid gap-2 xl:grid-cols-2">
      <TopPerformerHeadline rows={rows} monthLabel={monthLabel} />
      <LowPerformerHeadline rows={rows} monthLabel={monthLabel} />
    </div>
  )
}

// ─── Sheet ────────────────────────────────────────────────────────────────────

/** The month as the server holds it, in the one shape it is saved and compared in. */
const wireOf = (state: TopPerformerState | null) => {
  const { settings, ticks } = fromWire(state)
  return toWire(settings, ticks)
}

export default function TopPerformerSheet({ month, monthLabel, staff, attendance, leaves, performance, behaviour, saved, onRanked }: {
  /** "YYYY-MM" — the month being judged. */
  month: string
  monthLabel: string
  staff: StaffMember[]
  attendance: AttendanceDayLite[]
  /** The month's Leaves sheet — its Half Day and Late Login columns count against 2 and 4. */
  leaves: StaffLeave[]
  performance: ReviewEntry[]
  behaviour: ReviewEntry[]
  /** The month's saved state from the server (null = nothing saved yet → defaults). */
  saved: TopPerformerState | null
  /** Told the ranked rows and settings as they stand, so the page's PDF prints what is shown. */
  onRanked?: (state: { rows: RankedRow[]; settings: IncentiveSettings }) => void
}) {
  const [settings, setSettings] = useState<IncentiveSettings>(() => fromWire(saved).settings)
  const [ticks, setTicks] = useState<ManualTicks>(() => fromWire(saved).ticks)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [onlyEligible, setOnlyEligible] = useState(false)
  // A tick here decides who wears the badge on every other page.
  const reloadBadges = usePerformerReload()
  const [query, setQuery] = useState('')

  // The page remounts this sheet on a month change (key={month}), so the initialisers
  // above read that month's own saved state. Every change is sent to the server a moment
  // later — one PUT with the whole month, debounced so a burst of ticks is one request.
  // The first render is skipped: nothing has changed yet.
  //
  // `onServer` is the month as the server last told us, as JSON. A render that changes
  // nothing must not write anything: a re-render that re-sent this payload could only ever
  // overwrite the month with what it already says. It also goes with every save as `base`,
  // so the server applies only THIS browser's changes on top of any other manager's.
  const [onServer, setOnServer] = useState(() => JSON.stringify(wireOf(saved)))
  // A newer copy of the month — another manager's save arriving live, or the answer to our
  // own — is folded in on the next render: whatever was changed here since `onServer` stays
  // as it is, everything else takes the server's. A tick is never lost to a refresh.
  const [incoming, setIncoming] = useState<TopPerformerState | null>(null)
  const [seenSaved, setSeenSaved] = useState(saved)
  if (saved !== seenSaved) {
    setSeenSaved(saved)
    setIncoming(saved)
  }
  if (incoming !== null) {
    const theirs = wireOf(incoming)
    const merged = fromWire({ ...incoming, ...merge3(JSON.parse(onServer), toWire(settings, ticks), theirs) })
    setIncoming(null)
    setSettings(merged.settings)
    setTicks(merged.ticks)
    setOnServer(JSON.stringify(theirs))
  }

  const dirty = useRef(false)
  // The debounced save still waiting to go, so leaving the page inside the debounce sends it.
  const pending = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!dirty.current) { dirty.current = true; return }
    const payload = toWire(settings, ticks)
    const json = JSON.stringify(payload)
    pending.current = null
    if (json === onServer) return
    const base = JSON.parse(onServer) as ReturnType<typeof wireOf>
    const send = () => {
      pending.current = null
      setSyncError(null)
      api.saveTopPerformer(month, payload, base)
        .then((state) => {
          // The answer is the merge: this save plus whatever else landed meanwhile.
          setOnServer(json)
          setIncoming(state)
          reloadBadges(month)
        })
        .catch((err: Error) => setSyncError(err.message))
    }
    pending.current = send
    const handle = setTimeout(send, 400)
    return () => clearTimeout(handle)
  }, [month, onServer, settings, ticks, reloadBadges])
  useEffect(() => () => pending.current?.(), [])
  // Saved once the server holds what is on screen; a failed save says so until the next one.
  const sync = syncError !== null ? 'error' : JSON.stringify(toWire(settings, ticks)) !== onServer ? 'saving' : 'saved'

  const candidates = useMemo(() => buildCandidates(staff, attendance, leaves, performance, behaviour), [staff, attendance, leaves, performance, behaviour])
  const rows = useMemo(() => rankCandidates(candidates, settings, ticks), [candidates, settings, ticks])

  // The list re-ranks itself on every tick: a confirmation raises somebody's score and they
  // move to where that score puts them, straight away. Rows are keyed by person, so a row
  // moving is the same element sliding, not a new one appearing under the cursor.
  const active = useMemo(() => activeCriteria(settings), [settings])
  const dataCriteria = useMemo(() => active.filter((c) => c.source !== 'manual'), [active])
  const manualCriteria = useMemo(() => active.filter((c) => c.source === 'manual'), [active])

  useEffect(() => { onRanked?.({ rows, settings }) }, [rows, settings, onRanked])

  const winners = useMemo(() => rows.filter((r) => r.allMet), [rows])
  const passData = useMemo(() => rows.filter((r) => dataCriteria.every((c) => r.verdicts[c.id].met)), [rows, dataCriteria])
  const q = query.trim().toLowerCase()
  const shown = rows.filter((r) =>
    (!onlyEligible || passData.includes(r)) &&
    (!q || r.candidate.member.name.toLowerCase().includes(q) || r.candidate.member.departments.some((d) => d.name.toLowerCase().includes(q))),
  )
  const avgScore = rows.length ? Math.round((rows.reduce((s, r) => s + r.met / Math.max(1, r.total), 0) / rows.length) * 100) : 0
  // Only reviewed people are ranked (buildCandidates), so the roster figure to show is the
  // other side: who is not on the list yet because nobody has picked a rating for them.
  const onRoster = staff.filter((m) => m.status !== 'inactive').length
  const awaitingReview = Math.max(0, onRoster - rows.length)

  const toggleAdditional = (id: CriterionId) =>
    setSettings((s) => ({ ...s, additional: s.additional.includes(id) ? s.additional.filter((x) => x !== id) : [...s.additional, id] }))

  const tick = (staffId: number, id: CriterionId, on: boolean) => {
    setTicks((t) => {
      const own = t[staffId] ?? []
      return { ...t, [staffId]: on ? [...new Set([...own, id])] : own.filter((x) => x !== id) }
    })
  }

  // Who the rules alone badge Low, so a flip can tell a mark from handing it back.
  const lowByRules = useMemo(() => new Set(pickPerformers(rows).lowByRules.map((r) => r.candidate.member.id)), [rows])
  const isLow = (r: RankedRow) => r.lowMark ?? lowByRules.has(r.candidate.member.id)
  // One person is never both: Low can't be set on a marked top performer, nor Top on
  // somebody Low (the switches are disabled too; these guard a stale click).
  const flipLow = (r: RankedRow) => {
    if (r.topMark) return
    const id = r.candidate.member.id
    setTicks((t) => ({ ...t, [id]: withLowMark(t[id] ?? [], !isLow(r), lowByRules.has(id)) }))
  }
  const flipTop = (r: RankedRow) => {
    if (!r.topMark && isLow(r)) return
    const id = r.candidate.member.id
    setTicks((t) => ({ ...t, [id]: withTopMark(t[id] ?? [], !r.topMark) }))
  }

  /** Header chip: credit one manual criterion to everyone shown — or, if they all have it, take it back. */
  const tickAll = (id: CriterionId) => {
    const manual = criterion(id).source === 'manual'
    const on = !shown.every((r) => manual ? r.verdicts[id].met : (r.verdicts[id].confirmed ?? false))
    setTicks((t) => {
      const next = { ...t }
      for (const r of shown) {
        const own = next[r.candidate.member.id] ?? []
        next[r.candidate.member.id] = on ? [...new Set([...own, id])] : own.filter((x) => x !== id)
      }
      return next
    })
  }

  const core = CRITERIA.filter((c) => c.group === 'core')
  const additional = CRITERIA.filter((c) => c.group === 'additional')

  // Column template shared by the header and every row. The chip columns share the free
  // width roughly as their chips do (4 automatic ~460px, 4 manual ~570px), so each wraps
  // to about three lines at 1280px; their minimums are the widest single chip.
  const cols = 'grid-cols-[1.75rem_minmax(9.5rem,0.6fr)_minmax(8.5rem,0.8fr)_minmax(10rem,1.05fr)_3.5rem_4.75rem_4.75rem]'

  return (
    <div className="space-y-4">
      {/* The month's two answers, before the tiles that count the rest of the roster. */}
      <PerformerHeadlines rows={rows} monthLabel={monthLabel} />

      {/* The Low badge's bar, set per month like the Goal Achievement target below. */}
      <div
        className="flex flex-wrap items-center justify-end gap-1.5 text-[11px] text-slate-500"
        title="The Percentage on the Review page's Performance tab. Mark or clear anyone by hand in the Low column."
      >
        <span>Low performer under</span>
        <input
          type="number"
          min={0}
          max={100}
          aria-label="Low performer threshold"
          value={settings.lowPerformance}
          onChange={(e) => setSettings((s) => ({ ...s, lowPerformance: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))}
          className="w-14 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-center text-[11px] tabular-nums focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <span>% performance</span>
      </div>

      {/* Headline tiles, like the inspiration's stat cards. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Eligible for incentive', value: String(winners.length), of: rows.length, tone: winners.length ? 'text-emerald-600' : 'text-slate-900' },
          { label: 'Pass every automatic check', value: String(passData.length), of: rows.length, tone: 'text-brand' },
          { label: 'Average score', value: `${avgScore}%`, of: null, tone: 'text-slate-900' },
          { label: 'Reviewed this month', value: String(rows.length), of: onRoster, tone: awaitingReview ? 'text-amber-600' : 'text-slate-900' },
        ].map((t) => (
          <div key={t.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] font-medium text-slate-500">{t.label}</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className={cx('text-xl font-bold tabular-nums', t.tone)}>{t.value}</span>
              {t.of !== null && <span className="text-[11px] text-slate-400">of {t.of}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Criteria — the client's list, one line each, foldable. Hover a line for the wording and the rule. */}
      <div className="grid gap-3 lg:grid-cols-2">
        <FoldPanel id="core" title="Criteria to become Top Performer of the Month" meta="1–7 · always apply">
          <ol className="divide-y divide-slate-100">
            {core.map((c) => <CriterionLine key={c.id} c={c} on />)}
          </ol>
        </FoldPanel>
        <FoldPanel id="additional" title="Additional criteria (if applicable)" meta="8–12 · switch on what applies">
          <ol className="divide-y divide-slate-100">
            {additional.map((c) => (
              <CriterionLine key={c.id} c={c} on={settings.additional.includes(c.id)} onToggle={() => toggleAdditional(c.id)} />
            ))}
          </ol>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
            <span>Goal Achievement target:</span>
            <input
              type="number"
              min={0}
              max={100}
              value={settings.minPerformance}
              onChange={(e) => setSettings((s) => ({ ...s, minPerformance: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))}
              className="w-14 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-center text-[11px] tabular-nums focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            <span>% or a rating of Excellent / Good.</span>
          </div>
        </FoldPanel>
      </div>

      {/* The leaderboard. */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-brand"><IconAward /></span>
            <h4 className="text-sm font-semibold text-slate-900">Ranking — {monthLabel}</h4>
            <span className="text-[11px] text-slate-400">{shown.length} of {rows.length}</span>
            <span
              className={cx('text-[11px] font-medium', sync === 'error' ? 'text-rose-600' : sync === 'saving' ? 'text-slate-400' : 'text-emerald-600')}
              title={sync === 'error' ? syncError ?? 'Could not save' : undefined}
            >
              {sync === 'saving' ? 'Saving…' : sync === 'error' ? 'Not saved — check your connection' : 'Saved'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or department…"
              className="w-52 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
              <input type="checkbox" checked={onlyEligible} onChange={(e) => setOnlyEligible(e.target.checked)} className="h-3.5 w-3.5 accent-brand" />
              Only people who pass every automatic check
            </label>
          </div>
        </div>

        {winners.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-emerald-100 bg-emerald-50/60 px-4 py-2 text-xs text-emerald-800">
            <span className="text-emerald-600"><IconCrown /></span>
            {winners.length === 1
              ? <><span className="font-semibold">{winners[0].candidate.member.name}</span> meets all {active.length} criteria.</>
              : <><span className="font-semibold">{winners.length} people</span> meet all {active.length} criteria: {winners.map((w) => w.candidate.member.name).join(', ')}.</>}
          </div>
        )}

        <div className="overflow-x-auto">
          <div className="min-w-190">
            {/* Header */}
            <div className={cx('grid items-center gap-x-2 px-3 py-2 text-[11px] font-medium text-slate-500', cols)}>
              <span>#</span>
              <span>Staff</span>
              <span className="flex flex-wrap items-center gap-1">
                <span className="mr-1" title="Read from the month's Review, Attendance and Leaves sheets. Tap a pill to confirm it by hand.">Checked for you</span>
                {dataCriteria.map((c) => {
                  const all = shown.length > 0 && shown.every((r) => r.verdicts[c.id].confirmed)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => tickAll(c.id)}
                      disabled={shown.length === 0}
                      title={all ? `Hand "${c.label}" back to the data for everyone shown` : `Confirm "${c.label}" by hand for everyone shown`}
                      className={cx('rounded border px-1 py-px text-[9px] font-semibold transition-colors', all ? 'border-brand bg-brand text-white' : 'border-slate-200 text-slate-400 hover:border-brand hover:text-brand')}
                    >
                      {c.label}
                    </button>
                  )
                })}
              </span>
              <span className="flex flex-wrap items-center gap-1">
                <span className="mr-1">You confirm</span>
                {manualCriteria.map((c) => {
                  const all = shown.length > 0 && shown.every((r) => r.verdicts[c.id].met)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => tickAll(c.id)}
                      disabled={shown.length === 0}
                      title={all ? `Take "${c.label}" back from everyone shown` : `Credit "${c.label}" to everyone shown`}
                      className={cx('rounded border px-1 py-px text-[9px] font-semibold transition-colors', all ? 'border-brand bg-brand text-white' : 'border-slate-200 text-slate-400 hover:border-brand hover:text-brand')}
                    >
                      {c.label}
                    </button>
                  )
                })}
              </span>
              <span>Score</span>
              <span>Status</span>
              <span title={`Top: marked by hand only. Low: under ${settings.lowPerformance}% performance, the month's lowest score, or marked by hand. Never both.`}>Top · Low</span>
            </div>

            {/* Rows */}
            {shown.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-400">
                {rows.length === 0
                  ? `Nobody has a review for ${monthLabel} yet — pick a Performance or Behaviour rating on the Review page and the name appears here.`
                  : q ? `Nothing matches "${query}".` : 'Nobody passes every automatic check yet.'}
              </div>
            ) : (
              <ol className="divide-y divide-slate-100">
                {shown.map((r) => {
                  const m = r.candidate.member
                  const first = r.rank === 1
                  const pct = scorePct(r)
                  return (
                    <li key={m.id} className={cx('grid items-center gap-x-2 px-3 py-2.5 transition-colors hover:bg-slate-50/80', cols, r.allMet && 'bg-emerald-50/40')}>
                      {/* Rank */}
                      <span className={cx('inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold', r.allMet ? 'bg-emerald-600 text-white' : first ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600')}>
                        {r.topMark ? <IconCrown /> : r.rank}
                      </span>
                      {/* Person */}
                      <span className="min-w-0 leading-tight">
                        <span className="flex min-w-0 items-center gap-1">
                          <span className="truncate text-sm font-semibold text-slate-800" title={m.name}>{m.name}</span>
                          <PerformerBadge staffId={m.id} compact />
                        </span>
                        <span className="block truncate text-[11px] text-slate-400">
                          {m.departments.map((d) => d.name).join(' · ') || 'No department'}
                          <span className="text-slate-300"> · </span>
                          {r.candidate.presentDays > 0 ? `${r.candidate.presentDays} day${r.candidate.presentDays > 1 ? 's' : ''} in` : 'no attendance'}
                          {m.status === 'leave' && <span className="text-slate-300"> · on leave</span>}
                        </span>
                      </span>
                      {/* Data-driven verdicts */}
                      <span className="flex flex-wrap gap-1">
                        {dataCriteria.map((c) => (
                          <VerdictPill key={c.id} c={c} row={r} name={m.name} onToggle={() => tick(m.id, c.id, !(r.verdicts[c.id].confirmed ?? false))} />
                        ))}
                      </span>
                      {/* Manual ticks */}
                      <span className="flex flex-wrap gap-1">
                        {manualCriteria.map((c) => (
                          <TickChip key={c.id} c={c} name={m.name} on={r.verdicts[c.id].met} onToggle={() => tick(m.id, c.id, !r.verdicts[c.id].met)} />
                        ))}
                      </span>
                      {/* Score: the figure, with its bar under it */}
                      <span className="flex flex-col gap-1">
                        <span className="text-xs font-semibold tabular-nums text-slate-700">{pct}%</span>
                        <span className="h-1 overflow-hidden rounded-full bg-slate-100">
                          <span className={cx('block h-full rounded-full', r.allMet ? 'bg-emerald-500' : 'bg-brand')} style={{ width: `${pct}%` }} />
                        </span>
                      </span>
                      {/* Status */}
                      <span><StatusPill row={r} /></span>
                      {/* The two badges, marked by hand — one at a time */}
                      <span className="flex flex-col items-start gap-1">
                        <TopToggle row={r} low={isLow(r)} name={m.name} onToggle={() => flipTop(r)} />
                        <LowToggle row={r} byRules={lowByRules.has(m.id)} threshold={settings.lowPerformance} name={m.name} onToggle={() => flipLow(r)} />
                      </span>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
