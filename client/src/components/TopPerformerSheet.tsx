// Top Performer of the Month — the Staff page's incentive tab.
//
// Everyone still on the roster is scored against the client's twelve criteria for the
// month (see lib/incentive.ts). Four verdicts are read off the month's data — behaviour
// analysis, the attendance sheet (full days; on-time logins) and the performance review —
// and show their evidence on hover; the rest are ticks the manager gives. Criteria 8–12
// are optional and switched on above the list. The list is ranked by criteria met, with
// the data as tie-breaks, and whoever meets every criterion in play carries the incentive
// mark. Ticks and the month's settings are kept on the server, so every manager sees the
// same confirmations; the sheet autosaves a moment after each change.
//
// The list is a div grid rather than a <table>: the app's global table rules give every
// cell the Excel-like density the sheets want, and this is a leaderboard, not a sheet —
// it wants room, labelled pills instead of numbered columns, and chips you can tap.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import { cx } from './ui'
import { BRAND } from '../lib/theme'
import {
  CRITERIA,
  activeCriteria,
  buildCandidates,
  fromWire,
  rankCandidates,
  toWire,
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
  attendance: 'Checked from Complete Attendance · Leaves',
  performance: 'Checked from Review · Performance',
  manual: 'You confirm this',
} as const

/** People have no photo — initials, white on the navbar's navy, stand in. */
const AVATAR = 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white'
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
const IconCrown = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M3 8l4.4 3L12 5l4.6 6L21 8l-1.5 9.2a1 1 0 0 1-1 .8H5.5a1 1 0 0 1-1-.8L3 8z" /></svg>
)

// ─── Pieces ───────────────────────────────────────────────────────────────────

/** A data-driven verdict as a labelled pill: green met, red not met, grey can't say. */
function VerdictPill({ c, row }: { c: Criterion; row: RankedRow }) {
  const v = row.verdicts[c.id]
  return (
    <span
      title={`${c.n}. ${c.label} — ${v.note}`}
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap',
        v.unknown ? 'bg-slate-100 text-slate-500' : v.met ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600',
      )}
    >
      <span className={cx('inline-flex h-3.5 w-3.5 items-center justify-center rounded-full', v.unknown ? 'bg-slate-200' : v.met ? 'bg-emerald-100' : 'bg-rose-100')}>
        {v.unknown ? <span className="text-[9px] font-bold leading-none">?</span> : v.met ? <IconCheck size={9} /> : <IconCross />}
      </span>
      {c.label}
    </span>
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

// ─── Guide ────────────────────────────────────────────────────────────────────
//
// Three steps, the way a pricing page explains itself: a title, one line under it, and
// three line-drawn icons joined by arrows. White and the navbar's navy only. It can be
// hidden, and stays hidden across visits — a manager who has read it once has read it.

const NAVY = BRAND
const GUIDE_KEY = 'top-performer:guide'

const guideIcon = (children: React.ReactNode) => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)
const GUIDE_STEPS = [
  {
    title: 'Pick the month',
    text: 'Criteria 1, 2, 4 and 9 are checked for you from that month\'s Review, Attendance and Leaves sheets.',
    icon: guideIcon(<><rect x="3" y="4" width="18" height="17" rx="2.5" /><path d="M16 2v4M8 2v4M3 9.5h18" /><path d="m9 15.5 2 2 4-4" /></>),
  },
  {
    title: 'Confirm the rest',
    text: 'Tap a criterion beside a person once you have seen it. The list holds its order until you press Re-rank.',
    icon: guideIcon(<><rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="m8 12 3 3 5-6" /><path d="M14.5 20.5 13 17l4-1.5z" fill={NAVY} stroke="none" /></>),
  },
  {
    title: 'Find the winner',
    text: 'Ranked by criteria met. Meet every one in play and they are Eligible for the incentive.',
    icon: guideIcon(<><path d="M8 4h8v5a4 4 0 0 1-8 0z" /><path d="M8 6H5a1 1 0 0 0-1 1 4 4 0 0 0 4 3M16 6h3a1 1 0 0 1 1 1 4 4 0 0 1-4 3" /><path d="M12 13v4M9 20h6M10 17h4" /></>),
  },
]

/** A thin arrow between steps, like the inspiration's — hidden when the steps stack. */
const GuideArrow = () => (
  <svg className="hidden w-16 shrink-0 self-start sm:block" style={{ marginTop: 14 }} viewBox="0 0 64 16" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
    <path d="M2 10 C 20 4, 40 4, 58 8" /><path d="m52 4 6 4-5 5" />
  </svg>
)

