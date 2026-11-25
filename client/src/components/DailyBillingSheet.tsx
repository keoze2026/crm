import { useRef, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { autoReplacement, replacementIsManual, standardizeCampaignCode } from '../lib/bundle'
import { saveBuyer } from '../lib/buyers'
import {
  clientCountFollowsFormula, clientFinalCount, sameLine, totalBill, trafficFinalCount,
  type BillingRow, type BillingTotals, type CarriedRow, type LineIdentity,
} from '../lib/dailyBilling'
import { money2, num } from '../lib/format'
import { useServerDraft } from '../lib/useServerDraft'
import type { CallRecord, Campaign, Destination } from '../types'
import { CampaignRatesPopover } from './CampaignRatesPopover'
import { addRowCls, bandCls, cellCls, fieldCls, headCls, isEnterSubmit, rowCls, tableCls, theadCls } from './sheet'
import { Spinner, cx } from './ui'

/**
 * The two tables of the AHT Daily Billing sheet — Client Billing (buyers, revenue) and
 * Traffic Source Cost (campaigns, cost) — in the printed sheet's column order:
 *
 *   Destination · Rate · Answered · Missed · Replaced · Final Count · Total Bill
 *   Camp · Source · Rate · Answered · Missed · Replaced · Final Count · Total Bill · Status
 *
 * On a single day every row is edited in place (auto-saved when focus leaves it) and a
 * trailing empty row takes a new record, as the Daily Sheet and Campaigns sheet did. A day
 * also opens with the last day's clients and sources carried forward at their rates with
 * blank counts (lib/dailyBilling carryForward): each saves once its count is typed, and
 * one left blank is simply not recorded. A carried line clears by itself the moment the
 * same destination is typed on another row, and it can be dismissed for the day with its
 * ×. Over a date range the tables show the roll-up read-only.
 */

export type Side = 'client' | 'traffic'

interface Entity { id: number; code: string; rate: number }

export interface SheetProps {
  side: Side
  /** The day being edited (YYYY-MM-DD); only meaningful while `editable`. */
  date: string
  editable: boolean
  /** The raw records of the day (editable mode) — each becomes one row. */
  records: CallRecord[]
  /** The lines to print (read-only mode), already rolled up and sorted. */
  rows: BillingRow[]
  totals: BillingTotals
  /** Last day's clients / camp + source lines not yet recorded today (editable mode). */
  carried: CarriedRow[]
  entities: Entity[]
  destinations: Destination[]
  campaigns: Campaign[]
  onChanged: () => void
}

const numCell = cx(cellCls, 'text-center tabular-nums')
const numField = cx(fieldCls, 'text-right')
const readOnlyField = cx(numField, 'cursor-not-allowed bg-white/[0.04] text-slate-400')

export default function DailyBillingSheet(p: SheetProps) {
  const client = p.side === 'client'
  const [draftKeys, setDraftKeys] = useState<number[]>([0])
  const nextKey = useRef(1)
  const requestNewRow = (key: number) =>
    setDraftKeys((k) => (k[k.length - 1] === key ? [...k, nextKey.current++] : k))
  const addRow = () => setDraftKeys((k) => [...k, nextKey.current++])
  const dropDraft = (key: number) =>
    setDraftKeys((k) => { const r = k.filter((x) => x !== key); return r.length ? r : [nextKey.current++] })

  // What each unsaved row currently names, so a carried line clears as soon as the same
  // destination is typed elsewhere — and the lines dismissed with their × for this day.
  const [typed, setTyped] = useState<Record<string, LineIdentity>>({})
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const onTyped = (id: string, identity: LineIdentity) => setTyped((t) => ({ ...t, [id]: identity }))
  const forgetTyped = (id: string) => setTyped((t) => { const rest = { ...t }; delete rest[id]; return rest })
  const dismiss = (key: string) => setDismissed((d) => new Set(d).add(key))
  const carried = p.carried.filter((c) =>
    !dismissed.has(c.key)
    && !Object.entries(typed).some(([id, t]) => id !== `carried-${c.key}` && sameLine(p.side, t, c)))

  const sorted = [...p.records].sort((a, b) => b.rate - a.rate || b.total_bill - a.total_bill)
  const columns = client ? 8 : 10

  return (
    <div className="overflow-x-auto">
      <table className={cx(tableCls, client ? 'min-w-[760px]' : 'min-w-[980px]')}>
        <colgroup>
          {client ? (
            <>
              <col className="w-[18%]" />{/* Destination */}
              <col className="w-[11%]" />{/* Rate */}
              <col className="w-[11%]" />{/* Answered */}
              <col className="w-[10%]" />{/* Missed */}
              <col className="w-[10%]" />{/* Replaced */}
              <col className="w-[11%]" />{/* Final Count */}
              <col className="w-[18%]" />{/* Total Bill */}
              <col className="w-[11%]" />{/* actions */}
            </>
          ) : (
            <>
              <col className="w-[11%]" />{/* Camp */}
              <col className="w-[13%]" />{/* Source */}
              <col className="w-[9%]" />{/* Rate */}
              <col className="w-[9%]" />{/* Answered */}
              <col className="w-[8%]" />{/* Missed */}
              <col className="w-[8%]" />{/* Replaced */}
              <col className="w-[9%]" />{/* Final Count */}
              <col className="w-[12%]" />{/* Total Bill */}
              <col className="w-[11%]" />{/* Status */}
              <col className="w-[10%]" />{/* actions */}
            </>
          )}
        </colgroup>
        <thead>
          <tr className={theadCls}>
            <th className={headCls}>{client ? 'Destination' : 'Camp'}</th>
            {!client && <th className={headCls}>Source</th>}
            <th className={headCls}>Rate</th>
            <th className={headCls}>Answered</th>
            <th className={headCls}>Missed</th>
            <th className={headCls}>Replaced</th>
            <th className={headCls}>Final Count</th>
            <th className={headCls}>Total Bill</th>
            {!client && <th className={headCls}>Status</th>}
            <th className={headCls} />
          </tr>
        </thead>
        <tbody>
          {p.editable
            ? sorted.map((r) => (
              <ExistingRow
                key={r.id}
                side={p.side}
                record={r}
                campaign={client ? undefined : (p.campaigns.find((c) => c.id === r.campaign_id) ?? fallbackCampaign(r))}
                onChanged={p.onChanged}
              />
            ))
            : p.rows.map((r) => <PrintedRow key={r.key} side={p.side} row={r} />)}
          {p.editable && carried.map((c) => (
            <DraftRow
              key={`carried-${c.key}`}
              side={p.side}
              date={p.date}
              entities={p.entities}
              destinations={p.destinations}
              initial={c}
              onActivate={() => {}}
              onTyped={(identity) => onTyped(`carried-${c.key}`, identity)}
              onDismiss={() => { dismiss(c.key); forgetTyped(`carried-${c.key}`) }}
              onSaved={() => { forgetTyped(`carried-${c.key}`); p.onChanged() }}
            />
          ))}
          {p.editable && draftKeys.map((key) => (
            <DraftRow
              key={`draft-${key}`}
              side={p.side}
              date={p.date}
              entities={p.entities}
              destinations={p.destinations}
              onActivate={() => requestNewRow(key)}
              onTyped={(identity) => onTyped(`draft-${key}`, identity)}
              onSaved={() => { forgetTyped(`draft-${key}`); dropDraft(key); p.onChanged() }}
            />
          ))}
          {!p.editable && p.rows.length === 0 && (
            <tr className={rowCls}>
              <td colSpan={columns} className="px-3 py-6 text-center text-sm text-slate-400">
                {client ? 'No client billing in this date range.' : 'No traffic source cost in this date range.'}
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className={cx(bandCls, 'font-bold')}>
            <td className={cx(cellCls, 'py-1.5 text-xs uppercase tracking-wide')}>Total</td>
            {!client && (
              <td className={cx(numCell, 'py-1.5')}>{num(p.rows.length)} {p.rows.length === 1 ? 'line' : 'lines'}</td>
            )}
            <td className={cx(numCell, 'py-1.5 text-white/90')} title="Average rate = Total Bill ÷ Final Count">{money2(p.totals.avgRate)}</td>
            <td className={cx(numCell, 'py-1.5')}>{num(p.totals.answered)}</td>
            <td className={cx(numCell, 'py-1.5')}>{num(p.totals.missed)}</td>
            <td className={cx(numCell, 'py-1.5')}>{num(p.totals.replaced)}</td>
            <td className={cx(numCell, 'py-1.5')}>{num(p.totals.finalCount)}</td>
            <td className={cx(numCell, 'py-1.5')}>{money2(p.totals.totalBill)}</td>
            {!client && <td className={cellCls} />}
            <td className={cx(cellCls, 'text-center')}>
              {p.editable && (
                <button type="button" onClick={addRow} title="Add row" className="rounded p-1 text-white hover:bg-white/20">
                  <PlusIcon />
                </button>
              )}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const PlusIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
const TrashIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
const CheckIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
const CrossIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>

// A campaign record always has a campaign_id, so its Status and rates controls show the
// moment the row exists, even before the campaigns list has (re)loaded. Edits send only
// the changed field, so this stub never writes the campaign's stored totals.
function fallbackCampaign(r: CallRecord): Campaign | undefined {
  if (r.campaign_id == null) return undefined
  return {
    id: r.campaign_id, code: r.campaign_code ?? '', name: null, status: 'active',
    notes: null, created_at: '', cost: 0, counted: 0, answered: 0, missed: 0,
    records: 0, sources: 0, last_activity: null,
  }
}

function StatusSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const active = value === 'active'
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cx(fieldCls, 'font-semibold', active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300')}
    >
      <option value="active">Active</option>
      <option value="inactive">Inactive</option>
    </select>
  )
}

function Field({ value, onChange, placeholder, right, type = 'text', step, onBlur }: {
  value: string; onChange: (v: string) => void; placeholder?: string; right?: boolean
  type?: 'text' | 'number'; step?: string; onBlur?: () => void
}) {
  return (
    <input
      type={type}
      min={type === 'number' ? '0' : undefined}
      step={step}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className={right ? numField : fieldCls}
    />
  )
}

// ── Printed (read-only) row — a date range's roll-up ─────────────────────────

function PrintedRow({ side, row }: { side: Side; row: BillingRow }) {
  return (
    <tr className={rowCls}>
      <td className={cx(cellCls, 'py-1 font-semibold')}>{row.code}</td>
      {side === 'traffic' && <td className={cx(cellCls, 'py-1 text-slate-300')}>{row.source}</td>}
      <td className={cx(numCell, 'py-1 text-slate-300')}>{money2(row.rate)}</td>
      <td className={cx(numCell, 'py-1')}>{num(row.answered)}</td>
      <td className={cx(numCell, 'py-1 text-slate-300')}>{num(row.missed)}</td>
      <td className={cx(numCell, 'py-1 text-slate-300')}>{num(row.replaced)}</td>
      <td className={cx(numCell, 'py-1 font-semibold')}>{num(row.finalCount)}</td>
      <td className={cx(numCell, 'py-1 font-semibold')}>{money2(row.totalBill)}</td>
      {side === 'traffic' && <td className={cellCls} />}
      <td className={cx(cellCls, 'text-center text-[11px] text-slate-400')}>
        {row.records > 1 && <span title={`${row.records} records rolled into this line`}>{row.records}×</span>}
      </td>
    </tr>
  )
}

// ── Existing record row (edited in place) ────────────────────────────────────

function ExistingRow({ side, record, campaign, onChanged }: {
  side: Side; record: CallRecord; campaign?: Campaign; onChanged: () => void
}) {
  const client = side === 'client'
  const [answered, setAnswered] = useServerDraft(String(record.answered))
  const [missed, setMissed] = useServerDraft(String(record.missed))
  const [replacement, setReplacement] = useServerDraft(String(record.replacement))
  const [counted, setCounted] = useServerDraft(String(record.counted))
  const [rate, setRate] = useServerDraft(String(record.rate))
  const [source, setSource] = useServerDraft(record.source ?? '')
  const [code, setCode] = useServerDraft(campaign?.code ?? record.campaign_code ?? '')
  const [buyerCode, setBuyerCode] = useServerDraft(record.buyer_code ?? '')
  const [busy, setBusy] = useState(false)
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)
  // Once Final Count is typed into, it is this person's number for the rest of the session.
  const [countedTouched, setCountedTouched] = useState(false)

  // Client: Final Count follows Answered + Missed − Replaced while the stored count was
  // never typed over; a client whose missed calls aren't billed keeps its typed count.
  // Traffic: Final Count is keyed in and Replaced derives from it (Answered − Final
  // Count), except for the excluded sources (PDSO), where Replaced is typed too.
  const manualRep = client || replacementIsManual(source)
  const manualCounted = !client || countedTouched || !clientCountFollowsFormula(record)
  const effRep = manualRep ? (Number(replacement) || 0) : autoReplacement(answered, counted)
  const effCounted = manualCounted ? (Number(counted) || 0) : clientFinalCount(answered, missed, replacement)
  const total = totalBill(effCounted, rate)

  const dirty =
    Number(answered) !== record.answered ||
    Number(missed) !== record.missed ||
    (manualRep && (Number(replacement) || 0) !== record.replacement) ||
    effCounted !== record.counted ||
    (Number(rate) || 0) !== record.rate ||
    (!client && (source ?? '') !== (record.source ?? ''))

  const save = async () => {
    if (saving.current || !dirty) return
    saving.current = true; setBusy(true)
    try {
      const payload: Record<string, unknown> = {
        answered: Number(answered) || 0, missed: Number(missed) || 0,
        replacement: effRep, counted: effCounted, rate: Number(rate) || 0,
      }
      if (!client) payload.source = source
      await api.updateRecord(record.id, payload)
      onChanged()
    } finally { saving.current = false; setBusy(false) }
  }

  // The Destination is the buyer itself, so editing it renames the buyer and every record
  // of that buyer, on every date, follows. Name doubles as the code, as on the Buyers
  // page. A rename onto a code another buyer holds offers to merge them (lib/buyers);
  // declining puts the old code back.
  const saveBuyerCode = async () => {
    if (record.buyer_id == null) return
    const stored = record.buyer_code ?? ''
    const raw = buyerCode.trim()
    if (raw === stored) return
    if (raw === '') { setBuyerCode(stored); return }
    try {
      if (await saveBuyer(record.buyer_id, stored, { code: raw, name: raw })) onChanged()
      else setBuyerCode(stored)
    } catch (e) { alert((e as Error).message) }
  }

  // Camp code edits the campaign itself (a rename), standardized to the "C-03" house
  // format; a cosmetic reformat of the same code just snaps the field back.
  const saveCampaignCode = async () => {
    if (!campaign) return
    const raw = code.trim()
    if (raw === '' || raw === campaign.code) return
    const standardized = standardizeCampaignCode(raw)
    if (standardized === campaign.code) { setCode(campaign.code); return }
    try {
      await api.updateCampaign(campaign.id, { code: standardized, name: campaign.name, notes: campaign.notes })
      onChanged()
    } catch (e) { alert((e as Error).message) }
  }

  const changeStatus = async (status: string) => {
    if (!campaign || status === campaign.status) return
    try {
      await api.updateCampaign(campaign.id, { status, name: campaign.name, notes: campaign.notes })
      onChanged()
    } catch (e) { alert((e as Error).message) }
  }

  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) {
      save()
      if (client) saveBuyerCode(); else saveCampaignCode()
    }
  }, 0)

  const del = async () => {
    if (!confirm('Delete this record?')) return
    await api.deleteRecord(record.id); onChanged()
  }

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className={rowCls}>
      {client ? (
        <td className={cellCls}>
          {record.buyer_id != null
            ? <Field value={buyerCode} onChange={setBuyerCode} />
            : <span className="font-semibold">{record.buyer_code ?? '—'}</span>}
        </td>
      ) : (
        <>
          <td className={cellCls}>
            {campaign
              ? <Field value={code} onChange={setCode} />
              : <span className="font-semibold">{record.campaign_code ?? '—'}</span>}
          </td>
          <td className={cellCls}><Field value={source} onChange={setSource} placeholder="Source" /></td>
        </>
      )}
      <td className={cellCls}><Field type="number" step="0.01" right value={rate} onChange={setRate} /></td>
      <td className={cellCls}><Field type="number" right value={answered} onChange={setAnswered} /></td>
      <td className={cellCls}><Field type="number" right value={missed} onChange={setMissed} /></td>
      <td className={cellCls}>
        {manualRep
          ? <Field type="number" right value={replacement} onChange={setReplacement} />
          : <input type="number" value={effRep} readOnly tabIndex={-1} title="Auto-filled: Answered − Final Count" className={readOnlyField} />}
      </td>
      <td className={cellCls}>
        <input
          type="number" min="0"
          value={manualCounted ? counted : String(effCounted)}
          onChange={(e) => { setCountedTouched(true); setCounted(e.target.value) }}
          title={client ? 'Answered + Missed − Replaced — type over it for a client whose missed calls are not billed' : 'Answered − Replaced'}
          className={cx(numField, 'font-semibold', !manualCounted && 'text-blue-200')}
        />
      </td>
      <td className={cx(numCell, 'font-semibold')}>{money2(total)}</td>
      {!client && (
        <td className={cellCls}>
          {campaign ? <StatusSelect value={campaign.status} onChange={changeStatus} /> : <span className="text-slate-400">—</span>}
        </td>
      )}
      <td className={cx(cellCls, 'text-center')}>
        <div className="flex items-center justify-center gap-1">
          {!client && campaign && <CampaignRatesPopover campaign={campaign} onSaved={onChanged} />}
          {busy ? <Spinner className="h-4 w-4" /> : dirty
            ? <button type="button" onClick={save} title="Save changes" className="rounded p-1 text-green-400 hover:bg-green-500/15"><CheckIcon /></button>
            : <button type="button" onClick={del} title="Delete" className="rounded p-1 text-slate-400 hover:bg-red-500/15 hover:text-red-400"><TrashIcon /></button>}
        </div>
      </td>
    </tr>
  )
}

