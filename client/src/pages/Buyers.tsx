import { useState } from 'react'
import { api } from '../api/client'
import { BillingReport } from '../components/BillingReport'
import { PageHeader } from '../components/Layout'
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
import { formatDate, money, num } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import type { Buyer } from '../types'

export default function Buyers() {
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Buyer | null>(null)

  const buyers = useAsync(() => api.buyers(search), [search])

  const openNew = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (b: Buyer) => { setEditing(b); setModalOpen(true) }
  const onSaved = () => { setModalOpen(false); buyers.reload() }

  const onDelete = async (b: Buyer) => {
    if (!confirm(`Delete buyer ${b.code}? This also deletes its ${num(b.records)} call records.`)) return
    await api.deleteBuyer(b.id)
    buyers.reload()
  }

  const list = buyers.data ?? []

  return (
    <div>
      <PageHeader title="Buyers" subtitle="Customers who purchase forwarded calls (revenue side)">
        <div className="w-full sm:w-auto">
          <Input placeholder="Search buyers…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full sm:w-48" />
        </div>
        <Button onClick={openNew}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          Add buyer
        </Button>
      </PageHeader>

      {buyers.loading ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6" /></div>
      ) : list.length === 0 ? (
        <Card><EmptyState message="No buyers yet. Add your first buyer to get started." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((b) => {
            const answerRate = b.answered + b.missed > 0 ? Math.round((b.answered / (b.answered + b.missed)) * 100) : 0
            return (
              <Card key={b.id} className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold text-slate-900">{b.code}</span>
                      <Badge color={b.status === 'active' ? 'green' : 'slate'}>{b.status}</Badge>
                    </div>
                    {b.name && <p className="text-sm text-slate-500">{b.name}</p>}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(b)} className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600" title="Edit">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    </button>
                    <button onClick={() => onDelete(b)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                    </button>
                  </div>
                </div>

                <div className="mt-4 rounded-xl bg-blue-50/70 px-3 py-2">
                  <div className="text-xs text-blue-700">Total revenue</div>
                  <div className="text-xl font-bold text-blue-700">{money(b.revenue)}</div>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
                  <dt className="text-slate-500">Counted</dt>
                  <dd className="text-right font-medium text-slate-700">{num(b.counted)}</dd>
                  <dt className="text-slate-500">Answer rate</dt>
                  <dd className="text-right font-medium text-slate-700">{answerRate}%</dd>
                  <dt className="text-slate-500">Records</dt>
                  <dd className="text-right font-medium text-slate-700">{num(b.records)}</dd>
                  <dt className="text-slate-500">Last activity</dt>
                  <dd className="text-right font-medium text-slate-700">{formatDate(b.last_activity)}</dd>
                </dl>
              </Card>
            )
          })}
        </div>
      )}

      {buyers.error && <p className="mt-4 text-sm text-red-600">{buyers.error}</p>}

      {/* Buyer billing table — same as Complete Report's revenue side */}
      <BillingReport type="buyer" />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${editing.code}` : 'Add buyer'}>
        <BuyerForm editing={editing} onSaved={onSaved} onCancel={() => setModalOpen(false)} />
      </Modal>
    </div>
  )
}

function BuyerForm({ editing, onSaved, onCancel }: { editing: Buyer | null; onSaved: () => void; onCancel: () => void }) {
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
      <Input label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
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
