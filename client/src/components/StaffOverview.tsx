// Staff overview — the Staff tab's dashboard band, above the editable roster sheet.
//
// The sheet is for keeping the roster; this is for reading it. Headline tiles say how big
// the team is and who is in today, department cards show who sits where at a glance (and
// are where departments are added, renamed and removed — the one Departments section), and
// the month's Top Performer standing is previewed with a jump to the Review page's tab. Same visual
// language as the Dashboard: white cards, navy accents, green/red only for good/bad.
import { useState } from 'react'
import { api } from '../api/client'
import { PerformerBadge } from '../lib/performers'
import { Spinner, cx } from './ui'
import { gapLabel, lateBy, staffStatus } from '../lib/staff'
import { BRAND } from '../lib/theme'
import type { RankedRow } from '../lib/incentive'
import type { Department, StaffAttendanceRow, StaffMember } from '../types'

const NAVY = BRAND
const DEFAULT_LOGIN = '09:00'

const initials = (name: string) => {
  const w = name.trim().split(/\s+/).filter(Boolean)
  return (w.length >= 2 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase()
}

function Avatar({ name, size = 'md', muted = false }: { name: string; size?: 'sm' | 'md'; muted?: boolean }) {
  return (
    <span
      title={name}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ring-2 ring-white',
        size === 'sm' ? 'h-6 w-6 text-[9px]' : 'h-7 w-7 text-[10px]',
        muted ? 'bg-slate-300' : 'bg-brand',
      )}
    >
      {initials(name)}
    </span>
  )
}

const IconAward = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="8" r="6" /><path d="M15.5 13 17 22l-5-3-5 3 1.5-9" /></svg>
)
const IconArrowR = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
)
const IconPlus = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
)
const IconPencil = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
)
const IconTrash = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
)
const IconClose = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
)
const IconCheck = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>
)