// ── New (draft) row ───────────────────────────────────────────────────────────

function DraftRow({ side, date, entities, destinations, initial, onActivate, onTyped, onDismiss, onSaved }: {
  side: Side; date: string; entities: Entity[]; destinations: Destination[]
  /** A line carried from the last day: code, source and rate come filled, the counts blank. */
  initial?: CarriedRow
  onActivate: () => void
  /** Called with what the row names whenever its code or source changes. */
  onTyped: (identity: LineIdentity) => void
  /** Carried lines only: hide this line for the day without recording anything. */
  onDismiss?: () => void
  onSaved: () => void
}) {
  const client = side === 'client'
  const carried = initial !== undefined
  const [code, setCode] = useState(initial?.code ?? '')          // destination (client) or camp (traffic)
  const [source, setSource] = useState(initial?.source ?? '')    // traffic source
  const [answered, setAnswered] = useState('')
  const [missed, setMissed] = useState('')
  const [replacement, setReplacement] = useState('')
  const [counted, setCounted] = useState('')
  const [rate, setRate] = useState(initial ? String(initial.rate) : '')
  const [busy, setBusy] = useState(false)
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)
  // Final Count and Rate auto-fill until typed into; after that the typed value stands.
  const [countedTouched, setCountedTouched] = useState(false)
  // A carried rate stands until typed over — it is not re-looked-up when the code is edited.
  const rateTouched = useRef(carried)

  const typedCode = code.trim()
  const manualRep = client || replacementIsManual(source)
  const formulaCounted = client
    ? clientFinalCount(answered, missed, replacement)
    : trafficFinalCount(answered, manualRep ? replacement : 0)
  const effCounted = countedTouched ? (Number(counted) || 0) : formulaCounted
  const effRep = manualRep ? (Number(replacement) || 0) : autoReplacement(answered, effCounted)
  const total = totalBill(effCounted, rate)

  const onCodeType = (v: string) => {
    setCode(v)
    onTyped({ code: v, source })
    if (v.trim()) onActivate()
    if (client && !rateTouched.current) {
      const match = entities.find((e) => e.code.toLowerCase() === v.trim().toLowerCase())
      setRate(match ? String(match.rate) : '')
    }
  }
  const onSourceType = (v: string) => {
    setSource(v)
    onTyped({ code, source: v })
    if (v.trim()) onActivate()
    if (!rateTouched.current) {
      const match = destinations.find((d) => d.name.toLowerCase() === v.trim().toLowerCase())
      setRate(match ? String(match.rate) : '')
    }
  }

  // A client needs a volume to bill; a camp only needs its code — typing a new one
  // registers the campaign, and the source, count and rate can follow on the row. A
  // carried line is already known, so it only saves once a count is typed — one left
  // blank is not a record.
  const complete = typedCode !== '' && (client || carried ? effCounted > 0 : true)

  const save = async () => {
    if (saving.current || !complete) return
    saving.current = true; setBusy(true)
    try {
      const payload: Record<string, unknown> = {
        record_type: client ? 'buyer' : 'campaign',
        record_date: date,
        answered: Number(answered) || 0, missed: Number(missed) || 0,
        replacement: effRep, counted: effCounted, rate: Number(rate) || 0,
      }
      payload[client ? 'buyer_code' : 'campaign_code'] = client ? typedCode : standardizeCampaignCode(typedCode)
      if (!client && source.trim()) payload.source = source.trim()
      await api.createRecord(payload)
      onSaved()
    } catch (e) { alert((e as Error).message) } finally { saving.current = false; setBusy(false) }
  }
  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)

  return (
    <tr ref={rowRef} onBlur={onRowBlur} onKeyDown={(e) => { if (isEnterSubmit(e)) save() }} className={addRowCls}
      title={carried ? 'Carried from the last day — type today\'s counts to record it' : undefined}>
      <td className={cellCls}>
        <Field value={code} onChange={onCodeType} placeholder={client ? 'Destination' : 'Camp'}
          onBlur={() => { if (!client && code.trim()) setCode(standardizeCampaignCode(code)) }} />
      </td>
      {!client && <td className={cellCls}><Field value={source} onChange={onSourceType} placeholder="Source" /></td>}
      <td className={cellCls}><Field type="number" step="0.01" right value={rate} onChange={(v) => { rateTouched.current = true; setRate(v) }} /></td>
      <td className={cellCls}><Field type="number" right value={answered} onChange={setAnswered} /></td>
      <td className={cellCls}><Field type="number" right value={missed} onChange={setMissed} /></td>
      <td className={cellCls}>
        {manualRep
          ? <Field type="number" right value={replacement} onChange={setReplacement} />
          : <input type="number" value={effRep} readOnly tabIndex={-1} title="Auto-filled: Answered − Final Count" className={readOnlyField} />}
      </td>
      <td className={cellCls}>
        <input
          type="number" min="0"
          value={countedTouched ? counted : (answered === '' && missed === '' ? '' : String(effCounted))}
          placeholder="auto"
          onChange={(e) => { setCountedTouched(true); setCounted(e.target.value) }}
          className={cx(numField, 'font-semibold', !countedTouched && 'text-blue-200')}
        />
      </td>
      <td className={cx(numCell, 'font-semibold')}>{money2(total)}</td>
      {!client && <td className={cellCls} />}
      <td className={cx(cellCls, 'text-center')}>
        {busy ? <Spinner className="h-4 w-4" /> : carried && !complete && onDismiss ? (
          <button type="button" onClick={onDismiss} title="Not today — hide this carried line"
            className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white">
            <CrossIcon />
          </button>
        ) : (
          <button type="button" onClick={save} disabled={!complete} title="Save row"
            className={cx('rounded p-1', complete ? 'text-green-400 hover:bg-green-500/15' : 'cursor-not-allowed text-slate-500')}>
            <CheckIcon />
          </button>
        )}
      </td>
    </tr>
  )
}

/** The heading over each table: its name and the counts the printed sheet carries. */
export function SheetHeading({ title, note, children }: { title: string; note: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
      <h2 className="text-base font-semibold text-slate-50">{title}</h2>
      <div className="flex items-center gap-3 text-xs text-slate-400">{note}{children}</div>
    </div>
  )
}
