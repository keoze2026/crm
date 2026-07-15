import { useState } from 'react'
import { Users } from 'lucide-react'
import { api } from '../api/client'
import { DateRangeControl, type Range } from '../components/DateRange'
import DashboardPageLayout from '@/components/dashboard/page-layout'
import BuyersSheet from '../components/BuyersSheet'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useAsync } from '../lib/useAsync'

export default function Buyers() {
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<Range>({ from: '', to: '' })
  const buyers = useAsync(() => api.buyers(search, range), [search, range.from, range.to])

  // Always sort by rate high → low.
  const list = (buyers.data ?? []).slice().sort((a, b) => b.rate - a.rate)

  return (
    <DashboardPageLayout
      header={{
        title: 'Buyers',
        icon: Users,
        description: (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <DateRangeControl value={range} onChange={setRange} />
            <Input placeholder="Search by name…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full sm:w-48" />
          </div>
        ),
      }}
    >
      {buyers.loading ? (
        <div className="flex justify-center py-16"><Spinner className="size-6" /></div>
      ) : (
        <Card>
          <CardContent className="overflow-hidden p-0">
            <div className="border-b border-border px-5 py-4">
              <h2 className="font-display text-lg text-foreground">Monthly Sheet</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Total Calls Bought auto-populates from the Daily Sheet for the selected date range; edit a buyer code or Rate inline (Total, Average &amp; Amount auto-calculate). New buyers appear here once used on the Daily Sheet.
              </p>
            </div>
            <BuyersSheet buyers={list} onChanged={() => buyers.reload()} />
          </CardContent>
        </Card>
      )}

      {buyers.error && <p className="mt-4 text-sm text-destructive">{buyers.error}</p>}
    </DashboardPageLayout>
  )
}
