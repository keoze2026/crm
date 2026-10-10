import { useState } from 'react'
import { api } from '../api/client'
import IncentivesSheet from '../components/IncentivesSheet'
import { PageHeader } from '../components/Layout'
import { MonthSelector, formatMonth, shiftMonth } from '../components/MonthSelector'
import { Badge, Button, Card, CardHeader, PageLoader } from '../components/ui'
import { money2 } from '../lib/format'
import { sumOf } from '../lib/payouts'
import { PerformerScope, defaultPerformerMonth } from '../lib/performers'
import { useAsync } from '../lib/useAsync'

/**
 * Monthly Incentives — who is owed an incentive for a month, how much, and whether it has
 * been paid. Laid out like the Staff page's sheets: one card, one sheet, a badge counting
 * what is still pending.
 *
 * Opens on last month, the month the Review page and its Top Performer tab open on, since
 * incentives are paid for a month once it is over. The Top / Low badges beside names are
 * that month's — a guide when picking, never applied automatically.
 */
export default function Incentives() {
  const [month, setMonth] = useState<string>(defaultPerformerMonth)
  const prevMonth = shiftMonth(month, -1)
  const incentives = useAsync(() => api.incentives(month), [month])
  const previous = useAsync(() => api.incentives(prevMonth), [prevMonth])
  const staff = useAsync(() => api.staff(), [])
  const [copying, setCopying] = useState(false)

  const rows = incentives.data ?? []
  const pending = rows.filter((r) => r.status === 'Pending')
  const label = formatMonth(month)
  const canCopy = rows.length === 0 && (previous.data?.length ?? 0) > 0

  const copy = async () => {
    setCopying(true)
    try {
      await api.copyIncentives(prevMonth, month)
      incentives.reload()
    } catch (err) { alert((err as Error).message) } finally { setCopying(false) }
  }

  return (
    // Every badge on the page speaks for the month being shown.
    <PerformerScope month={month}>
    <div className="min-w-0">
      <PageHeader title="Monthly Incentives">
        <MonthSelector value={month} onChange={setMonth} />
      </PageHeader>

      {incentives.loading || staff.loading ? (
        <PageLoader label="Loading incentives…" />
      ) : (
        <Card>
          <CardHeader
            title={`Incentives — ${label}`}
            action={canCopy ? (
              <Button variant="secondary" size="sm" onClick={copy} disabled={copying}>
                {copying ? 'Copying…' : `Copy from ${formatMonth(prevMonth)}`}
              </Button>
            ) : pending.length > 0 ? (
              <Badge color="amber">{`${pending.length} pending · ${money2(sumOf(pending))}`}</Badge>
            ) : rows.length > 0 ? (
              <Badge color="green">All settled</Badge>
            ) : undefined}
          />
          <div className="p-4">
            <IncentivesSheet
              // Remount on a month change so no row keeps the previous month's draft.
              key={month}
              month={month}
              incentives={rows}
              staff={staff.data ?? []}
              onChanged={() => incentives.reload()}
            />
          </div>
        </Card>
      )}

      {(incentives.error || staff.error) && (
        <p className="mt-4 text-sm text-red-600">{incentives.error ?? staff.error}</p>
      )}
    </div>
    </PerformerScope>
  )
}
