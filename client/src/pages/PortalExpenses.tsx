import { useState } from 'react'
import { Wallet } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts'
import { api } from '../api/client'
import { useAsync } from '../lib/useAsync'
import { money2 } from '../lib/format'
import { MonthSelector, currentMonth, formatMonth } from '../components/MonthSelector'
import PortalExpensesSheet from '../components/PortalExpensesSheet'
import DashboardPageLayout from '@/components/dashboard/page-layout'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Bullet } from '@/components/ui/bullet'
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart'

// Cycled series colors for the per-provider bars.
const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

const METRICS = [
  { key: 'voice_minutes', label: 'Voice Minutes' },
  { key: 'rejected_calls', label: 'Rejected Calls' },
  { key: 'rent_values', label: 'Rent Values' },
  { key: 'payout_expenses', label: 'Payout Expenses' },
  { key: 'total_amount', label: 'Total Amount (USD)' },
] as const

// Compact axis labels: 28,736 -> "28.7K", 950 -> "950".
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const fmtAxis = (v: number) => (v === 0 ? '' : compact.format(v))

export default function PortalExpenses() {
  const [month, setMonth] = useState<string>(currentMonth())
  const expenses = useAsync(() => api.portalExpenses(month), [month])

  const rows = expenses.data ?? []
  const grandTotal = rows.reduce((s, e) => s + e.total_amount, 0)

  // Tooltip label lookup (provider name -> label + color).
  const chartConfig: ChartConfig = Object.fromEntries(
    rows.map((e, i) => [e.name, { label: e.name, color: COLORS[i % COLORS.length] }]),
  )

  const monthLabel = formatMonth(month)

  return (
    <DashboardPageLayout
      header={{
        title: 'Portal Expenses',
        icon: Wallet,
        description: <MonthSelector value={month} onChange={setMonth} />,
      }}
    >
      {expenses.loading ? (
        <div className="flex justify-center py-16"><Spinner className="size-6" /></div>
      ) : (
        <>
          <Card>
            <CardContent className="overflow-hidden p-0">
              <div className="border-b border-border px-5 py-4">
                <h2 className="font-display text-lg text-foreground">{monthLabel} Portal Expenses</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Provider expenses for the selected month. Total Amount defaults to Voice Minutes +
                  Rejected calls + Rent values + Payout expenses, but can be overridden for flat fees.
                  % of Total and the charts update as you edit. Rows auto-save on blur.
                </p>
              </div>
              <div className="p-4">
                <PortalExpensesSheet month={month} expenses={rows} onChanged={() => expenses.reload()} />
              </div>
            </CardContent>
          </Card>

          {/* Chart */}
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <h3 className="font-display text-lg uppercase text-foreground">{monthLabel} Overview</h3>
              {rows.length > 0 && (
                <div className="flex flex-wrap items-center gap-4">
                  {rows.map((e, i) => (
                    <div key={e.id} className="flex items-center gap-2 uppercase">
                      <Bullet style={{ backgroundColor: COLORS[i % COLORS.length] }} className="rotate-45" />
                      <span className="text-xs font-medium text-muted-foreground">{e.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {rows.length === 0 ? (
              <div className="rounded-lg bg-accent p-3">
                <p className="py-16 text-center text-sm uppercase text-muted-foreground">
                  No expenses for {monthLabel} — add a provider above.
                </p>
              </div>
            ) : (
              // One panel per metric, each independently scaled, so small-magnitude
              // metrics (Payout, Rejected calls) stay legible next to the large ones.
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                {METRICS.map((m) => (
                  <MetricChart
                    key={m.key}
                    label={m.label}
                    config={chartConfig}
                    data={rows.map((e) => ({ name: e.name, value: e[m.key] }))}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Total banner */}
          <div className="flex justify-center">
            <div className="rounded-lg bg-primary px-6 py-3 text-center text-primary-foreground">
              <span className="text-sm font-semibold uppercase tracking-wide">Total Expenses: </span>
              <span className="font-display text-2xl">{money2(grandTotal)}</span>
            </div>
          </div>
        </>
      )}

      {expenses.error && <p className="mt-4 text-sm text-destructive">{expenses.error}</p>}
    </DashboardPageLayout>
  )
}

/** A single independently-scaled metric panel: one bar per provider. */
function MetricChart({
  label, data, config,
}: { label: string; data: { name: string; value: number }[]; config: ChartConfig }) {
  return (
    <div className="rounded-lg bg-accent p-3">
      <div className="mb-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <ChartContainer className="h-50 w-full" config={config}>
        <BarChart data={data} margin={{ left: -12, right: 8, top: 8, bottom: 4 }}>
          <CartesianGrid horizontal={false} strokeDasharray="8 8" strokeWidth={2} stroke="var(--muted-foreground)" opacity={0.3} />
          <XAxis dataKey="name" hide />
          <YAxis tickLine={false} axisLine={false} tickFormatter={fmtAxis} width={44} className="text-xs fill-muted-foreground" />
          <ChartTooltip cursor={false} content={<ChartTooltipContent className="min-w-40" />} />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={48}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  )
}
