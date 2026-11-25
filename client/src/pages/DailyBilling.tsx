import { useMemo, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import DailyBillingSheet, { SheetHeading } from '../components/DailyBillingSheet'
import { DateRangeControl, type Range } from '../components/DateRange'
import { PageHeader } from '../components/Layout'
import { Button, Card, PageLoader, cx } from '../components/ui'
import {
  aggregateClientRows, aggregateTrafficRows, campCount, carryForward, clientCount, clientRows,
  finalProfit, marginPct, sourceCount, totalsOf, trafficRows,
} from '../lib/dailyBilling'
import { buildDailyBillingPdf } from '../lib/dailyBillingPdf'
import { daysBeforeIso, fileDateRange, formatDate, formatRangeLong, money2, num, todayRange } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import type { Buyer, CallRecord, Campaign, Destination } from '../types'

/**
 * AHT Daily Billing — the Daily Sheet (client billing) and the Campaigns sheet (traffic
 * source cost) on one page, laid out as the client's printed billing sheet: three
 * figures up top, the two tables, and the Final Profit line underneath.
 *
 * A single day is edited in place and opens with the last day's clients and sources
 * carried forward at their rates, counts blank, so the team only types the day's figures.
 * A date range reads as a roll-up. The cost side and the profit need the Campaigns
 * permission, as the Campaigns sheet did — without it the page is the client billing alone.
 */

/** How far back a day looks for the last one with records to carry forward. */
const CARRY_LOOKBACK_DAYS = 14

interface Loaded {
  clientRecords: CallRecord[]
  trafficRecords: CallRecord[]
  /** Records of the days before this one (single-day view only), for the carry-forward. */
  previousClient: CallRecord[]
  previousTraffic: CallRecord[]
  buyers: Buyer[]
  campaigns: Campaign[]
  destinations: Destination[]
}

export default function DailyBillingPage() {
  const { canAccess } = useAuth()
  const showCost = canAccess('campaigns')
  const [range, setRange] = useState<Range>(todayRange)
  const single = range.from === range.to

  // Every GET starts before the first await, so a change anyone makes to records, buyers,
  // campaigns or sources re-runs this quietly (lib/live).
  const data = useAsync<Loaded>(async () => {
    const filters = { from: range.from, to: range.to, page: 1, per_page: 9999 }
    const before = { from: daysBeforeIso(range.from, CARRY_LOOKBACK_DAYS), to: daysBeforeIso(range.from, 1), page: 1, per_page: 9999 }
    const none = Promise.resolve(null)
    const [clientPage, trafficPage, prevClient, prevTraffic, buyers, campaigns, destinations] = await Promise.all([
      api.records({ ...filters, type: 'buyer' }),
      showCost ? api.records({ ...filters, type: 'campaign' }) : none,
      single ? api.records({ ...before, type: 'buyer' }) : none,
      single && showCost ? api.records({ ...before, type: 'campaign' }) : none,
      api.buyers(),
      showCost ? api.campaigns() : Promise.resolve([] as Campaign[]),
      showCost ? api.destinations() : Promise.resolve([] as Destination[]),
    ])
    return {
      clientRecords: clientPage.data,
      trafficRecords: trafficPage?.data ?? [],
      previousClient: prevClient?.data ?? [],
      previousTraffic: prevTraffic?.data ?? [],
      buyers, campaigns, destinations,
    }
  }, [range.from, range.to, showCost, single])

  const view = useMemo(() => {
    if (!data.data) return null
    const { clientRecords, trafficRecords, previousClient, previousTraffic } = data.data
    const client = single ? clientRows(clientRecords) : aggregateClientRows(clientRecords)
    const traffic = single ? trafficRows(trafficRecords) : aggregateTrafficRows(trafficRecords)
    const clientTotals = totalsOf(client)
    const trafficTotals = totalsOf(traffic)
    return {
      client, traffic, clientTotals, trafficTotals,
      carriedClient: single ? carryForward('client', previousClient, clientRecords) : { from: null, rows: [] },
      carriedTraffic: single ? carryForward('traffic', previousTraffic, trafficRecords) : { from: null, rows: [] },
      clients: clientCount(clientRecords),
      camps: campCount(trafficRecords),
      sources: sourceCount(trafficRecords),
      profit: finalProfit(clientTotals.totalBill, trafficTotals.totalBill),
      margin: marginPct(clientTotals.totalBill, trafficTotals.totalBill),
    }
  }, [data.data, single])

  const dateLabel = single ? formatRangeLong(range.from, range.from) : formatRangeLong(range.from, range.to)

  const downloadPdf = () => {
    if (!view) return
    const doc = buildDailyBillingPdf({
      dateLabel,
      client: view.client, clientTotals: view.clientTotals, clients: view.clients,
      traffic: showCost ? view.traffic : null, trafficTotals: view.trafficTotals,
      camps: view.camps, sources: view.sources,
      profit: view.profit, margin: view.margin,
    })
    doc.save(`aht-daily-billing-${fileDateRange(range.from, range.to)}.pdf`)
  }

  const entities = (data.data?.buyers ?? []).map((b) => ({ id: b.id, code: b.code, rate: b.rate }))

  return (
    <div>
      <PageHeader title="AHT Daily Billing" subtitle="Client billing vs traffic source cost — final profit report">
        <DateRangeControl value={range} onChange={setRange} />
        <Button variant="secondary" onClick={downloadPdf} disabled={!view}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3v12M6 11l6 6 6-6M4 21h16" /></svg>
          PDF
        </Button>
      </PageHeader>

      {data.error && <p className="mb-4 text-sm text-red-400">{data.error}</p>}

      {data.loading || !view ? (
        <PageLoader label="Loading billing…" />
      ) : (
        <div className="space-y-6">
          {/* The three figures */}
          <div className={cx('grid gap-3', showCost ? 'sm:grid-cols-3' : 'sm:grid-cols-1 sm:max-w-sm')}>
            <Figure tone="blue" label="Client Billing" value={money2(view.clientTotals.totalBill)}
              hint={`${num(view.clientTotals.finalCount)} final count · ${num(view.clientTotals.replaced)} replaced`} />
            {showCost && (
              <>
                <Figure tone="red" label="Traffic Source Cost" value={money2(view.trafficTotals.totalBill)}
                  hint={`${num(view.trafficTotals.finalCount)} final count · ${num(view.trafficTotals.replaced)} replaced`} />
                <Figure tone={view.profit >= 0 ? 'green' : 'red'} label="Final Profit" value={money2(view.profit)}
                  hint={view.margin === null ? 'no client billing yet' : `${view.margin}% margin`} />
              </>
            )}
          </div>

          {/* Client Billing */}
          <section>
            <SheetHeading
              title="Client Billing"
              note={<span>{num(view.clients)} {view.clients === 1 ? 'client' : 'clients'} · price high to low</span>}
            >
              {!single && <span className="text-slate-500">pick one day to edit</span>}
              <Carried carry={view.carriedClient} />
            </SheetHeading>
            <Card className="overflow-hidden">
              <DailyBillingSheet
                side="client"
                date={range.from}
                editable={single}
                records={data.data!.clientRecords}
                rows={view.client}
                totals={view.clientTotals}
                carried={view.carriedClient.rows}
                entities={entities}
                destinations={[]}
                campaigns={[]}
                onChanged={data.reload}
              />
            </Card>
          </section>

          {/* Traffic Source Cost */}
          {showCost && (
            <section>
              <SheetHeading
                title="Traffic Source Cost"
                note={<span>{num(view.camps)} {view.camps === 1 ? 'camp' : 'camps'} · {num(view.sources)} {view.sources === 1 ? 'source' : 'sources'} · price high to low</span>}
              >
                {!single && <span className="text-slate-500">pick one day to edit</span>}
                <Carried carry={view.carriedTraffic} />
              </SheetHeading>
              <Card className="overflow-hidden">
                <DailyBillingSheet
                  side="traffic"
                  date={range.from}
                  editable={single}
                  records={data.data!.trafficRecords}
                  rows={view.traffic}
                  totals={view.trafficTotals}
                  carried={view.carriedTraffic.rows}
                  entities={[]}
                  destinations={data.data!.destinations}
                  campaigns={data.data!.campaigns}
                  onChanged={data.reload}
                />
              </Card>
            </section>
          )}

          {/* Final Profit */}
          {showCost && (
            <div className={cx(
              'flex flex-col gap-2 rounded-xl border px-5 py-4 sm:flex-row sm:items-center sm:justify-between',
              view.profit >= 0 ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10',
            )}>
              <span className={cx('text-xs font-bold uppercase tracking-wide', view.profit >= 0 ? 'text-emerald-300' : 'text-red-300')}>Final Profit</span>
              <span className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
                <span className="text-sm text-slate-300">{money2(view.clientTotals.totalBill)} − {money2(view.trafficTotals.totalBill)} =</span>
                <span className={cx('text-2xl font-bold', view.profit >= 0 ? 'text-emerald-300' : 'text-red-300')}>{money2(view.profit)}</span>
              </span>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-slate-500">
            <span className="font-semibold text-slate-400">Final Count:</span> Client = Answered + Missed − Replaced (auto-filled; type over it for a client whose missed calls are not billed)
            {showCost && <> · Traffic = Answered − Replaced (Replaced fills in from the Final Count keyed in)</>}
            {' '}· <span className="font-semibold text-slate-400">Total Bill</span> = Final Count × Rate
            {showCost && <> · <span className="font-semibold text-slate-400">Final Profit</span> = Client Billing − Traffic Source Cost</>}
            {' '}· {dateLabel}
          </p>
        </div>
      )}
    </div>
  )
}

/** The note beside a table's heading saying what was carried forward and from when. */
function Carried({ carry }: { carry: { from: string | null; rows: unknown[] } }) {
  if (!carry.from || carry.rows.length === 0) return null
  return (
    <span className="text-blue-300">
      {num(carry.rows.length)} {carry.rows.length === 1 ? 'line' : 'lines'} carried from {formatDate(carry.from)} — type today's counts
    </span>
  )
}

/** One of the three figures across the top — the money, with what it is made of beneath. */
function Figure({ tone, label, value, hint }: { tone: 'blue' | 'red' | 'green'; label: string; value: ReactNode; hint: ReactNode }) {
  const tones = {
    blue: 'border-blue-500/25 bg-blue-500/10 text-blue-200',
    red: 'border-red-500/25 bg-red-500/10 text-red-200',
    green: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
  }
  return (
    <div className={cx('rounded-xl border px-5 py-4', tones[tone])}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-80">{label}</p>
      <p className="mt-1 font-figures text-2xl font-bold tracking-tight tabular-nums text-white">{value}</p>
      <p className="mt-0.5 text-xs text-slate-400">{hint}</p>
    </div>
  )
}
