import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, fmtAttendanceTime } from '../api/client'
import { useAsync } from '../lib/useAsync'
import type { AttendanceDay, AttendanceStaff } from '../types'
import { PageHeader } from '../components/Layout'
import { Button, Card, CardHeader, SegmentedTabs, Spinner, cx } from '../components/ui'
import type { Range } from '../components/DateRange'
import { fileDateRange } from '../lib/format'
import { saveXlsx } from '../lib/xlsx'
import {
  aggregateBreaks,
  buildAllUsersBreakPdf,
  buildTeamBreakPdf,
  buildUserBreakPdf,
  fmtHm,
  hoursCell,
  labelOf,
  periodLabel,
  teamBreakSheet,
  userBreakSheet,
  type BreakStat,
} from '../lib/attendanceReports'

const TZ = 'America/New_York'
const TARGET_LOGIN_MIN = 9 * 60  // 9:00 AM EST — late threshold

// ─── Date / time helpers ───────────────────────────────────────────────────────

function todayEST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

/** Current calendar month in the org timezone, as 'YYYY-MM'. */
function thisMonthEST(): string {
  return todayEST().slice(0, 7)
}

/** Shift a 'YYYY-MM' month string by `delta` months. */
function addMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Human label for a 'YYYY-MM' month, e.g. "June 2026". */
function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/**
 * Inclusive date bounds for a calendar month. The end is capped at "today"
 * for the current month so averages aren't diluted by future empty days.
 */
function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const end = `${ym}-${String(lastDay).padStart(2, '0')}`
  const todayStr = todayEST()
  return { from: `${ym}-01`, to: end > todayStr ? todayStr : end }
}

/** Format a UTC date object back to a 'YYYY-MM-DD' string. */
function isoFromUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/**
 * Inclusive Mon–Sun bounds for the week `delta` weeks from the current one,
 * in the org timezone. The current week is capped at today.
 */
function weekBounds(delta: number): { from: string; to: string } {
  const [y, m, d] = todayEST().split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  const dow = (base.getUTCDay() + 6) % 7  // 0 = Monday
  const monday = new Date(base)
  monday.setUTCDate(base.getUTCDate() - dow + delta * 7)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  const todayStr = todayEST()
  const to = isoFromUTC(sunday)
  return { from: isoFromUTC(monday), to: to > todayStr ? todayStr : to }
}

/** Minutes-since-midnight of a UTC timestamp, in the org timezone. */
function minutesEST(iso: string | null): number | null {
  if (!iso) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso))
  const h = Number(parts.find((p) => p.type === 'hour')?.value) % 24
  const m = Number(parts.find((p) => p.type === 'minute')?.value)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}

/** Render minutes-since-midnight as a 12-hour clock label. */
function fmtClock(min: number | null): string {
  if (min == null) return '—'
  const total = Math.round(min)
  const h24 = Math.floor(total / 60) % 24
  const m = total % 60
  const ampm = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

const fmtHours = (n: number | null): string => (n == null ? '—' : `${n.toFixed(1)}h`)

function shortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fullDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

const labelFor = (s: { staff_name: string | null; username: string | null; user_id: string }) =>
  s.staff_name || (s.username ? `@${s.username}` : s.user_id)

// ─── Small presentational pieces ────────────────────────────────────────────────

function Avatar({ name, size = 28 }: { name: string | null; size?: number }) {
  const initials = (name || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
  const COLORS = ['#B5D4F4', '#9FE1CB', '#F4C0D1', '#CECBF6', '#FAC775', '#C0DD97']
  const TEXT = ['#0C447C', '#085041', '#72243E', '#3C3489', '#633806', '#27500A']
  const idx = (initials.charCodeAt(0) || 0) % COLORS.length
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: COLORS[idx], color: TEXT[idx],
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 600, flexShrink: 0,
    }}>
      {initials}
    </div>
  )
}

function StatusBadge({ row }: { row: AttendanceDay }) {
  if (!row.present) return <span className="text-slate-400 text-xs">—</span>
  if (row.still_in) return <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Checked in</span>
  return <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Checked out</span>
}

function BreakStatusBadge({ overMin }: { overMin: number }) {
  if (overMin > 0) return <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold bg-red-50 text-red-700">OVER by {overMin}m</span>
  return <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold bg-emerald-50 text-emerald-700">OK</span>
}

/** Status derived from raw timestamps — works for /days rows that lack present/still_in. */
function DayStatus({ row }: { row: AttendanceDay }) {
  if (row.login_at == null) return <span className="text-slate-400 text-xs">—</span>
  if (row.logout_at == null) return <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">No logout</span>
  return <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Checked out</span>
}

