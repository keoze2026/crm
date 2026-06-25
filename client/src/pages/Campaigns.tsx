import { useState } from 'react'
import { api } from '../api/client'
import { PageHeader } from '../components/Layout'
import { Protected } from '../components/PasswordGate'
import { DateRangeFilter } from '../components/DateRange'
import RecordsSection from '../components/RecordsSection'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  Select,
  Spinner,
} from '../components/ui'
import { formatDate, money, money2, num } from '../lib/format'
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
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Campaign | null>(null)
  const [ratesFor, setRatesFor] = useState<Campaign | null>(null)

  // Single page-level date filter — applies to every section below.
  const [from, setFrom] = useState('')
  const [to,   setTo]   = useState('')

  const campaigns = useAsync(() => api.campaigns(search, { from, to }), [search, from, to])

  const openNew = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (c: Campaign) => { setEditing(c); setModalOpen(true) }
  const onSaved = () => { setModalOpen(false); campaigns.reload() }
  const onRatesSaved = () => { setRatesFor(null); campaigns.reload() }

  const onDelete = async (c: Campaign) => {
    if (!confirm(`Delete campaign ${c.code}? This also deletes its ${num(c.records)} call records.`)) return
    await api.deleteCampaign(c.id)
    campaigns.reload()
  }

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
        <Button onClick={openNew}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          Add campaign
        </Button>
      </PageHeader>

      {campaigns.loading ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6" /></div>
      ) : list.length === 0 ? (
        <Card><EmptyState message="No campaigns yet. Add your first campaign to get started." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((c) => {
            const totalVolume = c.answered + c.missed
            const replacement = Math.max(0, totalVolume - c.counted)
            return (
              <Card key={c.id} className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold text-slate-900">{c.code}</span>
                      <Badge color={c.status === 'active' ? 'green' : 'red'}>{c.status}</Badge>
                    </div>
                    {c.name && <p className="text-sm text-slate-500">{c.name}</p>}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setRatesFor(c)} className="rounded p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-600" title="Edit source rates">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                    </button>
                    <button onClick={() => openEdit(c)} className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600" title="Edit">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    </button>
                    <button onClick={() => onDelete(c)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                    </button>
                  </div>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
                  <dt className="text-slate-500">Avg rate</dt>
                  <dd className="text-right font-semibold text-amber-700">{money2(c.counted > 0 ? c.cost / c.counted : 0)}</dd>
                  <dt className="text-slate-500">Total volume</dt>
                  <dd className="text-right font-medium text-slate-700">{num(totalVolume)}</dd>
                  <dt className="text-slate-500">Replacement</dt>
                  <dd className="text-right font-medium text-slate-700">{num(replacement)}</dd>
                  <dt className="text-slate-500">Final count</dt>
                  <dd className="text-right font-medium text-slate-700">{num(c.counted)}</dd>
                  <dt className="text-slate-500">Last active</dt>
                  <dd className="text-right font-medium text-slate-700">{formatDate(c.last_activity)}</dd>
                </dl>

                <div className="mt-4 rounded-xl bg-amber-50/70 px-3 py-2">
                  <div className="flex items-center justify-between text-xs text-amber-700">
                    <span>Total running fee</span>
                    <span className="tabular-nums text-amber-600/70">{num(c.sources)} {c.sources === 1 ? 'source' : 'sources'}</span>
                  </div>
                  <div className="text-xl font-bold text-amber-700">{money(c.cost)}</div>
                </div>
              </Card>
            )
          })}
        </div>
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${editing.code}` : 'Add campaign'}>
        <CampaignForm editing={editing} onSaved={onSaved} onCancel={() => setModalOpen(false)} />
      </Modal>

      <Modal open={!!ratesFor} onClose={() => setRatesFor(null)} title={ratesFor ? `Source rates — ${ratesFor.code}` : 'Source rates'}>
        {ratesFor && <CampaignRatesForm campaign={ratesFor} onSaved={onRatesSaved} onCancel={() => setRatesFor(null)} />}
      </Modal>
    </div>
  )
}

function CampaignRatesForm({ campaign, onSaved, onCancel }: { campaign: Campaign; onSaved: () => void; onCancel: () => void }) {
  const sources = useAsync(() => api.campaignSources(campaign.id), [campaign.id])
  const [rates, setRates] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const list = sources.data ?? []
  const rateValue = (s: CampaignSource) =>
    s.destination_id != null && rates[s.destination_id] !== undefined ? rates[s.destination_id] : String(s.rate)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      // Save only the sources whose rate actually changed.
      const changed = list.filter(
        (s) => s.destination_id != null &&
          rates[s.destination_id] !== undefined &&
          Number(rates[s.destination_id]) !== s.rate,
      )
      for (const s of changed) {
        await api.updateDestination(s.destination_id!, { rate: Number(rates[s.destination_id!]) || 0 })
      }
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-500">
        Each source bills at its own rate; the campaign cost is the sum across them. Changing a
        rate updates that source everywhere it is used and re-prices its existing records.
      </p>

      {sources.loading ? (
        <div className="flex justify-center py-8"><Spinner className="h-6 w-6" /></div>
      ) : list.length === 0 ? (
        <EmptyState message="This campaign has no source records yet." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2 text-right">Calls</th>
                <th className="px-3 py-2 text-right">Rate ($/call)</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.name} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-800">{s.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{num(s.counted)}</td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number" min="0" step="0.01"
                      value={rateValue(s)}
                      disabled={s.destination_id == null}
                      title={s.destination_id == null ? 'This source has no destination record to edit' : undefined}
                      onChange={(e) => s.destination_id != null && setRates((r) => ({ ...r, [s.destination_id!]: e.target.value }))}
                      className="w-28 text-right"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving || list.length === 0}>{saving && <Spinner className="h-4 w-4 text-white" />}Save rates</Button>
      </div>
    </form>
  )
}

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