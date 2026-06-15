import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../api/client'
import { formatDate, money2, num, today } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import type { CallRecord, RecordFilters, RecordType } from '../types'
import { DateRangeFilter, DownloadButton } from './DateRange'
import { Button, Card, EmptyState, Input, Modal, Select, Spinner, cx } from './ui'

interface Entity { id: number; code: string }

const PdfIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
  </svg>
)
const PlusIcon  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
const EditIcon  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
const TrashIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>

// ─── PDF ─────────────────────────────────────────────────────────────────────

function buildPdf(title: string, subtitle: string, columns: string[], rows: (string | number)[][], numericFrom: number): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  doc.setFontSize(13); doc.setTextColor(15, 23, 42); doc.setFont('helvetica', 'bold')
  doc.text(title, 40, 46)
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139)
  doc.text(subtitle, 40, 62)
  doc.text(`Generated ${new Date().toLocaleString()}`, pageW - 40, 62, { align: 'right' })
  autoTable(doc, {
    startY: 78, theme: 'grid', head: [columns], body: rows.map((r) => r.map(String)),
    styles: { fontSize: 8, cellPadding: 4, lineColor: [255, 255, 255], lineWidth: 1, textColor: [15, 23, 42], valign: 'middle' },
    headStyles: { fillColor: [26, 54, 84], textColor: 255, fontStyle: 'bold', halign: 'left', lineColor: [26, 54, 84], lineWidth: 1 },
    bodyStyles: { fillColor: [212, 233, 242] },
    columnStyles: Object.fromEntries(columns.flatMap((_, i) => (i >= numericFrom ? [[i, { halign: 'right' as const }]] : []))),
    margin: { left: 40, right: 40 },
  })
  return doc
}

// ─── Section ──────────────────────────────────────────────────────────────────