/** Glass KPI card matching the Dashboard look. */
function MetricCard({ label, value, sub }: { label: string; value: ReactNode; sub?: string; accent?: string }) {
  return (
    <div className="glass rounded-2xl p-4 shadow-xl shadow-slate-900/5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

function ChartLoading() {
  return <div className="flex h-full items-center justify-center"><Spinner className="h-6 w-6" /></div>
}

/** Single-series bar-chart tooltip (matches the Dashboard tooltip style). */
function BarTooltip({ active, payload, label, unit, name }: {
  active?: boolean
  payload?: { value?: number | string; name?: number | string }[]
  label?: string | number
  unit: string
  name: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      {label != null && <div className="mb-1 font-medium text-slate-700">{label}</div>}
      <div className="flex items-center gap-1.5">
        <span className="text-slate-500">{name}:</span>
        <span className="font-medium tabular-nums text-slate-800">{payload[0].value}{unit}</span>
      </div>
    </div>
  )
}

// ─── Tab switcher ───────────────────────────────────────────────────────────────

type Tab = 'roster' | 'summary' | 'reports'

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  {
    id: 'roster', label: 'Daily Roster',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>,
  },
  {
    id: 'summary', label: 'Staff Summary',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M18 17V9M13 17V5M8 17v-3" /></svg>,
  },
  {
    id: 'reports', label: 'Staff Reports',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></svg>,
  },
]

// ════════════════════════════════════════════════════════════════════════════════
//  Page shell
// ════════════════════════════════════════════════════════════════════════════════

export default function Attendance() {
  const [tab, setTab] = useState<Tab>('roster')
  const [clock, setClock] = useState('')

  useEffect(() => {
    const tick = () => setClock(
      new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(new Date()) + ' EST'
    )
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id)
  }, [])

  return (
    <div>
      <PageHeader title="Attendance" subtitle="Team check-in / check-out via Telegram bot">
        <span className="text-xs text-slate-400 tabular-nums">{clock}</span>
      </PageHeader>

      {/* Sub-menu */}
      <div className="mb-6">
        <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} />
      </div>

      {tab === 'roster' ? <RosterView /> : tab === 'summary' ? <StaffSummaryView /> : <BreakReportsView />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
//  Daily roster  (logic unchanged — restyled to the glass theme)
// ════════════════════════════════════════════════════════════════════════════════

const PER_PAGE = 15

function RosterView() {
  const [date, setDate] = useState(todayEST())
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [sortKey, setSortKey] = useState('login_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const rosterReq = useAsync(() => api.attendanceRoster(date), [date])
  const staffReq = useAsync(() => api.attendanceStaff(), [])
  const liveReq = useAsync(() => api.attendanceLive(), [])
  const overBreakReq = useAsync(() => api.attendanceExceptions('over_break', date, date), [date])

  const rows = rosterReq.data?.rows ?? []
  const onlineIds = useMemo(() => new Set((liveReq.data ?? []).map((m: AttendanceDay) => m.user_id)), [liveReq.data])

  const filtered = useMemo(() => {
    const data = rows.filter((r) =>
      !search ||
      (r.staff_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (r.username ?? '').toLowerCase().includes(search.toLowerCase())
    )
    return [...data].sort((a, b) => {
      const va = (a as unknown as Record<string, unknown>)[sortKey]
      const vb = (b as unknown as Record<string, unknown>)[sortKey]
      if (va == null) return 1; if (vb == null) return -1
      const sa = typeof va === 'string' ? va.toLowerCase() : va
      const sb = typeof vb === 'string' ? vb.toLowerCase() : vb
      return sortDir === 'asc' ? (sa > sb ? 1 : -1) : (sa < sb ? 1 : -1)
    })
  }, [rows, search, sortKey, sortDir])

  useEffect(() => setPage(0), [date, search, sortKey, sortDir])

  const absentMembers = useMemo(() => {
    const present = new Set(rows.map((r) => r.user_id))
    return (staffReq.data ?? []).filter((m: AttendanceStaff) => !present.has(m.user_id))
  }, [rows, staffReq.data])

  const metrics = useMemo(() => {
    const workedRows = rows.filter((r) => r.hours != null)
    return {
      present: rows.filter((r) => r.present).length,
      stillIn: rows.filter((r) => r.still_in).length,
      avgHours: workedRows.length
        ? (workedRows.reduce((s, r) => s + (r.hours ?? 0), 0) / workedRows.length).toFixed(1)
        : '—',
    }
  }, [rows])

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }
  const sa = (key: string) => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '')

  const totalPages = Math.ceil(filtered.length / PER_PAGE)
  const pageSlice = filtered.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)

  return (
    <div>
      {/* Status strip */}
      <div className="glass mb-6 flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3 shadow-xl shadow-slate-900/5">
        <span className="mr-2 text-xs font-medium text-slate-500">Now online</span>
        {(liveReq.data ?? []).length === 0
          ? <span className="text-xs text-slate-400">Nobody checked in yet today</span>
          : (liveReq.data ?? []).map((m: AttendanceDay) => (
            <span key={m.user_id} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {m.staff_name || m.username || m.user_id}
            </span>
          ))
        }
      </div>

      {/* Metric cards */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard label="Present today" value={metrics.present} sub={`of ${staffReq.data?.length ?? '?'} staff`} accent="#1D9E75" />
        <MetricCard label="Still checked in" value={metrics.stillIn} sub="no logout yet" accent="#3B82F6" />
        <MetricCard label="Avg hours worked" value={metrics.avgHours !== '—' ? `${metrics.avgHours}h` : '—'} sub="checked-out only" accent="#F59E0B" />
      </div>

      {/* Alert cards */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Absent */}
        <div className="glass rounded-2xl shadow-xl shadow-slate-900/5 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/50">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Absent</p>
              <p className="text-xs text-slate-400 mt-0.5">No record on {date}</p>
            </div>
            <span className="text-2xl font-semibold text-slate-800">{absentMembers.length}</span>
          </div>
          <div className="px-4 py-3 min-h-12">
            {absentMembers.length === 0
              ? <p className="text-xs text-emerald-600">✓ Full attendance</p>
              : <div className="flex flex-wrap gap-1.5">
                {absentMembers.map((m: AttendanceStaff) => (
                  <span key={m.user_id} className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                    {m.staff_name || m.username || m.user_id}
                  </span>
                ))}
              </div>
            }
          </div>
        </div>

        {/* Break overages */}
        <div className="glass rounded-2xl shadow-xl shadow-slate-900/5 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/50">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Break overages</p>
              <p className="text-xs text-slate-400 mt-0.5">Exceeded 60-min allowance</p>
            </div>
            <span className="text-2xl font-semibold text-slate-800">
              {overBreakReq.data?.rows?.length ?? 0}
            </span>
          </div>
          <div className="px-4 py-3 min-h-12">
            {(overBreakReq.data?.rows?.length ?? 0) === 0
              ? <p className="text-xs text-emerald-600">✓ No overages</p>
              : <div className="flex flex-col gap-1.5">
                {(overBreakReq.data?.rows ?? []).map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="rounded-full bg-violet-50 px-2.5 py-1 font-medium text-violet-700">{r.staff_name || r.user_id}</span>
                    <span className="text-violet-500">+{r.over_min}m</span>
                  </div>
                ))}
              </div>
            }
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="glass-input rounded-lg border border-white/70 px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
        <input
          type="text" placeholder="Search name or username…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="glass-input w-52 rounded-lg border border-white/70 px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
        <button
          onClick={() => { setDate(todayEST()); setSearch('') }}
          className="glass-input rounded-lg border border-white/70 px-3 py-1.5 text-sm text-slate-600 hover:bg-white/80"
        >
          Reset
        </button>
        <span className="ml-auto text-xs text-slate-400">{filtered.length} records</span>
      </div>

      {/* Table */}
      <div className="glass rounded-2xl shadow-xl shadow-slate-900/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/50 bg-white/40">
                {[
                  ['Date', 'work_date'],
                  ['Username', 'username'],
                  ['Name', 'staff_name'],
                  ['Active', null],
                  ['User ID', 'user_id'],
                  ['Login (recorded)', 'login_at'],
                  ['Logout (recorded)', 'logout_at'],
                  ['Hours', 'hours'],
                  ['Net Hours', 'net_hours'],
                  ['Break', 'break_count'],
                  ['Break M', 'break_min'],
                  ['Over (m)', 'over_break_min'],
                  ['Break Status', null],
                  ['Break Detail', null],
                  ['Status', null],
                ].map(([label, key]) => (
                  <th
                    key={label as string}
                    onClick={() => key && handleSort(key as string)}
                    className={cx(
                      'whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500',
                      key ? 'cursor-pointer hover:text-slate-700 select-none' : ''
                    )}
                  >
                    {label as string}{key ? sa(key as string) : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rosterReq.loading ? (
                <tr><td colSpan={15} className="py-12 text-center text-sm text-slate-400">Loading…</td></tr>
              ) : rosterReq.error ? (
                <tr><td colSpan={15} className="py-12 text-center text-sm text-red-500">{rosterReq.error}</td></tr>
              ) : pageSlice.length === 0 ? (
                <tr><td colSpan={15} className="py-12 text-center text-sm text-slate-400">No records for {date}</td></tr>
              ) : pageSlice.map((r, i) => (
                <tr key={i} className="border-b border-white/40 hover:bg-white/40 transition-colors">
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums text-slate-600">{r.work_date}</td>
                  <td className="px-3 py-2.5 text-xs font-medium text-slate-700">{r.username || '—'}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Avatar name={r.staff_name || r.username} size={24} />
                      <span className="text-xs">{r.staff_name || '—'}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center"><ActiveBadge active={onlineIds.has(r.user_id)} /></td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-slate-400">{r.user_id}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums">{fmtAttendanceTime(r.login_at)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums">{fmtAttendanceTime(r.logout_at)}</td>
                  <td className="px-3 py-2.5 text-xs tabular-nums">{r.hours != null ? r.hours : '—'}</td>
                  <td className={cx('px-3 py-2.5 text-xs tabular-nums', r.net_hours != null && r.net_hours < 0 ? 'text-red-600' : 'text-slate-700')}>
                    {r.net_hours != null ? r.net_hours : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-center tabular-nums">{r.break_count}</td>
                  <td className="px-3 py-2.5 text-xs text-center tabular-nums">{r.break_min}</td>
                  <td className={cx('px-3 py-2.5 text-xs text-center tabular-nums', r.over_break_min > 0 ? 'text-red-600' : 'text-slate-700')}>
                    {r.over_break_min}
                  </td>
                  <td className="px-3 py-2.5"><BreakStatusBadge overMin={r.over_break_min} /></td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-600">{r.break_detail || '—'}</td>
                  <td className="px-3 py-2.5"><StatusBadge row={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-white/50 px-4 py-3 text-sm text-slate-500">
          <span>
            {filtered.length === 0 ? 'No records'
              : `Showing ${page * PER_PAGE + 1}–${Math.min(page * PER_PAGE + PER_PAGE, filtered.length)} of ${filtered.length}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => p - 1)} disabled={page === 0}
              className="glass-input rounded-lg border border-white/70 px-3 py-1 text-xs disabled:opacity-40 hover:bg-white/80"
            >← Prev</button>
            <span className="text-xs">Page {page + 1} / {totalPages || 1}</span>
            <button
              onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= totalPages}
              className="glass-input rounded-lg border border-white/70 px-3 py-1 text-xs disabled:opacity-40 hover:bg-white/80"
            >Next →</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
//  Staff summary  (32-day window, computed client-side from /attendance/days)
// ════════════════════════════════════════════════════════════════════════════════

interface StaffStat {
  user_id: string
  staff_name: string | null
  username: string | null
  daysPresent: number
  daysComplete: number
  totalHours: number
  netHours: number
  avgHoursPerDay: number | null
  avgCheckIn: number | null
  avgCheckOut: number | null
  totalBreakMin: number
  avgBreakMin: number | null
  overBreakDays: number
  totalOverBreakMin: number
  lateDays: number
  attendanceRate: number   // 0..1 of operational days
  completionRate: number   // 0..1 of present days that logged out
  lastDay: string | null
  rows: AttendanceDay[]
}

const SUMMARY_COLUMNS: { label: string; key: keyof StaffStat | 'name'; align: 'left' | 'right' | 'center' }[] = [
  { label: 'Staff', key: 'name', align: 'left' },
  { label: 'Present', key: 'daysPresent', align: 'center' },
  { label: 'Attendance', key: 'attendanceRate', align: 'center' },
  { label: 'Avg check-in', key: 'avgCheckIn', align: 'center' },
  { label: 'Total hours', key: 'totalHours', align: 'right' },
  { label: 'Avg hrs/day', key: 'avgHoursPerDay', align: 'right' },
  { label: 'Break used', key: 'totalBreakMin', align: 'right' },
]

function StaffSummaryView() {
  const currentMonth = thisMonthEST()
  const [month, setMonth] = useState(currentMonth)
  const { from, to } = monthBounds(month)

  const daysReq = useAsync(() => api.attendanceDays({ from, to }), [from, to])
  const staffReq = useAsync(() => api.attendanceStaff(), [])

  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<keyof StaffStat | 'name'>('totalHours')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selected, setSelected] = useState<StaffStat | null>(null)

  const rows = daysReq.data?.rows ?? []

  const operationalDays = useMemo(
    () => new Set(rows.map((r) => r.work_date)).size,
    [rows],
  )

  const stats = useMemo<StaffStat[]>(() => {
    const byUser = new Map<string, AttendanceDay[]>()
    for (const r of rows) {
      const arr = byUser.get(r.user_id) ?? []
      arr.push(r)
      byUser.set(r.user_id, arr)
    }

    // Seed with the full directory so chronic-absence staff still surface.
    const ids = new Set<string>([...byUser.keys(), ...(staffReq.data ?? []).map((s) => s.user_id)])
    const dir = new Map((staffReq.data ?? []).map((s) => [s.user_id, s]))

    const out: StaffStat[] = []
    for (const id of ids) {
      const userRows = (byUser.get(id) ?? []).slice().sort((a, b) => (a.work_date < b.work_date ? -1 : 1))
      const present = userRows.filter((r) => r.login_at != null)
      const complete = userRows.filter((r) => r.logout_at != null)
      const checkIns = present.map((r) => minutesEST(r.login_at)).filter((m): m is number => m != null)
      const checkOuts = complete.map((r) => minutesEST(r.logout_at)).filter((m): m is number => m != null)
      const totalHours = complete.reduce((s, r) => s + (r.hours ?? 0), 0)
      const netHours = userRows.reduce((s, r) => s + (r.net_hours ?? 0), 0)
      const totalBreakMin = userRows.reduce((s, r) => s + (r.break_min ?? 0), 0)
      const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
      const meta = dir.get(id)

      out.push({
        user_id: id,
        staff_name: meta?.staff_name ?? userRows[0]?.staff_name ?? null,
        username: meta?.username ?? userRows[0]?.username ?? null,
        daysPresent: present.length,
        daysComplete: complete.length,
        totalHours,
        netHours,
        avgHoursPerDay: complete.length ? totalHours / complete.length : null,
        avgCheckIn: avg(checkIns),
        avgCheckOut: avg(checkOuts),
        totalBreakMin,
        avgBreakMin: present.length ? totalBreakMin / present.length : null,
        overBreakDays: userRows.filter((r) => (r.over_break_min ?? 0) > 0).length,
        totalOverBreakMin: userRows.reduce((s, r) => s + (r.over_break_min ?? 0), 0),
        lateDays: checkIns.filter((m) => m > TARGET_LOGIN_MIN).length,
        attendanceRate: operationalDays ? present.length / operationalDays : 0,
        completionRate: present.length ? complete.length / present.length : 0,
        lastDay: userRows.length ? userRows[userRows.length - 1].work_date : null,
        rows: userRows,
      })
    }
    return out
  }, [rows, staffReq.data, operationalDays])

  const filtered = useMemo(() => {
    const data = stats.filter((s) =>
      !search ||
      (s.staff_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (s.username ?? '').toLowerCase().includes(search.toLowerCase())
    )
    return [...data].sort((a, b) => {
      if (sortKey === 'name') {
        const an = (a.staff_name ?? a.username ?? '').toLowerCase()
        const bn = (b.staff_name ?? b.username ?? '').toLowerCase()
        return sortDir === 'asc' ? (an > bn ? 1 : -1) : (an < bn ? 1 : -1)
      }
      const va = a[sortKey] as number | null
      const vb = b[sortKey] as number | null
      if (va == null) return 1; if (vb == null) return -1
      return sortDir === 'asc' ? va - vb : vb - va
    })
  }, [stats, search, sortKey, sortDir])

  const team = useMemo(() => {
    const active = stats.filter((s) => s.daysPresent > 0)
    const allCheckIns = rows.map((r) => minutesEST(r.login_at)).filter((m): m is number => m != null)
    return {
      active: active.length,
      totalStaff: stats.length,
      totalHours: stats.reduce((s, x) => s + x.totalHours, 0),
      avgAttendance: active.length ? active.reduce((s, x) => s + x.attendanceRate, 0) / active.length : 0,
      avgCheckIn: allCheckIns.length ? allCheckIns.reduce((a, b) => a + b, 0) / allCheckIns.length : null,
      totalBreakMin: stats.reduce((s, x) => s + x.totalBreakMin, 0),
      lateDays: stats.reduce((s, x) => s + x.lateDays, 0),
    }
  }, [stats, rows])

  const topHours = useMemo(
    () => [...stats].filter((s) => s.totalHours > 0).sort((a, b) => b.totalHours - a.totalHours).slice(0, 8)
      .map((s) => ({ name: (s.staff_name || s.username || s.user_id).split(' ')[0], hours: Number(s.totalHours.toFixed(1)) })),
    [stats],
  )
  const topBreaks = useMemo(
    () => [...stats].filter((s) => s.totalBreakMin > 0).sort((a, b) => b.totalBreakMin - a.totalBreakMin).slice(0, 8)
      .map((s) => ({ name: (s.staff_name || s.username || s.user_id).split(' ')[0], breakMin: s.totalBreakMin })),
    [stats],
  )

  const handleSort = (key: keyof StaffStat | 'name') => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc') }
  }
  const sa = (key: keyof StaffStat | 'name') => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '')

  const loading = daysReq.loading
  const error = daysReq.error

  return (
    <div>
      {/* Month navigator */}
      <div className="glass mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-2.5 shadow-xl shadow-slate-900/5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMonth((m) => addMonth(m, -1))}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/70 hover:text-slate-700"
            aria-label="Previous month"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div className="flex items-center gap-2 text-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
            <span className="min-w-34 text-center font-semibold text-slate-800">{monthLabel(month)}</span>
          </div>
          <button
            onClick={() => setMonth((m) => addMonth(m, 1))}
            disabled={month >= currentMonth}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/70 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Next month"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
          {month !== currentMonth && (
            <button
              onClick={() => setMonth(currentMonth)}
              className="glass-input ml-1 rounded-lg border border-white/70 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-white/80"
            >
              This month
            </button>
          )}
        </div>
        <span className="text-xs text-slate-400">
          <span className="tabular-nums">{fullDate(from)} → {fullDate(to)}</span>
          <span className="mx-1.5">·</span>
          {operationalDays} operational day{operationalDays === 1 ? '' : 's'}
        </span>
      </div>

      {/* Team KPI cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Active staff" value={team.active} sub={`of ${team.totalStaff} on record`} accent="#3B82F6" />
        <MetricCard label="Total hours" value={fmtHours(team.totalHours)} sub="completed days" accent="#1D9E75" />
        <MetricCard label="Avg attendance" value={`${Math.round(team.avgAttendance * 100)}%`} sub="of operational days" accent="#0EA5E9" />
        <MetricCard label="Avg check-in" value={fmtClock(team.avgCheckIn)} sub="team-wide, EST" accent="#F59E0B" />
        <MetricCard label="Break time" value={`${Math.round(team.totalBreakMin / 60)}h`} sub={`${team.totalBreakMin} min total`} accent="#7C3AED" />
        <MetricCard label="Late check-ins" value={team.lateDays} sub="after 9:00 AM EST" accent="#EF4444" />
      </div>

      {/* Charts */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top staff by hours" subtitle={`Total worked hours · ${monthLabel(month)}`} />
          <div className="h-72 px-2 py-4">
            {loading ? <ChartLoading /> : topHours.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">No completed days in window</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topHours} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => `${v}h`} tick={{ fontSize: 12, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} axisLine={false} width={72} />
                  <Tooltip cursor={{ fill: '#f8fafc' }} content={<BarTooltip unit="h" name="Hours" />} />
                  <Bar dataKey="hours" name="Hours" radius={[0, 4, 4, 0]} fill="#2563eb" barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Break utilization" subtitle={`Total break minutes · ${monthLabel(month)}`} />
          <div className="h-72 px-2 py-4">
            {loading ? <ChartLoading /> : topBreaks.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">No breaks recorded in window</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topBreaks} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => `${v}m`} tick={{ fontSize: 12, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} axisLine={false} width={72} />
                  <Tooltip cursor={{ fill: '#f8fafc' }} content={<BarTooltip unit=" min" name="Break" />} />
                  <Bar dataKey="breakMin" name="Break minutes" radius={[0, 4, 4, 0]} fill="#7c3aed" barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text" placeholder="Search staff…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="glass-input w-52 rounded-lg border border-white/70 px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
        <span className="ml-auto text-xs text-slate-400">{filtered.length} staff · click a row for details</span>
      </div>

      {/* Per-staff table */}
      <div className="glass rounded-2xl shadow-xl shadow-slate-900/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/50 bg-white/40">
                {SUMMARY_COLUMNS.map((c) => (
                  <th
                    key={c.label}
                    onClick={() => handleSort(c.key)}
                    className={cx(
                      'whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 cursor-pointer select-none hover:text-slate-700',
                      c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                    )}
                  >
                    {c.label}{sa(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={SUMMARY_COLUMNS.length} className="py-12 text-center text-sm text-slate-400">Loading…</td></tr>
              ) : error ? (
                <tr><td colSpan={SUMMARY_COLUMNS.length} className="py-12 text-center text-sm text-red-500">{error}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={SUMMARY_COLUMNS.length} className="py-12 text-center text-sm text-slate-400">No staff data in this window</td></tr>
              ) : filtered.map((s) => (
                <tr
                  key={s.user_id}
                  onClick={() => setSelected(s)}
                  className="border-b border-white/40 hover:bg-white/50 transition-colors cursor-pointer"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={s.staff_name || s.username} size={28} />
                      <div className="leading-tight">
                        <div className="text-xs font-medium text-slate-800">{s.staff_name || '—'}</div>
                        {s.username && <div className="text-[11px] text-slate-400">@{s.username}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs tabular-nums text-slate-700">
                    {s.daysPresent}<span className="text-slate-400">/{operationalDays}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <AttendancePill rate={s.attendanceRate} />
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs tabular-nums text-slate-700">{fmtClock(s.avgCheckIn)}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums text-slate-900">{fmtHours(s.totalHours)}</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-700">{fmtHours(s.avgHoursPerDay)}</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                    <span className={cx(s.totalOverBreakMin > 0 ? 'text-violet-600 font-medium' : 'text-slate-700')}>{fmtHours(s.totalBreakMin / 60)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <StaffDetailModal stat={selected} operationalDays={operationalDays} periodLabel={monthLabel(month)} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

function AttendancePill({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100)
  const tone = pct >= 80 ? 'bg-emerald-50 text-emerald-700' : pct >= 50 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums', tone)}>{pct}%</span>
}

// ─── Individual staff detail ────────────────────────────────────────────────────

function DetailStat({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="rounded-xl bg-white/60 px-3 py-2.5 ring-1 ring-white/60" style={{ borderTop: accent ? `2px solid ${accent}` : undefined }}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  )
}

function StaffDetailModal({ stat, operationalDays, periodLabel, onClose }: { stat: StaffStat; operationalDays: number; periodLabel: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const chartData = useMemo(
    () => stat.rows.map((r) => ({
      date: shortDate(r.work_date),
      hours: r.hours != null ? Number(r.hours.toFixed(1)) : 0,
      break: r.break_min ?? 0,
    })),
    [stat.rows],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/30 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div className="glass-strong w-full max-w-3xl rounded-2xl shadow-2xl shadow-slate-900/20" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/50 px-5 py-4">
          <div className="flex items-center gap-3">
            <Avatar name={stat.staff_name || stat.username} size={40} />
            <div className="leading-tight">
              <h3 className="text-lg font-semibold text-slate-900">{stat.staff_name || labelFor(stat)}</h3>
              <p className="text-xs text-slate-400">
                {stat.username ? `@${stat.username} · ` : ''}{periodLabel}{stat.lastDay ? ` · last seen ${shortDate(stat.lastDay)}` : ''}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-5 py-4">
          {/* Stat grid */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <DetailStat label="Days present" value={<>{stat.daysPresent}<span className="text-sm text-slate-400">/{operationalDays}</span></>} accent="#3B82F6" />
            <DetailStat label="Total hours" value={fmtHours(stat.totalHours)} accent="#1D9E75" />
            <DetailStat label="Avg hrs/day" value={fmtHours(stat.avgHoursPerDay)} accent="#0EA5E9" />
            <DetailStat label="Net hours" value={fmtHours(stat.netHours)} accent="#10B981" />
            <DetailStat label="Avg check-in" value={fmtClock(stat.avgCheckIn)} accent="#F59E0B" />
            <DetailStat label="Avg check-out" value={fmtClock(stat.avgCheckOut)} accent="#6366F1" />
            <DetailStat label="Break used" value={`${stat.totalBreakMin}m`} accent="#7C3AED" />
            <DetailStat label="Late days" value={stat.lateDays} accent="#EF4444" />
          </div>

          {/* Secondary line */}
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
            <span>Attendance <span className="font-semibold text-slate-700">{Math.round(stat.attendanceRate * 100)}%</span></span>
            <span>Completion <span className="font-semibold text-slate-700">{Math.round(stat.completionRate * 100)}%</span></span>
            <span>Avg break <span className="font-semibold text-slate-700">{stat.avgBreakMin != null ? `${Math.round(stat.avgBreakMin)}m/day` : '—'}</span></span>
            <span>Over-allowance <span className={cx('font-semibold', stat.overBreakDays > 0 ? 'text-violet-600' : 'text-slate-700')}>{stat.overBreakDays} day{stat.overBreakDays === 1 ? '' : 's'} ({stat.totalOverBreakMin}m)</span></span>
          </div>

          {/* Daily hours chart */}
          <div className="mt-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Daily hours</p>
            <div className="h-40">
              {chartData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">No activity in this window</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={32} tickFormatter={(v) => `${v}h`} />
                    <Tooltip cursor={{ fill: '#f8fafc' }} content={<BarTooltip unit="h" name="Hours" />} />
                    <Bar dataKey="hours" name="hours" radius={[3, 3, 0, 0]} fill="#2563eb" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Day-by-day table */}
          <div className="mt-4 max-h-64 overflow-y-auto rounded-xl ring-1 ring-white/60">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0">
                <tr className="bg-white/80 backdrop-blur">
                  {['Date', 'Check-in', 'Check-out', 'Hours', 'Break', 'Status'].map((h, i) => (
                    <th key={h} className={cx('whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500', i === 0 ? 'text-left' : 'text-right', h === 'Status' && 'text-center')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stat.rows.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-sm text-slate-400">No days recorded</td></tr>
                ) : stat.rows.slice().reverse().map((r, i) => {
                  const late = (minutesEST(r.login_at) ?? 0) > TARGET_LOGIN_MIN && r.login_at != null
                  return (
                    <tr key={i} className="border-t border-white/50 hover:bg-white/40">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{fullDate(r.work_date)}</td>
                      <td className={cx('whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums', late ? 'text-amber-600 font-medium' : 'text-slate-700')}>{fmtAttendanceTime(r.login_at)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-slate-700">{fmtAttendanceTime(r.logout_at)}</td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-700">{r.hours != null ? `${r.hours}h` : '—'}</td>
                      <td className={cx('px-3 py-2 text-right text-xs tabular-nums', r.over_break_min > 0 ? 'text-violet-600 font-medium' : 'text-slate-700')}>{r.break_min}m</td>
                      <td className="px-3 py-2 text-center"><DayStatus row={r} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
//  Break-overage reports  (weekly / monthly · team + per-member · PDF & Excel)
// ════════════════════════════════════════════════════════════════════════════════

const REPORT_PRESETS: { label: string; get: () => Range }[] = [
  { label: 'This week',  get: () => weekBounds(0) },
  { label: 'Last week',  get: () => weekBounds(-1) },
  { label: 'This month', get: () => monthBounds(thisMonthEST()) },
  { label: 'Last month', get: () => monthBounds(addMonth(thisMonthEST(), -1)) },
]

/** Filename-safe member label, e.g. "Jane Doe" → "Jane_Doe". */
function safeFileName(s: BreakStat): string {
  return labelOf(s).replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || s.user_id
}

function BreakReportsView() {
  const [range, setRange] = useState<Range>(() => monthBounds(thisMonthEST()))
  const [selectedUser, setSelectedUser] = useState('')
  const [busy, setBusy] = useState<Record<string, boolean>>({})

  const daysReq = useAsync(() => api.attendanceDays({ from: range.from, to: range.to }), [range.from, range.to])

  const rows = daysReq.data?.rows ?? []
  const stats = useMemo(() => aggregateBreaks(rows), [rows])
  const operationalDays = useMemo(() => new Set(rows.map((r) => r.work_date)).size, [rows])

  const team = useMemo(() => ({
    totalHours: stats.reduce((s, x) => s + x.totalHours, 0),
    totalBreak: stats.reduce((s, x) => s + x.totalBreakMin, 0),
    totalOver: stats.reduce((s, x) => s + x.totalOverMin, 0),
    presentDays: stats.reduce((s, x) => s + x.daysPresent, 0),
    overMembers: stats.filter((x) => x.totalOverMin > 0).length,
    members: stats.length,
  }), [stats])

  const selectedStat = useMemo(() => stats.find((s) => s.user_id === selectedUser) ?? null, [stats, selectedUser])

  const activePreset = REPORT_PRESETS.find((p) => {
    const r = p.get()
    return r.from === range.from && r.to === range.to
  })

  const fileTag = fileDateRange(range.from, range.to)
  const periodText = periodLabel(range.from, range.to)
  const hasData = stats.length > 0
  const maxDate = todayEST()

  // Defer the synchronous PDF/Excel build one tick so the button spinner can paint.
  const run = (key: string, fn: () => void) => {
    setBusy((b) => ({ ...b, [key]: true }))
    setTimeout(() => {
      try { fn() } finally { setBusy((b) => ({ ...b, [key]: false })) }
    }, 0)
  }

  const downloadTeamPdf = () => run('team-pdf', () =>
    buildTeamBreakPdf(stats, range.from, range.to).save(`Overall_Staff_Report_Team_${fileTag}.pdf`))
  const downloadTeamXlsx = () => run('team-xlsx', () =>
    saveXlsx(`Overall_Staff_Report_Team_${fileTag}.xlsx`, [teamBreakSheet(stats)]))
  const downloadAllPdf = () => run('all-pdf', () =>
    buildAllUsersBreakPdf(stats, range.from, range.to).save(`Overall_Staff_Report_AllMembers_${fileTag}.pdf`))
  const downloadUserPdf = () => { if (selectedStat) run('user-pdf', () =>
    buildUserBreakPdf(selectedStat, range.from, range.to).save(`Overall_Staff_Report_${safeFileName(selectedStat)}_${fileTag}.pdf`)) }
  const downloadUserXlsx = () => { if (selectedStat) run('user-xlsx', () =>
    saveXlsx(`Overall_Staff_Report_${safeFileName(selectedStat)}_${fileTag}.xlsx`, [userBreakSheet(selectedStat)])) }

  return (
    <div>
      {/* Period controls — weekly / monthly presets + explicit date filtering */}
      <div className="glass mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-2.5 shadow-xl shadow-slate-900/5">
        <div className="flex flex-wrap items-center gap-1.5">
          {REPORT_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setRange(p.get())}
              style={activePreset?.label === p.label ? { backgroundColor: '#34eb92', color: '#0f172a' } : undefined}
              className={cx(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                activePreset?.label === p.label
                  ? 'shadow'
                  : 'glass-input border border-white/70 text-slate-600 hover:bg-white/80',
              )}
            >
              {p.label}
            </button>
          ))}
          <label className="ml-1 flex items-center gap-1.5 text-xs font-medium text-slate-500">
            From
            <input
              type="date"
              value={range.from}
              max={range.to || maxDate}
              onChange={(e) => { if (e.target.value) setRange((r) => ({ ...r, from: e.target.value })) }}
              className="glass-input rounded-lg border border-white/70 px-2.5 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            To
            <input
              type="date"
              value={range.to}
              min={range.from}
              max={maxDate}
              onChange={(e) => { if (e.target.value) setRange((r) => ({ ...r, to: e.target.value })) }}
              className="glass-input rounded-lg border border-white/70 px-2.5 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </label>
        </div>
        <span className="text-xs text-slate-400 tabular-nums">
          {periodText} · {operationalDays} operational day{operationalDays === 1 ? '' : 's'}
        </span>
      </div>

      {/* Team KPI cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Total worked hours" value={hoursCell(team.totalHours)} sub="all members" accent="#1D9E75" />
        <MetricCard label="Total break time" value={fmtHm(team.totalBreak)} sub="all members" accent="#0EA5E9" />
        <MetricCard label="Break-time exceeding" value={fmtHm(team.totalOver)} sub="beyond 60-min/day" accent="#EF4444" />
        <MetricCard label="Members exceeding" value={team.overMembers} sub={`of ${team.members} active`} accent="#7C3AED" />
      </div>

      {/* Team report */}
      <Card className="mb-6">
        <CardHeader
          title="Overall Staff Report"
          subtitle={`Worked hours and break time over the 60-minute allowance · ${periodText}`}
          action={
            <div className="flex flex-wrap gap-2">
              <ExportBtn kind="xlsx" onClick={downloadTeamXlsx} loading={!!busy['team-xlsx']} disabled={!hasData} />
              <ExportBtn kind="pdf" onClick={downloadTeamPdf} loading={!!busy['team-pdf']} disabled={!hasData} />
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/50 bg-white/40">
                {([
                  { label: 'Staff', cls: 'text-left' },
                  { label: 'Days Logged In', cls: 'text-center' },
                  { label: 'Break Used', cls: 'text-right' },
                  { label: 'Break-Time Exceeding Allowance', cls: 'text-right' },
                  { label: 'Worked Hours', cls: 'text-right' },
                ] as const).map((c) => (
                  <th key={c.label} className={cx('px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500', c.cls)}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {daysReq.loading ? (
                <tr><td colSpan={5} className="py-12 text-center text-sm text-slate-400">Loading…</td></tr>
              ) : daysReq.error ? (
                <tr><td colSpan={5} className="py-12 text-center text-sm text-red-500">{daysReq.error}</td></tr>
              ) : !hasData ? (
                <tr><td colSpan={5} className="py-12 text-center text-sm text-slate-400">No attendance recorded in this period</td></tr>
              ) : stats.map((s) => (
                <tr key={s.user_id} className="border-b border-white/40 hover:bg-white/40 transition-colors">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={s.staff_name || s.username} size={28} />
                      <div className="leading-tight">
                        <div className="text-xs font-medium text-slate-800">{s.staff_name || '—'}</div>
                        {s.username && <div className="text-[11px] text-slate-400">@{s.username}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs tabular-nums text-slate-700">{s.daysPresent}</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-700">{fmtHm(s.totalBreakMin)}</td>
                  <td className={cx('px-3 py-2.5 text-right text-xs font-semibold tabular-nums', s.totalOverMin > 0 ? 'text-red-600' : 'text-slate-400')}>
                    {fmtHm(s.totalOverMin)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums text-slate-900">{hoursCell(s.totalHours)}</td>
                </tr>
              ))}
            </tbody>
            {hasData && (
              <tfoot>
                <tr className="border-t border-white/60 bg-white/50">
                  <td className="px-3 py-2.5 text-xs font-semibold text-slate-700">Team total</td>
                  <td className="px-3 py-2.5 text-center text-xs font-semibold tabular-nums text-slate-700">{team.presentDays}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums text-slate-700">{fmtHm(team.totalBreak)}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums text-red-600">{fmtHm(team.totalOver)}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums text-slate-900">{hoursCell(team.totalHours)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {/* Per-member report */}
      <Card>
        <CardHeader
          title="Per-member report"
          subtitle="Day-by-day worked hours and break detail for one member"
          action={
            <ExportBtn kind="pdf" label="All members PDF" onClick={downloadAllPdf} loading={!!busy['all-pdf']} disabled={!hasData} />
          }
        />
        <div className="px-5 py-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="glass-input rounded-lg border border-white/70 px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              <option value="">Select a member…</option>
              {stats.map((s) => (
                <option key={s.user_id} value={s.user_id}>{labelOf(s)}</option>
              ))}
            </select>
            <ExportBtn kind="xlsx" onClick={downloadUserXlsx} loading={!!busy['user-xlsx']} disabled={!selectedStat} />
            <ExportBtn kind="pdf" onClick={downloadUserPdf} loading={!!busy['user-pdf']} disabled={!selectedStat} />
          </div>

          {selectedStat ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-slate-500">
                <span>Days logged in <span className="font-semibold text-slate-700">{selectedStat.daysPresent}</span></span>
                <span>Worked hours <span className="font-semibold text-slate-700">{hoursCell(selectedStat.totalHours)}</span></span>
                <span>Total break <span className="font-semibold text-slate-700">{fmtHm(selectedStat.totalBreakMin)}</span></span>
                <span>
                  Break-time exceeding allowance{' '}
                  <span className={cx('font-semibold', selectedStat.totalOverMin > 0 ? 'text-red-600' : 'text-slate-700')}>{fmtHm(selectedStat.totalOverMin)}</span>
                  {' '}on {selectedStat.overDays} day{selectedStat.overDays === 1 ? '' : 's'}
                </span>
              </div>
              <div className="overflow-x-auto rounded-xl ring-1 ring-white/60">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-white/60">
                      {['Date', 'Login', 'Logout', 'Worked Hours', 'Break', 'Exceeding Allowance', 'Status'].map((h, i) => (
                        <th
                          key={h}
                          className={cx(
                            'whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500',
                            i === 0 ? 'text-left' : i === 6 ? 'text-center' : 'text-right',
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedStat.rows.length === 0 ? (
                      <tr><td colSpan={7} className="py-8 text-center text-sm text-slate-400">No days recorded</td></tr>
                    ) : selectedStat.rows.slice().reverse().map((r, i) => (
                      <tr key={i} className="border-t border-white/50 hover:bg-white/40">
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{fullDate(r.work_date)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-slate-700">{fmtAttendanceTime(r.login_at)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-slate-700">{fmtAttendanceTime(r.logout_at)}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-700">{hoursCell(r.hours)}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-700">{r.break_min}m</td>
                        <td className={cx('px-3 py-2 text-right text-xs font-medium tabular-nums', r.over_break_min > 0 ? 'text-red-600' : 'text-slate-400')}>{fmtHm(r.over_break_min)}</td>
                        <td className="px-3 py-2 text-center"><DayStatus row={r} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="rounded-xl bg-white/40 py-10 text-center text-sm text-slate-400">
              Choose a member above to preview and export their daily breakdown.
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

// ─── Status marker + export buttons ─────────────────────────────────────────────

/** Active = currently checked in (from /attendance/live); otherwise Offline. */
function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
      Offline
    </span>
  )
}

function PdfIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  )
}

function ExcelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </svg>
  )
}

function ExportBtn({ kind, label, onClick, loading, disabled }: {
  kind: 'pdf' | 'xlsx'
  label?: string
  onClick: () => void
  loading: boolean
  disabled?: boolean
}) {
  return (
    <Button variant="secondary" onClick={onClick} disabled={loading || disabled}>
      {loading ? <Spinner className="h-3.5 w-3.5" /> : kind === 'pdf' ? <PdfIcon /> : <ExcelIcon />}
      {label ?? (kind === 'pdf' ? 'PDF' : 'Excel')}
    </Button>
  )
}
