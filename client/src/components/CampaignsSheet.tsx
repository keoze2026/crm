import { useRef, useState } from 'react'
import { api } from '../api/client'
import { money, money2, num } from '../lib/format'
import type { Campaign } from '../types'
import { Input, Select, Spinner, cx } from './ui'

/**
 * Editable "Monthly Sheet" of campaigns (cost side), same format as the buyers
 * sheet / Complete Report cost table: Code · Answered · Missed · Counted · Avg
 * Rate · Total Bill · Status. Answered/Missed/Counted/Total Bill are aggregated
 * from the campaign's records; Avg Rate = cost ÷ counted (the per-source rates are
 * edited via the $ button). Code/Status are edited in place; the bottom row (or +)
 * adds a campaign; the trash button deletes one.
 */
export default function CampaignsSheet({ campaigns, onChanged, onEditRates }: {
  campaigns: Campaign[]; onChanged: () => void; onEditRates: (c: Campaign) => void
}) {
  const [draftKeys, setDraftKeys] = useState<number[]>([0])
  const nextKey = useRef(1)
  const requestNewRow = (key: number) =>
    setDraftKeys((k) => (k[k.length - 1] === key ? [...k, nextKey.current++] : k))
  const addRow = () => setDraftKeys((k) => [...k, nextKey.current++])
  const dropDraft = (key: number) =>
    setDraftKeys((k) => { const r = k.filter((x) => x !== key); return r.length ? r : [nextKey.current++] })

  const totals = campaigns.reduce(
    (a, c) => ({
      answered: a.answered + Number(c.answered),
      missed:   a.missed   + Number(c.missed),
      counted:  a.counted  + Number(c.counted),
      cost:     a.cost     + Number(c.cost),
    }),
    { answered: 0, missed: 0, counted: 0, cost: 0 },
  )
  const headCls = 'px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide bg-[#1a3654] text-white'

  return (
    <div className="overflow-x-auto rounded-t-2xl">
      <table className="w-full border-collapse text-sm [&_td]:border [&_td]:border-white [&_th]:border [&_th]:border-white">
        <thead>
          <tr>
            <th className={headCls}>Code</th>
            <th className={headCls}>Answered</th>
            <th className={headCls}>Missed</th>
            <th className={headCls}>Counted</th>
            <th className={headCls}>Avg Rate</th>
            <th className={headCls}>Total Bill</th>
            <th className={headCls}>Status</th>
            <th className={headCls} />
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => <CampaignRow key={c.id} campaign={c} onChanged={onChanged} onEditRates={onEditRates} />)}
          {draftKeys.map((key) => (
            <DraftCampaignRow key={`d-${key}`} onActivate={() => requestNewRow(key)} onSaved={() => { dropDraft(key); onChanged() }} />
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-[#1a3654] font-bold text-white">
            <td className="px-3 py-2.5 text-center text-xs font-bold uppercase">{num(campaigns.length)}</td>
            <td className="px-3 py-2.5 text-center tabular-nums">{num(totals.answered)}</td>
            <td className="px-3 py-2.5 text-center tabular-nums">{num(totals.missed)}</td>
            <td className="px-3 py-2.5 text-center tabular-nums">{num(totals.counted)}</td>
            <td className="px-3 py-2.5 text-center text-white/70">{money2(totals.counted > 0 ? totals.cost / totals.counted : 0)}</td>
            <td className="px-3 py-2.5 text-center tabular-nums">{money(totals.cost)}</td>
            <td className="px-3 py-2.5" />
            <td className="px-2 py-2.5 text-center">
              <button type="button" onClick={addRow} title="Add campaign" className="rounded p-1 text-white hover:bg-white/20"><PlusIcon /></button>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

const td = 'px-2 py-1'
const roCell = cx(td, 'text-center tabular-nums text-[#0f172a]')
const PlusIcon  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
const CheckIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
const TrashIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
const RatesIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>

function StatusSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const active = value === 'active'
  return (
    <div className={cx('rounded-xl', active ? 'bg-emerald-200/80' : 'bg-red-200/80')}>
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx('border-transparent! bg-transparent! font-semibold', active ? 'text-emerald-800' : 'text-red-700')}
      >
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </Select>
    </div>
  )
}

// ── Existing campaign row ───────────────────────────────────────────────────────
function CampaignRow({ campaign, onChanged, onEditRates }: {
  campaign: Campaign; onChanged: () => void; onEditRates: (c: Campaign) => void
}) {
  const [code,   setCode]   = useState(campaign.code)
  const [status, setStatus] = useState(campaign.status)
  const [busy,   setBusy]   = useState(false)
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)

  const avgRate = campaign.counted > 0 ? campaign.cost / campaign.counted : 0
  const dirty = code.trim() !== campaign.code || status !== campaign.status

  const save = async () => {
    if (saving.current || !dirty || code.trim() === '') return
    saving.current = true; setBusy(true)
    try {
      await api.updateCampaign(campaign.id, { code: code.trim(), name: campaign.name, status })
      onChanged()
    } catch (e) { alert((e as Error).message) } finally { saving.current = false; setBusy(false) }
  }
  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)
  const del = async () => {
    if (!confirm(`Delete campaign ${campaign.code}? This also deletes its ${num(campaign.records)} call records.`)) return
    await api.deleteCampaign(campaign.id); onChanged()
  }

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className="bg-[#d4e9f2] text-[#0f172a]">
      <td className={td}><Input value={code} onChange={(e) => setCode(e.target.value)} /></td>
      <td className={roCell}>{num(campaign.answered)}</td>
      <td className={roCell}>{num(campaign.missed)}</td>
      <td className={roCell}>{num(campaign.counted)}</td>
      <td className={roCell}>{money2(avgRate)}</td>
      <td className={cx(roCell, 'font-bold')}>{money(campaign.cost)}</td>
      <td className={td}><StatusSelect value={status} onChange={setStatus} /></td>
      <td className={cx(td, 'text-center')}>
        <div className="flex items-center justify-center gap-1">
          <button type="button" onClick={() => onEditRates(campaign)} title="Edit source rates" className="rounded p-1 text-amber-600 hover:bg-amber-100"><RatesIcon /></button>
          {busy ? <Spinner className="h-4 w-4" /> : dirty
            ? <button type="button" onClick={save} title="Save changes" className="rounded p-1 text-green-600 hover:bg-green-100"><CheckIcon /></button>
            : <button type="button" onClick={del} title="Delete campaign" className="rounded p-1 text-slate-500 hover:bg-red-100 hover:text-red-600"><TrashIcon /></button>}
        </div>
      </td>
    </tr>
  )
}

