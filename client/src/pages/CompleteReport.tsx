import { useState, type ReactNode } from 'react'
import { FileText } from 'lucide-react'
import { api } from '../api/client'
import { DateRangeControl, type Range } from '../components/DateRange'
import DashboardPageLayout from '@/components/dashboard/page-layout'
import {
  SectionTable, SectionHeading, rangeText,
  buyerCols, campCols, buyerTableData, campTableData,
} from '../components/ReportTable'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { daysAgo, money2, today } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import type { CompleteReport } from '../types'

export default function CompleteReportPage() {
  const [range, setRange] = useState<Range>({ from: daysAgo(6), to: today() })
  const report = useAsync(() => api.completeReport(range), [range.from, range.to])
  const data = report.data

  return (
    <DashboardPageLayout
      header={{
        title: 'Complete Report',
        icon: FileText,
        description: <DateRangeControl value={range} onChange={setRange} />,
      }}
    >
      <Card>
        <CardContent className="p-6">
          {report.loading ? (
            <div className="flex justify-center py-16"><Spinner className="size-7" /></div>
          ) : report.error ? (
            <p className="py-10 text-center text-sm text-destructive">{report.error}</p>
          ) : !data || (data.buyers.length === 0 && data.campaigns.length === 0) ? (
            <p className="py-16 text-center text-sm text-muted-foreground uppercase">No data for this period.</p>
          ) : (
            <ReportView data={data} />
          )}
        </CardContent>
      </Card>
    </DashboardPageLayout>
  )
}

function ReportView({ data }: { data: CompleteReport }) {
  const dateLabel = rangeText(data.from, data.to)
  const buyer = buyerTableData(data)
  const camp = campTableData(data)

  return (
    <div className="mx-auto space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-xs text-muted-foreground">
        <span>Period: <span className="font-medium text-foreground">{dateLabel}</span></span>
        <span>{data.buyers.length} destinations · {data.campaigns.length} campaign rows</span>
      </div>

      <section>
        <SectionHeading title="Revenue" note="buyer destinations" />
        <SectionTable dateLabel={dateLabel} cols={buyerCols} rows={buyer.rows} totals={buyer.totals} />
      </section>

      <section>
        <SectionHeading title="Cost" note="campaign destinations" />
        <SectionTable dateLabel={dateLabel} cols={campCols} rows={camp.rows} totals={camp.totals} />
      </section>

      <section>
        <SectionHeading title="Complete" note="revenue − cost = profit" />
        <FormulaBand revenue={data.revenue} cost={data.cost} profit={data.profit} />
      </section>
    </div>
  )
}

/** Combined profit: Revenue − Cost = Profit, laid out as an equation. */
function FormulaBand({ revenue, cost, profit }: { revenue: number; cost: number; profit: number }) {
  return (
    <div className="flex flex-col items-stretch gap-3 rounded-lg border border-border bg-accent p-5 sm:flex-row sm:items-center sm:justify-center">
      <Tile label="Revenue" value={money2(revenue)} />
      <Operator>−</Operator>
      <Tile label="Cost" value={money2(cost)} />
      <Operator>=</Operator>
      <Tile label="Profit" value={money2(profit)} highlight={profit >= 0 ? 'primary' : 'destructive'} />
    </div>
  )
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: 'primary' | 'destructive' }) {
  const filled = highlight === 'primary' ? 'bg-primary text-primary-foreground border-primary'
    : highlight === 'destructive' ? 'bg-destructive text-white border-destructive'
    : 'bg-card text-foreground border-border'
  return (
    <div className={cn('flex-1 rounded-lg border px-6 py-4 text-center', filled)}>
      <p className={cn('text-[11px] font-semibold uppercase tracking-wide', highlight ? 'text-white/80' : 'text-muted-foreground')}>{label}</p>
      <p className="mt-1 text-2xl font-bold font-display tabular-nums">{value}</p>
    </div>
  )
}

function Operator({ children }: { children: ReactNode }) {
  return <span className="self-center text-2xl font-bold text-muted-foreground">{children}</span>
}
