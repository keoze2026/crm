// Staff Dashboard — the Dashboard's second view: the whole roster with each person's metrics,
// slid in beside the overview with a back button rather than opened as a popup.
//
// One card per person pulls together what otherwise lives on five pages: the Staff roster
// (departments, status, expected hours), this month's attendance (present / late days, avg
// hours, today's clock times), the latest review (performance + %, behaviour), leaves,
// the month's salary status and queue coverage. Everything is fetched when the view mounts,
// and each block is gated by the page permission it comes from. Same clothes as the
// overview — white cards, navy accents, green/red verdicts.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { MonthSelector, currentMonth, formatMonth, shiftMonth } from './MonthSelector'
import { cx } from './ui'
import { useAsync } from '../lib/useAsync'
import {
  clockLabel,
  gapLabel,
  lateBy,
  monthRange,
  netHours,
  orgToday,
  staffStatus,
} from '../lib/staff'
import { asPercent } from '../lib/review'
import type {
  QueueAssignment,
  ReviewDepartment,
  ReviewEntry,
  StaffAttendanceRow,
  StaffLeave,
  StaffMember,
  StaffSalary,
} from '../types'

/** The flat late threshold for someone with no expected login on the Staff page. */
const DEFAULT_LOGIN = '09:00'

// ─── Rating colours: green for good, red for bad, navy outline for the middle ─────────

const GOOD = 'bg-emerald-50 text-emerald-700 ring-emerald-200'
const MID = 'bg-white text-brand ring-brand/30'
const BAD = 'bg-rose-50 text-rose-700 ring-rose-200'
const NONE = 'bg-slate-50 text-slate-400 ring-slate-200'

function performanceTone(rating: string): string {
  if (/excellent|good/i.test(rating)) return GOOD
  if (/below|poor/i.test(rating)) return BAD
  return rating ? MID : NONE
}
function behaviourTone(rating: string): string {
  if (/low/i.test(rating)) return BAD
  if (/consistent|good standing/i.test(rating)) return GOOD
  return rating ? MID : NONE
}
function salaryTone(status: string): string {
  if (/received/i.test(status)) return GOOD
  if (/not paid|hold/i.test(status)) return BAD
  return status ? MID : NONE
}

function Chip({ tone, children, title }: { tone: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset', tone)}>
      {children}
    </span>
  )
}

function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean)
  return (w.length >= 2 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase()
}

// ─── Per-person rollup ─────────────────────────────────────────────────────────

interface PersonRow {
  member: StaffMember
  today: StaffAttendanceRow | null
  todayLate: number | null
  presentDays: number
  lateDays: number
  avgHours: number | null
  leaves: StaffLeave[]
  performance: ReviewEntry | null
  behaviour: ReviewEntry | null
  salary: StaffSalary | null
  queues: number
}

function rollup(
  staff: StaffMember[],
  attendance: StaffAttendanceRow[],
  leaves: StaffLeave[],
  performance: ReviewEntry[],
  behaviour: ReviewEntry[],
  salaries: StaffSalary[],
  queues: QueueAssignment[],
  today: string,
): PersonRow[] {
  const byStaff = <T extends { staff_id: number | null }>(rows: T[]) => {
    const m = new Map<number, T[]>()
    for (const r of rows) {
      if (r.staff_id == null) continue
      m.set(r.staff_id, [...(m.get(r.staff_id) ?? []), r])
    }
    return m
  }
  const att = byStaff(attendance)
  const lv = byStaff(leaves)
  const perf = byStaff(performance)
  const beh = byStaff(behaviour)
  const sal = byStaff(salaries)
  // Reviews written before the person was linked to the roster carry only a name.
  const perfByName = new Map(performance.map((e) => [e.person_name.toLowerCase(), e]))
  const behByName = new Map(behaviour.map((e) => [e.person_name.toLowerCase(), e]))
  const queueCount = new Map<number, number>()
  for (const q of queues) queueCount.set(q.person_id, (queueCount.get(q.person_id) ?? 0) + q.codes.length)

  return staff.map((member) => {
    const days = att.get(member.id) ?? []
    const expected = member.expected_login ?? DEFAULT_LOGIN
    const present = days.filter((d) => d.login_at)
    const lateDays = present.filter((d) => (lateBy(d.login_at, expected) ?? 0) > 0).length
    const hours = present
      .map((d) => (d.login_at && d.logout_at ? netHours(d.login_at, d.logout_at, d.break_min) : null))
      .filter((h): h is number => h != null)
    const todayRow = days.find((d) => d.work_date === today) ?? null
    const key = member.name.toLowerCase()
    return {
      member,
      today: todayRow,
      todayLate: todayRow ? lateBy(todayRow.login_at, expected) : null,
      presentDays: present.length,
      lateDays,
      avgHours: hours.length ? hours.reduce((s, h) => s + h, 0) / hours.length : null,
      leaves: lv.get(member.id) ?? [],
      performance: perf.get(member.id)?.[0] ?? perfByName.get(key) ?? null,
      behaviour: beh.get(member.id)?.[0] ?? behByName.get(key) ?? null,
      salary: sal.get(member.id)?.[0] ?? null,
      queues: queueCount.get(member.id) ?? 0,
    }
  })
}

