import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import AnnualReviewSheet, { type AnnualExport } from '../components/AnnualReviewSheet'
import DepartmentSheet from '../components/DepartmentSheet'
import { PageHeader } from '../components/Layout'
import { MonthSelector, currentMonth, formatMonth, shiftMonth } from '../components/MonthSelector'
import ReviewSheet from '../components/ReviewSheet'
import TopPerformerSheet from '../components/TopPerformerSheet'
import { Button, Card, CardHeader, DownloadIcon, PageLoader, SegmentedTabs } from '../components/ui'
import { PerformerScope } from '../lib/performers'
import {
  buildSlices, periodLabel, periodMonths, type AnnualSpan,
} from '../lib/annualReview'
import type { IncentiveSettings, RankedRow } from '../lib/incentive'
import {
  buildAnnualReviewPdf, buildBehaviourPdf, buildDepartmentsPdf, buildPerformancePdf, buildTopPerformerPdf,
} from '../lib/sheetPdf'
import { monthRange } from '../lib/staff'
import { useAsync } from '../lib/useAsync'
import type { ReviewKind } from '../types'

type Tab = ReviewKind | 'department' | 'top' | 'annual'

const TABS: { id: Tab; label: string }[] = [
  { id: 'performance', label: 'Performance' },
  { id: 'behaviour', label: 'Behavior' },
  { id: 'department', label: 'Department' },
  { id: 'top', label: 'Top Performer' },
  { id: 'annual', label: 'Annual Reviews' },
]
const isTab = (v: string | null): v is Tab => TABS.some((t) => t.id === v)