export default function RecordsSection({
  type, title, subtitle, compact = false, onChange,
}: {
  type: RecordType; title: string; subtitle: string; compact?: boolean; onChange?: () => void
}) {
  const isBuyer    = type === 'buyer'
  const entityLabel = isBuyer ? 'Buyer' : 'Campaign'

  const [filters, setFilters] = useState<RecordFilters>({
    type, from: '', to: '', search: '', buyer_id: '', campaign_id: '',
    sort: 'total_bill', dir: 'desc', page: 1, per_page: 25,
  })
  const [modalOpen,  setModalOpen]  = useState(false)
  const [editing,    setEditing]    = useState<CallRecord | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)

  const entities = useAsync<Entity[]>(async () => {
    const list = isBuyer ? await api.buyers() : await api.campaigns()
    return list.map((x) => ({ id: x.id, code: x.code }))
  }, [type])
  const records = useAsync(() => api.records(filters), [JSON.stringify(filters)])

  const set = (patch: Partial<RecordFilters>) => setFilters((f) => ({ ...f, page: 1, ...patch }))

  const openNew  = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (r: CallRecord) => { setEditing(r); setModalOpen(true) }

  const onSaved = () => { setModalOpen(false); records.reload(); entities.reload(); onChange?.() }
  const onDelete = async (r: CallRecord) => {
    if (!confirm(`Delete this record from ${formatDate(r.record_date)}?`)) return
    await api.deleteRecord(r.id); records.reload(); onChange?.()
  }

  const filterLabel = useMemo(() => {
    const parts: string[] = []
    if (filters.from || filters.to) parts.push(`${filters.from || '…'} → ${filters.to || '…'}`)
    if (filters.search) parts.push(`search: "${filters.search}"`)
    return parts.length ? parts.join('  ·  ') : 'All records'
  }, [filters])

  const handlePdf = async () => {
    setPdfLoading(true)
    try {
      const result = await api.records({ ...filters, page: 1, per_page: 5000 })
      const rows = result.data.map((r) => [
        formatDate(r.record_date),
        (isBuyer ? r.buyer_code : r.campaign_code) ?? '—',
        r.answered, r.missed, r.counted,
        `$${r.rate.toFixed(2)}`, `$${r.total_bill.toFixed(2)}`,
      ])
      buildPdf(
        isBuyer ? 'Revenue Records Export' : 'Cost Records Export',
        filterLabel,
        ['Date', entityLabel, 'Answered', 'Missed', 'Counted', 'Rate', 'Total Bill'],
        rows, 2,
      ).save(isBuyer ? 'revenue-records.pdf' : 'cost-records.pdf')
    } finally { setPdfLoading(false) }
  }

  const meta = records.data?.meta
  const rows = records.data?.data ?? []

  const actions = (
    <>
      <DownloadButton href={api.recordsExportUrl(filters)}>CSV</DownloadButton>
      <Button variant="secondary" onClick={handlePdf} disabled={pdfLoading}>
        {pdfLoading ? <Spinner className="h-3.5 w-3.5" /> : <PdfIcon />} PDF
      </Button>
      <Button onClick={openNew}><PlusIcon /> Add record</Button>
    </>
  )

  return (
    <section>
      {compact ? (
        <div className="mb-4 mt-10 flex flex-col gap-3 border-t border-white/50 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
            <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      ) : (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
            <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      )}

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <DateRangeFilter
            from={filters.from ?? ''}
            to={filters.to ?? ''}
            onFromChange={(iso) => set({ from: iso })}
            onToChange={(iso) => set({ to: iso })}
          />
          <Select
            label={entityLabel}
            value={isBuyer ? filters.buyer_id : filters.campaign_id}
            onChange={(e) =>
              set(isBuyer
                ? { buyer_id: e.target.value ? Number(e.target.value) : '' }
                : { campaign_id: e.target.value ? Number(e.target.value) : '' })
            }
          >
            <option value="">All {isBuyer ? 'buyers' : 'campaigns'}</option>
            {entities.data?.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
          </Select>
          <Input label="Search" placeholder={`${entityLabel} code…`} value={filters.search} onChange={(e) => set({ search: e.target.value })} />
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
                  <th className="px-4 py-3 font-medium">#</th>
                  <Th onClick={() => set({ sort: 'record_date', dir: nextDir(filters, 'record_date') })} active={filters.sort === 'record_date'} dir={filters.dir}>Date</Th>
                  <th className="px-4 py-3 font-medium">{entityLabel}</th>
                  <ThNum onClick={() => set({ sort: 'answered',   dir: nextDir(filters, 'answered')   })} active={filters.sort === 'answered'}   dir={filters.dir}>Answered</ThNum>
                  <ThNum onClick={() => set({ sort: 'missed',     dir: nextDir(filters, 'missed')     })} active={filters.sort === 'missed'}     dir={filters.dir}>Missed</ThNum>
                  <ThNum onClick={() => set({ sort: 'counted',    dir: nextDir(filters, 'counted')    })} active={filters.sort === 'counted'}    dir={filters.dir}>Counted</ThNum>
                  <th className="px-4 py-3 text-right font-medium">Rate</th>
                  <ThNum onClick={() => set({ sort: 'total_bill', dir: nextDir(filters, 'total_bill') })} active={filters.sort === 'total_bill'} dir={filters.dir}>Total</ThNum>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-4 py-3 tabular-nums text-slate-400">{(meta ? (meta.page - 1) * meta.per_page : 0) + i + 1}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(r.record_date)}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{(isBuyer ? r.buyer_code : r.campaign_code) ?? '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{num(r.answered)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">{num(r.missed)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{num(r.counted)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">{money2(r.rate)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{money2(r.total_bill)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => openEdit(r)} className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600" title="Edit"><EditIcon /></button>
                        <button onClick={() => onDelete(r)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><TrashIcon /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {meta && meta.total > 0 && (
          <div className="flex flex-col items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-sm text-slate-500 sm:flex-row">
            <span>Showing {(meta.page - 1) * meta.per_page + 1}–{Math.min(meta.page * meta.per_page, meta.total)} of {num(meta.total)}</span>
            <div className="flex items-center gap-1">
              <Button variant="secondary" size="sm" disabled={meta.page <= 1}          onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}>Prev</Button>
              <span className="px-2">Page {meta.page} / {meta.pages}</span>
              <Button variant="secondary" size="sm" disabled={meta.page >= meta.pages} onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}>Next</Button>
            </div>
          </div>
        )}
      </Card>

      {records.error && <p className="mt-4 text-sm text-red-600">{records.error}</p>}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit record' : `Add ${isBuyer ? 'revenue' : 'cost'} record`}>
        <RecordForm type={type} editing={editing} entities={entities.data ?? []} onSaved={onSaved} onCancel={() => setModalOpen(false)} />
      </Modal>
    </section>
  )
}

function nextDir(filters: RecordFilters, col: string): 'asc' | 'desc' {
  return filters.sort === col && filters.dir === 'desc' ? 'asc' : 'desc'
}
function Th({ children, onClick, active, dir }: { children: ReactNode; onClick: () => void; active?: boolean; dir?: string }) {
  return (
    <th className="cursor-pointer select-none px-4 py-3 font-medium" onClick={onClick}>
      <span className={cx(active && 'text-blue-600')}>{children}{active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
    </th>
  )
}
function ThNum({ children, onClick, active, dir }: { children: ReactNode; onClick: () => void; active?: boolean; dir?: string }) {
  return (
    <th className="cursor-pointer select-none px-4 py-3 text-right font-medium" onClick={onClick}>
      <span className={cx(active && 'text-blue-600')}>{children}{active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
    </th>
  )
}

// ─── Record form ──────────────────────────────────────────────────────────────

function RecordForm({ type, editing, entities, onSaved, onCancel }: {
  type: RecordType; editing: CallRecord | null; entities: Entity[]; onSaved: () => void; onCancel: () => void
}) {
  const isBuyer    = type === 'buyer'
  const entityLabel = isBuyer ? 'Buyer' : 'Campaign'
  const isEdit     = !!editing

  const [date,     setDate]     = useState(editing?.record_date ?? today())
  const [entityId, setEntityId] = useState<string>(editing ? String((isBuyer ? editing.buyer_id : editing.campaign_id) ?? '') : '')
  const [newCode,  setNewCode]  = useState('')
  const [answered, setAnswered] = useState(String(editing?.answered ?? ''))
  const [missed,   setMissed]   = useState(String(editing?.missed   ?? ''))
  const [counted,  setCounted]  = useState(String(editing?.counted  ?? ''))
  const [rate,     setRate]     = useState(String(editing?.rate     ?? ''))
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const total       = useMemo(() => (Number(counted) || 0) * (Number(rate) || 0), [counted, rate])
  const creatingNew = !isEdit && entityId === '__new__'

  const handleAnswered = (v: string) => { setAnswered(v); setCounted(String((Number(v) || 0) + (Number(missed) || 0))) }
  const handleMissed   = (v: string) => { setMissed(v);   setCounted(String((Number(answered) || 0) + (Number(v) || 0))) }

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setSaving(true); setError(null)
    try {
      const base = { record_date: date, answered: Number(answered)||0, missed: Number(missed)||0, counted: Number(counted)||0, rate: Number(rate)||0 }
      if (isEdit) {
        await api.updateRecord(editing!.id, { ...base })
      } else {
        const payload: Record<string, unknown> = { ...base, record_type: type }
        if (entityId === '__new__') payload[isBuyer ? 'buyer_code' : 'campaign_code'] = newCode
        else payload[isBuyer ? 'buyer_id' : 'campaign_id'] = Number(entityId)
        await api.createRecord(payload)
      }
      onSaved()
    } catch (err) { setError((err as Error).message) } finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required />
        {isEdit ? (
          <Input label={entityLabel} value={(isBuyer ? editing!.buyer_code : editing!.campaign_code) ?? ''} disabled />
        ) : (
          <Select label={entityLabel} value={entityId} onChange={(e) => setEntityId(e.target.value)} required>
            <option value="">Select {entityLabel.toLowerCase()}…</option>
            {entities.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
            <option value="__new__">+ New {entityLabel.toLowerCase()}…</option>
          </Select>
        )}
        {creatingNew && <Input label="New code" placeholder={isBuyer ? 'e.g. RTG 99' : 'e.g. C-12'} value={newCode} onChange={(e) => setNewCode(e.target.value)} required />}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Input label="Answered" type="number" min="0" value={answered} onChange={(e) => handleAnswered(e.target.value)} />
        <Input label="Missed"   type="number" min="0" value={missed}   onChange={(e) => handleMissed(e.target.value)} />
        <Input label="Counted"  type="number" min="0" value={counted}  disabled />
        <Input label="Rate ($)" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
      </div>
      <div className="flex items-center justify-between rounded-xl bg-linear-to-r from-blue-500 to-blue-600 px-4 py-3 text-white shadow-lg shadow-blue-600/25">
        <span className="text-sm font-medium text-blue-50">{isBuyer ? 'Total revenue' : 'Total cost'}</span>
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