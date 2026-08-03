import RecordsSection from '../components/RecordsSection'
// Page header retired — the Campaigns sheet section carries its own title now.
// import { PageHeader } from '../components/Layout'

// ── Monthly Sheet retired ────────────────────────────────────────────────────
// The Monthly Sheet table (and its page-level date-range + name-search filters)
// is commented out below — campaigns are now managed entirely on the "Campaigns
// sheet" section (formerly "Cost billing"). To bring it back, restore these
// imports and uncomment the state, filters and table block marked below.
// import { useState } from 'react'
// import { api } from '../api/client'
// import { DateRangeFilter } from '../components/DateRange'
// import CampaignsSheet from '../components/CampaignsSheet'
// import { Card, Input, Spinner } from '../components/ui'
// import { useAsync } from '../lib/useAsync'

export default function Campaigns() {
  return <CampaignsPage />
}

function CampaignsPage() {
  // ── Monthly Sheet state + data (retired) ───────────────────────────────────
  // const [search, setSearch] = useState('')
  // // Single page-level date filter — applies to the Monthly Sheet below.
  // const [from, setFrom] = useState('')
  // const [to,   setTo]   = useState('')
  // const campaigns = useAsync(() => api.campaigns(search, { from, to }), [search, from, to])
  // // Sort by avg rate (cost ÷ counted) high → low, matching the report tables.
  // const list = (campaigns.data ?? []).slice().sort((a, b) => {
  //   const ra = a.counted > 0 ? a.cost / a.counted : 0
  //   const rb = b.counted > 0 ? b.cost / b.counted : 0
  //   return rb - ra
  // })

  return (
    <div>
      {/* Page header retired — the Campaigns sheet below carries its own title.
      <PageHeader title="Campaigns" subtitle="Media-buying campaigns that source Leads (cost side)">
        <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        <div className="w-full sm:w-auto">
          <Input placeholder="Search by name…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full sm:w-48" />
        </div>
      </PageHeader>
      */}

      {/* Monthly Sheet table retired — campaigns are managed on the Campaigns sheet below.
      {campaigns.loading ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6" /></div>
      ) : (
        <Card className="overflow-hidden rounded-md!">
          <div className="border-b border-white/50 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Monthly Sheet</h2>
            <p className="mt-0.5 text-sm text-slate-500">Edit a cell to update a campaign; the $ button sets per-source rates; fill the bottom row (or press +) to add one; the trash deletes.</p>
          </div>
          <CampaignsSheet campaigns={list} onChanged={() => campaigns.reload()} />
        </Card>
      )}

      {campaigns.error && <p className="mt-4 text-sm text-red-600">{campaigns.error}</p>}
      */}

      {/* Campaign (cost) records — the sole campaign management surface now. */}
      <RecordsSection
        type="campaign"
        title="Campaigns sheet"
        subtitle="Campaign Lead records — billing sheet"
        theme="navy"
      />

    </div>
  )
}

/* Add-campaign modal form retired — campaigns are added inline on the Campaigns sheet.
function CampaignForm({ editing, onSaved, onCancel }: { editing: Campaign | null; onSaved: () => void; onCancel: () => void }) {
  const [code, setCode] = useState(editing?.code ?? '')
  const [name, setName] = useState(editing?.name ?? '')
  const [status, setStatus] = useState(editing?.status ?? 'active')
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      const data = { code, name: name || null, status, notes: notes || null }
      if (editing) await api.updateCampaign(editing.id, data)
      else await api.createCampaign(data)
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
        <Input label="Code" placeholder="e.g. C-05" value={code} onChange={(e) => setCode(e.target.value)} required />
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
      </div>
      <Input label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="glass-input w-full rounded-xl border border-white/70 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving && <Spinner className="h-4 w-4 text-white" />}{editing ? 'Save' : 'Add campaign'}</Button>
      </div>
    </form>
  )
}
*/