export default function StaffOverview({ staff, departments, today, todayRows, todayLoading, ranked, rankedLoading, monthLabel, onOpenTop, onOpenAttendance, onDepartmentsChanged }: {
  staff: StaffMember[]
  departments: Department[]
  /** Re-reads the roster and departments after one is added, renamed or removed. */
  onDepartmentsChanged: () => void
  /** The org's day, "YYYY-MM-DD". */
  today: string
  /** Today's rows from the Attendance page's day sheet. */
  todayRows: StaffAttendanceRow[]
  todayLoading: boolean
  /** The Top Performer ranking for the month, or null while it loads / when nothing applies. */
  ranked: RankedRow[] | null
  rankedLoading: boolean
  monthLabel: string
  onOpenTop: () => void
  onOpenAttendance: () => void
}) {
  // Department management — the same catalogue the Review page bands its sheets by, so a
  // department added here becomes a band there; removing one unfiles its people rather
  // than deleting them.
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: number; value: string } | null>(null)

  const addDepartment = async () => {
    if (draft.trim() === '' || busy) return
    setBusy(true); setNote(null)
    try {
      await api.createDepartment(draft.trim())
      setDraft('')
      onDepartmentsChanged()
    } catch (err) { setNote((err as Error).message) } finally { setBusy(false) }
  }
  const renameDepartment = async () => {
    if (!renaming || renaming.value.trim() === '') return
    try {
      await api.renameDepartment(renaming.id, renaming.value.trim())
      setRenaming(null); setNote(null)
      onDepartmentsChanged()
    } catch (err) { setNote((err as Error).message) }
  }
  const removeDepartment = async (d: Department) => {
    const people = d.staff_count === 1 ? '1 person' : `${d.staff_count} people`
    const warning = d.staff_count > 0
      ? `Remove "${d.name}"? ${people} lose the department, and their reviews move to "No department".`
      : `Remove "${d.name}"?`
    if (!confirm(warning)) return
    try {
      await api.deleteDepartment(d.id)
      setNote(null)
      onDepartmentsChanged()
    } catch (err) { setNote((err as Error).message) }
  }

  const active = staff.filter((m) => m.status === 'active')
  const onLeave = staff.filter((m) => m.status === 'leave')
  const inactive = staff.filter((m) => m.status === 'inactive')

  const byStaff = new Map(todayRows.map((r) => [r.staff_id, r]))
  const inToday = active.filter((m) => byStaff.get(m.id)?.login_at)
  const late = inToday
    .map((m) => ({ m, min: lateBy(byStaff.get(m.id)?.login_at ?? null, m.expected_login ?? DEFAULT_LOGIN) ?? 0 }))
    .filter((x) => x.min > 0)
    .sort((a, b) => b.min - a.min)
  const notIn = active.filter((m) => !byStaff.get(m.id)?.login_at)

  const tiles = [
    { label: 'Active staff', value: String(active.length), sub: `${staff.length} on roster`, tone: 'text-slate-900' },
    { label: 'On leave', value: String(onLeave.length), sub: onLeave.length ? onLeave.map((m) => m.name.split(' ')[0]).slice(0, 3).join(', ') : 'nobody', tone: onLeave.length ? 'text-brand' : 'text-slate-900' },
    { label: 'Inactive', value: String(inactive.length), sub: 'not on the job', tone: 'text-slate-900' },
    { label: 'In today', value: todayLoading ? '…' : String(inToday.length), sub: `of ${active.length} active`, tone: 'text-brand' },
    { label: 'Late today', value: todayLoading ? '…' : String(late.length), sub: late.length ? `worst ${gapLabel(late[0].min)}` : 'everyone on time', tone: late.length ? 'text-rose-600' : 'text-emerald-600' },
    { label: 'Not in yet', value: todayLoading ? '…' : String(notIn.length), sub: today, tone: notIn.length ? 'text-rose-600' : 'text-emerald-600' },
  ]

  const topThree = ranked?.slice(0, 3) ?? []
  const winners = ranked?.filter((r) => r.allMet) ?? []

  return (
    <div className="space-y-4">
      {/* Headline tiles. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] font-medium text-slate-500">{t.label}</div>
            <div className={cx('mt-0.5 text-xl font-bold tabular-nums leading-tight', t.tone)}>{t.value}</div>
            <div className="truncate text-[10px] text-slate-400">{t.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Departments — who sits where. */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 xl:col-span-2">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-slate-900">Departments</h4>
            <span className="text-[11px] text-slate-400">{departments.length} department{departments.length === 1 ? '' : 's'}</span>
            <div className="ml-auto flex items-center gap-1">
              <input
                value={draft}
                placeholder="Add a department…"
                onChange={(e) => { setDraft(e.target.value); setNote(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') addDepartment() }}
                className="w-44 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
              <button
                type="button"
                onClick={addDepartment}
                disabled={draft.trim() === '' || busy}
                title="Add department"
                aria-label="Add department"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand text-white transition-colors hover:bg-brand-dark disabled:bg-slate-300"
              >
                {busy ? <Spinner className="h-3.5 w-3.5 text-white" /> : <IconPlus />}
              </button>
            </div>
          </div>
          {note && <p className="mb-2 text-[11px] font-medium text-rose-600">{note}</p>}
          {departments.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No departments yet — add one above and file people under it on the roster below.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {departments.map((d) => {
                const members = staff.filter((m) => m.departments.some((x) => x.id === d.id))
                const activeHere = members.filter((m) => m.status === 'active')
                const inHere = activeHere.filter((m) => byStaff.get(m.id)?.login_at).length
                const lateHere = late.filter((x) => members.some((m) => m.id === x.m.id)).length
                return (
                  <div key={d.id} className="group rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center gap-1.5">
                      {renaming?.id === d.id ? (
                        <>
                          <input
                            value={renaming.value}
                            autoFocus
                            onChange={(e) => setRenaming({ id: d.id, value: e.target.value })}
                            onKeyDown={(e) => { if (e.key === 'Enter') renameDepartment(); if (e.key === 'Escape') setRenaming(null) }}
                            className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-semibold text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                          />
                          <button type="button" onClick={renameDepartment} title="Save" aria-label="Save name" className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-600 text-white hover:bg-emerald-700"><IconCheck /></button>
                          <button type="button" onClick={() => setRenaming(null)} title="Cancel" aria-label="Cancel" className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"><IconClose /></button>
                        </>
                      ) : (
                        <>
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">{d.name}</span>
                          <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{members.length}</span>
                          <button type="button" onClick={() => setRenaming({ id: d.id, value: d.name })} title={`Rename ${d.name}`} aria-label={`Rename ${d.name}`} className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-brand focus:opacity-100 group-hover:opacity-100"><IconPencil /></button>
                          <button type="button" onClick={() => removeDepartment(d)} title={`Remove ${d.name}`} aria-label={`Remove ${d.name}`} className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-600 focus:opacity-100 group-hover:opacity-100"><IconTrash /></button>
                        </>
                      )}
                    </div>
                    <div className="mt-2 flex items-center">
                      {members.slice(0, 6).map((m, i) => (
                        <span key={m.id} className={cx(i > 0 && '-ml-1.5')}>
                          <Avatar name={m.name} size="sm" muted={m.status !== 'active'} />
                        </span>
                      ))}
                      {members.length > 6 && <span className="-ml-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-500 ring-2 ring-white">+{members.length - 6}</span>}
                      {members.length === 0 && <span className="text-[11px] text-slate-400">Nobody filed here</span>}
                    </div>
                    {members.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-x-2 text-[10px] text-slate-500">
                        <span>{todayLoading ? '…' : inHere}/{activeHere.length} in today</span>
                        {lateHere > 0 && <span className="text-rose-600">{lateHere} late</span>}
                        {members.length - activeHere.length > 0 && <span>{members.length - activeHere.length} away</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {(late.length > 0 || notIn.length > 0) && !todayLoading && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 text-[11px]">
              {late.map(({ m, min }) => (
                <span key={m.id} className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
                  {m.name} <PerformerBadge staffId={m.id} compact /> <span className="tabular-nums">{gapLabel(min)} late</span>
                </span>
              ))}
              {notIn.slice(0, 6).map((m) => (
                <span key={m.id} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-1.5 py-0.5 text-slate-500">
                  <span className={cx('h-1.5 w-1.5 rounded-full', staffStatus(m.status).dot)} />{m.name} <PerformerBadge staffId={m.id} compact /> <span className="text-slate-400">not in</span>
                </span>
              ))}
              {notIn.length > 6 && <span className="text-slate-400">+{notIn.length - 6} more</span>}
              <button type="button" onClick={onOpenAttendance} className="ml-auto inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                Attendance <IconArrowR />
              </button>
            </div>
          )}
        </section>

        {/* Top Performer — the month's standing, previewed. */}
        <section className="flex flex-col rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-1.5">
            <span style={{ color: NAVY }}><IconAward /></span>
            <h4 className="text-sm font-semibold text-slate-900">Top Performer</h4>
            <span className="text-[11px] text-slate-400">{monthLabel}</span>
          </div>
          <div className="mt-3 flex-1">
            {rankedLoading || !ranked ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-100" />)}</div>
            ) : topThree.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">Nobody active on the roster yet.</p>
            ) : (
              <ol className="space-y-2">
                {topThree.map((r) => {
                  const pct = Math.round((r.met / Math.max(1, r.total)) * 100)
                  return (
                    <li key={r.candidate.member.id} className="flex items-center gap-2.5">
                      <span className={cx('inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', r.allMet ? 'bg-emerald-600 text-white' : r.rank === 1 ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600')}>{r.rank}</span>
                      <Avatar name={r.candidate.member.name} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1 truncate text-xs font-semibold text-slate-800">
                            <span className="truncate">{r.candidate.member.name}</span>
                            <PerformerBadge staffId={r.candidate.member.id} compact />
                          </span>
                          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-600">{r.met}/{r.total}</span>
                        </span>
                        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-100">
                          <span className={cx('block h-full rounded-full', r.allMet ? 'bg-emerald-500' : 'bg-brand')} style={{ width: `${pct}%` }} />
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
            {ranked && !rankedLoading && (
              winners.length > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                  <IconCheck /> {winners.length === 1 ? `${winners[0].candidate.member.name} is eligible` : `${winners.length} eligible`}
                </span>
              ) : (
                <span className="text-[11px] text-slate-400">Nobody eligible yet</span>
              )
            )}
            <button type="button" onClick={onOpenTop} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-brand-dark">
              Top Performer on Review <IconArrowR />
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
