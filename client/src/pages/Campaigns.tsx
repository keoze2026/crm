import { useState } from 'react'
import { api } from '../api/client'
import { PageHeader } from '../components/Layout'
import { Protected } from '../components/PasswordGate'
import { DateRangeFilter } from '../components/DateRange'
import RecordsSection from '../components/RecordsSection'
import CampaignsSheet from '../components/CampaignsSheet'
import {
  Button,
  Card,
  Input,
  Modal,
  Spinner,
} from '../components/ui'
import { num } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import type { Campaign, CampaignSource } from '../types'

export default function Campaigns() {
  return (
    <Protected pageTitle="Campaigns" password="campaigns-2026" storageKey="lock-campaigns">
      <CampaignsPage />
    </Protected>
  )
}

function CampaignsPage() {
  const [search, setSearch] = useState('')
  // Add-campaign modal retired — add campaigns inline on the Monthly Sheet's bottom row.
  // const [modalOpen, setModalOpen] = useState(false)
  // const [editing, setEditing] = useState<Campaign | null>(null)
  const [ratesFor, setRatesFor] = useState<Campaign | null>(null)

  // Single page-level date filter — applies to every section below.
  const [from, setFrom] = useState('')
  const [to,   setTo]   = useState('')

  const campaigns = useAsync(() => api.campaigns(search, { from, to }), [search, from, to])

  // const openNew = () => { setEditing(null); setModalOpen(true) }
  // const onSaved = () => { setModalOpen(false); campaigns.reload() }
  const onRatesSaved = () => { setRatesFor(null); campaigns.reload() }

  // Sort by avg rate (cost ÷ counted) high → low, matching the report tables.
  const list = (campaigns.data ?? []).slice().sort((a, b) => {
    const ra = a.counted > 0 ? a.cost / a.counted : 0
    const rb = b.counted > 0 ? b.cost / b.counted : 0
    return rb - ra
  })

  return (
    <div>
      <PageHeader title="Campaigns" subtitle="Media-buying campaigns that source calls (cost side)">
        <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        <div className="w-full sm:w-auto">
          <Input placeholder="Search by name…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full sm:w-48" />
        </div>
        {/* Add-campaign button retired — campaigns are added inline on the Monthly Sheet's bottom row.
        <Button onClick={openNew}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          Add campaign
        </Button>
        */}
      </PageHeader>

      {campaigns.loading ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6" /></div>
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-white/50 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Monthly Sheet</h2>
            <p className="mt-0.5 text-sm text-slate-500">Edit a cell to update a campaign; the $ button sets per-source rates; fill the bottom row (or press +) to add one; the trash deletes.</p>
          </div>
          <CampaignsSheet campaigns={list} onChanged={() => campaigns.reload()} onEditRates={setRatesFor} />
        </Card>
      )}

      {campaigns.error && <p className="mt-4 text-sm text-red-600">{campaigns.error}</p>}

      {/* Cost records — campaign (cost) entries only (no buyer / profit) */}
      <RecordsSection
        type="campaign"
        title="Cost billing"
        subtitle="Campaign call records — billing sheet"
        compact
        theme="navy"
        onChange={() => campaigns.reload()}
      />

      {/* Add-campaign modal retired — see CampaignForm below (also commented out).
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${editing.code}` : 'Add campaign'}>
        <CampaignForm editing={editing} onSaved={onSaved} onCancel={() => setModalOpen(false)} />
      </Modal>
      */}

      <Modal open={!!ratesFor} onClose={() => setRatesFor(null)} title={ratesFor ? `Source rates — ${ratesFor.code}` : 'Source rates'}>
        {ratesFor && <CampaignRatesForm campaign={ratesFor} onSaved={onRatesSaved} onCancel={() => setRatesFor(null)} />}
      </Modal>
    </div>
  )
}

function CampaignRatesForm({ campaign, onSaved, onCancel }: { campaign: Campaign; onSaved: () => void; onCancel: () => void }) {
  const sources = useAsync(() => api.campaignSources(campaign.id), [campaign.id])
  const [rates, setRates] = useState<Record<number, string>>({})
  const [newRows, setNewRows] = useState<{ name: string; rate: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const list = sources.data ?? []
  const rateValue = (s: CampaignSource) =>
    s.destination_id != null && rates[s.destination_id] !== undefined ? rates[s.destination_id] : String(s.rate)

  const addRow = () => setNewRows((r) => [...r, { name: '', rate: '' }])
  const patchRow = (i: number, patch: Partial<{ name: string; rate: string }>) =>
    setNewRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)))
  const removeRow = (i: number) => setNewRows((r) => r.filter((_, j) => j !== i))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      // Update existing source rates that changed.
      const changed = list.filter(
        (s) => s.destination_id != null &&
          rates[s.destination_id] !== undefined &&
          Number(rates[s.destination_id]) !== s.rate,
      )
      for (const s of changed) {
        await api.updateDestination(s.destination_id!, { rate: Number(rates[s.destination_id!]) || 0 })
      }
      // Create any new sources, linked to this campaign.
      const toCreate = newRows.filter((r) => r.name.trim() !== '')
      for (const r of toCreate) {
        await api.createDestination({ name: r.name.trim(), rate: Number(r.rate) || 0, campaign_id: campaign.id })
      }
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const nothingToSave = list.length === 0 && newRows.length === 0

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-500">
        Each source bills at its own rate; the campaign cost is the sum across them. These rates
        are stored on the campaign and stay editable even with no call records. Changing a rate
        also re-prices that source's existing records.
      </p>

      {sources.loading ? (
        <div className="flex justify-center py-8"><Spinner className="h-6 w-6" /></div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2 text-right">Calls</th>
                <th className="px-3 py-2 text-right">Rate ($/call)</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && newRows.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">No sources yet — add one below.</td></tr>
              )}
              {list.map((s) => (
                <tr key={s.name} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-800">{s.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{num(s.counted)}</td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number" min="0" step="0.01"
                      value={rateValue(s)}
                      disabled={s.destination_id == null}
                      onChange={(e) => s.destination_id != null && setRates((r) => ({ ...r, [s.destination_id!]: e.target.value }))}
                      className="w-24 text-right"
                    />
                  </td>
                  <td className="px-3 py-2" />
                </tr>
              ))}
              {newRows.map((row, i) => (
                <tr key={`new-${i}`} className="border-t border-slate-100 bg-amber-50/40">
                  <td className="px-3 py-2">
                    <Input placeholder="New source name" value={row.name} onChange={(e) => patchRow(i, { name: e.target.value })} className="w-full" />
                  </td>
                  <td className="px-3 py-2 text-right text-slate-300">—</td>
                  <td className="px-3 py-2 text-right">
                    <Input type="number" min="0" step="0.01" placeholder="0.00" value={row.rate} onChange={(e) => patchRow(i, { rate: e.target.value })} className="w-24 text-right" />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button type="button" onClick={() => removeRow(i)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Remove">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Button type="button" variant="secondary" onClick={addRow}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        Add source
      </Button>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving || nothingToSave}>{saving && <Spinner className="h-4 w-4 text-white" />}Save rates</Button>
      </div>
    </form>
  )
}

/* Add-campaign modal form retired — campaigns are added inline on the Monthly Sheet.
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