function Guide() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(GUIDE_KEY) !== 'hidden' } catch { return true }
  })
  const toggle = () => {
    const next = !open
    setOpen(next)
    try { localStorage.setItem(GUIDE_KEY, next ? 'shown' : 'hidden') } catch { /* storage unavailable */ }
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <button type="button" onClick={toggle} className="text-[11px] font-medium text-slate-400 transition-colors hover:text-brand">
          Show guide
        </button>
      </div>
    )
  }

  return (
    <section className="relative rounded-xl border border-slate-200 bg-white px-6 py-6 text-center" aria-label="How this tab works">
      <button
        type="button"
        onClick={toggle}
        className="absolute right-3 top-3 rounded-md px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:bg-slate-50 hover:text-brand"
      >
        Hide guide
      </button>
      <h4 className="text-base font-bold tracking-tight text-brand">How it works</h4>
      <p className="mt-0.5 text-xs text-slate-500">Three steps between you and the month's incentive winner</p>

      <ol className="mx-auto mt-5 flex max-w-3xl flex-col items-center gap-4 sm:flex-row sm:items-start sm:justify-center sm:gap-2">
        {GUIDE_STEPS.map((step, i) => (
          <React.Fragment key={step.title}>
            {i > 0 && <GuideArrow />}
            <li className="flex w-44 flex-col items-center">
              {step.icon}
              <span className="mt-2 text-[11px] font-bold uppercase tracking-wide text-brand">{i + 1}. {step.title}</span>
              <span className="mt-1 text-[11px] leading-snug text-slate-500">{step.text}</span>
            </li>
          </React.Fragment>
        ))}
      </ol>
    </section>
  )
}

