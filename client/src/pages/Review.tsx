import { useState } from 'react'
import { api } from '../api/client'
import DepartmentSheet from '../components/DepartmentSheet'
import { PageHeader } from '../components/Layout'
import { MonthSelector, currentMonth, formatMonth } from '../components/MonthSelector'
import ReviewSheet from '../components/ReviewSheet'
import { Button, Card, CardHeader, DownloadIcon, PageLoader, SegmentedTabs } from '../components/ui'
import { formatDmy, today } from '../lib/format'
import { buildBehaviourPdf, buildDepartmentsPdf, buildPerformancePdf } from '../lib/sheetPdf'
import { useAsync } from '../lib/useAsync'
import type { ReviewKind } from '../types'

type Tab = ReviewKind | 'department'

const TABS: { id: Tab; label: string }[] = [
  { id: 'performance', label: 'Performance' },
  { id: 'behaviour', label: 'Behavior' },
  { id: 'department', label: 'Department' },
]

export default function Review() {
  const [tab, setTab] = useState<Tab>('performance')
  const [month, setMonth] = useState<string>(currentMonth())

  const departments = useAsync(() => api.reviewDepartments(), [])
  // Behaviour is a monthly sheet; performance is a running one, so only the former passes
  // a month. The Department tab needs no entries at all.
  const entries = useAsync(
    () => tab === 'department'
      ? Promise.resolve([])
      : api.reviewEntries(tab, tab === 'behaviour' ? month : undefined),
    [tab, month],
  )
  // The NAME cell picks from the shared staff roster (the same list the Queues page keeps),
  // and can add to or remove from it in place. Tolerated as optional — an install where the
  // queues tables don't exist yet still loads the page, just with an empty list.
  const roster = useAsync(() => api.queuePeople().catch(() => []), [])

  const reload = () => { entries.reload(); departments.reload() }
  const loading = departments.loading || entries.loading
  const error = departments.error ?? entries.error

  // Each tab exports its own sheet — the rows as filled in, without the entry rows or the
  // department bands that hold none.
  const rows = entries.data ?? []
  const depts = departments.data ?? []
  const canExport = tab === 'department' ? depts.length > 0 : rows.length > 0

  const exportPdf = () => {
    const stamp = formatDmy(today())
    if (tab === 'performance') {
      buildPerformancePdf(rows, depts).save(`Review_Performance_${stamp}.pdf`)
    } else if (tab === 'behaviour') {
      buildBehaviourPdf(rows, depts, formatMonth(month)).save(`Review_Behaviour_${month}.pdf`)
    } else {
      buildDepartmentsPdf(depts).save(`Review_Departments_${stamp}.pdf`)
    }
  }

  return (
    <div>
      <PageHeader title="Review" subtitle="Monthly performance and behaviour reviews">
        {tab === 'behaviour' && <MonthSelector value={month} onChange={setMonth} />}
        <Button variant="secondary" disabled={!canExport} onClick={exportPdf}>
          <DownloadIcon />PDF
        </Button>
      </PageHeader>

      <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} className="mb-5" />

      {loading ? (
        <PageLoader label="Loading reviews…" />
      ) : (
        <Card>
          <CardHeader
            title={
              tab === 'performance' ? 'Performance'
                : tab === 'behaviour' ? `Behaviour — ${formatMonth(month)}`
                  : 'Department'
            }
          />
          <div className="p-4">
            {tab === 'department' ? (
              <DepartmentSheet departments={departments.data ?? []} onChanged={reload} />
            ) : (
              <ReviewSheet
                // Remount when the tab or month changes so no row keeps a stale draft.
                key={`${tab}-${month}`}
                kind={tab}
                month={month}
                entries={entries.data ?? []}
                departments={departments.data ?? []}
                people={roster.data ?? []}
                onChanged={reload}
                onRosterChanged={roster.reload}
              />
            )}
          </div>
        </Card>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </div>
  )
}
