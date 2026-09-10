import { useMemo, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import DepartmentLists from '../components/DepartmentLists'
import { DaySelector } from '../components/DaySelector'
import { PageHeader } from '../components/Layout'
import { MonthSelector, currentMonth, formatMonth, shiftMonth } from '../components/MonthSelector'
import StaffAttendanceSheet from '../components/StaffAttendanceSheet'
import StaffLeavesSheet from '../components/StaffLeavesSheet'
import StaffSalariesSheet from '../components/StaffSalariesSheet'
import StaffSheet from '../components/StaffSheet'
import {
  Badge, Button, Card, CardHeader, DownloadIcon, EmptyState, Input, PageLoader,
  RefreshIcon, SegmentedTabs, cx,
} from '../components/ui'
import { formatDate } from '../lib/format'
import { matches } from '../lib/queues'
import {
  buildLeavesPdf, buildSalariesPdf, buildStaffAttendancePdf, buildStaffPdf,
} from '../lib/sheetPdf'
import {
  monthRange, orgNowLabel, punctualityOf, tallyPunctuality, type PunctualityTally,
} from '../lib/staff'
import { useAsync } from '../lib/useAsync'
import { useOrgToday } from '../lib/useOrgToday'

type Tab = 'staff' | 'attendance' | 'leaves' | 'salaries'

const icon = (path: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
)

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'staff', label: 'Staff', icon: icon(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></>) },
  { id: 'attendance', label: 'Complete Attendance', icon: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>) },
  { id: 'leaves', label: 'Leaves', icon: icon(<><path d="M8 2v4M16 2v4M3 10h18" /><rect x="3" y="4" width="18" height="18" rx="2" /><path d="m9 16 2 2 4-4" /></>) },
  { id: 'salaries', label: 'Salaries', icon: icon(<><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M6 12h.01M18 12h.01" /></>) },
]

/**
 * The day the attendance sheet is showing, counted up — every figure read off the SAME
 * rows the table below renders, so a scorecard can never contradict the column under it.
 *
 * "In" is out of the whole roster because the sheet lists the whole roster; the punctuality
 * figures are out of the days that could be judged, which is fewer — nobody with no
 * schedule set, and nobody who never clocked in, is counted either way.
 */
function AttendanceScore({ inCount, roster, flags }: {
  inCount: number
  roster: number
  flags: PunctualityTally
}) {
  const tiles: { label: string; value: number; of: number; tone: string }[] = [
    { label: 'In', value: inCount, of: roster, tone: 'text-slate-900' },
    { label: 'On time', value: flags.onTime, of: flags.judged, tone: 'text-emerald-700' },
    { label: 'Late in', value: flags.late, of: flags.judged, tone: 'text-amber-700' },
    { label: 'Early out', value: flags.early, of: flags.judged, tone: 'text-amber-700' },
    { label: 'Late + early', value: flags.both, of: flags.judged, tone: 'text-rose-700' },
  ]

  return (
    <div className="grid grid-cols-2 gap-px border-b border-white/50 bg-white/30 sm:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className="bg-white/40 px-4 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{t.label}</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums leading-6">
            <span className={cx(t.value === 0 ? 'text-slate-400' : t.tone)}>{t.value}</span>
            <span className="text-xs font-medium text-slate-400">/{t.of}</span>
          </p>
        </div>
      ))}
    </div>
  )
}

/**
 * Staff Management — the roster every other sheet reads, plus the three sheets that hang
 * off it.
 *
 * Each tab carries the filter it actually needs: attendance is a day at a time, opening on
 * today, because it records a day as it happens; leaves and salaries are monthly sheets
 * about the month just finished, so they open on last month like Review; and the roster is
 * neither, so it gets a search box.
 */