// ─── Sheet ────────────────────────────────────────────────────────────────────

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
  const [sync, setSync] = useState<'saved' | 'saving' | 'error'>('saved')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [onlyEligible, setOnlyEligible] = useState(false)
  const [query, setQuery] = useState('')

  // The page remounts this sheet on a month change (key={month}), so the initialisers
  // above read that month's own saved state. Every change is sent to the server a moment
  // later — one PUT with the whole month, debounced so a burst of ticks is one request.
  // The first render is skipped: nothing has changed yet.
  const dirty = useRef(false)
  useEffect(() => {
    if (!dirty.current) { dirty.current = true; return }
    setSync('saving')
    const handle = setTimeout(() => {
      api.saveTopPerformer(month, toWire(settings, ticks))
        .then(() => { setSync('saved'); setSyncError(null) })
        .catch((err: Error) => { setSync('error'); setSyncError(err.message) })
    }, 400)
    return () => clearTimeout(handle)
  }, [month, settings, ticks])

  const candidates = useMemo(() => buildCandidates(staff, attendance, leaves, performance, behaviour), [staff, attendance, leaves, performance, behaviour])
  const rows = useMemo(() => rankCandidates(candidates, settings, ticks), [candidates, settings, ticks])

  /**
   * The order on screen is HELD while the manager is ticking.
   *
   * Ranking is live — a tick raises someone's score, which moves them up the list. Left to
   * itself the list would re-sort under the cursor: the person just ticked jumps away and
   * whoever slides into that row shows the same chip unticked, which reads as "my tick went
   * to the wrong person". So the first tick freezes the running order (for these candidates),
   * the rank badges and scores keep updating in place, and a Re-rank button restores the
   * true order when the manager is ready. A month change or a data reload drops the hold.
   */
  const [hold, setHold] = useState<{ base: typeof candidates; ids: number[] } | null>(null)
  const held = hold && hold.base === candidates ? hold.ids : null
  const ordered = useMemo(() => {
    if (!held) return rows
    const byId = new Map(rows.map((r) => [r.candidate.member.id, r]))
    const kept = held.map((id) => byId.get(id)).filter((r): r is RankedRow => r !== undefined)
    const seen = new Set(held)
    return [...kept, ...rows.filter((r) => !seen.has(r.candidate.member.id))]
  }, [rows, held])
  const orderStale = held !== null && ordered.some((r, i) => r !== rows[i])
  const holdOrder = () => { if (!held) setHold({ base: candidates, ids: ordered.map((r) => r.candidate.member.id) }) }
  const rerank = () => setHold(null)
  const active = useMemo(() => activeCriteria(settings), [settings])
  const dataCriteria = useMemo(() => active.filter((c) => c.source !== 'manual'), [active])
  const manualCriteria = useMemo(() => active.filter((c) => c.source === 'manual'), [active])

  useEffect(() => { onRanked?.({ rows, settings }) }, [rows, settings, onRanked])

  const winners = useMemo(() => rows.filter((r) => r.allMet), [rows])
  const passData = useMemo(() => rows.filter((r) => dataCriteria.every((c) => r.verdicts[c.id].met)), [rows, dataCriteria])
  const q = query.trim().toLowerCase()
  const shown = ordered.filter((r) =>
    (!onlyEligible || passData.includes(r)) &&
    (!q || r.candidate.member.name.toLowerCase().includes(q) || r.candidate.member.departments.some((d) => d.name.toLowerCase().includes(q))),
  )
  const avgScore = rows.length ? Math.round((rows.reduce((s, r) => s + r.met / Math.max(1, r.total), 0) / rows.length) * 100) : 0
  const reviewed = rows.filter((r) => r.candidate.performance || r.candidate.behaviour).length

  const toggleAdditional = (id: CriterionId) =>
    setSettings((s) => ({ ...s, additional: s.additional.includes(id) ? s.additional.filter((x) => x !== id) : [...s.additional, id] }))

  const tick = (staffId: number, id: CriterionId, on: boolean) => {
    holdOrder()
    setTicks((t) => {
      const own = t[staffId] ?? []
      return { ...t, [staffId]: on ? [...new Set([...own, id])] : own.filter((x) => x !== id) }
    })
  }

  /** Header chip: credit one manual criterion to everyone shown — or, if they all have it, take it back. */
  const tickAll = (id: CriterionId) => {
    holdOrder()
    const on = !shown.every((r) => r.verdicts[id].met)
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

  // Column template shared by the header and every row.
  const cols = 'grid-cols-[2.75rem_minmax(12rem,1.1fr)_minmax(13rem,1.2fr)_minmax(16rem,1.8fr)_8rem_6.5rem]'

  return (
    <div className="space-y-4">
      {/* Headline tiles, like the inspiration's stat cards. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Eligible for incentive', value: String(winners.length), of: rows.length, tone: winners.length ? 'text-emerald-600' : 'text-slate-900' },
          { label: 'Pass every automatic check', value: String(passData.length), of: rows.length, tone: 'text-brand' },
          { label: 'Average score', value: `${avgScore}%`, of: null, tone: 'text-slate-900' },
          { label: 'Have a review this month', value: String(reviewed), of: rows.length, tone: 'text-slate-900' },
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

      <Guide />

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
            {orderStale && (
              <button
                type="button"
                onClick={rerank}
                title="Scores changed while you were ticking — put the list back in rank order"
                className="inline-flex items-center gap-1 rounded-md border border-brand bg-white px-2 py-0.5 text-[11px] font-semibold text-brand transition-colors hover:bg-brand hover:text-white"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 6h13M3 12h9M3 18h5" /><path d="m17 10 3-3 3 3M20 7v14" /></svg>
                Re-rank
              </button>
            )}
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
              ? <><span className="font-semibold">{winners[0].candidate.member.name}</span> meets all {active.length} criteria — the {monthLabel} incentive.</>
              : <><span className="font-semibold">{winners.length} people</span> meet all {active.length} criteria: {winners.map((w) => w.candidate.member.name).join(', ')}.</>}
          </div>
        )}

        <div className="overflow-x-auto">
          <div className="min-w-272">
            {/* Header */}
            <div className={cx('grid items-center gap-3 px-4 py-2 text-[11px] font-medium text-slate-500', cols)}>
              <span>#</span>
              <span>Staff</span>
              <span>Checked for you <span className="text-slate-400">· hover for the evidence</span></span>
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
            </div>

            {/* Rows */}
            {shown.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-400">
                {rows.length === 0 ? 'Nobody on the roster is active.' : q ? `Nothing matches "${query}".` : 'Nobody passes every automatic check yet.'}
              </div>
            ) : (
              <ol className="divide-y divide-slate-100">
                {shown.map((r) => {
                  const m = r.candidate.member
                  const first = r.rank === 1
                  const pct = Math.round((r.met / Math.max(1, r.total)) * 100)
                  return (
                    <li key={m.id} className={cx('grid items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50/80', cols, r.allMet && 'bg-emerald-50/40')}>
                      {/* Rank */}
                      <span className={cx('inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold', r.allMet ? 'bg-emerald-600 text-white' : first ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600')}>
                        {first && r.allMet ? <IconCrown /> : r.rank}
                      </span>
                      {/* Person */}
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className={AVATAR}>{initials(m.name)}</span>
                        <span className="min-w-0 leading-tight">
                          <span className="block truncate text-sm font-semibold text-slate-800">{m.name}</span>
                          <span className="block truncate text-[11px] text-slate-400">
                            {m.departments.map((d) => d.name).join(' · ') || 'No department'}
                            <span className="text-slate-300"> · </span>
                            {r.candidate.presentDays > 0 ? `${r.candidate.presentDays} day${r.candidate.presentDays > 1 ? 's' : ''} in` : 'no attendance'}
                            {m.status === 'leave' && <span className="text-slate-300"> · on leave</span>}
                          </span>
                        </span>
                      </span>
                      {/* Data-driven verdicts */}
                      <span className="flex flex-wrap gap-1">
                        {dataCriteria.map((c) => <VerdictPill key={c.id} c={c} row={r} />)}
                      </span>
                      {/* Manual ticks */}
                      <span className="flex flex-wrap gap-1">
                        {manualCriteria.map((c) => (
                          <TickChip key={c.id} c={c} name={m.name} on={r.verdicts[c.id].met} onToggle={() => tick(m.id, c.id, !r.verdicts[c.id].met)} />
                        ))}
                      </span>
                      {/* Score */}
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <span className={cx('block h-full rounded-full', r.allMet ? 'bg-emerald-500' : 'bg-brand')} style={{ width: `${pct}%` }} />
                        </span>
                        <span className="w-9 text-right text-xs font-semibold tabular-nums text-slate-700">{pct}%</span>
                      </span>
                      {/* Status */}
                      <span><StatusPill row={r} /></span>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        </div>

        <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
          Green = met, red = not met, grey "?" = nothing recorded for that month yet (no review, or no attendance). Hover any pill to see exactly what it was read from.
          Your confirmations and the switches above are saved for {monthLabel} and shared with every manager.
        </p>
      </div>
    </div>
  )
}
