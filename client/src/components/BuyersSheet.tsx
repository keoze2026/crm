import { useRef, useState } from 'react'
import { api } from '../api/client'
import { money, num } from '../lib/format'
import type { Buyer } from '../types'
import { Input, Select, Spinner, cx } from './ui'

/**
 * Editable "Monthly Sheet" of buyers (revenue side). Rows are edited in place
 * (auto-save when focus leaves the row, or via the green check); there is always
 * an empty row at the bottom for adding a buyer, plus a "+" in the footer; the
 * trash button deletes a buyer (and its records). Totals auto-calculate.
 */
export default function BuyersSheet({ buyers, onChanged }: { buyers: Buyer[]; onChanged: () => void }) {
  const [draftKeys, setDraftKeys] = useState<number[]>([0])
  const nextKey = useRef(1)
  const requestNewRow = (key: number) =>
    setDraftKeys((k) => (k[k.length - 1] === key ? [...k, nextKey.current++] : k))
  const addRow = () => setDraftKeys((k) => [...k, nextKey.current++])
  const dropDraft = (key: number) =>
    setDraftKeys((k) => { const r = k.filter((x) => x !== key); return r.length ? r : [nextKey.current++] })

  const totals = buyers.reduce(
    (a, b) => ({ counted: a.counted + Number(b.counted), revenue: a.revenue + Number(b.revenue) }),
    { counted: 0, revenue: 0 },
  )
  const headCls = 'px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide bg-[#1a3654] text-white'

  return (
    <div className="overflow-x-auto rounded-t-2xl">
      <table className="w-full border-collapse text-sm [&_td]:border [&_td]:border-white [&_th]:border [&_th]:border-white">
        <thead>
          <tr>
            <th className={headCls}>Code</th>
            <th className={headCls}>Name</th>
            <th className={headCls}>Rate</th>
            <th className={headCls}>Status</th>
            <th className={headCls}>Counted</th>
            <th className={headCls}>Revenue</th>
            <th className={headCls} />
          </tr>
        </thead>
        <tbody>
          {buyers.map((b) => <BuyerRow key={b.id} buyer={b} onChanged={onChanged} />)}
          {draftKeys.map((key) => (
            <DraftBuyerRow key={`d-${key}`} onActivate={() => requestNewRow(key)} onSaved={() => { dropDraft(key); onChanged() }} />
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-[#1a3654] font-bold text-white">
            <td className="px-3 py-2.5 text-xs font-bold uppercase" colSpan={4}>{num(buyers.length)} buyers</td>
            <td className="px-3 py-2.5 text-center tabular-nums">{num(totals.counted)}</td>
            <td className="px-3 py-2.5 text-center tabular-nums">{money(totals.revenue)}</td>
            <td className="px-2 py-2.5 text-center">
              <button type="button" onClick={addRow} title="Add buyer" className="rounded p-1 text-white hover:bg-white/20"><PlusIcon /></button>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

const td = 'px-2 py-1'
const PlusIcon  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
const CheckIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
const TrashIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>

function StatusSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="active">Active</option>
      <option value="inactive">Inactive</option>
    </Select>
  )
}

// ── Existing buyer row ──────────────────────────────────────────────────────────
function BuyerRow({ buyer, onChanged }: { buyer: Buyer; onChanged: () => void }) {
  const [code,   setCode]   = useState(buyer.code)
  const [name,   setName]   = useState(buyer.name ?? '')
  const [status, setStatus] = useState(buyer.status)
  const [rate,   setRate]   = useState(String(buyer.rate))
  const [busy,   setBusy]   = useState(false)
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)

  const dirty =
    code.trim() !== buyer.code ||
    name !== (buyer.name ?? '') ||
    status !== buyer.status ||
    (Number(rate) || 0) !== buyer.rate

  const save = async () => {
    if (saving.current || !dirty || code.trim() === '') return
    saving.current = true; setBusy(true)
    try {
      await api.updateBuyer(buyer.id, { code: code.trim(), name: name || null, status, rate: Number(rate) || 0 })
      onChanged()
    } catch (e) { alert((e as Error).message) } finally { saving.current = false; setBusy(false) }
  }
  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)
  const del = async () => {
    if (!confirm(`Delete buyer ${buyer.code}? This also deletes its ${num(buyer.records)} call records.`)) return
    await api.deleteBuyer(buyer.id); onChanged()
  }

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className="bg-[#d4e9f2] text-[#0f172a]">
      <td className={td}><Input value={code} onChange={(e) => setCode(e.target.value)} /></td>
      <td className={td}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="—" /></td>
      <td className={td}><Input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className="text-right" /></td>
      <td className={td}><StatusSelect value={status} onChange={setStatus} /></td>
      <td className={cx(td, 'text-center tabular-nums')}>{num(buyer.counted)}</td>
      <td className={cx(td, 'text-center font-semibold tabular-nums')}>{money(buyer.revenue)}</td>
      <td className={cx(td, 'text-center')}>
        {busy ? <Spinner className="h-4 w-4" /> : dirty
          ? <button type="button" onClick={save} title="Save changes" className="rounded p-1 text-green-600 hover:bg-green-100"><CheckIcon /></button>
          : <button type="button" onClick={del} title="Delete buyer" className="rounded p-1 text-slate-500 hover:bg-red-100 hover:text-red-600"><TrashIcon /></button>}
      </td>
    </tr>
  )
}

// ── New (draft) buyer row ───────────────────────────────────────────────────────
function DraftBuyerRow({ onActivate, onSaved }: { onActivate: () => void; onSaved: () => void }) {
  const [code,   setCode]   = useState('')
  const [name,   setName]   = useState('')
  const [status, setStatus] = useState('active')
  const [rate,   setRate]   = useState('')
  const [busy,   setBusy]   = useState(false)
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)

  const complete = code.trim() !== ''
  const onCode = (v: string) => { setCode(v); if (v.trim()) onActivate() }

  const save = async () => {
    if (saving.current || !complete) return
    saving.current = true; setBusy(true)
    try {
      await api.createBuyer({ code: code.trim(), name: name || null, status, rate: Number(rate) || 0 })
      onSaved()
    } catch (e) { alert((e as Error).message); saving.current = false; setBusy(false) }
  }
  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className="bg-amber-50/50 text-[#0f172a]">
      <td className={td}><Input value={code} onChange={(e) => onCode(e.target.value)} placeholder="New code" /></td>
      <td className={td}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" /></td>
      <td className={td}><Input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.00" className="text-right" /></td>
      <td className={td}><StatusSelect value={status} onChange={setStatus} /></td>
      <td className={cx(td, 'text-center text-slate-300')}>—</td>
      <td className={cx(td, 'text-center text-slate-300')}>—</td>
      <td className={cx(td, 'text-center')}>
        {busy ? <Spinner className="h-4 w-4" /> : (
          <button type="button" onClick={save} disabled={!complete} title="Add buyer"
            className={cx('rounded p-1', complete ? 'text-green-600 hover:bg-green-100' : 'cursor-not-allowed text-slate-300')}>
            <CheckIcon />
          </button>
        )}
      </td>
    </tr>
  )
}
