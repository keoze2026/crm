import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { standardizeCampaignCode } from '../lib/bundle'
import { money2, num } from '../lib/format'
import type { CallRecord, Campaign, Destination, RecordType } from '../types'
import { Input, Select, Spinner, cx } from './ui'
import { CampaignRatesPopover } from './CampaignRatesPopover'

interface Entity { id: number; code: string; rate: number }

/**
 * Spreadsheet-style editor for a single day's records (revenue or cost).
 * - existing rows are edited in place (auto-save when focus leaves the row);
 * - there is always one empty row at the bottom; filling it saves and a fresh
 *   empty row appears, and the "+" button adds another empty row on demand;
 * - counted, per-row totals, and the column totals all auto-calculate.
 */
export default function RecordsGrid({
  type, date, records, entities, destinations, campaigns = [], navy, onChanged,
}: {
  type: RecordType
  date: string
  records: CallRecord[]
  entities: Entity[]
  destinations: Destination[]
  /** Full campaign objects (cost side) — powers the Status column & rates popover. */
  campaigns?: Campaign[]
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
      answered:    a.answered    + Number(r.answered),
      missed:      a.missed      + Number(r.missed),
      replacement: a.replacement + Number(r.replacement),
      counted:     a.counted     + Number(r.counted),
      total:       a.total       + Number(r.total_bill),
    }),
    { answered: 0, missed: 0, replacement: 0, counted: 0, total: 0 },
  )
  const entityCount = isBuyer
    ? new Set(records.map((r) => r.buyer_id)).size
    : new Set(records.map((r) => r.source).filter(Boolean)).size
  // Always show existing rows highest-rate first.
  const sortedRecords = [...records].sort((a, b) => b.rate - a.rate)

  const headCls = cx('px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide', navy ? 'bg-[#1a3654] text-white' : 'bg-blue-600 text-blue-50')
  // "REPLACEMENT" is the longest header; in the fixed-width campaign grid it clips
  // against the column edge, so this variant tightens the padding, drops the wide
  // letter-spacing and shrinks the font a notch so the whole word fits.
  const headClsReplacement = cx('px-1 py-2.5 text-center text-[10px] font-semibold uppercase tracking-tight whitespace-nowrap', navy ? 'bg-[#1a3654] text-white' : 'bg-blue-600 text-blue-50')

  return (
    <div className="overflow-x-auto rounded-t-2xl">
      {/* min-w keeps columns from crushing on small screens; the wrapper scrolls
          horizontally instead (matching Users / System Logs). Campaigns carry an
          extra Source column + Status select, so they need a wider floor. */}
      <table className={cx('w-full text-sm', isBuyer ? 'min-w-[760px]' : 'min-w-[1020px] table-fixed', navy && 'border-collapse [&_td]:border [&_td]:border-white [&_th]:border [&_th]:border-white')}>
        <thead>
          <tr>
            <th className={headCls}>{isBuyer ? 'Destination' : 'Camp'}</th>
            {!isBuyer && <th className={headCls}>Traffic Source</th>}
            <th className={headCls}>Answered</th>
            <th className={headCls}>Missed</th>
            <th className={headClsReplacement}>Replacement</th>
            <th className={headCls}>Counted</th>
            <th className={headCls}>Rate</th>
            <th className={headCls}>Total</th>
            {!isBuyer && <th className={headCls}>Status</th>}
            <th className={headCls} />
          </tr>
        </thead>
        <tbody>
          {sortedRecords.map((r) => (
            <ExistingRow
              key={r.id}
              record={r}
              isBuyer={isBuyer}
              navy={navy}
              onChanged={onChanged}
              campaign={isBuyer ? undefined : (campaigns.find((c) => c.id === r.campaign_id) ?? fallbackCampaign(r))}
            />
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
            <td className="px-3 py-2.5 text-center tabular-nums">{num(totals.replacement)}</td>
            <td className="px-3 py-2.5 text-center tabular-nums">{num(totals.counted)}</td>
            <td className={cx('px-3 py-2.5 text-center tabular-nums', navy ? 'text-white/90' : 'text-blue-700')} title="Average rate = Total ÷ Counted">{totals.counted > 0 ? money2(totals.total / totals.counted) : '—'}</td>
            <td className={cx('px-3 py-2.5 text-center tabular-nums', navy ? 'text-white' : 'text-blue-700')}>{money2(totals.total)}</td>
            {!isBuyer && <td className="px-3 py-2.5" />}
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

// A campaign record always has a campaign_id, so we can show the Status dropdown
// and rates/delete icons the moment a row exists — even before the full campaigns
// list has (re)loaded. Editing sends only the changed field (see changeStatus /
// saveCode), so the campaign's stored totals are never touched by this stub.
function fallbackCampaign(r: CallRecord): Campaign | undefined {
  if (r.campaign_id == null) return undefined
  return {
    id: r.campaign_id, code: r.campaign_code ?? '', name: null, status: 'active',
    notes: null, created_at: '', cost: 0, counted: 0, answered: 0, missed: 0,
    records: 0, sources: 0, last_activity: null,
  }
}

const rowCls = (navy: boolean, extra = '') =>
  cx(navy ? 'bg-[#d4e9f2] text-[#0f172a]' : 'border-b border-slate-100/70 hover:bg-blue-50/40', extra)
const cellCls = 'px-2 py-1'
const numInput = 'text-right'

const TrashIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
const CheckIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>

// Coloured Active/Inactive dropdown — matches the Monthly Sheet's Status cell.
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

// ── Existing record row (edit in place) ─────────────────────────────────────────
function ExistingRow({ record, isBuyer, navy, onChanged, campaign }: {
  record: CallRecord; isBuyer: boolean; navy: boolean; onChanged: () => void
  campaign?: Campaign
}) {
  const [answered, setAnswered] = useState(String(record.answered))
  const [missed,   setMissed]   = useState(String(record.missed))
  // Replacement is keyed in like Counted (manual entry) on both the buyer and the
  // campaign sheet. It never feeds the per-row Total (counted × rate), but it IS
  // summed into the Replacement column total in the footer.
  const [replacement, setReplacement] = useState(String(record.replacement))
  // Counted is keyed in manually so both buyer categories work: "Yes" adds missed
  // to answered, "No / Non-Missed" excludes them. It no longer auto-derives here.
  const [counted,  setCounted]  = useState(String(record.counted))
  const [source,   setSource]   = useState(record.source ?? '')
  const [rate,     setRate]     = useState(String(record.rate))
  // Camp code is campaign-level (cost side); editing it renames the campaign.
  const [code,     setCode]     = useState(campaign?.code ?? record.campaign_code ?? '')
  const [busy,     setBusy]     = useState(false)
  const rowRef   = useRef<HTMLTableRowElement>(null)
  const saving   = useRef(false)

  // Keep the Camp field in sync when the campaign is renamed elsewhere (another
  // source row for the same campaign, or a reload), so it never reverts a rename.
  useEffect(() => { setCode(campaign?.code ?? record.campaign_code ?? '') }, [campaign?.code, record.campaign_code])

  const countedNum = Number(counted) || 0
  const total   = countedNum * (Number(rate) || 0)
  const dirty =
    Number(answered) !== record.answered ||
    Number(missed)   !== record.missed ||
    (Number(replacement) || 0) !== record.replacement ||
    countedNum       !== record.counted ||
    (Number(rate) || 0) !== record.rate ||
    (!isBuyer && (source ?? '') !== (record.source ?? ''))

  const save = async () => {
    if (saving.current || !dirty) return
    saving.current = true; setBusy(true)
    try {
      const payload: Record<string, unknown> = {
        answered: Number(answered) || 0, missed: Number(missed) || 0,
        replacement: Number(replacement) || 0, counted: countedNum, rate: Number(rate) || 0,
      }
      if (!isBuyer) payload.source = source
      await api.updateRecord(record.id, payload)
      onChanged()
    } finally { saving.current = false; setBusy(false) }
  }
  // Camp code edits the campaign itself (rename), mirroring the Monthly Sheet.
  // Only code + name/notes are sent — the stored totals are COALESCE-preserved
  // server-side, so they're never overwritten from here.
  const saveCode = async () => {
    if (!campaign) return
    const raw = code.trim()
    // Skip when empty or left exactly as stored, so merely focusing a row never
    // renames it — only an actual edit triggers standardization.
    if (raw === '' || raw === campaign.code) return
    const standardized = standardizeCampaignCode(raw)
    // A cosmetic reformat of the same campaign (e.g. "C-3" for "C-03"): snap the
    // field back to canonical without firing a needless rename request.
    if (standardized === campaign.code) { setCode(campaign.code); return }
    try {
      await api.updateCampaign(campaign.id, { code: standardized, name: campaign.name, notes: campaign.notes })
      onChanged()
    } catch (e) { alert((e as Error).message) }
  }
  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) { save(); saveCode() }
  }, 0)
  const del = async () => {
    if (!confirm('Delete this record?')) return
    await api.deleteRecord(record.id); onChanged()
  }
  // Status lives on the campaign (cost side), so flipping it updates the campaign,
  // resending its stored fields unchanged alongside the new status.
  const changeStatus = async (status: string) => {
    if (!campaign || status === campaign.status) return
    try {
      await api.updateCampaign(campaign.id, { status, name: campaign.name, notes: campaign.notes })
      onChanged()
    } catch (e) { alert((e as Error).message) }
  }

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className={rowCls(navy)}>
      {isBuyer ? (
        <td className={cx(cellCls, 'text-center font-medium text-slate-800')}>{record.buyer_code ?? '—'}</td>
      ) : (
        <td className={cellCls}>
          {campaign
            ? <Input value={code} onChange={(e) => setCode(e.target.value)} />
            : <span className="font-medium text-slate-800">{record.campaign_code ?? '—'}</span>}
        </td>
      )}
      {!isBuyer && <td className={cellCls}><Input value={source} onChange={(e) => setSource(e.target.value)} /></td>}
      <td className={cellCls}><Input type="number" min="0" value={answered} onChange={(e) => setAnswered(e.target.value)} className={numInput} /></td>
      <td className={cellCls}><Input type="number" min="0" value={missed} onChange={(e) => setMissed(e.target.value)} className={numInput} /></td>
      <td className={cellCls}><Input type="number" min="0" value={replacement} onChange={(e) => setReplacement(e.target.value)} className={numInput} /></td>
      <td className={cellCls}><Input type="number" min="0" value={counted} onChange={(e) => setCounted(e.target.value)} className={numInput} /></td>
      <td className={cellCls}><Input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className={numInput} /></td>
      <td className={cx(cellCls, 'text-center font-semibold tabular-nums text-slate-900')}>{money2(total)}</td>
      {!isBuyer && (
        <td className={cellCls}>
          {campaign ? <StatusSelect value={campaign.status} onChange={changeStatus} /> : <span className="text-slate-300">—</span>}
        </td>
      )}
      <td className={cx(cellCls, 'text-center')}>
        <div className="flex items-center justify-center gap-1">
          {!isBuyer && campaign && <CampaignRatesPopover campaign={campaign} onSaved={onChanged} />}
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
  const [newCode,  setNewCode]  = useState('')   // entity code, typed directly
  const [source,   setSource]   = useState('')   // source/destination, typed directly (campaigns)
  const [answered, setAnswered] = useState('')
  const [missed,   setMissed]   = useState('')
  const [replacement, setReplacement] = useState('')   // manual entry (buyer + campaign); summed in the footer, not the row total
  const [counted,  setCounted]  = useState('')
  const [rate,     setRate]     = useState('')
  const [busy,     setBusy]     = useState(false)
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)
  // Counted is manual entry. On the buyer sheet it auto-fills to answered + missed
  // as a convenience (until edited); on the campaign (cost) sheet it's fully manual —
  // only the per-row Total (counted × rate) is auto-calculated.
  const countedTouched = useRef(false)
  // Rate auto-fills from the matched destination while untouched; once keyed in
  // manually we stop overriding it.
  const rateTouched = useRef(false)

  const typedCode = newCode.trim()
  const destName  = source.trim()
  const countedNum = Number(counted) || 0
  const total   = countedNum * (Number(rate) || 0)

  const onAnswered = (v: string) => { setAnswered(v); if (isBuyer && !countedTouched.current) setCounted(String((Number(v) || 0) + (Number(missed) || 0))) }
  const onMissed   = (v: string) => { setMissed(v);   if (isBuyer && !countedTouched.current) setCounted(String((Number(answered) || 0) + (Number(v) || 0))) }
  const onCounted  = (v: string) => { countedTouched.current = true; setCounted(v) }
  const onRate     = (v: string) => { rateTouched.current = true; setRate(v) }

  // Entity (buyer destination / campaign) typed directly: activate a trailing row
  // and, for buyers, auto-fill the rate from a matching destination while untouched.
  const onEntityType = (v: string) => {
    setNewCode(v)
    if (v.trim()) onActivate()
    if (isBuyer && !rateTouched.current) {
      const match = entities.find((e) => e.code.toLowerCase() === v.trim().toLowerCase())
      setRate(match ? String(match.rate) : '')
    }
  }
  // Campaign source typed directly: auto-fill the rate from a matching source while untouched.
  const onSourceType = (v: string) => {
    setSource(v)
    if (v.trim()) onActivate()
    if (!rateTouched.current) {
      const match = destinations.find((d) => d.name.toLowerCase() === v.trim().toLowerCase())
      setRate(match ? String(match.rate) : '')
    }
  }

  const entityChosen = typedCode !== ''
  // Buyers still need a volume to log a leads record. Campaigns only need a code —
  // typing a new one registers the campaign (find-or-create) so the Cost Billing
  // sheet fully replaces the Campaigns Monthly Sheet for adding campaigns; the
  // source / counted / rate can be filled in on the row afterwards.
  const complete = isBuyer ? (entityChosen && countedNum > 0) : entityChosen

  const save = async () => {
    if (saving.current || !complete) return
    saving.current = true; setBusy(true)
    try {
      const payload: Record<string, unknown> = {
        record_type: isBuyer ? 'buyer' : 'campaign',
        record_date: date,
        answered: Number(answered) || 0, missed: Number(missed) || 0,
        replacement: Number(replacement) || 0, counted: countedNum, rate: Number(rate) || 0,
      }
      // The typed code find-or-creates the buyer/campaign; a typed source is created
      // and linked (with its rate) on the server when the record is saved. Campaign
      // codes are standardized to the "C-03" house format first.
      payload[isBuyer ? 'buyer_code' : 'campaign_code'] = isBuyer ? typedCode : standardizeCampaignCode(typedCode)
      if (!isBuyer && destName) payload.source = destName
      await api.createRecord(payload)
      onSaved()
    } finally { saving.current = false; setBusy(false) }
  }
  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className={rowCls(navy, navy ? '!bg-white/70' : 'bg-amber-50/30')}>
      <td className={cellCls}>
        {/* Entity is a free typing field (find-or-create by code). Dropdown retired:
              <Select value={entityId} onChange={(e) => onEntity(e.target.value)}>
                <option value="">{isBuyer ? 'Destination…' : 'Campaign…'}</option>
                {entities.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
                <option value="__new__">+ New…</option>
              </Select> */}
        <Input placeholder={isBuyer ? 'Destination' : 'Campaign'} value={newCode}
          onChange={(e) => onEntityType(e.target.value)}
          onBlur={() => { if (!isBuyer && newCode.trim()) setNewCode(standardizeCampaignCode(newCode)) }} />
      </td>
      {!isBuyer && (
        <td className={cellCls}>
          {/* Source is a free typing field (find-or-create by name on save). Dropdown retired:
                <Select value={source} onChange={(e) => onSourceSel(e.target.value)}>
                  <option value="">Source…</option>
                  {destOptions.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                  <option value="__new__">+ New…</option>
                </Select> */}
          <Input placeholder="Source" value={source} onChange={(e) => onSourceType(e.target.value)} />
        </td>
      )}
      <td className={cellCls}><Input type="number" min="0" value={answered} onChange={(e) => onAnswered(e.target.value)} className={numInput} /></td>
      <td className={cellCls}><Input type="number" min="0" value={missed} onChange={(e) => onMissed(e.target.value)} className={numInput} /></td>
      <td className={cellCls}><Input type="number" min="0" value={replacement} onChange={(e) => setReplacement(e.target.value)} className={numInput} /></td>
      <td className={cellCls}><Input type="number" min="0" value={counted} onChange={(e) => onCounted(e.target.value)} className={numInput} /></td>
      <td className={cellCls}><Input type="number" min="0" step="0.01" value={rate} onChange={(e) => onRate(e.target.value)} className={numInput} /></td>
      <td className={cx(cellCls, 'text-center font-semibold tabular-nums text-slate-900')}>{money2(total)}</td>
      {!isBuyer && <td className={cellCls} />}
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
