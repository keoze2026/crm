import { useMemo, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import DepartmentLists from '../components/DepartmentLists'
import { DaySelector } from '../components/DaySelector'
import { PageHeader } from '../components/Layout'
import { MonthSelector, currentMonth, formatMonth } from '../components/MonthSelector'
import StaffAttendanceSheet from '../components/StaffAttendanceSheet'
import StaffLeavesSheet from '../components/StaffLeavesSheet'
import StaffSalariesSheet from '../components/StaffSalariesSheet'
import StaffSheet from '../components/StaffSheet'
import {
  Badge, Button, Card, CardHeader, DownloadIcon, EmptyState, Input, PageLoader,
  SegmentedTabs, StatTile,
} from '../components/ui'
import { formatDate, today } from '../lib/format'
import { matches } from '../lib/queues'
import {
  buildLeavesPdf, buildSalariesPdf, buildStaffAttendancePdf, buildStaffPdf,
} from '../lib/sheetPdf'
import { monthRange } from '../lib/staff'
import { useAsync } from '../lib/useAsync'

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
 * Staff Management — the roster every other sheet reads, plus the three sheets that hang
 * off it.
 *
 * Each tab carries the filter it actually needs: attendance is a day at a time (opening on
 * today, like the Attendance page), leaves and salaries are monthly sheets, and the roster
 * is neither, so it gets a search box.
 */
export default function Staff() {
  const [tab, setTab] = useState<Tab>('staff')
  const [month, setMonth] = useState<string>(currentMonth())
  const [date, setDate] = useState<string>(today)
  const [search, setSearch] = useState('')

  const staff = useAsync(() => api.staff(), [])
  const departments = useAsync(() => api.departments(), [])

  const range = monthRange(month)
  const attendance = useAsync(
    () => tab === 'attendance' ? api.staffAttendance({ from: date, to: date }) : Promise.resolve(null),
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

  const people = useMemo(() => staff.data ?? [], [staff.data])
  const depts = useMemo(() => departments.data ?? [], [departments.data])
  const attendanceRows = attendance.data?.rows ?? []
  const leaveRows = leaves.data ?? []
  const salaryRows = salaries.data ?? []

  const query = search.trim()
  const shownStaff = useMemo(() => (
    query === ''
      ? people
      : people.filter((p) => matches(p.name, query) || p.departments.some((d) => matches(d.name, query)))
  ), [people, query])

  const loading = staff.loading || departments.loading
      || (tab === 'attendance' && attendance.loading)
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
    <div>
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
          <DaySelector value={date} onChange={setDate} />
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
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile label="Staff" value={people.length} />
            <StatTile label="Active" value={people.filter((p) => p.status === 'active').length} />
            <StatTile label="Departments" value={depts.length} />
          </div>

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
            action={<Badge>{`${attendanceRows.filter((r) => r.login_at !== null).length} of ${people.length} in`}</Badge>}
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

