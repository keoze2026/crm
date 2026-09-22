import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { PageHeader } from '../components/Layout'
import { MonthSelector, currentMonth, formatMonth, shiftMonth } from '../components/MonthSelector'
import StaffLeavesSheet from '../components/StaffLeavesSheet'
import StaffSalariesSheet from '../components/StaffSalariesSheet'
import StaffSalaryHoldSheet from '../components/StaffSalaryHoldSheet'
import StaffOverview from '../components/StaffOverview'
import StaffSheet from '../components/StaffSheet'
import {
  Badge, Button, Card, CardHeader, DownloadIcon, EmptyState, Input, PageLoader,
  SegmentedTabs,
} from '../components/ui'
import { PerformerScope } from '../lib/performers'
import { matches } from '../lib/queues'
import { buildLeavesPdf, buildSalariesPdf, buildSalaryHoldsPdf, buildStaffPdf } from '../lib/sheetPdf'
import { buildCandidates, fromWire, rankCandidates } from '../lib/incentive'
import { monthRange } from '../lib/staff'
import { useAsync } from '../lib/useAsync'
import { useOrgToday } from '../lib/useOrgToday'

type Tab = 'staff' | 'leaves' | 'salaries' | 'hold'

const icon = (path: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
)

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'staff', label: 'Staff', icon: icon(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></>) },
  { id: 'leaves', label: 'Leaves', icon: icon(<><path d="M8 2v4M16 2v4M3 10h18" /><rect x="3" y="4" width="18" height="18" rx="2" /><path d="m9 16 2 2 4-4" /></>) },
  { id: 'salaries', label: 'Salaries', icon: icon(<><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M6 12h.01M18 12h.01" /></>) },
  { id: 'hold', label: 'Salary Hold', icon: icon(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>) },
]

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
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('staff')
  // Leaves and salaries are both written up about the month just finished — a salary paid
  // in September is for August's work — so they open on last month, the way Review does.
  // Attendance is the opposite: it is a record of a day as it happens, so it opens on today.
  const [month, setMonth] = useState<string>(() => shiftMonth(currentMonth(), -1))
  const [search, setSearch] = useState('')

  // The overview band reads today's attendance for who is in and who is late. Attendance
  // days are New York days (the API says so in its `timezone`), so "today" is the ORG's,
  // never the browser's, and a page left open through midnight follows the day over.
  const orgDay = useOrgToday()

  const staff = useAsync(() => api.staff(), [])
  const departments = useAsync(() => api.departments(), [])

  const range = monthRange(month)

  const leaves = useAsync(
    () => tab === 'leaves' || tab === 'staff' ? api.staffLeaves(range) : Promise.resolve([]),
    [tab, range.from, range.to],
  )
  const salaries = useAsync(
    () => tab === 'salaries' ? api.staffSalaries(month) : Promise.resolve([]),
    [tab, month],
  )
  // Salary Hold is a running log, not a monthly sheet — every row is fetched regardless
  // of the month picker (which this tab doesn't show), so a hold stays visible until it's
  // resolved rather than scrolling out of view when the month changes.
  const holds = useAsync(
    () => tab === 'hold' ? api.staffSalaryHolds() : Promise.resolve([]),
    [tab],
  )

  // The Staff tab's overview previews the month's Top Performer standing (the Review page
  // owns the full sheet), so it reads the same inputs: the month's attendance and reviews.
  const wantsTop = tab === 'staff'
  const topAttendance = useAsync(
    () => wantsTop ? api.staffAttendance(range) : Promise.resolve(null),
    [wantsTop, range.from, range.to],
  )
  const topPerformance = useAsync(
    () => wantsTop ? api.reviewEntries('performance', `${month}-01`) : Promise.resolve([]),
    [wantsTop, month],
  )
  const topBehaviour = useAsync(
    () => wantsTop ? api.reviewEntries('behaviour', `${month}-01`) : Promise.resolve([]),
    [wantsTop, month],
  )
  // The Staff tab's overview reads today's sheet for who is in and who is late.
  const topSaved = useAsync(
    () => wantsTop ? api.topPerformer(month).catch(() => null) : Promise.resolve(null),
    [wantsTop, month],
  )
  const todayAttendance = useAsync(
    () => tab === 'staff' ? api.staffAttendance({ from: orgDay, to: orgDay }) : Promise.resolve(null),
    [tab, orgDay],
  )

  // The roster feeds every tab, so a change anywhere reloads it along with the sheet.
  const reloadRoster = () => { staff.reload(); departments.reload() }

  const people = useMemo(() => staff.data ?? [], [staff.data])
  const depts = useMemo(() => departments.data ?? [], [departments.data])
  const leaveRows = leaves.data ?? []
  const salaryRows = salaries.data ?? []
  // Memoised, unlike its siblings above: it feeds another useMemo's dependency list below,
  // and a fresh array identity every render would defeat that memo entirely.
  const holdRows = useMemo(() => holds.data ?? [], [holds.data])

  const overviewRanked = useMemo(() => {
    if (tab !== 'staff' || !topAttendance.data) return null
    const candidates = buildCandidates(people, topAttendance.data.rows, leaves.data ?? [], topPerformance.data ?? [], topBehaviour.data ?? [])
    const { settings, ticks } = fromWire(topSaved.data)
    return rankCandidates(candidates, settings, ticks)
  }, [tab, people, topAttendance.data, leaves.data, topPerformance.data, topBehaviour.data, topSaved.data])

  const query = search.trim()
  const shownStaff = useMemo(() => (
    query === ''
      ? people
      : people.filter((p) => matches(p.name, query) || p.departments.some((d) => matches(d.name, query)))
  ), [people, query])
  // Salary Hold is filtered by the month picker like Leaves and Salaries, and by the same
  // search box the roster uses. The month narrows what is SHOWN only — the log itself still
  // holds every month, and the sheet's own month cell can file a new row under any of them.
  const monthHolds = useMemo(
    () => holdRows.filter((h) => h.month.slice(0, 7) === month),
    [holdRows, month],
  )
  const shownHolds = useMemo(() => (
    query === ''
      ? monthHolds
      : monthHolds.filter((h) => matches(h.staff_name, query) || matches(h.reason, query))
  ), [monthHolds, query])
  // Holds filed under another month that are still open. The month filter would otherwise
  // hide them completely, and an unresolved hold nobody can see is the one thing this sheet
  // exists to prevent — so the tab says they are there and which month to look in.
  const elsewhere = useMemo(
    () => holdRows.filter((h) => h.month.slice(0, 7) !== month && h.status === 'On Hold'),
    [holdRows, month],
  )

  const loading = staff.loading || departments.loading
      || (tab === 'leaves' && leaves.loading)
      || (tab === 'salaries' && salaries.loading)
      || (tab === 'hold' && holds.loading)
  const error = staff.error ?? departments.error
      ?? leaves.error ?? salaries.error ?? holds.error
      ?? topAttendance.error ?? topPerformance.error ?? topBehaviour.error

  const monthLabel = formatMonth(month)

  const exports: Record<Tab, { enabled: boolean; run: () => void }> = {
    staff: {
      enabled: people.length > 0,
      run: () => buildStaffPdf(people).save('Staff.pdf'),
    },
    leaves: {
      enabled: leaveRows.length > 0,
      run: () => buildLeavesPdf(leaveRows, monthLabel).save(`Leaves_${month}.pdf`),
    },
    salaries: {
      enabled: salaryRows.length > 0,
      run: () => buildSalariesPdf(salaryRows, depts, monthLabel).save(`Salaries_${month}.pdf`),
    },
    hold: {
      enabled: monthHolds.length > 0,
      run: () => buildSalaryHoldsPdf(monthHolds, monthLabel).save(`Salary_Hold_${month}.pdf`),
    },
  }

  return (
    // Badges follow the month picked for Leaves and Salaries — the same month the Staff
    // tab's overview previews the ranking for.
    <PerformerScope month={month}>
    <div className="min-w-0">
      <PageHeader title="Staff Management">
        {/* Salary Hold takes both: the month narrows the sheet, the box searches within it. */}
        {(tab === 'staff' || tab === 'hold') && (
          <div className="w-full sm:w-56">
            <Input
              value={search}
              placeholder={tab === 'staff' ? 'Search a name or department…' : 'Search a name or reason…'}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
        {tab !== 'staff' && <MonthSelector value={month} onChange={setMonth} />}
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
          <StaffOverview
            staff={people}
            departments={depts}
            today={orgDay}
            todayRows={todayAttendance.data?.rows ?? []}
            todayLoading={todayAttendance.loading}
            ranked={overviewRanked}
            rankedLoading={topAttendance.loading || topPerformance.loading || topBehaviour.loading || leaves.loading}
            monthLabel={monthLabel}
            onOpenTop={() => navigate('/review?tab=top')}
            onOpenAttendance={() => navigate('/attendance')}
            onDepartmentsChanged={reloadRoster}
          />

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
      ) : tab === 'salaries' ? (
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
      ) : (
        <Card>
          <CardHeader
            title={`Salary Hold — ${monthLabel}`}
            action={query !== '' && monthHolds.length > 0
              ? <Badge color="blue">{`${shownHolds.length} of ${monthHolds.length}`}</Badge>
              : monthHolds.length > 0
                ? <Badge color="amber">{`${monthHolds.filter((h) => h.status === 'On Hold').length} on hold`}</Badge>
                : undefined}
          />
          <div className="p-4">
            {shownHolds.length === 0 && query !== '' ? (
              <EmptyState message={`Nothing matches "${query}" in ${monthLabel}.`} />
            ) : (
              <StaffSalaryHoldSheet
                // Remount on a month change so no row keeps the previous month's draft,
                // and the add row picks the new month up as its default.
                key={month}
                month={month}
                holds={shownHolds}
                staff={people}
                onChanged={holds.reload}
              />
            )}
            {elsewhere.length > 0 && (
              <p className="mt-3 text-[11px] text-slate-500">
                <span className="font-semibold text-amber-700">
                  {elsewhere.length} other {elsewhere.length === 1 ? 'hold is' : 'holds are'} still open
                </span>
                {' '}outside {monthLabel} — {[...new Set(elsewhere.map((h) => formatMonth(h.month.slice(0, 7))))].join(', ')}.
              </p>
            )}
          </div>
        </Card>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </div>
    </PerformerScope>
  )
}

