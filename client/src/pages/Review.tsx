import { useState } from 'react'
import { api } from '../api/client'
import DepartmentSheet from '../components/DepartmentSheet'
import { PageHeader } from '../components/Layout'
import { MonthSelector, currentMonth, formatMonth, shiftMonth } from '../components/MonthSelector'
import ReviewSheet from '../components/ReviewSheet'
import { Button, Card, CardHeader, DownloadIcon, PageLoader, SegmentedTabs } from '../components/ui'
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
  // A review is about the month BEFORE it is written — the sheet you fill in during
  // September judges August — so the page opens on last month, not this one.
  const [month, setMonth] = useState<string>(() => shiftMonth(currentMonth(), -1))

  // All three tabs are month-wise: departments carry the score they held that month, and
  // both entry tabs carry the rows written about it.
  const departments = useAsync(() => api.reviewDepartments(month), [month])
  const entries = useAsync(
    () => tab === 'department' ? Promise.resolve([]) : api.reviewEntries(tab, month),
    [tab, month],
  )
  // The NAME cell picks from the shared staff roster (the Staff page's list), which is
  // also where each person's departments come from. Tolerated as optional — an install
  // where the staff tables don't exist yet still loads the page, just with an empty list.
  const roster = useAsync(() => api.staff().catch(() => []), [])

  const reload = () => { entries.reload(); departments.reload() }
  const loading = departments.loading || entries.loading
  const error = departments.error ?? entries.error

  // Each tab exports its own sheet — the rows as filled in, without the entry rows or the
  // department bands that hold none.
  const rows = entries.data ?? []
  const depts = departments.data ?? []
  const canExport = tab === 'department' ? depts.length > 0 : rows.length > 0

  const label = formatMonth(month)
  const exportPdf = () => {
    if (tab === 'performance') {
      buildPerformancePdf(rows, depts, label).save(`Review_Performance_${month}.pdf`)
    } else if (tab === 'behaviour') {
      buildBehaviourPdf(rows, depts, label).save(`Review_Behaviour_${month}.pdf`)
    } else {
      buildDepartmentsPdf(depts, label).save(`Review_Departments_${month}.pdf`)
    }
  }

  return (
    <div>
      <PageHeader
        title="Review"
        subtitle={`Reviewing ${label}`}
      >
        <MonthSelector value={month} onChange={setMonth} />
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
            title={`${tab === 'performance' ? 'Performance' : tab === 'behaviour' ? 'Behaviour' : 'Department'} — ${label}`}
          />
          <div className="p-4">
            {tab === 'department' ? (
              <DepartmentSheet
                // Remount on a month change so no row keeps the previous month's draft.
                key={month}
                month={month}
                departments={depts}
                onChanged={reload}
              />
            ) : (
              <ReviewSheet
                key={`${tab}-${month}`}
                kind={tab}
                month={month}
                entries={rows}
                departments={depts}
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
