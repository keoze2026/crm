import { useRef, useState } from 'react'
import { api } from '../api/client'
import { money2, num } from '../lib/format'
import type { CallRecord, Destination, RecordType } from '../types'
import { Input, Select, Spinner, cx } from './ui'

interface Entity { id: number; code: string; rate: number }

/**
 * Spreadsheet-style editor for a single day's records (revenue or cost).
 * - existing rows are edited in place (auto-save when focus leaves the row);
 * - there is always one empty row at the bottom; filling it saves and a fresh
 *   empty row appears, and the "+" button adds another empty row on demand;
 * - counted, per-row totals, and the column totals all auto-calculate.
 */
export default function RecordsGrid({
  type, date, records, entities, destinations, navy, onChanged,
}: {
  type: RecordType
  date: string
  records: CallRecord[]
  entities: Entity[]
  destinations: Destination[]
  navy: boolean
  onChanged: () => void
}) {
  const isBuyer = type === 'buyer'
  const [draftKeys, setDraftKeys] = useState<number[]>([0])
  const nextKey = useRef(1)

  // Keep a trailing empty row: when the last draft gets activated, append another.
  const requestNewRow = (key: number) =>
    setDraftKeys((k) => (k[k.length - 1] === key ? [...k, nextKey.current++] : k))
  const addRow = () => setDraftKeys((k) => [...k, nextKey.current++])
  const dropDraft = (key: number) =>
    setDraftKeys((k) => { const r = k.filter((x) => x !== key); return r.length ? r : [nextKey.current++] })

  const totals = records.reduce(
    (a, r) => ({
      answered: a.answered + Number(r.answered),
      missed:   a.missed   + Number(r.missed),
      counted:  a.counted  + Number(r.counted),
      total:    a.total    + Number(r.total_bill),
    }),
    { answered: 0, missed: 0, counted: 0, total: 0 },
  )
  const entityCount = isBuyer
    ? new Set(records.map((r) => r.buyer_id)).size
    : new Set(records.map((r) => r.source).filter(Boolean)).size

  const headCls = cx('px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide', navy ? 'bg-[#1a3654] text-white' : 'bg-blue-600 text-blue-50')

  return (
    <div className="overflow-x-auto rounded-t-2xl">
      <table className={cx('w-full text-sm', navy && 'border-collapse [&_td]:border [&_td]:border-white [&_th]:border [&_th]:border-white')}>
        <thead>
          <tr>
            <th className={headCls}>{isBuyer ? 'Destination' : 'Campaign'}</th>
            {!isBuyer && <th className={headCls}>Source</th>}
            <th className={headCls}>Answered</th>
            <th className={headCls}>Missed</th>
            <th className={headCls}>Counted</th>
            <th className={headCls}>Rate</th>
            <th className={headCls}>Total</th>
            <th className={headCls} />
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <ExistingRow key={r.id} record={r} isBuyer={isBuyer} navy={navy} onChanged={onChanged} />
          ))}
          {draftKeys.map((key) => (
            <DraftRow
              key={`draft-${key}`}
              isBuyer={isBuyer}
              date={date}
              entities={entities}
              destinations={destinations}
              navy={navy}
              onActivate={() => requestNewRow(key)}
              onSaved={() => { dropDraft(key); onChanged() }}
            />
          ))}
        </tbody>
        <tfoot>
          <tr className={cx('font-semibold', navy ? 'bg-[#1a3654] font-bold text-white' : 'border-t-2 border-blue-200 bg-blue-50 text-slate-900')}>
            <td className={cx('px-3 py-2.5 text-xs font-bold uppercase', navy ? 'text-white' : 'text-blue-700')} colSpan={isBuyer ? 1 : 2}>
              {num(entityCount)} {isBuyer ? 'dest.' : 'sources'}
            </td>
            <td className="px-3 py-2.5 text-center tabular-nums">{num(totals.answered)}</td>
            <td className="px-3 py-2.5 text-center tabular-nums">{num(totals.missed)}</td>
            <td className="px-3 py-2.5 text-center tabular-nums">{num(totals.counted)}</td>
            <td className={cx('px-3 py-2.5 text-center', navy ? 'text-white/70' : 'text-slate-400')}>—</td>
            <td className={cx('px-3 py-2.5 text-center tabular-nums', navy ? 'text-white' : 'text-blue-700')}>{money2(totals.total)}</td>
            <td className="px-2 py-2.5 text-center">
              <button type="button" onClick={addRow} title="Add row"
                className={cx('rounded p-1', navy ? 'text-white hover:bg-white/20' : 'text-blue-600 hover:bg-blue-100')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              </button>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

const rowCls = (navy: boolean, extra = '') =>
  cx(navy ? 'bg-[#d4e9f2] text-[#0f172a]' : 'border-b border-slate-100/70 hover:bg-blue-50/40', extra)
const cellCls = 'px-2 py-1'
const numInput = 'text-right'

const TrashIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
const CheckIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>

// ── Existing record row (edit in place) ─────────────────────────────────────────
function ExistingRow({ record, isBuyer, navy, onChanged }: {
  record: CallRecord; isBuyer: boolean; navy: boolean; onChanged: () => void
}) {
  const [answered, setAnswered] = useState(String(record.answered))
  const [missed,   setMissed]   = useState(String(record.missed))
  const [source,   setSource]   = useState(record.source ?? '')
  const [rate,     setRate]     = useState(String(record.rate))
  const [busy,     setBusy]     = useState(false)
  const rowRef   = useRef<HTMLTableRowElement>(null)
  const saving   = useRef(false)

  const counted = (Number(answered) || 0) + (Number(missed) || 0)
  const total   = counted * (Number(rate) || 0)
  const dirty =
    Number(answered) !== record.answered ||
    Number(missed)   !== record.missed ||
    (Number(rate) || 0) !== record.rate ||
    (!isBuyer && (source ?? '') !== (record.source ?? ''))

  const save = async () => {
    if (saving.current || !dirty) return
    saving.current = true; setBusy(true)
    try {
      const payload: Record<string, unknown> = {
        answered: Number(answered) || 0, missed: Number(missed) || 0, counted, rate: Number(rate) || 0,
      }
      if (!isBuyer) payload.source = source
      await api.updateRecord(record.id, payload)
      onChanged()
    } finally { saving.current = false; setBusy(false) }
  }
  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)
  const del = async () => {
    if (!confirm('Delete this record?')) return
    await api.deleteRecord(record.id); onChanged()
  }

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className={rowCls(navy)}>
      <td className={cx(cellCls, 'text-center font-medium text-slate-800')}>{(isBuyer ? record.buyer_code : record.campaign_code) ?? '—'}</td>
      {!isBuyer && <td className={cellCls}><Input value={source} onChange={(e) => setSource(e.target.value)} /></td>}
      <td className={cellCls}><Input type="number" min="0" value={answered} onChange={(e) => setAnswered(e.target.value)} className={numInput} /></td>
      <td className={cellCls}><Input type="number" min="0" value={missed} onChange={(e) => setMissed(e.target.value)} className={numInput} /></td>
      <td className={cx(cellCls, 'text-center tabular-nums text-slate-700')}>{num(counted)}</td>
      <td className={cellCls}><Input type="number" min="0" step="0.01" value={rate} disabled={isBuyer} onChange={(e) => setRate(e.target.value)} className={numInput} title={isBuyer ? 'Buyer rate — edit it on the Buyers page' : undefined} /></td>
      <td className={cx(cellCls, 'text-center font-semibold tabular-nums text-slate-900')}>{money2(total)}</td>
      <td className={cx(cellCls, 'text-center')}>
        <div className="flex items-center justify-center gap-1">
          {busy ? <Spinner className="h-4 w-4" /> : dirty
            ? <button type="button" onClick={save} title="Save changes" className="rounded p-1 text-green-600 hover:bg-green-50"><CheckIcon /></button>
            : <button type="button" onClick={del} title="Delete" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><TrashIcon /></button>}
        </div>
      </td>
    </tr>
  )
}

