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
import type {
  AttendanceBreakRecord, AttendanceDay, AttendanceOnBreak,
  StaffAttendanceRow, StaffMember,
} from '../types'
import StaffAttendanceSheet from '../components/StaffAttendanceSheet'
import { buildStaffAttendancePdf } from '../lib/sheetPdf'
import { PageHeader } from '../components/Layout'
import { Button, CardHeader, Modal, PageLoader, SegmentedTabs, Spinner, cx } from '../components/ui'
import { BRAND } from '../lib/theme'
import type { Range } from '../components/DateRange'
import { fileDateRange } from '../lib/format'
import {
  ORG_TZ, clockLabel, earlyBy, gapLabel, impliedStatus, lateBy, loginTallies, monthRange,
  netHours, orgToday, punctuality, tallyPunctuality,
  type Punctuality,
} from '../lib/staff'
import PunctualityBadge from '../components/PunctualityBadge'
import { PerformerBadge, PerformerScope } from '../lib/performers'
import { saveXlsx } from '../lib/xlsx'
import {
  aggregateBreaks,
  buildAllUsersBreakPdf,
  buildTeamBreakPdf,
  buildUserBreakPdf,
  fmtHm,
  hoursCell,
  isLateLogin,
  labelOf,
  loginLateMinutes,
  loginMonthSheet,
  periodLabel,
  tallyByMonth,
  teamBreakSheet,
  userBreakSheet,
  type BreakStat,
} from '../lib/attendanceReports'

// The org clock lives in lib/staff so this page and Staff Management cannot drift apart
// about which day "today" is — they read the same attendance days.
const TZ = ORG_TZ

// ─── Date / time helpers ───────────────────────────────────────────────────────

const todayEST = orgToday

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
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: BRAND, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 700, flexShrink: 0,
    }}>
      {initials}
    </div>
  )
}

/**
 * Minutes late against the expected login kept for that person on the Staff page, as a
 * plain number for the cells that only need "how far off, if at all".
 *
 * The rule itself — including the flat 9:00 AM fallback for anyone whose schedule has not
 * been set yet — lives in lib/attendanceReports beside the exports, so the reports and this
 * page can never disagree about who was late.
 */
const lateMinutes = (r: AttendanceDay): number => loginLateMinutes(r) ?? 0

/**
 * Minutes short of the expected logout. There is no fallback here on purpose: a company
 * -wide finishing time was never agreed the way 9:00 AM was, so a person with no schedule
 * simply isn't marked early.
 */
const earlyMinutes = (r: AttendanceDay): number => r.early_min ?? 0

/**
 * The day's punctuality as one verdict, from the same two marks the clock cells already
 * carry — so the badge never says something the cells beside it don't.
 *
 * Each end is only judged where there was something to judge it by: a missing clock time is
 * not "on time". The two ends are not judged on the same terms, because the marks they come
 * from aren't either — a login falls back to this page's flat 9:00 AM when no schedule is
 * set (lateMinutes), a logout has no such fallback and simply isn't judged. That is why a
 * person with no schedule at all can read "Late in" in the summaries while the day sheet,
 * which never falls back, leaves the same day unmarked. Setting their expected hours on
 * Staff Management is what makes the two tabs agree.
 */
function dayFlag(r: AttendanceDay): Punctuality | null {
  return punctuality(
    r.login_at == null ? null : lateMinutes(r),
    r.logout_at == null || r.expected_logout == null ? null : earlyMinutes(r),
  )
}

/**
 * A recorded clock time, with how far it missed the schedule. On time — or with no
 * schedule to miss — it reads as a plain time, so the colour only ever means something.
 */
function ScheduleTime({ at, off, word, expected }: {
  at: string | null
  /** Minutes off schedule; 0 for on time. */
  off: number
  word: 'late' | 'early'
  /** The time it was judged against, "HH:MM", for the tooltip. */
  expected: string | null
}) {
  if (at == null || off <= 0) {
    return <span className="tabular-nums text-slate-700">{fmtAttendanceTime(at)}</span>
  }
  return (
    <span
      title={`${gapLabel(off)} ${word}${expected ? ` — expected ${clockLabel(expected)}` : ''}`}
      className="whitespace-nowrap font-medium tabular-nums text-rose-600"
    >
      {fmtAttendanceTime(at)}
      <span className="ml-1 rounded bg-rose-50 px-1 text-[10px] font-bold uppercase">
        {gapLabel(off)} {word}
      </span>
    </span>
  )
}

function ReturnedCell({ b }: { b: AttendanceBreakRecord }) {
  if (b.returned_at) return <span className="tabular-nums text-slate-700">{fmtAttendanceTime(b.returned_at)}</span>
  if (b.out_till_eod) return <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700">Out till EOD</span>
  return <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700">Still out</span>
}

/**
 * The day's late returns — how many breaks came back past stated + grace and by how much in
 * all — with any never returned from called out, since those are the ones to chase.
 */
