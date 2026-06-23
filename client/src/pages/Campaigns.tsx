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
import type { Campaign } from '../types'

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

  // Single page-level date filter — applies to every section below.
  const [from, setFrom] = useState('')
  const [to,   setTo]   = useState('')

  const campaigns = useAsync(() => api.campaigns(search, { from, to }), [search, from, to])

  const openNew = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (c: Campaign) => { setEditing(c); setModalOpen(true) }
  const onSaved = () => { setModalOpen(false); campaigns.reload() }

  const onDelete = async (c: Campaign) => {
    if (!confirm(`Delete campaign ${c.code}? This also deletes its ${num(c.records)} call records.`)) return
    await api.deleteCampaign(c.id)
    campaigns.reload()
  }

  const list = campaigns.data ?? []

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
                    <button onClick={() => openEdit(c)} className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600" title="Edit">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    </button>
                    <button onClick={() => onDelete(c)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                    </button>
                  </div>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
                  <dt className="text-slate-500">Rate</dt>
                  <dd className="text-right font-semibold text-amber-700">{money2(c.rate)}</dd>
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
                    <span className="tabular-nums text-amber-600/70">{money2(c.rate)} × {num(c.counted)}</span>
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
    </div>
  )
}

function CampaignForm({ editing, onSaved, onCancel }: { editing: Campaign | null; onSaved: () => void; onCancel: () => void }) {
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
      <div className="grid grid-cols-2 gap-3">
        <Input label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Rate ($/call)" type="number" min="0" step="0.01" placeholder="e.g. 50.00" value={rate} onChange={(e) => setRate(e.target.value)} required />
      </div>
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