export default function Staff() {
  const [tab, setTab] = useState<Tab>('staff')
  // Leaves and salaries are both written up about the month just finished — a salary paid
  // in September is for August's work — so they open on last month, the way Review does.
  // Attendance is the opposite: it is a record of a day as it happens, so it opens on today.
  const [month, setMonth] = useState<string>(() => shiftMonth(currentMonth(), -1))
  const [search, setSearch] = useState('')

  // Which day the attendance tab shows. Attendance days are New York days (the API says
  // so in its `timezone`), so "today" is the ORG's, never the browser's — and it is held
  // as null rather than a date, so a sheet left open through midnight follows the day
  // over instead of quietly freezing on yesterday. Picking a day pins it; Today unpins.
  const orgDay = useOrgToday()
  const [picked, setPicked] = useState<string | null>(null)
  const date = picked ?? orgDay
  const onToday = picked === null
  const setDate = (iso: string) => setPicked(iso === orgDay ? null : iso)

  const staff = useAsync(() => api.staff(), [])
  const departments = useAsync(() => api.departments(), [])

  const range = monthRange(month)
  // The fetch stamps itself with the time it landed, so the "as of" line beside the
  // Refresh button is the age of the figures on screen rather than the clock on the wall.
  const attendance = useAsync(
    async () => tab === 'attendance'
      ? { page: await api.staffAttendance({ from: date, to: date }), at: orgNowLabel() }
      : null,
    [tab, date],
  )
  const leaves = useAsync(
    () => tab === 'leaves' ? api.staffLeaves(range) : Promise.resolve([]),
    [tab, range.from, range.to],
  )
  const salaries = useAsync(
    () => tab === 'salaries' ? api.staffSalaries(month) : Promise.resolve([]),
    [tab, month],
  )

  // The roster feeds every tab, so a change anywhere reloads it along with the sheet.
  const reloadRoster = () => { staff.reload(); departments.reload() }

  // Refresh pulls the day AND the roster: the check-in bot writes new logins and logouts
  // between page loads, and someone's expected hours may have been set on the Staff tab in
  // another window — both change what the sheet says without anything here having changed.
  const refreshAttendance = () => { attendance.reload(); staff.reload() }

  const people = useMemo(() => staff.data ?? [], [staff.data])
  const depts = useMemo(() => departments.data ?? [], [departments.data])
  /**
   * The rows on screen, but ONLY when they are the day in the heading.
   *
   * useAsync deliberately keeps the last result up while the next is in flight, which is
   * right for re-reading the same day and wrong the moment the DATE changes: for as long
   * as that fetch takes, YESTERDAY's logins sit under today's heading, carrying yesterday's
   * late marks and flags. Worse, those rows are editable, so a blur in that window would
   * write the previous day's times onto the day now selected. The response says which day
   * it answered for, so a result for any other day counts as nothing at all.
   */
  const dayOnScreen = attendance.data?.page.from === date ? attendance.data : null
  const attendanceStale = attendance.data !== null && dayOnScreen === null
  const attendanceRows = useMemo(() => dayOnScreen?.page.rows ?? [], [dayOnScreen])
  const leaveRows = leaves.data ?? []
  const salaryRows = salaries.data ?? []

  // The day's punctuality at a glance, judged exactly as the sheet's own Flag column
  // judges each row — from the effective clock times, against each person's own schedule.
  const attendanceFlags = useMemo(() => {
    const byStaff = new Map(attendanceRows.map((r) => [r.staff_id, r]))
    return tallyPunctuality(people.map((p) => {
      const row = byStaff.get(p.id)
      return punctualityOf(row?.login_at ?? null, row?.logout_at ?? null, p.expected_login, p.expected_logout)
    }))
  }, [people, attendanceRows])

  const query = search.trim()
  const shownStaff = useMemo(() => (
    query === ''
      ? people
      : people.filter((p) => matches(p.name, query) || p.departments.some((d) => matches(d.name, query)))
  ), [people, query])

  const loading = staff.loading || departments.loading
      // `attendanceStale` too: rows for another day must never reach the sheet OR the
      // scorecards, so the whole tab waits rather than showing a day it isn't titled.
      || (tab === 'attendance' && (attendance.loading || attendanceStale))
      || (tab === 'leaves' && leaves.loading)
      || (tab === 'salaries' && salaries.loading)
  const error = staff.error ?? departments.error
      ?? attendance.error ?? leaves.error ?? salaries.error

  const monthLabel = formatMonth(month)
  const dateLabel = formatDate(date)

  const exports: Record<Tab, { enabled: boolean; run: () => void }> = {
    staff: {
      enabled: people.length > 0,
      run: () => buildStaffPdf(people).save('Staff.pdf'),
    },
    attendance: {
      enabled: people.length > 0,
      run: () => buildStaffAttendancePdf(people, attendanceRows, dateLabel).save(`Attendance_${date}.pdf`),
    },
    leaves: {
      enabled: leaveRows.length > 0,
      run: () => buildLeavesPdf(leaveRows, monthLabel).save(`Leaves_${month}.pdf`),
    },
    salaries: {
      enabled: salaryRows.length > 0,
      run: () => buildSalariesPdf(salaryRows, depts, monthLabel).save(`Salaries_${month}.pdf`),
    },
  }

  return (
    <div className="min-w-0">
      <PageHeader title="Staff Management">
        {tab === 'staff' ? (
          <div className="w-full sm:w-64">
            <Input
              value={search}
              placeholder="Search a name or department…"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        ) : tab === 'attendance' ? (
          <DaySelector value={date} onChange={setDate} today={orgDay} />
        ) : (
          <MonthSelector value={month} onChange={setMonth} />
        )}
        <Button variant="secondary" disabled={!exports[tab].enabled} onClick={exports[tab].run}>
          <DownloadIcon />PDF
        </Button>
      </PageHeader>

      <div className="mb-5">
        <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} />
      </div>

      {loading ? (
        <PageLoader label="Loading staff…" />
      ) : tab === 'staff' ? (
        <>
          <DepartmentLists departments={depts} onChanged={reloadRoster} />

          <Card className="mt-6">
            <CardHeader
              title="Staff"
              action={query !== '' && people.length > 0
                ? <Badge color="blue">{`${shownStaff.length} of ${people.length}`}</Badge>
                : undefined}
            />
            <div className="p-4">
              {shownStaff.length === 0 && query !== '' ? (
                <EmptyState message={`Nothing matches "${query}".`} />
              ) : (
                <StaffSheet staff={shownStaff} departments={depts} onChanged={reloadRoster} />
              )}
            </div>
          </Card>
        </>
      ) : tab === 'attendance' ? (
        <Card>
          <CardHeader
            title={`Attendance — ${dateLabel}`}
            subtitle={
              <span className="tabular-nums">
                {onToday ? 'Today' : 'Past day'} · New York
                {attendance.data ? ` · as of ${attendance.data.at}` : ''}
                {onToday && ' · still filling in'}
              </span>
            }
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={refreshAttendance}
                disabled={attendance.loading || attendance.refreshing}
                title="Re-read the day from the check-in bot"
              >
                <RefreshIcon spinning={attendance.loading || attendance.refreshing} />
                {attendance.refreshing ? 'Refreshing…' : 'Refresh'}
              </Button>
            }
          />

          <AttendanceScore
            inCount={attendanceRows.filter((r) => r.login_at !== null).length}
            roster={people.length}
            flags={attendanceFlags}
          />

          <div className="p-4">
            <StaffAttendanceSheet
              date={date}
              rows={attendanceRows}
              staff={people}
              onChanged={attendance.reload}
            />
          </div>
        </Card>
      ) : tab === 'leaves' ? (
        <Card>
          <CardHeader
            title={`Leaves — ${monthLabel}`}
            action={<Badge>{`${leaveRows.length} rows`}</Badge>}
          />
          <div className="p-4">
            <StaffLeavesSheet
              // Remount on a month change so no row keeps the previous month's draft.
              key={month}
              month={month}
              leaves={leaveRows}
              staff={people}
              onChanged={leaves.reload}
            />
          </div>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={`Salaries — ${monthLabel}`}
            action={
              <Badge color="green">
                {`${salaryRows.filter((s) => s.status === 'Received').length} received`}
              </Badge>
            }
          />
          <div className="p-4">
            <StaffSalariesSheet
              key={month}
              month={month}
              salaries={salaryRows}
              staff={people}
              departments={depts}
              onChanged={salaries.reload}
            />
          </div>
        </Card>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </div>
  )
}

