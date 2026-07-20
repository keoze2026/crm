import { useState } from 'react'
import { api } from '../api/client'
import { DateRangeControl, type Range } from '../components/DateRange'
import { PageHeader } from '../components/Layout'
// import RecordsSection from '../components/RecordsSection'  // Revenue billing section retired (see below)
import BuyersSheet from '../components/BuyersSheet'
import {
  Card,
  Input,
  PageLoader,
} from '../components/ui'
import { useAsync } from '../lib/useAsync'
// import type { Buyer } from '../types'  // only used by the retired Add-buyer modal

export default function Buyers() {
  return <BuyersPage />
}

function BuyersPage() {
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<Range>({ from: '', to: '' })
  // Add-buyer modal retired — add buyers inline on the Monthly Sheet's bottom row.
  // const [modalOpen, setModalOpen] = useState(false)
  // const [editing, setEditing] = useState<Buyer | null>(null)

  const buyers = useAsync(() => api.buyers(search, range), [search, range.from, range.to])

  // const openNew = () => { setEditing(null); setModalOpen(true) }
  // const onSaved = () => { setModalOpen(false); buyers.reload() }

  // Always sort by rate high → low.
  const list = (buyers.data ?? []).slice().sort((a, b) => b.rate - a.rate)

  return (
    <div>
      <PageHeader title="Buyers" subtitle="Customers who purchase forwarded calls (revenue side)">
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
            <p className="mt-0.5 text-sm text-slate-500">Total Calls Bought auto-populates from the Daily Sheet for the selected date range; edit a buyer code or Rate inline (Total, Average &amp; Amount auto-calculate). New buyers appear here once used on the Daily Sheet.</p>
          </div>
          <BuyersSheet buyers={list} onChanged={() => buyers.reload()} />
        </Card>
      )}

      {buyers.error && <p className="mt-4 text-sm text-red-600">{buyers.error}</p>}

      {/* Revenue billing section retired — it duplicates the Leads Records page.
      <RecordsSection type="buyer" title="Revenue billing" subtitle="Buyer call records — billing sheet" compact theme="navy" onChange={() => buyers.reload()} />
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
        <Input label="Rate ($/call)" type="number" min="0" step="0.01" placeholder="e.g. 55.00" value={rate} onChange={(e) => setRate(e.target.value)} required />
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
