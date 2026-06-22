import { useState, useEffect, useMemo } from 'react'
import { api, fmtAttendanceTime } from '../api/client'
import { useAsync } from '../lib/useAsync'
import type { AttendanceDay, AttendanceStaff } from '../types'
import { PageHeader } from '../components/Layout'
import { cx } from '../components/ui'

const TZ = 'America/New_York'

function todayEST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

function Avatar({ name, size = 28 }: { name: string | null; size?: number }) {
  const initials = (name || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
  const COLORS = ['#B5D4F4','#9FE1CB','#F4C0D1','#CECBF6','#FAC775','#C0DD97']
  const TEXT   = ['#0C447C','#085041','#72243E','#3C3489','#633806','#27500A']
  const idx    = (initials.charCodeAt(0) || 0) % COLORS.length
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

function MetricCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100" style={{ borderTop: accent ? `3px solid ${accent}` : undefined }}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

const PER_PAGE = 15

export default function Attendance() {
  const [date,   setDate]   = useState(todayEST())
  const [search, setSearch] = useState('')
  const [page,   setPage]   = useState(0)
  const [sortKey,  setSortKey]  = useState('login_at')
  const [sortDir,  setSortDir]  = useState<'asc' | 'desc'>('asc')
  const [clock,  setClock]  = useState('')

  useEffect(() => {
    const tick = () => setClock(
      new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(new Date()) + ' EST'
    )
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id)
  }, [])

  const rosterReq    = useAsync(() => api.attendanceRoster(date), [date])
  const staffReq     = useAsync(() => api.attendanceStaff(), [])
  const liveReq      = useAsync(() => api.attendanceLive(), [])
  const lateReq      = useAsync(() => api.attendanceExceptions('late', date, date), [date])
  const overBreakReq = useAsync(() => api.attendanceExceptions('over_break', date, date), [date])

  const rows = rosterReq.data?.rows ?? []

  const filtered = useMemo(() => {
    let data = rows.filter(r =>
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
    const present = new Set(rows.map(r => r.user_id))
    return (staffReq.data ?? []).filter((m: AttendanceStaff) => !present.has(m.user_id))
  }, [rows, staffReq.data])

  const metrics = useMemo(() => {
    const workedRows = rows.filter(r => r.hours != null)
    return {
      present:  rows.filter(r => r.present).length,
      stillIn:  rows.filter(r => r.still_in).length,
      avgHours: workedRows.length
        ? (workedRows.reduce((s, r) => s + (r.hours ?? 0), 0) / workedRows.length).toFixed(1)
        : '—',
      late: lateReq.data?.rows?.length ?? 0,
    }
  }, [rows, lateReq.data])

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }
  const sa = (key: string) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  const totalPages = Math.ceil(filtered.length / PER_PAGE)
  const pageSlice  = filtered.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)

  return (
    <div>
      <PageHeader title="Attendance" subtitle="Team check-in / check-out via Telegram bot">
        <span className="text-xs text-slate-400 tabular-nums">{clock}</span>
      </PageHeader>

      {/* Status strip */}
      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-100">
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
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Present today"    value={metrics.present}  sub={`of ${staffReq.data?.length ?? '?'} staff`} accent="#1D9E75" />
        <MetricCard label="Still checked in" value={metrics.stillIn}  sub="no logout yet"        accent="#3B82F6" />
        <MetricCard label="Avg hours worked" value={metrics.avgHours !== '—' ? `${metrics.avgHours}h` : '—'} sub="checked-out only" accent="#F59E0B" />
        <MetricCard label="Late arrivals"    value={metrics.late}     sub="after 9:00 AM EST"    accent="#EF4444" />
      </div>

      {/* Alert cards */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">

        {/* Absent */}
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 overflow-hidden" style={{ borderTop: '3px solid #EF4444' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-50">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Absent</p>
              <p className="text-xs text-slate-400 mt-0.5">No record on {date}</p>
            </div>
            <span className={cx('text-2xl font-semibold', absentMembers.length > 0 ? 'text-red-500' : 'text-slate-800')}>{absentMembers.length}</span>
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

        {/* Late */}
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 overflow-hidden" style={{ borderTop: '3px solid #F59E0B' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-50">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Late check-ins</p>
              <p className="text-xs text-slate-400 mt-0.5">After 9:00 AM EST</p>
            </div>
            <span className={cx('text-2xl font-semibold', metrics.late > 0 ? 'text-amber-500' : 'text-slate-800')}>{metrics.late}</span>
          </div>
          <div className="px-4 py-3 min-h-12">
            {metrics.late === 0
              ? <p className="text-xs text-emerald-600">✓ No late check-ins</p>
              : <div className="flex flex-col gap-1.5">
                  {(lateReq.data?.rows ?? []).map((r, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700">{r.staff_name || r.user_id}</span>
                      <span className="text-slate-400">{r.local_login}</span>
                    </div>
                  ))}
                </div>
            }
          </div>
        </div>

        {/* Break overages */}
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 overflow-hidden" style={{ borderTop: '3px solid #7C3AED' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-50">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Break overages</p>
              <p className="text-xs text-slate-400 mt-0.5">Exceeded 60-min allowance</p>
            </div>
            <span className={cx('text-2xl font-semibold', (overBreakReq.data?.rows?.length ?? 0) > 0 ? 'text-violet-600' : 'text-slate-800')}>
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
          type="date" value={date} onChange={e => setDate(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="text" placeholder="Search name or username…" value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-52 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={() => { setDate(todayEST()); setSearch('') }}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 shadow-sm hover:bg-slate-50"
        >
          Reset
        </button>
        <span className="ml-auto text-xs text-slate-400">{filtered.length} records</span>
      </div>

      {/* Table */}
      <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {[
                  ['Date', 'work_date'],
                  ['Username', 'username'],
                  ['Name', 'staff_name'],
                  ['User ID', 'user_id'],
                  ['Login (stated)', null],
                  ['Login (recorded)', 'login_at'],
                  ['Logout (stated)', null],
                  ['Logout (recorded)', 'logout_at'],
                  ['Hours', 'hours'],
                  ['Net Hours', 'net_hours'],
                  ['Break', 'break_count'],
                  ['Break M', 'break_min'],
                  ['Allowance', null],
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
                <tr><td colSpan={17} className="py-12 text-center text-sm text-slate-400">Loading…</td></tr>
              ) : rosterReq.error ? (
                <tr><td colSpan={17} className="py-12 text-center text-sm text-red-500">{rosterReq.error}</td></tr>
              ) : pageSlice.length === 0 ? (
                <tr><td colSpan={17} className="py-12 text-center text-sm text-slate-400">No records for {date}</td></tr>
              ) : pageSlice.map((r, i) => (
                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums text-slate-600">{r.work_date}</td>
                  <td className="px-3 py-2.5 text-xs font-medium text-slate-700">{r.username || '—'}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Avatar name={r.staff_name || r.username} size={24} />
                      <span className="text-xs">{r.staff_name || '—'}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-slate-400">{r.user_id}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{r.login_stated || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums">{fmtAttendanceTime(r.login_at)}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{r.logout_stated || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums">{fmtAttendanceTime(r.logout_at)}</td>
                  <td className="px-3 py-2.5 text-xs tabular-nums">{r.hours != null ? r.hours : '—'}</td>
                  <td className={cx('px-3 py-2.5 text-xs tabular-nums', r.net_hours != null && r.net_hours < 0 ? 'text-red-600' : 'text-slate-700')}>
                    {r.net_hours != null ? r.net_hours : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-center tabular-nums">{r.break_count}</td>
                  <td className="px-3 py-2.5 text-xs text-center tabular-nums">{r.break_min}</td>
                  <td className="px-3 py-2.5 text-xs text-center text-slate-400">60</td>
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
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
          <span>
            {filtered.length === 0 ? 'No records'
              : `Showing ${page * PER_PAGE + 1}–${Math.min(page * PER_PAGE + PER_PAGE, filtered.length)} of ${filtered.length}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => p - 1)} disabled={page === 0}
              className="rounded-lg border border-slate-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-slate-50"
            >← Prev</button>
            <span className="text-xs">Page {page + 1} / {totalPages || 1}</span>
            <button
              onClick={() => setPage(p => p + 1)} disabled={page + 1 >= totalPages}
              className="rounded-lg border border-slate-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-slate-50"
            >Next →</button>
          </div>
        </div>
      </div>
    </div>
  )
}