// ── New (draft) row ─────────────────────────────────────────────────────────────
function DraftRow({ isBuyer, date, entities, destinations, navy, onActivate, onSaved }: {
  isBuyer: boolean; date: string; entities: Entity[]; destinations: Destination[]
  navy: boolean; onActivate: () => void; onSaved: () => void
}) {
  const [entityId, setEntityId] = useState('')
  const [source,   setSource]   = useState('')
  const [newSource, setNewSource] = useState('')
  const [answered, setAnswered] = useState('')
  const [missed,   setMissed]   = useState('')
  const [rate,     setRate]     = useState('')
  const [busy,     setBusy]     = useState(false)
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)

  const creatingNewSource = !isBuyer && source === '__new__'
  const counted = (Number(answered) || 0) + (Number(missed) || 0)
  const total   = counted * (Number(rate) || 0)

  const onEntity = (v: string) => {
    setEntityId(v)
    if (isBuyer) setRate(v ? String(entities.find((e) => String(e.id) === v)?.rate ?? '') : '')
    if (v) onActivate()
  }
  const onSourceSel = (v: string) => {
    setSource(v)
    if (v === '__new__') setRate('')
    else setRate(v ? String(destinations.find((d) => d.name === v)?.rate ?? '') : '')
  }

  const destName = creatingNewSource ? newSource.trim() : source
  const complete = !!entityId && counted > 0 && (isBuyer || destName !== '')

  const save = async () => {
    if (saving.current || !complete) return
    saving.current = true; setBusy(true)
    try {
      if (!isBuyer && creatingNewSource && destName) {
        try { await api.createDestination({ name: destName, rate: Number(rate) || 0, campaign_id: Number(entityId) }) } catch { /* exists */ }
      }
      const payload: Record<string, unknown> = {
        record_type: isBuyer ? 'buyer' : 'campaign',
        record_date: date,
        answered: Number(answered) || 0, missed: Number(missed) || 0, counted, rate: Number(rate) || 0,
      }
      payload[isBuyer ? 'buyer_id' : 'campaign_id'] = Number(entityId)
      if (!isBuyer) payload.source = destName
      await api.createRecord(payload)
      onSaved()
    } finally { saving.current = false; setBusy(false) }
  }
  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)

  const destOptions = destinations.filter((d) => !entityId || d.campaign_id == null || String(d.campaign_id) === entityId)

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className={rowCls(navy, navy ? '!bg-white/70' : 'bg-amber-50/30')}>
      <td className={cellCls}>
        <Select value={entityId} onChange={(e) => onEntity(e.target.value)}>
          <option value="">{isBuyer ? 'Destination…' : 'Campaign…'}</option>
          {entities.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
        </Select>
      </td>
      {!isBuyer && (
        <td className={cellCls}>
          {creatingNewSource
            ? <Input placeholder="New source name" value={newSource} onChange={(e) => setNewSource(e.target.value)} />
            : (
              <Select value={source} onChange={(e) => onSourceSel(e.target.value)}>
                <option value="">Source…</option>
                {destOptions.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                <option value="__new__">+ New…</option>
              </Select>
            )}
        </td>
      )}
      <td className={cellCls}><Input type="number" min="0" value={answered} onChange={(e) => setAnswered(e.target.value)} className={numInput} /></td>
      <td className={cellCls}><Input type="number" min="0" value={missed} onChange={(e) => setMissed(e.target.value)} className={numInput} /></td>
      <td className={cx(cellCls, 'text-center tabular-nums text-slate-700')}>{num(counted)}</td>
      <td className={cellCls}><Input type="number" min="0" step="0.01" value={rate} disabled={isBuyer} onChange={(e) => setRate(e.target.value)} className={numInput} /></td>
      <td className={cx(cellCls, 'text-center font-semibold tabular-nums text-slate-900')}>{money2(total)}</td>
      <td className={cx(cellCls, 'text-center')}>
        {busy ? <Spinner className="h-4 w-4" /> : (
          <button type="button" onClick={save} disabled={!complete} title="Save row"
            className={cx('rounded p-1', complete ? 'text-green-600 hover:bg-green-50' : 'cursor-not-allowed text-slate-300')}>
            <CheckIcon />
          </button>
        )}
      </td>
    </tr>
  )
}