export default function Review() {
  // The tab is in the URL (?tab=top) so other pages can link straight to it.
  const [params, setParams] = useSearchParams()
  const tab: Tab = isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'performance'
  // Which roll-up the Annual Reviews tab is showing, also in the URL — so the half-yearly
  // sheet can be bookmarked and linked to, not just arrived at. The selected month is the
  // month the period ENDS on: the twelve months to September are chosen by picking September.
  const span: AnnualSpan = params.get('span') === 'half' ? 'half' : 'year'
  const setTab = (t: Tab) => setParams(
    t === 'performance' ? {} : { tab: t, ...(t === 'annual' && span === 'half' ? { span } : {}) },
    { replace: true },
  )
  const setSpan = (s: AnnualSpan) => setParams(
    s === 'half' ? { tab: 'annual', span: s } : { tab: 'annual' },
    { replace: true },
  )
  // A review is about the month BEFORE it is written — the sheet you fill in during
  // September judges August — so the page opens on last month, not this one.
  const [month, setMonth] = useState<string>(() => shiftMonth(currentMonth(), -1))

  // All three month-wise tabs: departments carry the score they held that month, and both
  // entry tabs carry the rows written about it.
  const departments = useAsync(() => api.reviewDepartments(month), [month])
  const entries = useAsync(
    () => tab === 'performance' || tab === 'behaviour' ? api.reviewEntries(tab, month) : Promise.resolve([]),
    [tab, month],
  )
  // Top Performer judges the month's attendance and leaves against BOTH review tabs. The
  // staff sheets are tolerated as optional — a viewer without the Staff page still gets the
  // review-driven criteria, with the attendance ones shown as "can't say".
  const isTop = tab === 'top'
  const topPerformance = useAsync(() => (isTop ? api.reviewEntries('performance', month) : Promise.resolve([])), [isTop, month])
  const topBehaviour = useAsync(() => (isTop ? api.reviewEntries('behaviour', month) : Promise.resolve([])), [isTop, month])
  const topAttendance = useAsync(() => (isTop ? api.staffAttendance(monthRange(month)).catch(() => null) : Promise.resolve(null)), [isTop, month])
  const topLeaves = useAsync(() => (isTop ? api.staffLeaves(monthRange(month)).catch(() => []) : Promise.resolve([])), [isTop, month])
  const topSaved = useAsync(() => (isTop ? api.topPerformer(month) : Promise.resolve(null)), [isTop, month])
  /** What the Top Performer sheet is showing right now, for its PDF. */
  const [topExport, setTopExport] = useState<{ rows: RankedRow[]; settings: IncentiveSettings } | null>(null)

  // ─── The Annual Reviews window ─────────────────────────────────────────────
  //
  // Six or twelve months ending on the selected month. Each one is scored exactly as the
  // Top Performer tab scores a month, then accumulated (lib/annualReview.ts) — so the
  // roll-up is fetched as a window rather than month by month: the attendance and leaves
  // sheets over the whole date range, every review row of each kind, and each month's
  // saved switches and ticks in one call. Six requests instead of six dozen.
  const isAnnual = tab === 'annual'
  const windowMonths = useMemo(() => periodMonths(month, span), [month, span])
  const windowRange = useMemo(() => ({
    from: monthRange(windowMonths[0]).from,
    to: monthRange(windowMonths[windowMonths.length - 1]).to,
  }), [windowMonths])
  const annualAttendance = useAsync(
    () => (isAnnual ? api.staffAttendance(windowRange).catch(() => null) : Promise.resolve(null)),
    [isAnnual, windowRange],
  )
  const annualLeaves = useAsync(
    () => (isAnnual ? api.staffLeaves(windowRange).catch(() => []) : Promise.resolve([])),
    [isAnnual, windowRange],
  )
  const annualPerformance = useAsync(
    () => (isAnnual ? api.reviewEntriesAllMonths('performance') : Promise.resolve([])),
    [isAnnual],
  )
  const annualBehaviour = useAsync(
    () => (isAnnual ? api.reviewEntriesAllMonths('behaviour') : Promise.resolve([])),
    [isAnnual],
  )
  const annualTicks = useAsync(
    () => (isAnnual ? api.topPerformerRange(windowMonths[0], windowMonths[windowMonths.length - 1]).catch(() => []) : Promise.resolve([])),
    [isAnnual, windowMonths],
  )
  const annualSaved = useAsync(
    () => (isAnnual ? api.annualReview(span, month) : Promise.resolve(null)),
    [isAnnual, span, month],
  )
  /** What the Annual Reviews sheet is showing, overrides included, for its PDF. */
  const [annualExport, setAnnualExport] = useState<AnnualExport | null>(null)

  // The NAME cell picks from the shared staff roster (the Staff page's list), which is
  // also where each person's departments come from. Tolerated as optional — an install
  // where the staff tables don't exist yet still loads the page, just with an empty list.
  const roster = useAsync(() => api.staff().catch(() => []), [])

  const slices = useMemo(
    () => buildSlices(
      windowMonths,
      roster.data ?? [],
      annualAttendance.data?.rows ?? [],
      annualLeaves.data ?? [],
      annualPerformance.data ?? [],
      annualBehaviour.data ?? [],
      annualTicks.data ?? [],
    ),
    [windowMonths, roster.data, annualAttendance.data, annualLeaves.data, annualPerformance.data, annualBehaviour.data, annualTicks.data],
  )

  const reload = () => { entries.reload(); departments.reload() }
  const loading = departments.loading || entries.loading
    || (isTop && (topPerformance.loading || topBehaviour.loading || topAttendance.loading || topLeaves.loading || topSaved.loading || roster.loading))
    || (isAnnual && (annualAttendance.loading || annualLeaves.loading || annualPerformance.loading || annualBehaviour.loading || annualTicks.loading || annualSaved.loading || roster.loading))
  const error = departments.error ?? entries.error
    ?? (isTop ? topPerformance.error ?? topBehaviour.error ?? topSaved.error : null)
    ?? (isAnnual ? annualPerformance.error ?? annualBehaviour.error ?? annualSaved.error : null)

  // Each tab exports its own sheet — the rows as filled in, without the entry rows or the
  // department bands that hold none.
  const rows = entries.data ?? []
  const depts = departments.data ?? []
  const canExport = tab === 'department' ? depts.length > 0
    : tab === 'top' ? (topExport?.rows.length ?? 0) > 0
    : tab === 'annual' ? (annualExport?.rows.length ?? 0) > 0
    : rows.length > 0

  const label = formatMonth(month)
  const windowLabel = periodLabel(windowMonths)
  const exportPdf = () => {
    if (tab === 'performance') {
      buildPerformancePdf(rows, depts, label).save(`Review_Performance_${month}.pdf`)
    } else if (tab === 'behaviour') {
      buildBehaviourPdf(rows, depts, label).save(`Review_Behaviour_${month}.pdf`)
    } else if (tab === 'top') {
      if (topExport) buildTopPerformerPdf(topExport.rows, topExport.settings, label).save(`Top_Performer_${month}.pdf`)
    } else if (tab === 'annual') {
      if (annualExport) {
        buildAnnualReviewPdf(annualExport).save(`Annual_Review_${span === 'half' ? '6' : '12'}m_${month}.pdf`)
      }
    } else {
      buildDepartmentsPdf(depts, label).save(`Review_Departments_${month}.pdf`)
    }
  }

  return (
    // Every badge on the page — the name cells, the ranking — speaks for the month reviewed.
    <PerformerScope month={month}>
    <div className="min-w-0">
      <PageHeader
        title="Review"
        subtitle={isAnnual ? `Accumulating ${windowLabel}` : `Reviewing ${label}`}
      >
        <MonthSelector value={month} onChange={setMonth} />
        <Button variant="secondary" disabled={!canExport} onClick={exportPdf}>
          <DownloadIcon />PDF
        </Button>
      </PageHeader>

      <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} className="mb-5" />

      {loading ? (
        <PageLoader label={isAnnual ? 'Accumulating the period…' : 'Loading reviews…'} />
      ) : tab === 'annual' ? (
        <Card>
          <CardHeader title={`Annual Reviews — ${windowLabel}`} />
          <div className="p-4">
            <AnnualReviewSheet
              // Remount on a change of period so the sheet reads that period's own edits.
              key={`${span}-${month}`}
              span={span}
              onSpan={setSpan}
              months={slices}
              saved={annualSaved.data}
              onExport={setAnnualExport}
            />
          </div>
        </Card>
      ) : tab === 'top' ? (
        <Card>
          <CardHeader
            title={`Top Performer — ${label}`}
            subtitle="Who earns the month's incentive, and who trails the month: the criteria, the evidence, and the ranking"
          />
          <div className="p-4">
            <TopPerformerSheet
              // Remount on a month change so the ticks and switches read are that month's.
              key={month}
              month={month}
              monthLabel={label}
              staff={roster.data ?? []}
              attendance={topAttendance.data?.rows ?? []}
              leaves={topLeaves.data ?? []}
              performance={topPerformance.data ?? []}
              behaviour={topBehaviour.data ?? []}
              saved={topSaved.data}
              onRanked={setTopExport}
            />
          </div>
        </Card>
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
    </PerformerScope>
  )
}
