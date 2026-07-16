import { useRef, useState } from 'react'
import { api } from '../api/client'
import { money, money2, num } from '../lib/format'
import type { Campaign } from '../types'
import { Input, Select, Spinner, cx } from './ui'
import { CampaignRatesPopover } from './CampaignRatesPopover'

/**
 * Editable "Monthly Sheet" of campaigns (cost side): Destination · Answered ·
 * Missed · Counted · Rate · Total Bill · Status. Every column is manual entry
 * except Total Bill, which is auto-calculated as Counted × Rate. The stored cost
 * is that product, so Rate loads back as cost ÷ counted. Destination/Status are
 * edited in place; the bottom row (or +) adds a campaign; the trash deletes one.
 */
export default function CampaignsSheet({ campaigns, onChanged }: {
  campaigns: Campaign[]; onChanged: () => void
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
            <th className={headCls}>Camp</th>
            <th className={headCls}>Answered</th>
            <th className={headCls}>Missed</th>
            <th className={headCls}>Counted</th>
            <th className={headCls}>Rate</th>
            <th className={headCls}>Total Bill</th>
            <th className={headCls}>Status</th>
            <th className={headCls} />
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => <CampaignRow key={c.id} campaign={c} onChanged={onChanged} />)}
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
// Rate loads back from the stored cost: cost ÷ counted, rounded to cents.
const rateFromCost = (cost: number, counted: number) =>
  counted > 0 ? String(Math.round((cost / counted) * 100) / 100) : ''
const PlusIcon  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
const CheckIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
const TrashIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>

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
function CampaignRow({ campaign, onChanged }: {
  campaign: Campaign; onChanged: () => void
}) {
  const [code,     setCode]     = useState(campaign.code)
  const [status,   setStatus]   = useState(campaign.status)
  const [answered, setAnswered] = useState(String(campaign.answered))
  const [missed,   setMissed]   = useState(String(campaign.missed))
  const [counted,  setCounted]  = useState(String(campaign.counted))
  const [rate,     setRate]     = useState(rateFromCost(campaign.cost, campaign.counted))
  const [busy,     setBusy]     = useState(false)
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)

  // Everything is keyed in directly except Total Bill = Counted × Rate (the stored cost).
  const countedNum = Number(counted) || 0
  const rateNum = Number(rate) || 0
  const costNum = Math.round(countedNum * rateNum * 100) / 100
  const dirty =
    code.trim() !== campaign.code || status !== campaign.status ||
    (Number(answered) || 0) !== campaign.answered ||
    (Number(missed) || 0)   !== campaign.missed ||
    countedNum              !== campaign.counted ||
    costNum                 !== campaign.cost

  const save = async () => {
    if (saving.current || !dirty || code.trim() === '') return
    saving.current = true; setBusy(true)
    try {
      await api.updateCampaign(campaign.id, {
        code: code.trim(), name: campaign.name, status,
        answered: Number(answered) || 0, missed: Number(missed) || 0, counted: countedNum, cost: costNum,
      })
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
      <td className={td}><Input type="number" min="0" value={answered} onChange={(e) => setAnswered(e.target.value)} className="text-right" /></td>
      <td className={td}><Input type="number" min="0" value={missed} onChange={(e) => setMissed(e.target.value)} className="text-right" /></td>
      <td className={td}><Input type="number" min="0" value={counted} onChange={(e) => setCounted(e.target.value)} className="text-right" /></td>
      <td className={td}><Input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className="text-right" /></td>
      <td className={roCell}>{money(costNum)}</td>
      <td className={td}><StatusSelect value={status} onChange={setStatus} /></td>
      <td className={cx(td, 'text-center')}>
        <div className="flex items-center justify-center gap-1">
          <CampaignRatesPopover campaign={campaign} onSaved={onChanged} />
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
  const [code,     setCode]     = useState('')
  const [status,   setStatus]   = useState('active')
  const [answered, setAnswered] = useState('')
  const [missed,   setMissed]   = useState('')
  const [counted,  setCounted]  = useState('')
  const [rate,     setRate]     = useState('')
  const [busy,     setBusy]     = useState(false)
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)

  const countedNum = Number(counted) || 0
  const rateNum = Number(rate) || 0
  const costNum = Math.round(countedNum * rateNum * 100) / 100
  const complete = code.trim() !== ''
  const onCode = (v: string) => { setCode(v); if (v.trim()) onActivate() }

  const save = async () => {
    if (saving.current || !complete) return
    saving.current = true; setBusy(true)
    try {
      await api.createCampaign({
        code: code.trim(), status,
        answered: Number(answered) || 0, missed: Number(missed) || 0, counted: countedNum, cost: costNum,
      })
      onSaved()
    } catch (e) { alert((e as Error).message); saving.current = false; setBusy(false) }
  }
  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className="bg-amber-50/50 text-[#0f172a]">
      <td className={td}><Input value={code} onChange={(e) => onCode(e.target.value)} placeholder="New code" /></td>
      <td className={td}><Input type="number" min="0" value={answered} onChange={(e) => setAnswered(e.target.value)} placeholder="0" className="text-right" /></td>
      <td className={td}><Input type="number" min="0" value={missed} onChange={(e) => setMissed(e.target.value)} placeholder="0" className="text-right" /></td>
      <td className={td}><Input type="number" min="0" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="0" className="text-right" /></td>
      <td className={td}><Input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.00" className="text-right" /></td>
      <td className={roCell}>{costNum > 0 ? money(costNum) : <span className="text-slate-300">—</span>}</td>
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