// ─── Overlay ───────────────────────────────────────────────────────────────────


// ─── View ──────────────────────────────────────────────────────────────────────

const IconBack = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
)

/**
 * The staff view of the Dashboard. It mounts when the manager slides to it, so its data is
 * fetched on mount; `onBack` slides the overview back in. The page frame it sits in is the
 * viewport-height Dashboard shell, so this view keeps a fixed header and scrolls its body.
 */
export function StaffDashboard({ onBack }: { onBack: () => void }) {
  const { canAccess } = useAuth()
  const canReviews = canAccess('reviews')
  const canQueues = canAccess('queues')

  // One month drives attendance, leaves and salary. Reviews are ABOUT the month before it
  // (a review keyed in during September judges August), so they follow one month behind.
  const [month, setMonth] = useState(currentMonth)
  const reviewMonth = shiftMonth(month, -1)
  const reviewKey = `${reviewMonth}-01`
  const today = orgToday()
  const range = useMemo(() => {
    const r = monthRange(month)
    // The current month stops at today — there is no attendance in the future.
    return r.to > today && r.from <= today ? { from: r.from, to: today } : r
  }, [month, today])

  const [search, setSearch] = useState('')
  const [dept, setDept] = useState<number | 'all'>('all')

  const staff = useAsync(() => api.staff(), [])
  const attendance = useAsync(() => api.staffAttendance(range), [range.from, range.to])
  const leaves = useAsync(() => api.staffLeaves(range), [range.from, range.to])
  const salaries = useAsync(() => api.staffSalaries(`${month}-01`), [month])
  const performance = useAsync(() => (canReviews ? api.reviewEntries('performance', reviewKey) : Promise.resolve(null)), [canReviews, reviewKey])
  const behaviour = useAsync(() => (canReviews ? api.reviewEntries('behaviour', reviewKey) : Promise.resolve(null)), [canReviews, reviewKey])
  const departments = useAsync(() => (canReviews ? api.reviewDepartments(reviewKey) : Promise.resolve(null)), [canReviews, reviewKey])
  const forwarding = useAsync(() => (canQueues ? api.queues('forwarding') : Promise.resolve(null)), [canQueues])
  const campFlow = useAsync(() => (canQueues ? api.queues('camp_flow') : Promise.resolve(null)), [canQueues])

  const rows = useMemo(
    () => rollup(
      staff.data ?? [],
      attendance.data?.rows ?? [],
      leaves.data ?? [],
      performance.data ?? [],
      behaviour.data ?? [],
      salaries.data ?? [],
      [...(forwarding.data ?? []), ...(campFlow.data ?? [])],
      today,
    ),
    [staff.data, attendance.data, leaves.data, performance.data, behaviour.data, salaries.data, forwarding.data, campFlow.data, today],
  )

  const deptOptions = useMemo(() => {
    const m = new Map<number, string>()
    for (const r of rows) for (const d of r.member.departments) m.set(d.id, d.name)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) =>
      (dept === 'all' || r.member.departments.some((d) => d.id === dept)) &&
      (!q || r.member.name.toLowerCase().includes(q) || r.member.departments.some((d) => d.name.toLowerCase().includes(q))),
    )
  }, [rows, search, dept])

  const totals = useMemo(() => {
    const active = rows.filter((r) => r.member.status === 'active')
    const scored = rows.map((r) => r.performance?.percentage).filter((p): p is number => p != null)
    const paid = rows.filter((r) => r.salary).length
    return {
      headcount: rows.length,
      active: active.length,
      onLeave: rows.filter((r) => r.member.status === 'leave').length,
      inToday: rows.filter((r) => r.today?.login_at).length,
      lateToday: rows.filter((r) => (r.todayLate ?? 0) > 0).length,
      avgScore: scored.length ? scored.reduce((s, p) => s + p, 0) / scored.length : null,
      reviewed: scored.length,
      received: rows.filter((r) => /received/i.test(r.salary?.status ?? '')).length,
      paid,
    }
  }, [rows])

  // Escape goes back, like a browser page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onBack() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onBack])

  const loading = staff.loading || attendance.loading
  const errors = [staff, attendance, leaves, salaries, performance, behaviour, departments, forwarding, campFlow].filter((b) => b.error)
  const monthIsCurrent = month === currentMonth()

  const tiles = [
    { label: 'Active staff', value: loading ? '…' : `${totals.active}`, sub: `${totals.headcount} on roster · ${totals.onLeave} on leave`, cls: 'text-slate-900' },
    { label: monthIsCurrent ? 'In today' : 'Present (last day)', value: loading ? '…' : `${totals.inToday}`, sub: `of ${totals.active} active`, cls: 'text-brand' },
    { label: 'Late today', value: loading ? '…' : `${totals.lateToday}`, sub: 'against expected login', cls: totals.lateToday ? 'text-rose-600' : 'text-emerald-600' },
    { label: 'Avg performance', value: !canReviews ? '—' : totals.avgScore == null ? '—' : `${totals.avgScore.toFixed(0)}%`, sub: canReviews ? `${totals.reviewed} reviewed · ${formatMonth(reviewMonth).slice(0, 3)}` : 'No Review access', cls: totals.avgScore == null ? 'text-slate-400' : totals.avgScore >= 75 ? 'text-emerald-600' : totals.avgScore >= 50 ? 'text-brand' : 'text-rose-600' },
    { label: 'Salaries received', value: loading ? '…' : `${totals.received}/${totals.paid}`, sub: `${formatMonth(month).slice(0, 3)} salary sheet`, cls: totals.paid && totals.received === totals.paid ? 'text-emerald-600' : 'text-slate-900' },
    { label: 'Leaves this month', value: loading ? '…' : `${(leaves.data ?? []).length}`, sub: 'leave sheet rows', cls: 'text-slate-900' },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Fixed header: back, title, month. */}
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-brand hover:text-brand"
          aria-label="Back to the dashboard"
        >
          <IconBack /> Dashboard
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">Staff</h1>
        </div>
        <p className="hidden text-xs text-slate-500 md:block">
          Attendance, leaves and salary for {formatMonth(month)} · reviews for {formatMonth(reviewMonth)}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-36 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 sm:w-48"
          />
          <MonthSelector value={month} onChange={setMonth} />
        </div>
      </div>

      {/* Scrolling body. */}
      <div className="min-h-0 flex-1 space-y-3 lg:overflow-y-auto lg:pr-1">
        {/* Tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 shadow-sm shadow-slate-900/5">
              <div className="text-[11px] font-medium text-slate-500">{t.label}</div>
              <div className={cx('mt-0.5 text-lg font-bold tabular-nums leading-tight', t.cls)}>{t.value}</div>
              <div className="truncate text-[10px] text-slate-400">{t.sub}</div>
            </div>
          ))}
        </div>

        {/* Department filter — worded as the Staff page words it. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Department</span>
          <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-0.5">
            <button onClick={() => setDept('all')} className={cx('rounded-md px-2.5 py-1 text-[11px] font-medium', dept === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>All departments</button>
            {deptOptions.map(([id, name]) => (
              <button key={id} onClick={() => setDept(id)} className={cx('rounded-md px-2.5 py-1 text-[11px] font-medium', dept === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>{name}</button>
            ))}
          </div>
          <span className="ml-auto text-[11px] text-slate-400">{visible.length} of {rows.length} staff</span>
        </div>

        {/* Department reviews — the Review page's Departments tab for the month reviewed. */}
        {canReviews && (departments.data ?? []).length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Department reviews · {formatMonth(reviewMonth).slice(0, 3)}</span>
            {(departments.data as ReviewDepartment[]).map((d) => (
              <span key={d.id} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px]">
                <span className="font-semibold text-slate-800">{d.name}</span>
                {d.performance ? <Chip tone={performanceTone(d.performance)}>{d.performance}</Chip> : <span className="text-slate-400">Not reviewed</span>}
                {d.percentage != null && <span className="font-semibold tabular-nums text-slate-600">{asPercent(d.percentage)}</span>}
              </span>
            ))}
          </div>
        )}

        {/* One card per person. */}
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-white" />)}
          </div>
        ) : visible.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white py-10 text-center text-xs text-slate-400">
            {rows.length === 0 ? 'No staff on the roster yet.' : 'Nobody matches that filter.'}
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {visible.map((r) => {
              const st = staffStatus(r.member.status)
              const t = r.today
              const late = r.todayLate ?? 0
              return (
                <li key={r.member.id} className="flex flex-col rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm shadow-slate-900/5">
                  {/* Identity + today, on one band. */}
                  <div className="flex items-center gap-2.5">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">{initials(r.member.name)}</span>
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-slate-900">{r.member.name}</span>
                        <span className={cx('inline-block h-1.5 w-1.5 shrink-0 rounded-full', st.dot)} title={st.label} />
                      </div>
                      <div className="truncate text-[10px] text-slate-400">
                        {r.member.departments.map((d) => d.name).join(' · ') || 'No department'}
                        {r.member.expected_login && ` · ${clockLabel(r.member.expected_login)}–${clockLabel(r.member.expected_logout)}`}
                      </div>
                    </div>
                    <div className="shrink-0 text-right leading-tight">
                      {t?.login_at ? (
                        <>
                          <div className="text-[11px] tabular-nums text-slate-800">{clockLabel(t.login_at)}{t.logout_at ? ` → ${clockLabel(t.logout_at)}` : ''}</div>
                          <div className={cx('text-[10px] font-semibold', late > 0 ? 'text-rose-600' : t.logout_at ? 'text-emerald-600' : 'text-brand')}>{late > 0 ? `${gapLabel(late)} late` : t.logout_at ? 'On time' : 'Still in'}</div>
                        </>
                      ) : (
                        <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">{t?.status && t.status !== 'absent' ? t.status : 'Not in'}</span>
                      )}
                    </div>
                  </div>

                  {/* Month figures. */}
                  <div className="mt-2.5 grid grid-cols-3 divide-x divide-slate-100 rounded-lg bg-slate-50 py-1.5 text-center">
                    {[
                      { label: 'Days in', value: String(r.presentDays), cls: 'text-slate-900' },
                      { label: 'Late', value: String(r.lateDays), cls: r.lateDays ? 'text-rose-600' : 'text-emerald-600' },
                      { label: 'Avg hrs', value: r.avgHours == null ? '—' : r.avgHours.toFixed(1), cls: 'text-slate-900' },
                    ].map((k) => (
                      <div key={k.label} className="px-1">
                        <div className={cx('text-sm font-bold tabular-nums leading-tight', k.cls)}>{k.value}</div>
                        <div className="text-[9px] font-medium uppercase tracking-wide text-slate-400">{k.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Ratings, salary, leaves, queues — chips in two rows. */}
                  <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px]">
                    {!canReviews ? null : r.performance ? (
                      <span className="inline-flex items-center gap-1" title={`Performance${r.performance.notes ? ` — ${r.performance.notes}` : ''}`}>
                        <Chip tone={performanceTone(r.performance.rating)}>{r.performance.rating || 'Unrated'}</Chip>
                        {r.performance.percentage != null && <span className="font-semibold tabular-nums text-slate-700">{asPercent(r.performance.percentage)}</span>}
                      </span>
                    ) : <span className="text-slate-400">Not reviewed</span>}
                    {canReviews && r.behaviour?.rating && <Chip tone={behaviourTone(r.behaviour.rating)} title={`Behaviour${r.behaviour.notes ? ` — ${r.behaviour.notes}` : ''}`}>{r.behaviour.rating}</Chip>}
                    {r.salary && (
                      <span className="inline-flex items-center gap-1" title={`Salary${r.salary.note ? ` — ${r.salary.note}` : ''}`}>
                        <Chip tone={salaryTone(r.salary.status)}>{r.salary.status || 'Salary recorded'}</Chip>
                        {r.salary.amount != null && <span className="tabular-nums text-slate-600">${r.salary.amount.toLocaleString('en-US')}</span>}
                      </span>
                    )}
                    <span className="ml-auto tabular-nums text-slate-400">
                      <span title={r.leaves.map((l) => `${l.leave_date}: ${[l.sick_leave && `sick ${l.sick_leave}`, l.half_day && `half day ${l.half_day}`, l.break_leave && `break ${l.break_leave}`, l.late_login && `late ${l.late_login}`, l.aob].filter(Boolean).join(', ')}`).join('\n') || 'No leaves this month'}>
                        {r.leaves.length} leave{r.leaves.length === 1 ? '' : 's'}
                      </span>
                      {canQueues && <> · {r.queues} queue{r.queues === 1 ? '' : 's'}</>}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {errors.length > 0 && (
          <p className="text-[11px] text-rose-600">
            Some blocks failed to load: {errors[0].error}{errors.length > 1 && ` (and ${errors.length - 1} more)`}. The rest is still current.
          </p>
        )}
      </div>
    </div>
  )
}
