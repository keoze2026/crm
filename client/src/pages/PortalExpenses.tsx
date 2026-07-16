import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api/client'
import { PageHeader } from '../components/Layout'
import { MonthSelector, currentMonth, formatMonth } from '../components/MonthSelector'
import PortalExpensesSheet from '../components/PortalExpensesSheet'
import { Card, CardHeader, EmptyState, Spinner } from '../components/ui'
import { money2 } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import type { PortalExpense } from '../types'

// Cycled series colours for the per-provider bars — the app's accent palette.
const COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#f43f5e', '#8b5cf6']

const METRICS = [
  { key: 'voice_minutes', label: 'Voice Minutes', money: false },
  { key: 'rejected_calls', label: 'Rejected Calls', money: false },
  { key: 'rent_values', label: 'Rent Values', money: false },
  { key: 'payout_expenses', label: 'Payout Expenses', money: true },
  { key: 'total_amount', label: 'Total Amount (USD)', money: true },
] as const

const numFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })
const fmtNum = (n: number) => numFmt.format(n || 0)

// Compact axis labels: 28,736 -> "28.7K", 950 -> "950".
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const fmtAxis = (v: number) => (v === 0 ? '' : compact.format(v))

interface Datum {
  name: string
  value: number
  fill: string
}

export default function PortalExpenses() {
  const [month, setMonth] = useState<string>(currentMonth())
  const expenses = useAsync(() => api.portalExpenses(month), [month])

  const rows = expenses.data ?? []
  const grandTotal = rows.reduce((s, e) => s + e.total_amount, 0)
  const monthLabel = formatMonth(month)

  return (
    <div>
      <PageHeader title="Portal Expenses" subtitle="Monthly provider expenses and payouts">
        <MonthSelector value={month} onChange={setMonth} />
      </PageHeader>

      {expenses.loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader
              title={`${monthLabel} Portal Expenses`}
              subtitle="Total Amount defaults to Voice Minutes + Rejected calls + Rent values + Payout expenses, but can be overridden for flat fees. % of Total and the charts update as you edit. Rows auto-save on blur."
            />
            <div className="p-4">
              <PortalExpensesSheet month={month} expenses={rows} onChanged={() => expenses.reload()} />
            </div>
          </Card>

          <Card className="mt-6">
            <CardHeader
              title={`${monthLabel} Overview`}
              subtitle="Each metric is scaled independently so smaller values stay legible"
              action={<Legend rows={rows} />}
            />
            <div className="p-4">
              {rows.length === 0 ? (
                <EmptyState message={`No expenses for ${monthLabel} — add a provider above.`} />
              ) : (
                // One panel per metric, each independently scaled, so small-magnitude
                // metrics (Payout, Rejected calls) stay legible next to the large ones.
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                  {METRICS.map((m) => (
                    <MetricChart
                      key={m.key}
                      label={m.label}
                      money={m.money}
                      data={rows.map((e, i) => ({
                        name: e.name,
                        value: e[m.key],
                        fill: COLORS[i % COLORS.length],
                      }))}
                    />
                  ))}
                </div>
              )}
            </div>
          </Card>

          <div className="mt-6 flex justify-center">
            <div className="rounded-2xl bg-[#1a3654] px-6 py-3 text-center text-white shadow-xl shadow-slate-900/10">
              <span className="text-sm font-semibold uppercase tracking-wide">Total Expenses: </span>
              <span className="text-2xl font-bold tracking-tight">{money2(grandTotal)}</span>
            </div>
          </div>
        </>
      )}

      {expenses.error && <p className="mt-4 text-sm text-red-600">{expenses.error}</p>}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Legend({ rows }: { rows: PortalExpense[] }) {
  if (rows.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-3">
      {rows.map((e, i) => (
        <div key={e.id} className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
          <span className="text-xs font-medium text-slate-500">{e.name}</span>
        </div>
      ))}
    </div>
  )
}

/** A single independently-scaled metric panel: one bar per provider. */
function MetricChart({ label, data, money }: { label: string; data: Datum[]; money: boolean }) {
  return (
    <div className="glass-input rounded-xl border border-white/70 p-3">
      <div className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="name" hide />
            <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={44} />
            <Tooltip content={<MetricTooltip money={money} />} cursor={{ fill: '#f8fafc' }} />
            <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={48}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

interface TooltipProps {
  active?: boolean
  payload?: { value: number; payload: Datum }[]
  money?: boolean
}

function MetricTooltip({ active, payload, money }: TooltipProps) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.payload.fill }} />
        <span className="text-slate-500">{p.payload.name}:</span>
        <span className="font-medium text-slate-800">{money ? money2(p.value) : fmtNum(p.value)}</span>
      </div>
    </div>
  )
}
