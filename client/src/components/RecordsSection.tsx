import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../api/client'
import { bundleCampaignRecords, effectiveCampaignReplacement, normalizeCode } from '../lib/bundle'
import { formatDate, money2, num, today } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import type { CallRecord, Campaign, Destination, RecordFilters, RecordType } from '../types'
import { DateRangeFilter } from './DateRange'
import RecordsGrid from './RecordsGrid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface Entity { id: number; code: string; rate: number }

const selectCls =
  'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50'

const EditIcon  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
const TrashIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>

/** Labeled form control wrapper for the record modal. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  )
}

// ─── Section ──────────────────────────────────────────────────────────────────

export default function RecordsSection({
  type, title, subtitle, compact = false, onChange, onTotalsChange, onDateChange,
  from, to, hideDateFilter = false, hideHeader = false, theme = 'blue',
}: {
  type: RecordType; title: string; subtitle: string; compact?: boolean; onChange?: () => void; onTotalsChange?: (total_bill: number | null) => void; onDateChange?: (from: string, to: string) => void; profit?: number | null
  /** When provided, the parent controls the date range (e.g. a single page-level filter). */
  from?: string; to?: string; hideDateFilter?: boolean
  /** Suppress the internal title/subtitle (the page frame supplies it instead). */
  hideHeader?: boolean
  /** 'navy' renders the bordered grid look that matches the Complete Report table. */
  theme?: 'blue' | 'navy'
}) {
  const isBuyer    = type === 'buyer'
  const entityLabel = isBuyer ? 'Destination' : 'Campaign'
  const navy        = theme === 'navy'

  // Default to today (a single day) so the editable grid is visible immediately.
  const [filters, setFilters] = useState<RecordFilters>({
    type, from: today(), to: today(), search: '', buyer_id: '', campaign_id: '',
    sort: 'rate', dir: 'desc', page: 1, per_page: 35,
  })
  const [modalOpen,  setModalOpen]  = useState(false)
  const [editing,    setEditing]    = useState<CallRecord | null>(null)

  const entities = useAsync<Entity[]>(async () => {
    // Buyers carry their own rate (revenue side). Campaigns don't — on the cost side
    // the rate lives on the source/destination, so campaign entities have no rate.
    if (isBuyer) {
      const list = await api.buyers()
      return list.map((x) => ({ id: x.id, code: x.code, rate: x.rate }))
    }
    const list = await api.campaigns()
    return list.map((x) => ({ id: x.id, code: x.code, rate: 0 }))
  }, [type])
  const records = useAsync(() => api.records(filters), [JSON.stringify(filters)])

  // Fetch destinations list for campaign records
  const destinations = useAsync(() => api.destinations(), [])

  // Full campaign objects (status + stored fields) for the cost grid's Status
  // column and per-campaign source-rates button. Buyers don't need this.
  const campaignList = useAsync<Campaign[]>(() => (isBuyer ? Promise.resolve([]) : api.campaigns()), [type])

  // Fetch all records matching the current filters (no pagination) for totals row
  const allRecords = useAsync(
    () => api.records({ ...filters, page: 1, per_page: 9999 }),
    [JSON.stringify(filters)],
  )

  const totals = useMemo(() => {
    const data = allRecords.data?.data ?? []
    if (data.length === 0) return null
    // Campaigns are bundled by normalized code, so the entity count is the number
    // of distinct normalized campaign codes (matching the bundled rows below).
    const uniqueEntities = isBuyer
      ? new Set(data.map((r) => r.buyer_id)).size
      : new Set(data.map((r) => normalizeCode(r.campaign_code))).size
    return {
      answered:    data.reduce((s, r) => s + Number(r.answered),    0),
      missed:      data.reduce((s, r) => s + Number(r.missed),      0),
      // Match the rows: campaign Replacement is the effective (auto-filled) value,
      // buyer Replacement is the stored manual value.
      replacement: data.reduce((s, r) => s + (isBuyer ? Number(r.replacement) : effectiveCampaignReplacement(r)), 0),
      counted:     data.reduce((s, r) => s + Number(r.counted),     0),
      total_bill:  data.reduce((s, r) => s + Number(r.total_bill),  0),
      count:       uniqueEntities,
    }
  }, [allRecords.data, isBuyer])

  // Campaign (cost) records are bundled in the multi-day table view.
  const bundledRows = useMemo(
    () => (isBuyer ? [] : bundleCampaignRecords(allRecords.data?.data ?? [])),
    [isBuyer, allRecords.data],
  )

  // Notify parent whenever totals change (for profit badge)
  useEffect(() => { onTotalsChange?.(totals?.total_bill ?? null) }, [totals])
  useEffect(() => { onDateChange?.(filters.from ?? '', filters.to ?? '') }, [filters.from, filters.to])

  // When the parent controls the date range, mirror it into the filters.
  useEffect(() => {
    if (from === undefined && to === undefined) return
    setFilters((f) =>
      f.from === (from ?? '') && f.to === (to ?? '') ? f : { ...f, from: from ?? '', to: to ?? '', page: 1 },
    )
  }, [from, to])

  const set = (patch: Partial<RecordFilters>) => setFilters((f) => ({ ...f, page: 1, ...patch }))
  const isFiltered = !!(filters.from || filters.to)
  const isSingleDay = !!(filters.from && filters.to && filters.from === filters.to)
  const bundled = !isBuyer
  const showSerial = !isFiltered || isSingleDay
  const showDate   = !isSingleDay

  const openEdit = (r: CallRecord) => { setEditing(r); setModalOpen(true) }

  const onSaved = () => { setModalOpen(false); records.reload(); entities.reload(); onChange?.() }
  // After an inline grid edit/add/delete, refresh everything the grid depends on.
  const gridChanged = () => { records.reload(); allRecords.reload(); entities.reload(); destinations.reload(); campaignList.reload(); onChange?.() }
  const onDelete = async (r: CallRecord) => {
    if (!confirm(`Delete this record from ${formatDate(r.record_date)}?`)) return
    await api.deleteRecord(r.id); records.reload(); onChange?.()
  }

  const meta = records.data?.meta
  const rows = records.data?.data ?? []

  // Date range lives in the page header (top-right), not the filters card.
  const dateControl = !hideDateFilter ? (
    <DateRangeFilter
      from={filters.from ?? ''}
      to={filters.to ?? ''}
      onFromChange={(iso) => set({ from: iso })}
      onToChange={(iso) => set({ to: iso })}
    />
  ) : null

  const tableGrid = navy && 'border-collapse [&_td]:border [&_td]:border-border [&_th]:border [&_th]:border-border'

  return (
    <section>
      {hideHeader ? null : compact ? (
        <div className="mb-4 mt-10 flex flex-col gap-3 border-t border-border pt-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-display tracking-tight text-foreground">{title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
      ) : (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-display tracking-tight text-foreground sm:text-2xl">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="filters mb-3 rounded-lg border border-border bg-card p-2.5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-foreground">Search</span>
            <Input placeholder={`${entityLabel} code…`} value={filters.search} onChange={(e) => set({ search: e.target.value })} />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            {dateControl && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-foreground">Date</span>
                {dateControl}
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-foreground">{entityLabel}</span>
              <select
                className={selectCls}
                value={isBuyer ? filters.buyer_id : filters.campaign_id}
                onChange={(e) =>
                  set(isBuyer
                    ? { buyer_id: e.target.value ? Number(e.target.value) : '' }
                    : { campaign_id: e.target.value ? Number(e.target.value) : '' })
                }
              >
                <option value="">All {isBuyer ? 'destinations' : 'campaigns'}</option>
                {entities.data?.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {!isFiltered ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
              </svg>
            </div>
            <p className="text-base font-semibold text-foreground">Select a date to view records</p>
            <p className="max-w-sm text-sm text-muted-foreground">Pick a day or date range with the <span className="font-medium text-foreground">Date</span> picker above to load call records.</p>
          </div>
        ) : isSingleDay ? (
          allRecords.loading ? (
            <div className="flex justify-center py-16"><Spinner className="size-6" /></div>
          ) : (
            <RecordsGrid
              type={type}
              date={filters.from ?? today()}
              records={allRecords.data?.data ?? []}
              entities={entities.data ?? []}
              destinations={destinations.data ?? []}
              campaigns={campaignList.data ?? []}
              navy={navy}
              onChanged={gridChanged}
            />
          )
        ) : (bundled ? allRecords.loading : records.loading) ? (
          <div className="flex justify-center py-16"><Spinner className="size-6" /></div>
        ) : (bundled ? bundledRows.length === 0 : rows.length === 0) ? (
          <p className="py-16 text-center text-sm text-muted-foreground uppercase">No records match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={cn('w-full min-w-[900px] table-fixed text-sm', tableGrid)}>
              <colgroup>
                {showSerial && <col className="w-[6%]" />}
                {showDate && <col className="w-[11%]" />}
                <col className="w-[14%]" />
                {!isBuyer && <col className="w-[12%]" />}
                <col className="w-[12%]" />
                <col className="w-[10%]" />
                <col className="w-[11%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[15%]" />
                <col className="w-[8%]" />
              </colgroup>
              <thead>
                <tr className="bg-primary text-center text-xs font-semibold uppercase tracking-wide text-primary-foreground">
                  {showSerial && <th className="px-4 py-3 font-medium">#</th>}
                  {showDate && <Th onClick={() => set({ sort: 'record_date', dir: nextDir(filters, 'record_date') })} active={filters.sort === 'record_date'} dir={filters.dir}>Date</Th>}
                  <th className="px-4 py-3 font-medium">{entityLabel}</th>
                  {!isBuyer && <th className="px-4 py-3 font-medium">Destination</th>}
                  <ThNum onClick={() => set({ sort: 'answered',   dir: nextDir(filters, 'answered')   })} active={filters.sort === 'answered'}   dir={filters.dir}>Answered</ThNum>
                  <ThNum onClick={() => set({ sort: 'missed',     dir: nextDir(filters, 'missed')     })} active={filters.sort === 'missed'}     dir={filters.dir}>Missed</ThNum>
                  <th className="px-1 py-3 text-center text-[10px] font-medium tracking-tight whitespace-nowrap">Replacement</th>
                  <ThNum onClick={() => set({ sort: 'counted',    dir: nextDir(filters, 'counted')    })} active={filters.sort === 'counted'}    dir={filters.dir}>Counted</ThNum>
                  <ThNum onClick={() => set({ sort: 'rate',       dir: nextDir(filters, 'rate')       })} active={filters.sort === 'rate'}       dir={filters.dir}>Rate</ThNum>
                  <ThNum onClick={() => set({ sort: 'total_bill', dir: nextDir(filters, 'total_bill') })} active={filters.sort === 'total_bill'} dir={filters.dir}>Total</ThNum>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {bundled
                  ? bundledRows.map((b, i) => (
                    <tr key={b.key} className={cn(navy ? 'bg-card text-foreground' : 'border-b border-border odd:bg-card even:bg-accent hover:bg-accent/70')}>
                      {showDate && (
                        <td className="whitespace-nowrap px-4 py-3 text-center font-medium text-muted-foreground">
                          {i === 0 ? formatDate(filters.from ?? null) : i === bundledRows.length - 1 ? formatDate(filters.to ?? null) : ''}
                        </td>
                      )}
                      <td className="py-3 pl-10 pr-2 text-center font-medium text-foreground"><Box w="w-16" align="left">{b.camp}</Box></td>
                      <td className="py-3 pl-10 pr-2 text-center text-muted-foreground"><Box w="w-20" align="left">{b.source}</Box></td>
                      <td className="py-3 pl-10 pr-2 text-center tabular-nums text-foreground"><Box w="w-12">{num(b.answered)}</Box></td>
                      <td className="py-3 pl-10 pr-2 text-center tabular-nums text-muted-foreground"><Box w="w-10">{num(b.missed)}</Box></td>
                      <td className="py-3 pl-10 pr-2 text-center tabular-nums text-muted-foreground"><Box w="w-12">{num(b.replacement)}</Box></td>
                      <td className="py-3 pl-10 pr-2 text-center tabular-nums text-foreground"><Box w="w-12">{num(b.counted)}</Box></td>
                      <td className="py-3 pl-10 pr-2 text-center tabular-nums text-muted-foreground"><Box w="w-16">{money2(b.rate)}</Box></td>
                      <td className="py-3 pl-10 pr-2 text-center font-semibold tabular-nums text-foreground"><Box w="w-28">{money2(b.total_bill)}</Box></td>
                      <td className="px-4 py-3 text-center">
                        {b.count > 1 && <span className="text-xs tabular-nums text-muted-foreground" title={`${b.count} records merged into this row`}>{b.count}×</span>}
                      </td>
                    </tr>
                  ))
                  : rows.map((r, i) => (
                    <tr key={r.id} className={cn(navy ? 'bg-card text-foreground' : 'border-b border-border odd:bg-card even:bg-accent hover:bg-accent/70')}>
                      {showSerial && <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">{(meta ? (meta.page - 1) * meta.per_page : 0) + i + 1}</td>}
                      {showDate && (isFiltered
                        ? <td className="whitespace-nowrap px-4 py-3 text-center text-muted-foreground font-medium">
                            {i === 0 ? formatDate(r.record_date) : i === rows.length - 1 ? formatDate(r.record_date) : ''}
                          </td>
                        : <td className="whitespace-nowrap px-4 py-3 text-center text-muted-foreground">{formatDate(r.record_date)}</td>
                      )}
                      <td className="py-3 pl-10 pr-2 text-center font-medium text-foreground"><Box w="w-16" align="left">{(isBuyer ? r.buyer_code : r.campaign_code) ?? '—'}</Box></td>
                      {!isBuyer && <td className="py-3 pl-10 pr-2 text-center text-muted-foreground"><Box w="w-20" align="left">{r.source ?? '—'}</Box></td>}
                      <td className="py-3 pl-10 pr-2 text-center tabular-nums text-foreground"><Box w="w-12">{num(r.answered)}</Box></td>
                      <td className="py-3 pl-10 pr-2 text-center tabular-nums text-muted-foreground"><Box w="w-10">{num(r.missed)}</Box></td>
                      <td className="py-3 pl-10 pr-2 text-center tabular-nums text-muted-foreground"><Box w="w-12">{num(r.replacement)}</Box></td>
                      <td className="py-3 pl-10 pr-2 text-center tabular-nums text-foreground"><Box w="w-12">{num(r.counted)}</Box></td>
                      <td className="py-3 pl-10 pr-2 text-center tabular-nums text-muted-foreground"><Box w="w-16">{money2(r.rate)}</Box></td>
                      <td className="py-3 pl-10 pr-2 text-center font-semibold tabular-nums text-foreground"><Box w="w-28">{money2(r.total_bill)}</Box></td>
                      <td className="px-4 py-3">
                        <div className="flex justify-center gap-1">
                          <button onClick={() => openEdit(r)} className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-primary" title="Edit"><EditIcon /></button>
                          <button onClick={() => onDelete(r)} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete"><TrashIcon /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="bg-primary font-bold text-primary-foreground">
                    <td className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide" colSpan={showSerial && showDate ? 2 : 1}>
                      TOTAL
                    </td>
                    <td className="py-3 pl-10 pr-2 text-center tabular-nums"><Box w="w-16" align="left">{num(totals.count)}</Box></td>
                    {!isBuyer && <td className="py-3 pl-10 pr-2 text-center tabular-nums"><Box w="w-20" align="left">{num(new Set((allRecords.data?.data ?? []).map(r => normalizeCode(r.source)).filter(Boolean)).size)}</Box></td>}
                    <td className="py-3 pl-10 pr-2 text-center tabular-nums"><Box w="w-12">{num(totals.answered)}</Box></td>
                    <td className="py-3 pl-10 pr-2 text-center tabular-nums"><Box w="w-10">{num(totals.missed)}</Box></td>
                    <td className="py-3 pl-10 pr-2 text-center tabular-nums"><Box w="w-12">{num(totals.replacement)}</Box></td>
                    <td className="py-3 pl-10 pr-2 text-center tabular-nums"><Box w="w-12">{num(totals.counted)}</Box></td>
                    <td className="py-3 pl-10 pr-2 text-center tabular-nums text-primary-foreground/90" title="Average rate = Total ÷ Counted"><Box w="w-16">{totals.counted > 0 ? money2(totals.total_bill / totals.counted) : '—'}</Box></td>
                    <td className="py-3 pl-10 pr-2 text-center tabular-nums"><Box w="w-28">{money2(totals.total_bill)}</Box></td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {/* Buyer view is server-paginated; bundled campaign view shows a one-line summary. */}
        {!bundled && isFiltered && !isSingleDay && meta && meta.total > 0 && (
          <div className="flex flex-col items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm text-muted-foreground sm:flex-row">
            <span>Showing {(meta.page - 1) * meta.per_page + 1}–{Math.min(meta.page * meta.per_page, meta.total)} of {num(meta.total)}</span>
            <div className="flex items-center gap-1">
              <Button variant="secondary" size="sm" disabled={meta.page <= 1}          onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}>Prev</Button>
              <span className="px-2">Page {meta.page} / {meta.pages}</span>
              <Button variant="secondary" size="sm" disabled={meta.page >= meta.pages} onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}>Next</Button>
            </div>
          </div>
        )}
        {bundled && isFiltered && !isSingleDay && bundledRows.length > 0 && (
          <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
            {num(bundledRows.length)} bundled campaign {bundledRows.length === 1 ? 'row' : 'rows'} from {num(allRecords.data?.data?.length ?? 0)} records
          </div>
        )}
      </div>

      {records.error && <p className="mt-4 text-sm text-destructive">{records.error}</p>}

      <Dialog open={modalOpen} onOpenChange={(o) => { if (!o) setModalOpen(false) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit record' : `Add ${isBuyer ? 'revenue' : 'cost'} record`}</DialogTitle>
          </DialogHeader>
          <RecordForm type={type} editing={editing} entities={entities.data ?? []} destinations={destinations.data ?? []} onSaved={onSaved} onCancel={() => setModalOpen(false)} />
        </DialogContent>
      </Dialog>
    </section>
  )
}

function nextDir(filters: RecordFilters, col: string): 'asc' | 'desc' {
  return filters.sort === col && filters.dir === 'desc' ? 'asc' : 'desc'
}

// Fixed-width, aligned box centered inside the cell so every value in a column
// shares the same edge — one clean vertical line, no drift.
function Box({ children, w, align = 'left' }: { children: ReactNode; w: string; align?: 'left' | 'right' }) {
  return <span className={cn('inline-block tabular-nums', w, align === 'left' ? 'text-left' : 'text-right')}>{children}</span>
}
function Th({ children, onClick, active, dir }: { children: ReactNode; onClick: () => void; active?: boolean; dir?: string }) {
  return (
    <th className="cursor-pointer select-none px-4 py-3 font-medium" onClick={onClick}>
      <span className={cn(active && 'underline underline-offset-4')}>{children}{active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
    </th>
  )
}
function ThNum({ children, onClick, active, dir }: { children: ReactNode; onClick: () => void; active?: boolean; dir?: string }) {
  return (
    <th className="cursor-pointer select-none px-4 py-3 text-center font-medium" onClick={onClick}>
      <span className={cn(active && 'underline underline-offset-4')}>{children}{active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
    </th>
  )
}

// ─── Record form ──────────────────────────────────────────────────────────────

function RecordForm({ type, editing, entities, destinations, onSaved, onCancel }: {
  type: RecordType; editing: CallRecord | null; entities: Entity[]; destinations: Destination[]; onSaved: () => void; onCancel: () => void
}) {
  const isBuyer     = type === 'buyer'
  const entityLabel = isBuyer ? 'Destination' : 'Campaign'
  const isEdit      = !!editing

  const [date,        setDate]        = useState(editing?.record_date ?? today())
  const [entityId,    setEntityId]    = useState<string>(editing ? String((isBuyer ? editing.buyer_id : editing.campaign_id) ?? '') : '')
  const [newCode,     setNewCode]     = useState('')
  const [source,      setSource]      = useState(editing?.source ?? '')
  const [newDest,     setNewDest]     = useState('')
  const [answered,    setAnswered]    = useState(String(editing?.answered ?? ''))
  const [missed,      setMissed]      = useState(String(editing?.missed   ?? ''))
  const [counted,     setCounted]     = useState(String(editing?.counted  ?? ''))
  const [rate,        setRate]        = useState(String(editing?.rate     ?? ''))
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const creatingNew    = !isEdit && entityId === '__new__'
  const creatingNewDest = !isBuyer && source === '__new__'

  const effectiveRate = Number(rate) || 0
  const total = useMemo(() => (Number(counted) || 0) * effectiveRate, [counted, effectiveRate])

  const handleEntity = (v: string) => {
    setEntityId(v)
    if (isBuyer) {
      const b = entities.find((e) => String(e.id) === v)
      setRate(v === '__new__' ? '' : b ? String(b.rate) : '')
    }
  }
  const handleSource = (v: string) => {
    setSource(v)
    const d = destinations.find((x) => x.name === v)
    setRate(v === '__new__' ? '' : d ? String(d.rate) : '')
  }

  const handleAnswered = (v: string) => { setAnswered(v); setCounted(String((Number(v) || 0) + (Number(missed) || 0))) }
  const handleMissed   = (v: string) => { setMissed(v);   setCounted(String((Number(answered) || 0) + (Number(v) || 0))) }

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setSaving(true); setError(null)
    try {
      const base = { record_date: date, answered: Number(answered)||0, missed: Number(missed)||0, counted: Number(counted)||0, rate: effectiveRate }
      if (isEdit) {
        const updatePayload: Record<string, unknown> = { ...base }
        if (!isBuyer) updatePayload.source = source === '__new__' ? newDest : source
        await api.updateRecord(editing!.id, updatePayload)
      } else {
        const payload: Record<string, unknown> = { ...base, record_type: type }
        if (entityId === '__new__') payload[isBuyer ? 'buyer_code' : 'campaign_code'] = newCode
        else payload[isBuyer ? 'buyer_id' : 'campaign_id'] = Number(entityId)
        if (!isBuyer) {
          const destName = source === '__new__' ? newDest : source
          if (destName) {
            if (source === '__new__' && newDest) {
              const campaignId = entityId && entityId !== '__new__' ? Number(entityId) : undefined
              try { await api.createDestination({ name: newDest, rate: Number(rate) || 0, campaign_id: campaignId }) } catch { /* already exists */ }
            }
            payload.source = destName
          }
        }
        await api.createRecord(payload)
      }
      onSaved()
    } catch (err) { setError((err as Error).message) } finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Date"><Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required /></Field>
        {isEdit ? (
          <Field label={entityLabel}><Input value={(isBuyer ? editing!.buyer_code : editing!.campaign_code) ?? ''} disabled /></Field>
        ) : (
          <Field label={entityLabel}>
            <select className={selectCls} value={entityId} onChange={(e) => handleEntity(e.target.value)} required>
              <option value="">Select {entityLabel.toLowerCase()}…</option>
              {entities.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
              <option value="__new__">+ New {entityLabel.toLowerCase()}…</option>
            </select>
          </Field>
        )}
        {creatingNew && <Field label="New code"><Input placeholder={isBuyer ? 'e.g. RTG 99' : 'e.g. C-12'} value={newCode} onChange={(e) => setNewCode(e.target.value)} required /></Field>}
      </div>
      {!isBuyer && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {isEdit ? (
            <Field label="Destination"><Input value={editing!.source ?? ''} onChange={(e) => setSource(e.target.value)} placeholder="e.g. AdsTerra" /></Field>
          ) : (
            <Field label="Destination">
              <select className={selectCls} value={source} onChange={(e) => handleSource(e.target.value)}>
                <option value="">Select destination…</option>
                {destinations
                  .filter((d) => !entityId || entityId === '__new__' || d.campaign_id == null || String(d.campaign_id) === entityId)
                  .map((d) => <option key={d.id} value={d.name}>{d.name} — {money2(d.rate)}</option>)}
                <option value="__new__">+ New destination…</option>
              </select>
            </Field>
          )}
          {creatingNewDest && (
            <Field label="New destination name"><Input placeholder="e.g. AdsTerra" value={newDest} onChange={(e) => setNewDest(e.target.value)} required /></Field>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Answered"><Input type="number" min="0" value={answered} onChange={(e) => handleAnswered(e.target.value)} /></Field>
        <Field label="Missed"><Input type="number" min="0" value={missed} onChange={(e) => handleMissed(e.target.value)} /></Field>
        <Field label="Counted"><Input type="number" min="0" value={counted} disabled /></Field>
        <Field label="Rate ($)"><Input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} title={isBuyer ? 'Buyer rate — auto-filled, editable per record' : 'Source rate — auto-filled from the destination; editable per record'} /></Field>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-primary px-4 py-3 text-primary-foreground">
        <span className="text-sm font-medium">{isBuyer ? 'Total revenue' : 'Total cost'}</span>
        <span className="text-lg font-bold font-display">{money2(total)}</span>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>
          {saving && <Spinner className="size-4" />}
          {isEdit ? 'Save changes' : 'Add record'}
        </Button>
      </div>
    </form>
  )
}