function BreakDetailModal({ row, onClose }: { row: AttendanceDay; onClose: () => void }) {
  const req = useAsync(() => api.attendanceBreaks(row.user_id, row.work_date), [row.user_id, row.work_date])
  const d = req.data
  return (
    <Modal open onClose={onClose} title={`Breaks · ${labelFor(row)} · ${fullDate(row.work_date)}`}>
      {req.loading ? (
        <PageLoader label="" size={40} className="py-6" />
      ) : req.error ? (
        <p className="text-sm text-red-600">{req.error}</p>
      ) : !d || d.breaks.length === 0 ? (
        <p className="text-sm text-slate-400">No breaks recorded.</p>
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="table-airy w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-700">
                  <th className="py-2 pr-3">Taken</th>
                  <th className="py-2 pr-3 text-right">Stated</th>
                  <th className="py-2 pr-3">Returned</th>
                  <th className="py-2 pr-3 text-right">Actual</th>
                  <th className="py-2 text-right">Late</th>
                </tr>
              </thead>
              <tbody>
                {d.breaks.map((b) => (
                  <tr key={b.id} title={b.raw ?? undefined} className="border-b border-slate-100">
                    <td className="whitespace-nowrap py-2 pr-3 text-xs">
                      <span className="tabular-nums">{fmtAttendanceTime(b.taken_at)}</span>
                      {b.urgent && <span className="ml-1.5 rounded bg-rose-50 px-1 text-[10px] font-bold uppercase text-rose-700">urgent</span>}
                    </td>
                    <td className="py-2 pr-3 text-right text-xs tabular-nums">{b.duration_min}m</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-xs"><ReturnedCell b={b} /></td>
                    <td className="py-2 pr-3 text-right text-xs tabular-nums">{gapLabel(b.actual_min)}</td>
                    <td className={cx('py-2 text-right text-xs font-medium tabular-nums', b.late_min > 0 ? 'text-rose-600' : 'text-slate-400')}>
                      {b.late_min > 0 ? `+${gapLabel(b.late_min)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Stated <b>{d.totalMin}m</b> of {d.allowanceMin}m allowed
            {d.overMin > 0 && <span className="text-red-600"> · over by {d.overMin}m</span>}
            {' '}· actually away <b>{gapLabel(d.actualMin)}</b>. Late means back more than {d.graceMin}m after
            the stated length; a break nobody returns from stops counting at {clockLabel(d.eodCutoff)}.
          </p>
          {d.overridden && (
            <p className="text-xs text-rose-700">
              This day's break total was corrected on Staff Management. The breaks above are the bot's own record.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

/** Status derived from raw timestamps — works for /days rows that lack present/still_in. */
function DayStatus({ row }: { row: AttendanceDay }) {
  if (row.login_at == null) return <span className="text-slate-400 text-xs">—</span>
  if (row.logout_at == null) return <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-brand">No logout</span>
  return <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Checked out</span>
}

/**
 * The people who logged in late on one particular day, named and worst first.
 *
 * A count in a card says a day went badly; this says WHO, which is the thing a supervisor
 * opening the page on a given date is there to find out. It sits above the table on purpose
 * — the answer should not need the roster to be scrolled, searched or sorted.
 *
 * When nobody was late it stays, quietly, in green: "nobody was late" is a different and
 * more useful statement than an empty space where the panel would have been.
 */
function LateLoginPanel({ rows, onTime, date }: {
  /** Late days only, already ordered worst first. */
  rows: DayView[]
  onTime: number
  date: string
}) {
  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm shadow-slate-900/5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-slate-700">Late logins</p>
          <p className="mt-0.5 text-xs text-slate-400">{fullDate(date)} · against each person's expected login</p>
        </div>
        <div className="flex items-center gap-4 text-right">
          <div>
            <p className="text-[11px] font-medium text-slate-400">On time</p>
            <p className="text-lg font-semibold tabular-nums text-emerald-600">{onTime}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-400">Late</p>
            <p className={cx('text-lg font-semibold tabular-nums', rows.length > 0 ? 'text-rose-600' : 'text-slate-400')}>
              {rows.length}
            </p>
          </div>
        </div>
      </div>
      <div className="min-h-12 px-4 py-3">
        {rows.length === 0 ? (
          <p className="text-xs text-emerald-600">✓ Nobody logged in late on this date</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {rows.map((d) => (
              <span
                key={d.person.id}
                title={`Logged in ${clockLabel(d.login)} — expected ${clockLabel(d.person.expected_login)}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                {d.person.name}
                <PerformerBadge staffId={d.person.id} compact />
                <span className="font-bold tabular-nums">{gapLabel(d.lateMin ?? 0)}</span>
                <span className="text-rose-400 tabular-nums">{clockLabel(d.login)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** KPI tile in the Dashboard's style: quiet label, bold figure, one line of context. */
function MetricCard({ label, value, sub }: { label: string; value: ReactNode; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm shadow-slate-900/5">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums tracking-tight text-slate-900">{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  )
}

/** White card, the Dashboard's panel, for the sections that used the shared glass Card. */
function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-xl border border-slate-200/80 bg-white shadow-sm shadow-slate-900/5', className)}>
      {children}
    </div>
  )
}

function ChartLoading() {
  return <PageLoader label="" size={40} className="h-full" />
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
    id: 'roster', label: 'Day Sheet',
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
      <PageHeader title="Attendance" subtitle="The team's day: the check-in bot's record, corrected by hand where it is wrong">
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
//  The day sheet — the CRM's one attendance table
//
//  It was two: the bot's read-only roster here, and an editable "Complete Attendance"
//  sheet on the Staff page, each showing the same day and each able to contradict the
//  other. This is both — the sheet's spreadsheet layout and its editable cells, carrying
//  the bot's breaks, returns and live state, over the whole roster rather than only the
//  people the bot happened to record.
// ════════════════════════════════════════════════════════════════════════════════

/**
 * One person's day, as the whole CRM now reads it: what is stored for them (the bot's
 * record, or the correction that replaces it), with the bot's own extras beside it.
 *
 * Everything on this tab — the cards, the panels, the sheet — is derived from this one
 * list, so no figure above the table can contradict the row under it.
 */
interface DayView {
  person: StaffMember
  /** The stored day: the bot's, or the row keyed in over it. Null when there is none. */
  row: StaffAttendanceRow | null
  /** The bot's own record, for breaks, returns and its account. Null when it has none. */
  bot: AttendanceDay | null
  login: string | null
  logout: string | null
  breakMin: number
  /** The status on record, or the one the clock times imply where none is stored. */
  status: string
  statusSet: boolean
  lateMin: number | null
  earlyMin: number | null
  flag: Punctuality | null
  hours: number | null
}

/** The statuses that count as a day at work — the same rule the server counts by. */
const AT_WORK = ['present', 'half day', 'still in']

function RosterView() {
  const [date, setDate] = useState(todayEST())
  const [search, setSearch] = useState('')
  const [breakRow, setBreakRow] = useState<AttendanceDay | null>(null)
  const month = date.slice(0, 7)

  // The roster drives the sheet: everybody gets a row for the day, whether the bot saw
  // them or not. The bot's own roster comes along for what only it knows.
  const staffReq = useAsync(() => api.staff(), [])
  const sheetReq = useAsync(() => api.staffAttendance({ from: date, to: date }), [date])
  const monthReq = useAsync(() => api.staffAttendance(monthRange(month)), [month])
  const rosterReq = useAsync(() => api.attendanceRoster(date), [date])
  const liveReq = useAsync(() => api.attendanceLive(), [])
  const onBreakReq = useAsync(() => api.attendanceOnBreak(), [])
  const lateReturnReq = useAsync(() => api.attendanceExceptions('late_return', date, date), [date])

  const people = useMemo(() => staffReq.data ?? [], [staffReq.data])
  // useAsync keeps the previous answer up while the next is in flight, so a day change
  // would briefly show yesterday's rows against today's date. The sheet is only fed rows
  // it can prove belong to the day on screen.
  const sheetRows = useMemo(
    () => (sheetReq.data?.from === date ? sheetReq.data.rows : []),
    [sheetReq.data, date],
  )
  const botRows = useMemo(
    () => (rosterReq.data?.date === date ? rosterReq.data.rows : []),
    [rosterReq.data, date],
  )
  const allowance = rosterReq.data?.breakAllowanceMin ?? 60

  const botByStaff = useMemo(() => {
    const m = new Map<number, AttendanceDay>()
    for (const r of botRows) if (r.staff_id != null && r.bot_seen) m.set(r.staff_id, r)
    return m
  }, [botRows])
  const online = useMemo(
    () => new Set((liveReq.data ?? []).map((m: AttendanceDay) => m.user_id)),
    [liveReq.data],
  )

  const monthRows = useMemo(() => monthReq.data?.rows ?? [], [monthReq.data])
  const monthTallies = useMemo(() => loginTallies(people, monthRows), [people, monthRows])

  const days: DayView[] = useMemo(() => {
    const byStaff = new Map(sheetRows.map((r) => [r.staff_id, r]))
    return people.map((person) => {
      const row = byStaff.get(person.id) ?? null
      const login = row?.login_at ?? null
      const logout = row?.logout_at ?? null
      const lateMin = lateBy(login, person.expected_login)
      const earlyMin = earlyBy(logout, person.expected_logout)
      return {
        person,
        row,
        bot: botByStaff.get(person.id) ?? null,
        login,
        logout,
        breakMin: row?.break_min ?? 0,
        status: row?.status.trim() ? row.status.trim() : impliedStatus(login, logout),
        statusSet: Boolean(row?.status.trim()),
        lateMin,
        earlyMin,
        flag: punctuality(lateMin, earlyMin),
        hours: netHours(login ?? '', logout ?? '', row?.break_min ?? 0),
      }
    })
  }, [people, sheetRows, botByStaff])

  const q = search.trim().toLowerCase()
  const shown = useMemo(
    () => (q === '' ? days : days.filter((d) =>
      d.person.name.toLowerCase().includes(q)
      || d.person.departments.some((x) => x.name.toLowerCase().includes(q))
      || (d.bot?.username ?? '').toLowerCase().includes(q))),
    [days, q],
  )

  const metrics = useMemo(() => {
    const worked = days.filter((d) => d.hours != null && d.logout)
    return {
      present: days.filter((d) => AT_WORK.includes(d.status)).length,
      stillIn: days.filter((d) => d.status === 'still in').length,
      avgHours: worked.length
        ? (worked.reduce((s, d) => s + (d.hours ?? 0), 0) / worked.length).toFixed(1)
        : '—',
      flags: tallyPunctuality(days.map((d) => d.flag)),
    }
  }, [days])

  /**
   * Everyone who logged in late on the day being shown, worst first — read off the same
   * rows the sheet renders, so the panel can never name somebody the table shows on time.
   */
  const lateLogins = useMemo(
    () => days.filter((d) => (d.lateMin ?? 0) > 0).sort((a, b) => (b.lateMin ?? 0) - (a.lateMin ?? 0)),
    [days],
  )
  const onTimeLogins = useMemo(() => days.filter((d) => d.login && (d.lateMin ?? 0) === 0).length, [days])
  const lateReturns = useMemo(() => lateReturnReq.data?.rows ?? [], [lateReturnReq.data])

  const loading = staffReq.loading || sheetReq.loading || rosterReq.loading
  const error = staffReq.error ?? sheetReq.error ?? rosterReq.error
  const blocks = [staffReq, sheetReq, monthReq, rosterReq, liveReq, onBreakReq, lateReturnReq]
  const refreshing = blocks.some((b) => b.refreshing)
  const refresh = () => blocks.forEach((b) => b.reload())
  // An edit changes the day, the month's late count beside it, and the bot-side figures
  // the cards read — so all three are re-read rather than just the row that was typed in.
  const onChanged = () => { sheetReq.reload(); monthReq.reload(); rosterReq.reload() }

  const dateLabel = fullDate(date)
  const monthName = monthLabel(month)
  const exportPdf = () => buildStaffAttendancePdf(
    people, sheetRows, dateLabel, monthTallies, monthName,
  ).save(`Attendance_${date}.pdf`)

  return (
    // Badges speak for the month the day on screen falls in.
    <PerformerScope month={month}>
    <div>
      {/* Status strip */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-4 py-2.5 shadow-sm shadow-slate-900/5">
        <span className="mr-2 text-xs font-medium text-slate-500">Now online</span>
        {(liveReq.data ?? []).length === 0
          ? <span className="text-xs text-slate-400">Nobody checked in yet today</span>
          : (liveReq.data ?? []).map((m: AttendanceDay) => (
            <span key={m.user_id} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {m.staff_name || m.username || m.user_id}
              <PerformerBadge userId={m.user_id} name={m.staff_name} compact />
            </span>
          ))
        }
        <span className="mx-2 hidden h-4 w-px bg-slate-200 sm:inline-block" />
        <span className="mr-2 text-xs font-medium text-slate-500">On a break</span>
        {(onBreakReq.data ?? []).length === 0
          ? <span className="text-xs text-slate-400">Nobody right now</span>
          : (onBreakReq.data ?? []).map((m: AttendanceOnBreak) => (
            <span
              key={`${m.user_id}-${m.taken_at}`}
              title={`Took ${m.duration_min}m at ${fmtAttendanceTime(m.taken_at)}${m.late_min > 0 ? ` — ${gapLabel(m.late_min)} past the grace` : ''}`}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
                m.late_min > 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-brand',
              )}
            >
              <span className={cx('h-1.5 w-1.5 rounded-full', m.late_min > 0 ? 'bg-rose-500' : 'bg-brand')} />
              {m.staff_name || m.username || m.user_id}
              <PerformerBadge userId={m.user_id} name={m.staff_name} compact />
              <span className="tabular-nums opacity-70">{gapLabel(m.out_for_min)} / {m.duration_min}m</span>
            </span>
          ))
        }
      </div>

      {/* Metric cards */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="At work" value={metrics.present} sub={`of ${people.length} staff`} />
        <MetricCard
          label="Late logins"
          value={<span className={lateLogins.length > 0 ? 'text-rose-600' : undefined}>{lateLogins.length}</span>}
          sub={`${onTimeLogins} on time · ${dateLabel}`}
        />
        <MetricCard label="Still checked in" value={metrics.stillIn} sub="no logout yet" />
        <MetricCard label="Avg hours worked" value={metrics.avgHours !== '—' ? `${metrics.avgHours}h` : '—'} sub="checked-out only" />
        <MetricCard
          label="Off schedule"
          value={
            <span className={metrics.flags.both > 0 ? 'text-rose-600' : undefined}>
              {metrics.flags.flagged}
              <span className="text-sm text-slate-400">/{metrics.flags.judged}</span>
            </span>
          }
          sub={`${metrics.flags.late} late in · ${metrics.flags.early} early out · ${metrics.flags.both} both`}
        />
        <MetricCard
          label="Late returns"
          value={<span className={lateReturns.length > 0 ? 'text-rose-600' : undefined}>{lateReturns.length}</span>}
          sub={lateReturns.length === 0
            ? 'everyone back on time'
            : lateReturns.slice(0, 2).map((r) => `${(r.staff_name || r.user_id).split(' ')[0]} ${r.out_till_eod ? 'out till EOD' : `+${gapLabel(r.late_min ?? 0)}`}`).join(' · ')
              + (lateReturns.length > 2 ? ` · +${lateReturns.length - 2} more` : '')}
        />
      </div>

      {/* Who was late today — named, worst first, before anything has to be scrolled to. */}
      <LateLoginPanel rows={lateLogins} onTime={onTimeLogins} date={date} />

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="bg-white rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <input
          type="text" placeholder="Search name or department…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-white w-52 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <button
          onClick={() => { setDate(todayEST()); setSearch('') }}
          className="bg-white rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          Reset
        </button>
        <button
          onClick={refresh}
          disabled={refreshing}
          title="Re-read the day from the check-in bot"
          className="bg-white rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          onClick={exportPdf}
          disabled={people.length === 0}
          className="bg-white rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          PDF
        </button>
        <span className="ml-auto text-xs text-slate-400">
          {shown.length} of {people.length} staff · {date === todayEST() ? 'today · still filling in' : 'past day'}
        </span>
      </div>

      {/* The day itself — every row editable, the bot's record filled in where it has one. */}
      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm shadow-slate-900/5">
        {loading ? (
          <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
        ) : error ? (
          <p className="py-12 text-center text-sm text-red-500">{error}</p>
        ) : (
          <StaffAttendanceSheet
            date={date}
            rows={sheetRows}
            staff={shown.map((d) => d.person)}
            monthTallies={monthTallies}
            monthLabel={monthName}
            bot={botByStaff}
            online={online}
            breakAllowanceMin={allowance}
            onBreakDetail={setBreakRow}
            onChanged={onChanged}
          />
        )}
        <p className="mt-2 border-t border-slate-100 px-1 pt-2 text-[11px] text-slate-500">
          Every cell is editable, including on a day the check-in bot recorded. What you key in
          replaces that day everywhere in the CRM — this page's figures, the Staff Summary, the
          reports and the Dashboard. The revert arrow on a corrected row puts the bot's own
          record back; the bot's data is never written to.
        </p>
      </div>

      {breakRow && <BreakDetailModal row={breakRow} onClose={() => setBreakRow(null)} />}
    </div>
    </PerformerScope>
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
  /**
   * The month's late logins — days this person clocked in after the hour expected of them.
   *
   * The same count as `lateDays`, arrived at from the login alone rather than from the
   * day's verdict, because it is the figure the summaries and the exports are read for and
   * it should not quietly change meaning if the verdict ever grows another end to judge.
   */
  lateLoginDays: number
  /** Days the login was on or before the expected hour. */
  onTimeLoginDays: number
  /** Days with a login at all — the denominator the two above are out of. */
  judgedLogins: number
  /** Minutes late summed over the late days, and the single worst of them. */
  totalLateMin: number
  worstLateMin: number
  /** Days finished before the expected logout. Only judged where a schedule was set. */
  earlyOutDays: number
  /** Days that were late in AND early out — also counted in the two figures above. */
  bothDays: number
  /** Days that were judged and carried no mark at all. */
  onTimeDays: number
  /** Days that carried at least one mark, out of the days that could be judged. */
  flaggedDays: number
  judgedDays: number
  attendanceRate: number   // 0..1 of operational days
  completionRate: number   // 0..1 of present days that logged out
  lastDay: string | null
  rows: AttendanceDay[]
}

const SUMMARY_COLUMNS: { label: string; key: keyof StaffStat | 'name'; align: 'left' | 'right' | 'center' }[] = [
  { label: 'Staff', key: 'name', align: 'left' },
  { label: 'Present', key: 'daysPresent', align: 'center' },
  { label: 'Attendance', key: 'attendanceRate', align: 'center' },
  { label: 'On-time logins', key: 'onTimeLoginDays', align: 'center' },
  { label: 'Late logins', key: 'lateLoginDays', align: 'center' },
  { label: 'Time lost', key: 'totalLateMin', align: 'center' },
  { label: 'Early out', key: 'earlyOutDays', align: 'center' },
  { label: 'Both', key: 'bothDays', align: 'center' },
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

  const rows = useMemo(() => daysReq.data?.rows ?? [], [daysReq.data])

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
      // Every day gets the same verdict the day sheet gives it, so the month's counts are
      // the days a supervisor already saw flagged.
      const flags = tallyPunctuality(userRows.map(dayFlag))
      // Late logins are counted from the login alone — see StaffStat.lateLoginDays.
      const lateMins = present.map(loginLateMinutes).filter((m): m is number => m != null)

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
        // Judged per person against their own expected hours, not one clock for everyone.
        lateDays: flags.late,
        lateLoginDays: lateMins.filter((m) => m > 0).length,
        onTimeLoginDays: lateMins.filter((m) => m === 0).length,
        judgedLogins: lateMins.length,
        totalLateMin: lateMins.reduce((s, m) => s + m, 0),
        worstLateMin: lateMins.reduce((a, m) => Math.max(a, m), 0),
        earlyOutDays: flags.early,
        bothDays: flags.both,
        onTimeDays: flags.onTime,
        flaggedDays: flags.flagged,
        judgedDays: flags.judged,
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
      earlyOutDays: stats.reduce((s, x) => s + x.earlyOutDays, 0),
      bothDays: stats.reduce((s, x) => s + x.bothDays, 0),
      onTimeDays: stats.reduce((s, x) => s + x.onTimeDays, 0),
      judgedDays: stats.reduce((s, x) => s + x.judgedDays, 0),
      lateLogins: stats.reduce((s, x) => s + x.lateLoginDays, 0),
      onTimeLogins: stats.reduce((s, x) => s + x.onTimeLoginDays, 0),
      judgedLogins: stats.reduce((s, x) => s + x.judgedLogins, 0),
      lateMin: stats.reduce((s, x) => s + x.totalLateMin, 0),
      lateMembers: stats.filter((x) => x.lateLoginDays > 0).length,
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
    // Badges speak for the month picked.
    <PerformerScope month={month}>
    <div>
      {/* Month navigator */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white px-4 py-2.5 shadow-sm shadow-slate-900/5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMonth((m) => addMonth(m, -1))}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/70 hover:text-slate-700"
            aria-label="Previous month"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div className="flex items-center gap-2 text-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
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
              className="bg-white ml-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
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

      {/* The month's login scorecards — the two figures the month is judged on, first. */}
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label={`On-time logins · ${monthLabel(month)}`}
          value={<span className="text-emerald-600">{team.onTimeLogins}</span>}
          sub={`of ${team.judgedLogins} logins this month`}
         
        />
        <MetricCard
          label={`Late logins · ${monthLabel(month)}`}
          value={<span className={team.lateLogins > 0 ? 'text-rose-600' : undefined}>{team.lateLogins}</span>}
          sub={`of ${team.judgedLogins} logins · 9:00 AM where unset`}
         
        />
        <MetricCard
          label="Time lost to late starts"
          value={<span className={team.lateMin > 0 ? 'text-rose-600' : undefined}>{fmtHm(team.lateMin)}</span>}
          sub="summed over the month's late days"
         
        />
        <MetricCard
          label="Staff logging in late"
          value={team.lateMembers}
          sub={`of ${team.active} active this month`}
         
        />
      </div>

      {/* Team KPI cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Active staff" value={team.active} sub={`of ${team.totalStaff} on record`} />
        <MetricCard label="Total hours" value={fmtHours(team.totalHours)} sub="completed days" />
        <MetricCard label="On-schedule days" value={team.onTimeDays} sub={`of ${team.judgedDays} judged`} />
        <MetricCard label="Late check-ins" value={team.lateDays} sub="past expected login · 9:00 AM if unset" />
        <MetricCard label="Early logouts" value={team.earlyOutDays} sub="before expected logout" />
        <MetricCard
          label="Late + early"
          value={<span className={team.bothDays > 0 ? 'text-rose-600' : undefined}>{team.bothDays}</span>}
          sub="days that missed both ends"
         
        />
      </div>

      {/* The figures the punctuality cards displaced, kept on one line rather than lost. */}
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 px-1 text-xs text-slate-500">
        <span>Avg attendance <span className="font-semibold text-slate-700">{Math.round(team.avgAttendance * 100)}%</span> of operational days</span>
        <span>Avg check-in <span className="font-semibold text-slate-700">{fmtClock(team.avgCheckIn)}</span> team-wide, EST</span>
        <span>Break time <span className="font-semibold text-slate-700">{Math.round(team.totalBreakMin / 60)}h</span> ({team.totalBreakMin} min total)</span>
      </div>

      {/* Charts */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel>
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
                  <Bar dataKey="hours" name="Hours" radius={[0, 4, 4, 0]} fill={BRAND} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        <Panel>
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
                  <Bar dataKey="breakMin" name="Break minutes" radius={[0, 4, 4, 0]} fill="#94a3b8" barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text" placeholder="Search staff…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-white w-52 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <span className="ml-auto text-xs text-slate-400">{filtered.length} staff · click a row for details</span>
      </div>

      {/* Per-staff table */}
      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm shadow-slate-900/5">
        <div className="overflow-x-auto">
          <table className="table-airy w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-white/40">
                {SUMMARY_COLUMNS.map((c) => (
                  <th
                    key={c.label}
                    onClick={() => handleSort(c.key)}
                    className={cx(
                      'whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-slate-700 cursor-pointer select-none hover:text-slate-700',
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
                        <div className="flex items-center gap-1 text-xs font-medium text-slate-800">
                          {s.staff_name || '—'}
                          <PerformerBadge userId={s.user_id} name={s.staff_name} compact />
                        </div>
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
                  <td className="px-3 py-2.5 text-center"><FlagCount n={s.onTimeLoginDays} tone="on-time" /></td>
                  <td className="px-3 py-2.5 text-center">
                    <LateCount days={s.lateLoginDays} of={s.judgedLogins} worstMin={s.worstLateMin} />
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs tabular-nums">
                    <span className={cx(s.totalLateMin > 0 ? 'font-semibold text-rose-600' : 'text-slate-300')}>
                      {s.totalLateMin > 0 ? fmtHm(s.totalLateMin) : '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center"><FlagCount n={s.earlyOutDays} tone="mark" /></td>
                  <td className="px-3 py-2.5 text-center"><FlagCount n={s.bothDays} tone="both" /></td>
                  <td className="px-3 py-2.5 text-center text-xs tabular-nums text-slate-700">{fmtClock(s.avgCheckIn)}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums text-slate-900">{fmtHours(s.totalHours)}</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-700">{fmtHours(s.avgHoursPerDay)}</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                    <span className={cx(s.totalOverBreakMin > 0 ? 'text-rose-600 font-medium' : 'text-slate-700')}>{fmtHours(s.totalBreakMin / 60)}</span>
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
    </PerformerScope>
  )
}

/**
 * A count of flagged days in the summary table. Zero is deliberately greyed out rather
 * than coloured: a column of quiet dashes is what makes the one person with six late days
 * findable without reading a single number.
 */
function FlagCount({ n, tone }: { n: number; tone: 'on-time' | 'mark' | 'both' }) {
  if (n === 0) return <span className="text-xs text-slate-300">—</span>
  const cls = tone === 'on-time' ? 'text-emerald-700'
    : tone === 'both' ? 'rounded bg-rose-100 px-1.5 py-0.5 text-rose-800'
      : 'text-rose-600'
  return <span className={cx('text-xs font-semibold tabular-nums', cls)}>{n}</span>
}

/**
 * The month's late logins for one person — the column this table is scanned down.
 *
 * Unlike the quiet counts beside it this one is a filled red chip, because "how many times
 * did each person turn up late this month" is the question the table is opened with, and
 * three red chips in a column of dashes answer it without a number being read. The
 * denominator rides along in the tooltip rather than the cell: it is the context you want
 * once you have found the person, not while you are still finding them.
 */
function LateCount({ days, of, worstMin }: { days: number; of: number; worstMin: number }) {
  if (days === 0) {
    return <span title={of === 0 ? 'No logins recorded' : `On time on all ${of} logins`} className="text-xs text-slate-300">—</span>
  }
  return (
    <span
      title={`${days} late login${days === 1 ? '' : 's'} out of ${of} · worst ${gapLabel(worstMin)} late`}
      className="inline-flex items-center rounded-md bg-rose-100 px-2 py-0.5 text-xs font-bold tabular-nums text-rose-800 ring-1 ring-rose-300"
    >
      {days}
      <span className="ml-0.5 font-medium text-rose-500">/{of}</span>
    </span>
  )
}

function AttendancePill({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100)
  const tone = pct >= 80 ? 'bg-emerald-50 text-emerald-700' : pct >= 50 ? 'bg-slate-100 text-brand' : 'bg-red-50 text-red-700'
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums', tone)}>{pct}%</span>
}

// ─── Individual staff detail ────────────────────────────────────────────────────

function DetailStat({ label, value }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
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
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <Avatar name={stat.staff_name || stat.username} size={40} />
            <div className="leading-tight">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                {stat.staff_name || labelFor(stat)}
                <PerformerBadge userId={stat.user_id} name={stat.staff_name} />
              </h3>
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
            <DetailStat label="Days present" value={<>{stat.daysPresent}<span className="text-sm text-slate-400">/{operationalDays}</span></>} />
            <DetailStat label="Total hours" value={fmtHours(stat.totalHours)} />
            <DetailStat label="Avg hrs/day" value={fmtHours(stat.avgHoursPerDay)} />
            <DetailStat label="Net hours" value={fmtHours(stat.netHours)} />
            <DetailStat label="Avg check-in" value={fmtClock(stat.avgCheckIn)} />
            <DetailStat label="Avg check-out" value={fmtClock(stat.avgCheckOut)} />
            <DetailStat label="Break used" value={`${stat.totalBreakMin}m`} />
            <DetailStat
              label="On-time logins"
              value={<span className="text-emerald-600">{stat.onTimeLoginDays}<span className="text-sm text-slate-400">/{stat.judgedLogins}</span></span>}
             
            />
            <DetailStat
              label="Late logins"
              value={<span className={stat.lateLoginDays > 0 ? 'text-rose-600' : undefined}>{stat.lateLoginDays}<span className="text-sm text-slate-400">/{stat.judgedLogins}</span></span>}
             
            />
            <DetailStat
              label="Time lost late"
              value={<span className={stat.totalLateMin > 0 ? 'text-rose-600' : undefined}>{fmtHm(stat.totalLateMin)}</span>}
             
            />
            <DetailStat label="Early logouts" value={stat.earlyOutDays} />
            <DetailStat
              label="Late + early"
              value={<span className={stat.bothDays > 0 ? 'text-rose-600' : undefined}>{stat.bothDays}</span>}
             
            />
          </div>

          {/* Secondary line */}
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
            <span>Attendance <span className="font-semibold text-slate-700">{Math.round(stat.attendanceRate * 100)}%</span></span>
            <span>Off schedule <span className={cx('font-semibold', stat.bothDays > 0 ? 'text-rose-600' : stat.flaggedDays > 0 ? 'text-brand' : 'text-slate-700')}>{stat.flaggedDays} of {stat.judgedDays} day{stat.judgedDays === 1 ? '' : 's'}</span></span>
            <span>Completion <span className="font-semibold text-slate-700">{Math.round(stat.completionRate * 100)}%</span></span>
            <span>Avg break <span className="font-semibold text-slate-700">{stat.avgBreakMin != null ? `${Math.round(stat.avgBreakMin)}m/day` : '—'}</span></span>
            <span>Over-allowance <span className={cx('font-semibold', stat.overBreakDays > 0 ? 'text-rose-600' : 'text-slate-700')}>{stat.overBreakDays} day{stat.overBreakDays === 1 ? '' : 's'} ({stat.totalOverBreakMin}m)</span></span>
          </div>

          {/* Daily hours chart */}
          <div className="mt-4">
            <p className="mb-1 text-xs font-semibold text-slate-700">Daily hours</p>
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
                    <Bar dataKey="hours" name="hours" radius={[3, 3, 0, 0]} fill={BRAND} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Day-by-day table */}
          <div className="mt-4 max-h-64 overflow-y-auto rounded-xl ring-1 ring-white/60">
            <table className="table-airy w-full border-collapse text-sm">
              <thead className="sticky top-0">
                <tr className="bg-white/80 backdrop-blur">
                  {['Date', 'Check-in', 'Check-out', 'Flag', 'Hours', 'Break', 'Status'].map((h, i) => (
                    <th key={h} className={cx('whitespace-nowrap px-3 py-2 text-xs font-semibold text-slate-700', i === 0 ? 'text-left' : 'text-right', (h === 'Status' || h === 'Flag') && 'text-center')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stat.rows.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-sm text-slate-400">No days recorded</td></tr>
                ) : stat.rows.slice().reverse().map((r, i) => {
                  return (
                    <tr key={i} className="border-t border-slate-100 hover:bg-white/40">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{fullDate(r.work_date)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                        <ScheduleTime at={r.login_at} off={lateMinutes(r)} word="late" expected={r.expected_login} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                        <ScheduleTime at={r.logout_at} off={earlyMinutes(r)} word="early" expected={r.expected_logout} />
                      </td>
                      <td className="px-3 py-2 text-center"><PunctualityBadge flag={dayFlag(r)} compact /></td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-700">{r.hours != null ? `${r.hours}h` : '—'}</td>
                      <td className={cx('px-3 py-2 text-right text-xs tabular-nums', r.over_break_min > 0 ? 'text-rose-600 font-medium' : 'text-slate-700')}>{r.break_min}m</td>
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

  const rows = useMemo(() => daysReq.data?.rows ?? [], [daysReq.data])
  const stats = useMemo(() => aggregateBreaks(rows), [rows])
  const operationalDays = useMemo(() => new Set(rows.map((r) => r.work_date)).size, [rows])

  const team = useMemo(() => ({
    totalHours: stats.reduce((s, x) => s + x.totalHours, 0),
    totalBreak: stats.reduce((s, x) => s + x.totalBreakMin, 0),
    totalOver: stats.reduce((s, x) => s + x.totalOverMin, 0),
    presentDays: stats.reduce((s, x) => s + x.daysPresent, 0),
    overMembers: stats.filter((x) => x.totalOverMin > 0).length,
    members: stats.length,
    lateLogins: stats.reduce((s, x) => s + x.lateDays, 0),
    onTimeLogins: stats.reduce((s, x) => s + x.onTimeDays, 0),
    lateMin: stats.reduce((s, x) => s + x.totalLateMin, 0),
    lateMembers: stats.filter((x) => x.lateDays > 0).length,
  }), [stats])

  // The same split the exports carry, so what is downloaded is what was on screen. A range
  // of one month is one row — the breakdown earns its place the moment a range crosses a
  // month boundary, which the From/To pickers make easy to do by accident.
  const months = useMemo(() => tallyByMonth(rows), [rows])

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

  // Every workbook carries the month split as its own sheet beside the table, so the
  // late-login scorecards survive the trip into Excel instead of having to be re-counted.
  const downloadTeamPdf = () => run('team-pdf', () =>
    buildTeamBreakPdf(stats, range.from, range.to, rows).save(`Overall_Staff_Report_Team_${fileTag}.pdf`))
  const downloadTeamXlsx = () => run('team-xlsx', () =>
    saveXlsx(`Overall_Staff_Report_Team_${fileTag}.xlsx`, [teamBreakSheet(stats), loginMonthSheet(rows)]))
  const downloadAllPdf = () => run('all-pdf', () =>
    buildAllUsersBreakPdf(stats, range.from, range.to).save(`Overall_Staff_Report_AllMembers_${fileTag}.pdf`))
  const downloadUserPdf = () => { if (selectedStat) run('user-pdf', () =>
    buildUserBreakPdf(selectedStat, range.from, range.to).save(`Overall_Staff_Report_${safeFileName(selectedStat)}_${fileTag}.pdf`)) }
  const downloadUserXlsx = () => { if (selectedStat) run('user-xlsx', () =>
    saveXlsx(
      `Overall_Staff_Report_${safeFileName(selectedStat)}_${fileTag}.xlsx`,
      [userBreakSheet(selectedStat), loginMonthSheet(selectedStat.rows)],
    )) }

  return (
    // A range can straddle two months; badges speak for the month it STARTS in.
    <PerformerScope month={range.from}>
    <div>
      {/* Period controls — weekly / monthly presets + explicit date filtering */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-2.5 shadow-sm shadow-slate-900/5">
        <div className="flex flex-wrap items-center gap-1.5">
          {REPORT_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setRange(p.get())}
              style={activePreset?.label === p.label ? { backgroundColor: BRAND, color: '#fff' } : undefined}
              className={cx(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                activePreset?.label === p.label
                  ? 'shadow'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50',
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
              className="bg-white rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand/20"
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
              className="bg-white rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
        </div>
        <span className="text-xs text-slate-400 tabular-nums">
          {periodText} · {operationalDays} operational day{operationalDays === 1 ? '' : 's'}
        </span>
      </div>

      {/* Login scorecards — the block every export now opens with, shown here first too. */}
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="On-time logins"
          value={<span className="text-emerald-600">{team.onTimeLogins}</span>}
          sub={`of ${team.onTimeLogins + team.lateLogins} logins in period`}
         
        />
        <MetricCard
          label="Late logins"
          value={<span className={team.lateLogins > 0 ? 'text-rose-600' : undefined}>{team.lateLogins}</span>}
          sub={`of ${team.onTimeLogins + team.lateLogins} logins in period`}
         
        />
        <MetricCard
          label="Time lost to late starts"
          value={<span className={team.lateMin > 0 ? 'text-rose-600' : undefined}>{fmtHm(team.lateMin)}</span>}
          sub="summed over late days"
         
        />
        <MetricCard label="Staff logging in late" value={team.lateMembers} sub={`of ${team.members} active`} />
      </div>

      {/* Team KPI cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Total worked hours" value={hoursCell(team.totalHours)} sub="all members" />
        <MetricCard label="Total break time" value={fmtHm(team.totalBreak)} sub="all members" />
        <MetricCard label="Break-time exceeding" value={fmtHm(team.totalOver)} sub="beyond 60-min/day" />
        <MetricCard label="Members exceeding" value={team.overMembers} sub={`of ${team.members} active`} />
      </div>

      {/* Late logins by month */}
      <Panel className="mb-6">
        <CardHeader
          title="Late logins by month"
          subtitle="The same breakdown every PDF and workbook now opens with"
        />
        <div className="overflow-x-auto">
          <table className="table-airy w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-white/40">
                {([
                  { label: 'Month', cls: 'text-left' },
                  { label: 'Operational days', cls: 'text-center' },
                  { label: 'On-time logins', cls: 'text-center' },
                  { label: 'Late logins', cls: 'text-center' },
                  { label: 'Time lost', cls: 'text-right' },
                ] as const).map((c) => (
                  <th key={c.label} className={cx('px-3 py-2.5 text-xs font-semibold text-slate-700', c.cls)}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.length === 0 ? (
                <tr><td colSpan={5} className="py-8 text-center text-sm text-slate-400">No attendance recorded in this period</td></tr>
              ) : months.map((m) => (
                <tr key={m.month} className="border-b border-white/40 hover:bg-white/40 transition-colors">
                  <td className="px-3 py-2.5 text-xs font-semibold text-slate-800">{m.label}</td>
                  <td className="px-3 py-2.5 text-center text-xs tabular-nums text-slate-700">{m.days}</td>
                  <td className="px-3 py-2.5 text-center text-xs font-semibold tabular-nums text-emerald-700">{m.onTime}</td>
                  <td className="px-3 py-2.5 text-center">
                    {m.late === 0
                      ? <span className="text-xs text-slate-300">—</span>
                      : <span className="inline-flex items-center rounded-md bg-rose-100 px-2 py-0.5 text-xs font-bold tabular-nums text-rose-800 ring-1 ring-rose-300">{m.late}</span>}
                  </td>
                  <td className={cx('px-3 py-2.5 text-right text-xs font-semibold tabular-nums', m.lateMin > 0 ? 'text-rose-600' : 'text-slate-400')}>
                    {fmtHm(m.lateMin)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Team report */}
      <Panel className="mb-6">
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
          <table className="table-airy w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-white/40">
                {([
                  { label: 'Staff', cls: 'text-left' },
                  { label: 'Days Logged In', cls: 'text-center' },
                  { label: 'On-Time Logins', cls: 'text-center' },
                  { label: 'Late Logins', cls: 'text-center' },
                  { label: 'Time Lost', cls: 'text-right' },
                  { label: 'Break Used', cls: 'text-right' },
                  { label: 'Break-Time Exceeding Allowance', cls: 'text-right' },
                  { label: 'Worked Hours', cls: 'text-right' },
                ] as const).map((c) => (
                  <th key={c.label} className={cx('px-3 py-2.5 text-xs font-semibold text-slate-700', c.cls)}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {daysReq.loading ? (
                <tr><td colSpan={8} className="py-12 text-center text-sm text-slate-400">Loading…</td></tr>
              ) : daysReq.error ? (
                <tr><td colSpan={8} className="py-12 text-center text-sm text-red-500">{daysReq.error}</td></tr>
              ) : !hasData ? (
                <tr><td colSpan={8} className="py-12 text-center text-sm text-slate-400">No attendance recorded in this period</td></tr>
              ) : stats.map((s) => (
                <tr key={s.user_id} className="border-b border-white/40 hover:bg-white/40 transition-colors">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={s.staff_name || s.username} size={28} />
                      <div className="leading-tight">
                        <div className="flex items-center gap-1 text-xs font-medium text-slate-800">
                          {s.staff_name || '—'}
                          <PerformerBadge userId={s.user_id} name={s.staff_name} compact />
                        </div>
                        {s.username && <div className="text-[11px] text-slate-400">@{s.username}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs tabular-nums text-slate-700">{s.daysPresent}</td>
                  <td className="px-3 py-2.5 text-center text-xs font-semibold tabular-nums text-emerald-700">
                    {s.onTimeDays === 0 ? <span className="text-slate-300">—</span> : s.onTimeDays}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <LateCount days={s.lateDays} of={s.lateDays + s.onTimeDays} worstMin={s.worstLateMin} />
                  </td>
                  <td className={cx('px-3 py-2.5 text-right text-xs font-semibold tabular-nums', s.totalLateMin > 0 ? 'text-rose-600' : 'text-slate-400')}>
                    {fmtHm(s.totalLateMin)}
                  </td>
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
                  <td className="px-3 py-2.5 text-center text-xs font-semibold tabular-nums text-emerald-700">{team.onTimeLogins}</td>
                  <td className="px-3 py-2.5 text-center text-xs font-semibold tabular-nums text-rose-600">{team.lateLogins}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums text-rose-600">{fmtHm(team.lateMin)}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums text-slate-700">{fmtHm(team.totalBreak)}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums text-red-600">{fmtHm(team.totalOver)}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums text-slate-900">{hoursCell(team.totalHours)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Panel>

      {/* Per-member report */}
      <Panel>
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
              className="bg-white rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand/20"
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
                <span>
                  Late logins{' '}
                  <span className={cx('font-semibold', selectedStat.lateDays > 0 ? 'text-rose-600' : 'text-emerald-600')}>
                    {selectedStat.lateDays}
                  </span>
                  {' '}of {selectedStat.lateDays + selectedStat.onTimeDays}
                  {selectedStat.lateDays > 0 && <> · <span className="font-semibold text-rose-600">{fmtHm(selectedStat.totalLateMin)}</span> lost</>}
                </span>
                <span>Worked hours <span className="font-semibold text-slate-700">{hoursCell(selectedStat.totalHours)}</span></span>
                <span>Total break <span className="font-semibold text-slate-700">{fmtHm(selectedStat.totalBreakMin)}</span></span>
                <span>
                  Break-time exceeding allowance{' '}
                  <span className={cx('font-semibold', selectedStat.totalOverMin > 0 ? 'text-red-600' : 'text-slate-700')}>{fmtHm(selectedStat.totalOverMin)}</span>
                  {' '}on {selectedStat.overDays} day{selectedStat.overDays === 1 ? '' : 's'}
                </span>
              </div>
              <div className="overflow-x-auto rounded-xl ring-1 ring-white/60">
                <table className="table-airy w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-white/60">
                      {['Date', 'Login', 'Late By', 'Logout', 'Worked Hours', 'Break', 'Exceeding Allowance', 'Status'].map((h, i) => (
                        <th
                          key={h}
                          className={cx(
                            'whitespace-nowrap px-3 py-2 text-xs font-semibold text-slate-700',
                            i === 0 ? 'text-left' : i === 7 ? 'text-center' : 'text-right',
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedStat.rows.length === 0 ? (
                      <tr><td colSpan={8} className="py-8 text-center text-sm text-slate-400">No days recorded</td></tr>
                    ) : selectedStat.rows.slice().reverse().map((r, i) => (
                      // A late day is tinted the whole way across, so it is the DAY that is
                      // findable in the list rather than one cell in the middle of it.
                      <tr key={i} className={cx('border-t border-slate-100', isLateLogin(r) ? 'bg-rose-50/70 hover:bg-rose-50' : 'hover:bg-white/40')}>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{fullDate(r.work_date)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                          <ScheduleTime at={r.login_at} off={lateMinutes(r)} word="late" expected={r.expected_login} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">
                          {r.login_at == null
                            ? <span className="text-slate-300">—</span>
                            : isLateLogin(r)
                              ? <span className="font-bold text-rose-600">{gapLabel(lateMinutes(r))}</span>
                              : <span className="text-emerald-600">On time</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                          <ScheduleTime at={r.logout_at} off={earlyMinutes(r)} word="early" expected={r.expected_logout} />
                        </td>
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
      </Panel>
    </div>
    </PerformerScope>
  )
}

// ─── Status marker + export buttons ─────────────────────────────────────────────

/** Active = currently checked in (from /attendance/live); otherwise Offline. */
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