// ── New (draft) campaign row ────────────────────────────────────────────────────
function DraftCampaignRow({ onActivate, onSaved }: { onActivate: () => void; onSaved: () => void }) {
  const [code,   setCode]   = useState('')
  const [status, setStatus] = useState('active')
  const [busy,   setBusy]   = useState(false)
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)

  const complete = code.trim() !== ''
  const onCode = (v: string) => { setCode(v); if (v.trim()) onActivate() }

  const save = async () => {
    if (saving.current || !complete) return
    saving.current = true; setBusy(true)
    try {
      await api.createCampaign({ code: code.trim(), status })
      onSaved()
    } catch (e) { alert((e as Error).message); saving.current = false; setBusy(false) }
  }
  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className="bg-amber-50/50 text-[#0f172a]">
      <td className={td}><Input value={code} onChange={(e) => onCode(e.target.value)} placeholder="New code" /></td>
      <td className={cx(td, 'text-center text-slate-300')}>—</td>
      <td className={cx(td, 'text-center text-slate-300')}>—</td>
      <td className={cx(td, 'text-center text-slate-300')}>—</td>
      <td className={cx(td, 'text-center text-slate-300')}>—</td>
      <td className={cx(td, 'text-center text-slate-300')}>—</td>
      <td className={td}><StatusSelect value={status} onChange={setStatus} /></td>
      <td className={cx(td, 'text-center')}>
        {busy ? <Spinner className="h-4 w-4" /> : (
          <button type="button" onClick={save} disabled={!complete} title="Add campaign"
            className={cx('rounded p-1', complete ? 'text-green-600 hover:bg-green-100' : 'cursor-not-allowed text-slate-300')}>
            <CheckIcon />
          </button>
        )}
      </td>
    </tr>
  )
}
