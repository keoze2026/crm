/* Standalone billing table for a single side (buyer or campaign), reusing the
 * exact Complete Report table. Buyer billing lives on the Buyers page; campaign
 * billing on the Campaigns page. */
import { useState } from 'react'
import { api } from '../api/client'
import { daysAgo, today } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { DateRangeControl, type Range } from './DateRange'
import {
  SectionTable, SectionHeading, rangeText,
  buyerCols, campCols, buyerTableData, campTableData,
} from './ReportTable'
import { Card, EmptyState, Spinner } from './ui'

export function BillingReport({ type }: { type: 'buyer' | 'campaign' }) {
  const isBuyer = type === 'buyer'
  const [range, setRange] = useState<Range>({ from: daysAgo(6), to: today() })
  const report = useAsync(() => api.completeReport(range), [range.from, range.to])
  const data = report.data
  const rowsCount = isBuyer ? data?.buyers.length ?? 0 : data?.campaigns.length ?? 0

  return (
    <Card className="mt-6 p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeading
          title={isBuyer ? 'Revenue billing' : 'Cost billing'}
          note={isBuyer ? 'buyer destinations' : 'campaign destinations'}
        />
        <DateRangeControl value={range} onChange={setRange} />
      </div>

      {report.loading ? (
        <div className="flex justify-center py-16"><Spinner className="h-7 w-7" /></div>
      ) : report.error ? (
        <p className="py-10 text-center text-sm text-red-600">{report.error}</p>
      ) : !data || rowsCount === 0 ? (
        <EmptyState message="No billing data for this period." />
      ) : (
        (() => {
          const { rows, totals } = isBuyer ? buyerTableData(data) : campTableData(data)
          return (
            <SectionTable
              dateLabel={rangeText(data.from, data.to)}
              cols={isBuyer ? buyerCols : campCols}
              rows={rows}
              totals={totals}
            />
          )
        })()
      )}
    </Card>
  )
}
