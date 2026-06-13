import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { useMemo, useState } from 'react'
import { api } from '../api/client'
import { DownloadButton } from '../components/DateRange'
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
  cx,
} from '../components/ui'
import { formatDate, money2, num, today } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import type { Buyer, CallRecord, Campaign, RecordFilters, RecordType } from '../types'

// ─── PDF generation ──────────────────────────────────────────────────────────

function buildPdf(
  title: string,
  subtitle: string,
  columns: string[],
  rows: (string | number)[][],
): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  doc.setFontSize(18)
  doc.setTextColor(30, 64, 175)
  doc.setFont('helvetica', 'bold')
  doc.text('CallFlow CRM', 40, 44)

  doc.setFontSize(13)
  doc.setTextColor(15, 23, 42)
  doc.text(title, 40, 64)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 116, 139)
  doc.text(subtitle, 40, 80)
  doc.text(`Generated ${new Date().toLocaleString()}`, pageW - 40, 80, { align: 'right' })

  autoTable(doc, {
    startY: 96,
    head: [columns],
    body: rows.map((r) => r.map(String)),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: 'bold', halign: 'left' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: Object.fromEntries(
      // right-align numeric columns (Answered … Total Bill)
      [4, 5, 6, 7, 8].map((i) => [i, { halign: 'right' }])
    ),
    margin: { left: 40, right: 40 },
  })

  return doc
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Records() {
  const [filters, setFilters] = useState<RecordFilters>({
    type: '',
    from: '',
    to: '',
    search: '',
    buyer_id: '',
    campaign_id: '',
    sort: 'record_date',
    dir: 'desc',
    page: 1,
    per_page: 25,
  })
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing]     = useState<CallRecord | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)

  const buyers    = useAsync(() => api.buyers(), [])
  const campaigns = useAsync(() => api.campaigns(), [])
  const records   = useAsync(() => api.records(filters), [JSON.stringify(filters)])

  const set = (patch: Partial<RecordFilters>) =>
    setFilters((f) => ({ ...f, page: 1, ...patch }))

  const openNew  = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (r: CallRecord) => { setEditing(r); setModalOpen(true) }

  const onSaved = () => {
    setModalOpen(false)
    records.reload()
    buyers.reload()
    campaigns.reload()
  }

  const onDelete = async (r: CallRecord) => {
    if (!confirm(`Delete this ${r.record_type} record from ${formatDate(r.record_date)}?`)) return
    await api.deleteRecord(r.id)
    records.reload()
  }

  // Build a human-readable subtitle describing the active filters
  const filterLabel = useMemo(() => {
    const parts: string[] = []
    if (filters.from || filters.to)
      parts.push(`${filters.from || '…'} → ${filters.to || '…'}`)
    if (filters.type)
      parts.push(filters.type === 'buyer' ? 'Revenue only' : 'Cost only')
    if (filters.search)
      parts.push(`source: "${filters.search}"`)
    return parts.length ? parts.join('  ·  ') : 'All records'
  }, [filters])

  const handlePdf = async () => {
    setPdfLoading(true)
    try {
      // Fetch up to 5 000 rows matching the current filters (strip pagination)
      const result = await api.records({
        ...filters,
        page: 1,
        per_page: 5000,
      })
      const rows = result.data.map((r) => [
        formatDate(r.record_date),
        r.record_type === 'buyer' ? 'Revenue' : 'Cost',
        r.buyer_code ?? r.campaign_code ?? '—',
        r.source ?? '—',
        r.answered,
        r.missed,
        r.counted,
        `$${r.rate.toFixed(2)}`,
        `$${r.total_bill.toFixed(2)}`,
      ])
      buildPdf(
        'Call Records Export',
        filterLabel,
        ['Date', 'Type', 'Buyer / Campaign', 'Source', 'Answered', 'Missed', 'Counted', 'Rate', 'Total Bill'],
        rows,
      ).save('call-records.pdf')
    } finally {
      setPdfLoading(false)
    }
  }

  const meta = records.data?.meta
  const rows = records.data?.data ?? []

  return (
    <div>
      <PageHeader title="Call Records" subtitle="Daily call volumes entered by the team">
        <DownloadButton href={api.recordsExportUrl(filters)}>CSV</DownloadButton>
        <Button variant="secondary" onClick={handlePdf} disabled={pdfLoading}>
          {pdfLoading
            ? <Spinner className="h-3.5 w-3.5" />
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
              </svg>
          }
          PDF
        </Button>
        <Button onClick={openNew}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add record
        </Button>
      </PageHeader>

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Select label="Type" value={filters.type} onChange={(e) => set({ type: e.target.value as RecordType | '' })}>
            <option value="">All types</option>
            <option value="buyer">Buyer (revenue)</option>
            <option value="campaign">Campaign (cost)</option>
          </Select>
          <Input label="From" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
          <Input label="To"   type="date" value={filters.to}   onChange={(e) => set({ to: e.target.value })} />
          <Select label="Buyer" value={filters.buyer_id} onChange={(e) => set({ buyer_id: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">All buyers</option>
            {buyers.data?.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
          </Select>
          <Select label="Campaign" value={filters.campaign_id} onChange={(e) => set({ campaign_id: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">All campaigns</option>
            {campaigns.data?.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </Select>
          <Input label="Search source" placeholder="e.g. AdsTerra" value={filters.search} onChange={(e) => set({ search: e.target.value })} />
        </div>
      </Card>

      {/* Table */}
      <Card>
        {records.loading ? (
          <div className="flex justify-center py-16"><Spinner className="h-6 w-6" /></div>
        ) : rows.length === 0 ? (
          <EmptyState message="No records match these filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <Th onClick={() => toggleSort(filters, set)} sortable active={filters.sort === 'record_date'} dir={filters.dir}>Date</Th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Buyer / Campaign</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <ThNum onClick={() => set({ sort: 'answered',   dir: nextDir(filters, 'answered')   })} active={filters.sort === 'answered'}   dir={filters.dir}>Answered</ThNum>
                  <ThNum onClick={() => set({ sort: 'missed',     dir: nextDir(filters, 'missed')     })} active={filters.sort === 'missed'}     dir={filters.dir}>Missed</ThNum>
                  <ThNum onClick={() => set({ sort: 'counted',    dir: nextDir(filters, 'counted')    })} active={filters.sort === 'counted'}    dir={filters.dir}>Counted</ThNum>
                  <th className="px-4 py-3 text-right font-medium">Rate</th>
                  <ThNum onClick={() => set({ sort: 'total_bill', dir: nextDir(filters, 'total_bill') })} active={filters.sort === 'total_bill'} dir={filters.dir}>Total</ThNum>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(r.record_date)}</td>
                    <td className="px-4 py-3">
                      <Badge color={r.record_type === 'buyer' ? 'blue' : 'amber'}>
                        {r.record_type === 'buyer' ? 'Revenue' : 'Cost'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{r.buyer_code ?? r.campaign_code ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{r.source ?? '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{num(r.answered)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">{num(r.missed)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{num(r.counted)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">{money2(r.rate)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{money2(r.total_bill)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => openEdit(r)} className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600" title="Edit">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                        </button>
                        <button onClick={() => onDelete(r)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {meta && meta.total > 0 && (
          <div className="flex flex-col items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-sm text-slate-500 sm:flex-row">
            <span>
              Showing {(meta.page - 1) * meta.per_page + 1}–{Math.min(meta.page * meta.per_page, meta.total)} of {num(meta.total)}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="secondary" size="sm" disabled={meta.page <= 1}          onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}>Prev</Button>
              <span className="px-2">Page {meta.page} / {meta.pages}</span>
              <Button variant="secondary" size="sm" disabled={meta.page >= meta.pages} onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}>Next</Button>
            </div>
          </div>
        )}
      </Card>

      {records.error && <p className="mt-4 text-sm text-red-600">{records.error}</p>}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit record' : 'Add call record'}>
        <RecordForm
          editing={editing}
          buyers={buyers.data ?? []}
          campaigns={campaigns.data ?? []}
          onSaved={onSaved}
          onCancel={() => setModalOpen(false)}
        />
      </Modal>
    </div>
  )
}

// ─── Sort helpers ─────────────────────────────────────────────────────────────

function nextDir(filters: RecordFilters, col: string): 'asc' | 'desc' {
  return filters.sort === col && filters.dir === 'desc' ? 'asc' : 'desc'
}
function toggleSort(filters: RecordFilters, set: (p: Partial<RecordFilters>) => void) {
  set({ sort: 'record_date', dir: nextDir(filters, 'record_date') })
}

// ─── Table header cells ───────────────────────────────────────────────────────

function Th({ children, onClick, sortable, active, dir }: {
  children: React.ReactNode; onClick?: () => void; sortable?: boolean; active?: boolean; dir?: string
}) {
  return (
    <th className={cx('px-4 py-3 font-medium', sortable && 'cursor-pointer select-none')} onClick={onClick}>
      <span className={cx(active && 'text-blue-600')}>
        {children}{active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
      </span>
    </th>
  )
}

function ThNum({ children, onClick, active, dir }: {
  children: React.ReactNode; onClick: () => void; active: boolean; dir?: string
}) {
  return (
    <th className="cursor-pointer select-none px-4 py-3 text-right font-medium" onClick={onClick}>
      <span className={cx(active && 'text-blue-600')}>
        {children}{active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
      </span>
    </th>
  )
}

// ─── Record form ──────────────────────────────────────────────────────────────

function RecordForm({
  editing, buyers, campaigns, onSaved, onCancel,
}: {
  editing: CallRecord | null
  buyers: Buyer[]
  campaigns: Campaign[]
  onSaved: () => void
  onCancel: () => void
}) {
  const [type,       setType]       = useState<RecordType>(editing?.record_type ?? 'buyer')
  const [date,       setDate]       = useState(editing?.record_date ?? today())
  const [buyerId,    setBuyerId]    = useState<string>(editing?.buyer_id     ? String(editing.buyer_id)     : '')
  const [campaignId, setCampaignId] = useState<string>(editing?.campaign_id ? String(editing.campaign_id) : '')
  const [newCode,    setNewCode]    = useState('')
  const [source,     setSource]     = useState(editing?.source   ?? '')
  const [answered,   setAnswered]   = useState(String(editing?.answered ?? ''))
  const [missed,     setMissed]     = useState(String(editing?.missed   ?? ''))
  const [counted,    setCounted]    = useState(String(editing?.counted  ?? ''))
  const [rate,       setRate]       = useState(String(editing?.rate     ?? ''))
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  const isEdit   = !!editing
  const total    = useMemo(() => (Number(counted) || 0) * (Number(rate) || 0), [counted, rate])

  const handleAnsweredChange = (v: string) => {
    setAnswered(v)
    setCounted(String((Number(v) || 0) + (Number(missed) || 0)))
  }
  const handleMissedChange = (v: string) => {
    setMissed(v)
    setCounted(String((Number(answered) || 0) + (Number(v) || 0)))
  }

  const creatingNew = !isEdit && (type === 'buyer' ? buyerId === '__new__' : campaignId === '__new__')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const base = {
        record_date: date,
        answered: Number(answered) || 0,
        missed:   Number(missed)   || 0,
        counted:  Number(counted)  || 0,
        rate:     Number(rate)     || 0,
      }
      if (isEdit) {
        await api.updateRecord(editing!.id, { ...base, source: type === 'campaign' ? source : null })
      } else {
        const payload: Record<string, unknown> = { ...base, record_type: type }
        if (type === 'buyer') {
          if (buyerId === '__new__') payload.buyer_code = newCode
          else payload.buyer_id = Number(buyerId)
        } else {
          if (campaignId === '__new__') payload.campaign_code = newCode
          else payload.campaign_id = Number(campaignId)
          payload.source = source
        }
        await api.createRecord(payload)
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
      {!isEdit && (
        <div className="glass-input flex rounded-xl border border-white/70 p-1">
          {(['buyer', 'campaign'] as RecordType[]).map((t) => (
            <button key={t} type="button" onClick={() => setType(t)}
              className={cx(
                'flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors',
                type === t ? 'bg-linear-to-b from-blue-500 to-blue-600 text-white shadow' : 'text-slate-500 hover:bg-white/50',
              )}>
              {t === 'buyer' ? 'Buyer (revenue)' : 'Campaign (cost)'}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Input label="Date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required />

        {type === 'buyer' && !isEdit && (
          <Select label="Buyer" value={buyerId} onChange={(e) => setBuyerId(e.target.value)} required>
            <option value="">Select buyer…</option>
            {buyers.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
            <option value="__new__">+ New buyer…</option>
          </Select>
        )}
        {type === 'campaign' && !isEdit && (
          <Select label="Campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} required>
            <option value="">Select campaign…</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
            <option value="__new__">+ New campaign…</option>
          </Select>
        )}
        {isEdit && (
          <Input
            label={editing!.record_type === 'buyer' ? 'Buyer' : 'Campaign'}
            value={editing!.buyer_code ?? editing!.campaign_code ?? ''}
            disabled
          />
        )}
        {creatingNew && (
          <Input label="New code" placeholder={type === 'buyer' ? 'e.g. RTG 99' : 'e.g. C-12'} value={newCode} onChange={(e) => setNewCode(e.target.value)} required />
        )}
        {type === 'campaign' && (
          <Input label="Source" placeholder="e.g. AdsTerra" value={source} onChange={(e) => setSource(e.target.value)} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Input label="Answered" type="number" min="0" value={answered} onChange={(e) => handleAnsweredChange(e.target.value)} />
        <Input label="Missed"   type="number" min="0" value={missed}   onChange={(e) => handleMissedChange(e.target.value)} />
        <Input label="Counted"  type="number" min="0" value={counted}  onChange={(e) => setCounted(e.target.value)} disabled />
        <Input label="Rate ($)" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
      </div>

      <div className="flex items-center justify-between rounded-xl bg-linear-to-r from-blue-500 to-blue-600 px-4 py-3 text-white shadow-lg shadow-blue-600/25">
        <span className="text-sm font-medium text-blue-50">Total bill</span>
        <span className="text-lg font-bold">{money2(total)}</span>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>
          {saving && <Spinner className="h-4 w-4 text-white" />}
          {isEdit ? 'Save changes' : 'Add record'}
        </Button>
      </div>
    </form>
  )
}