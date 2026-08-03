import { useState } from 'react'
import { api } from '../api/client'
import { DateRangeControl, type Range } from '../components/DateRange'
import { PageHeader } from '../components/Layout'
// import RecordsSection from '../components/RecordsSection'  // Revenue billing section retired (see below)
import BuyersSheet from '../components/BuyersSheet'
import {
  Card,
  EmptyState,
  Input,
  PageLoader,
} from '../components/ui'
import { todayRange } from '../lib/format'
import { useAsync } from '../lib/useAsync'
// import type { Buyer } from '../types'  // only used by the retired Add-buyer modal

export default function Buyers() {
  return <BuyersPage />
}

function BuyersPage() {
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<Range>(todayRange)
  // Add-buyer modal retired — add buyers inline on the Monthly Sheet's bottom row.
  // const [modalOpen, setModalOpen] = useState(false)
  // const [editing, setEditing] = useState<Buyer | null>(null)

  const buyers = useAsync(() => api.buyers(search, range), [search, range.from, range.to])

  // const openNew = () => { setEditing(null); setModalOpen(true) }
  // const onSaved = () => { setModalOpen(false); buyers.reload() }

  // Only buyers that actually bought Leads in the selected range reach the sheet — a row
  // of zeroes is noise, and `counted` here IS the sheet's "Total Leads Bought" column, so
  // hiding counted === 0 hides exactly the rows that would read 0. Filtered here rather
  // than in the API because GET /buyers also feeds the Daily Sheet's destination picker,
  // which must keep listing every buyer (including brand-new ones with no records yet).
  // Then always sort by rate high → low.
  const list = (buyers.data ?? [])
    .filter((b) => Number(b.counted) > 0)
    .sort((a, b) => b.rate - a.rate)

  return (
    <div>
      <PageHeader title="Buyers" subtitle="Customers who purchase forwarded Leads (revenue side)">
        <DateRangeControl value={range} onChange={setRange} />
        <div className="w-full sm:w-auto">
          <Input placeholder="Search by name…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full sm:w-48" />
        </div>
        {/* Add-buyer button retired — buyers are added inline on the Monthly Sheet's bottom row.
        <Button onClick={openNew}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          Add buyer
        </Button>
        */}
      </PageHeader>

      {buyers.loading ? (
        <PageLoader label="Loading buyers…" />
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-white/50 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Monthly Sheet</h2>
            <p className="mt-0.5 text-sm text-slate-500">Only buyers with Leads bought in the selected date range are listed; Total Leads Bought auto-populates from the Daily Sheet for that range. Edit a buyer code or Rate inline (Total, Average &amp; Amount auto-calculate). New buyers appear here once used on the Daily Sheet.</p>
          </div>
          {list.length === 0 ? (
            <EmptyState message="No buyers bought Leads in this date range — widen the date filter to see more." />
          ) : (
            <BuyersSheet buyers={list} onChanged={() => buyers.reload()} />
          )}
        </Card>
      )}

      {buyers.error && <p className="mt-4 text-sm text-red-600">{buyers.error}</p>}

      {/* Revenue billing section retired — it duplicates the Leads Records page.
      <RecordsSection type="buyer" title="Revenue billing" subtitle="Buyer Lead records — billing sheet" compact theme="navy" onChange={() => buyers.reload()} />
      */}

      {/* Add-buyer modal retired — see BuyerForm below (also commented out).
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${editing.code}` : 'Add buyer'}>
        <BuyerForm editing={editing} onSaved={onSaved} onCancel={() => setModalOpen(false)} />
      </Modal>
      */}
    </div>
  )
}

/* Add-buyer modal form retired — buyers are added inline on the Monthly Sheet.
function BuyerForm({ editing, onSaved, onCancel }: { editing: Buyer | null; onSaved: () => void; onCancel: () => void }) {
  const [code, setCode] = useState(editing?.code ?? '')
  const [name, setName] = useState(editing?.name ?? '')
  const [status, setStatus] = useState(editing?.status ?? 'active')
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [rate, setRate] = useState(String(editing?.rate ?? ''))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      const data = { code, name: name || null, status, notes: notes || null, rate: Number(rate) || 0 }
      if (editing) await api.updateBuyer(editing.id, data)
      else await api.createBuyer(data)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Input label="Code" placeholder="e.g. RTG 04" value={code} onChange={(e) => setCode(e.target.value)} required />
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Rate ($/Lead)" type="number" min="0" step="0.01" placeholder="e.g. 55.00" value={rate} onChange={(e) => setRate(e.target.value)} required />
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="glass-input w-full rounded-xl border border-white/70 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving && <Spinner className="h-4 w-4 text-white" />}{editing ? 'Save' : 'Add buyer'}</Button>
      </div>
    </form>
  )
}
*/
