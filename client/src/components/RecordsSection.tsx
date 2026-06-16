// PDF/CSV export disabled — report downloads removed.
// import { jsPDF } from 'jspdf'
// import autoTable from 'jspdf-autotable'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../api/client'
import { formatDate, money2, num, today } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import type { CallRecord, Destination, RecordFilters, RecordType } from '../types'
import { DateRangeFilter } from './DateRange'
import { Button, Card, EmptyState, Input, Modal, Select, Spinner, cx } from './ui'

interface Entity { id: number; code: string }

const PlusIcon  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
const EditIcon  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
const TrashIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>

// ─── PDF (disabled — report downloads removed) ─────────────────────────────────
/*
interface PdfTotals { count: number; answered: number; missed: number; counted: number; total_bill: number; destCount?: number }

function buildPdf(
  title: string,
  subtitle: string,
  columns: string[],
  rows: (string | number)[][],
  numericFrom: number,
  opts?: { singleDay?: string; dateFrom?: string; dateTo?: string; totals?: PdfTotals; entityLabel?: string; profit?: number | null },
): jsPDF {
  const { singleDay, dateFrom, dateTo, totals, entityLabel = 'Destination', profit: profitVal } = opts ?? {}
  const isRange = !singleDay && !!(dateFrom || dateTo)
  const NAVY: [number, number, number] = [26, 54, 84]
  const CYAN: [number, number, number] = [212, 233, 242]
  const CYAN_DATE: [number, number, number] = [191, 222, 235]
  const WHITE: [number, number, number] = [255, 255, 255]
  const INK: [number, number, number] = [15, 23, 42]

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  doc.setFontSize(13); doc.setTextColor(...NAVY); doc.setFont('helvetica', 'bold')
  doc.text(title, 40, 46)
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139)
  doc.text(subtitle, 40, 62)
  doc.text(`Generated ${new Date().toLocaleString()}`, pageW - 40, 62, { align: 'right' })

  // If single day: prepend DATE column and merge rows with rowSpan
  let head = columns
  let body: import('jspdf-autotable').RowInput[]
  let colStyles: Record<number, Partial<import('jspdf-autotable').Styles>> = Object.fromEntries(
    columns.flatMap((_, i) => (i >= numericFrom ? [[i, { halign: 'right' as const }]] : []))
  )
  let foot: string[] | undefined

  if (singleDay) {
    head = ['DATE', ...columns]
    // Print date on the middle row so it appears centered in the column visually
    const midRow = Math.floor(rows.length / 2)
    body = rows.map((r, i) => [(i === midRow ? singleDay : ''), ...r.map(String)])
    colStyles = {
      0: { fillColor: WHITE, halign: 'center', fontStyle: 'bold', valign: 'middle', cellWidth: 68 },
      ...Object.fromEntries(columns.flatMap((_, i) => (i >= numericFrom ? [[i + 1, { halign: 'right' as const }]] : []))),
    }
    if (totals) {
      const totalRow = totals.destCount !== undefined
        ? ['TOTAL', String(totals.count), String(totals.destCount), num(totals.answered), num(totals.missed), num(totals.counted), '—', `$${totals.total_bill.toFixed(2)}`]
        : ['TOTAL', String(totals.count), num(totals.answered), num(totals.missed), num(totals.counted), '—', `$${totals.total_bill.toFixed(2)}`]
      body.push(totalRow)
    }
  } else if (isRange) {
    // Range filter: prepend DATE column, show start on first row, end on last row
    head = ['DATE', ...columns]
    const startLabel = dateFrom ?? ''
    const endLabel   = dateTo && dateTo !== dateFrom ? dateTo : ''
    body = rows.map((r, i) => [
      i === 0 ? startLabel : i === rows.length - 1 && endLabel ? endLabel : '',
      ...r.map(String),
    ])
    colStyles = {
      0: { fillColor: WHITE, halign: 'center', fontStyle: 'bold', valign: 'middle', cellWidth: 68 },
      ...Object.fromEntries(columns.flatMap((_, i) => (i >= numericFrom ? [[i + 1, { halign: 'right' as const }]] : []))),
    }
    if (totals) {
      const totalRow = totals.destCount !== undefined
        ? ['TOTAL', String(totals.count), String(totals.destCount), num(totals.answered), num(totals.missed), num(totals.counted), '—', `$${totals.total_bill.toFixed(2)}`]
        : ['TOTAL', String(totals.count), num(totals.answered), num(totals.missed), num(totals.counted), '—', `$${totals.total_bill.toFixed(2)}`]
      body.push(totalRow)
    }
  } else {
    body = rows.map((r) => r.map(String))
    if (totals) {
      const totalRow = totals.destCount !== undefined
        ? ['TOTAL', String(totals.count), String(totals.destCount), num(totals.answered), num(totals.missed), num(totals.counted), '—', `$${totals.total_bill.toFixed(2)}`]
        : ['TOTAL', String(totals.count), num(totals.answered), num(totals.missed), num(totals.counted), '—', `$${totals.total_bill.toFixed(2)}`]
      body.push(totalRow)
    }
  }

  const totalRowIndex = totals ? body.length - 1 : -1

  autoTable(doc, {
    startY: 78, theme: 'grid', head: [head], body,
    styles: { fontSize: 8, cellPadding: 4, lineColor: WHITE, lineWidth: 1, textColor: INK, valign: 'middle' },
    headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', halign: 'center', lineColor: NAVY, lineWidth: 1 },
    bodyStyles: { fillColor: CYAN },
    columnStyles: colStyles,
    margin: { left: 40, right: 40 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === totalRowIndex) {
        data.cell.styles.fillColor = NAVY
        data.cell.styles.textColor = WHITE
        data.cell.styles.fontStyle = 'bold'
        if (data.column.index >= (singleDay || isRange ? 2 : 1)) {
          data.cell.styles.halign = 'right'
        }
      }
      // Keep DATE column white even on CYAN body rows
      if (data.section === 'body' && data.column.index === 0 && (singleDay || isRange) && data.row.index !== totalRowIndex) {
        data.cell.styles.fillColor = WHITE
      }
    },
  })
  // Profit badge (buyer PDF only)
  if (profitVal != null) {
    const lastY = (doc as any).lastAutoTable?.finalY ?? 78
    const NAVY2: [number,number,number] = [26,54,84]
    const WHITE2: [number,number,number] = [255,255,255]
    const bW = 160; const bH = 28
    const bX = (doc.internal.pageSize.getWidth() - bW) / 2
    const bY = lastY + 14
    doc.setFillColor(...NAVY2)
    doc.roundedRect(bX, bY, bW, bH, 5, 5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...WHITE2)
    doc.text(`PROFIT  $${Math.round(profitVal).toLocaleString('en-US')}`, bX + bW / 2, bY + bH / 2, { align: 'center', baseline: 'middle' })
  }

  return doc
}
*/

// ─── Section ──────────────────────────────────────────────────────────────────

export default function RecordsSection({
  type, title, subtitle, compact = false, onChange, onTotalsChange, onDateChange,
  from, to, hideDateFilter = false,
}: {
  type: RecordType; title: string; subtitle: string; compact?: boolean; onChange?: () => void; onTotalsChange?: (total_bill: number | null) => void; onDateChange?: (from: string, to: string) => void; profit?: number | null
  /** When provided, the parent controls the date range (e.g. a single page-level filter). */
  from?: string; to?: string; hideDateFilter?: boolean
}) {
  const isBuyer    = type === 'buyer'
  const entityLabel = isBuyer ? 'Destination' : 'Campaign'

  const [filters, setFilters] = useState<RecordFilters>({
    type, from: '', to: '', search: '', buyer_id: '', campaign_id: '',
    sort: 'total_bill', dir: 'desc', page: 1, per_page: 35,
  })
  const [modalOpen,  setModalOpen]  = useState(false)
  const [editing,    setEditing]    = useState<CallRecord | null>(null)
  // const [pdfLoading, setPdfLoading] = useState(false)  // PDF export disabled

  const entities = useAsync<Entity[]>(async () => {
    const list = isBuyer ? await api.buyers() : await api.campaigns()
    return list.map((x) => ({ id: x.id, code: x.code }))
  }, [type])
  const records = useAsync(() => api.records(filters), [JSON.stringify(filters)])

  // Fetch destinations list for campaign records
  const destinations = useAsync(() => api.destinations(), [])

  // Fetch all records matching the current filters (no pagination) for totals row
  const allRecords = useAsync(
    () => api.records({ ...filters, page: 1, per_page: 9999 }),
    [JSON.stringify(filters)],
  )

  const totals = useMemo(() => {
    const data = allRecords.data?.data ?? []
    if (data.length === 0) return null
    const uniqueEntities = new Set(data.map((r) => isBuyer ? r.buyer_id : r.campaign_id)).size
    return {
      answered:   data.reduce((s, r) => s + Number(r.answered),   0),
      missed:     data.reduce((s, r) => s + Number(r.missed),     0),
      counted:    data.reduce((s, r) => s + Number(r.counted),    0),
      total_bill: data.reduce((s, r) => s + Number(r.total_bill), 0),
      count:      uniqueEntities,
    }
  }, [allRecords.data, isBuyer])

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

  const openNew  = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (r: CallRecord) => { setEditing(r); setModalOpen(true) }

  const onSaved = () => { setModalOpen(false); records.reload(); entities.reload(); onChange?.() }
  const onDelete = async (r: CallRecord) => {
    if (!confirm(`Delete this record from ${formatDate(r.record_date)}?`)) return
    await api.deleteRecord(r.id); records.reload(); onChange?.()
  }

  /* PDF/CSV export disabled — report downloads removed.
  const filterLabel = useMemo(() => {
    const parts: string[] = []
    if (filters.from || filters.to) parts.push(`${filters.from || '…'} → ${filters.to || '…'}`)
    if (filters.search) parts.push(`search: "${filters.search}"`)
    return parts.length ? parts.join('  ·  ') : 'All records'
  }, [filters])

  const handlePdf = async () => {
    setPdfLoading(true)
    try {
      const isSingleDayPdf = !!(filters.from && filters.to && filters.from === filters.to)

      // Helper to build rows for a record set
      const buildRows = (data: typeof result.data, buyer: boolean) =>
        data.map((r) => {
          const base: (string | number)[] = buyer
            ? [r.buyer_code ?? '—', r.answered, r.missed, r.counted, `$${r.rate.toFixed(2)}`, `$${r.total_bill.toFixed(2)}`]
            : [r.campaign_code ?? '—', r.source ?? '—', r.answered, r.missed, r.counted, `$${r.rate.toFixed(2)}`, `$${r.total_bill.toFixed(2)}`]
          if (!isSingleDayPdf) base.unshift(formatDate(r.record_date))
          return base
        })

      // Fetch buyer records
      const result = await api.records({ ...filters, type: 'buyer', page: 1, per_page: 5000 })
      const buyerRows = buildRows(result.data, true)
      const buyerTotalBill = result.data.reduce((s, r) => s + Number(r.total_bill), 0)
      const buyerCount = new Set(result.data.map(r => r.buyer_id)).size
      const buyerTotals: PdfTotals = { count: buyerCount, answered: result.data.reduce((s,r)=>s+r.answered,0), missed: result.data.reduce((s,r)=>s+r.missed,0), counted: result.data.reduce((s,r)=>s+r.counted,0), total_bill: buyerTotalBill }

      // Fetch campaign records
      const campResult = await api.records({ ...filters, type: 'campaign', page: 1, per_page: 5000 })
      const campRows = buildRows(campResult.data, false)
      const campTotalBill = campResult.data.reduce((s, r) => s + Number(r.total_bill), 0)
      const campCount = new Set(campResult.data.map(r => r.campaign_id)).size
      const campDestCount = new Set(campResult.data.map(r => r.source).filter(Boolean)).size
      const campTotals: PdfTotals = { count: campCount, answered: campResult.data.reduce((s,r)=>s+r.answered,0), missed: campResult.data.reduce((s,r)=>s+r.missed,0), counted: campResult.data.reduce((s,r)=>s+r.counted,0), total_bill: campTotalBill, destCount: campDestCount }

      const profitVal = profit != null ? profit : (buyerTotalBill - campTotalBill)

      const buyerCols = isSingleDayPdf
        ? ['Destination', 'Answered', 'Missed', 'Counted', 'Rate', 'Total Bill']
        : ['Date', 'Destination', 'Answered', 'Missed', 'Counted', 'Rate', 'Total Bill']
      const campCols = ['Date', 'Campaign', 'Destination', 'Answered', 'Missed', 'Counted', 'Rate', 'Total Bill']

      const commonOpts = {
        singleDay: isSingleDayPdf ? formatDmy(filters.from ?? null) : undefined,
        dateFrom:  !isSingleDayPdf && filters.from ? formatDmy(filters.from) : undefined,
        dateTo:    !isSingleDayPdf && filters.to   ? formatDmy(filters.to)   : undefined,
      }

      // Build combined doc — buyer table first
      const doc = buildPdf('Revenue Records Export', filterLabel, buyerCols, buyerRows,
        isSingleDayPdf ? 1 : 2, { ...commonOpts, totals: buyerTotals, entityLabel: 'Destination' })

      // Profit badge BETWEEN the two tables
      const profitY = (doc as any).lastAutoTable?.finalY ?? 78
      const pageW2 = doc.internal.pageSize.getWidth()
      const bW = 180; const bH = 30
      const bX = (pageW2 - bW) / 2
      const bY = profitY + 14
      doc.setFillColor(26, 54, 84)
      doc.roundedRect(bX, bY, bW, bH, 5, 5, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(14)
      doc.setTextColor(255, 255, 255)
      doc.text(`PROFIT  $${Math.round(profitVal).toLocaleString('en-US')}`, bX + bW / 2, bY + bH / 2, { align: 'center', baseline: 'middle' })

      // Campaign table on same doc
      const startY = bY + bH + 14
      const NAVY: [number,number,number] = [26,54,84]
      const CYAN: [number,number,number] = [212,233,242]
      const WHITE: [number,number,number] = [255,255,255]
      const INK: [number,number,number] = [15,23,42]

      // Camp body — always build fresh from raw data (no double-date issue)
      const campMidRow = Math.floor(campResult.data.length / 2)
      const campBody = campResult.data.map((r, i) => {
        // Date cell value
        let dateVal = ''
        if (isSingleDayPdf) dateVal = i === campMidRow ? (commonOpts.singleDay ?? '') : ''
        else dateVal = i === 0 ? (commonOpts.dateFrom ?? '') : i === campResult.data.length - 1 ? (commonOpts.dateTo ?? '') : ''
        return [
          dateVal,
          r.campaign_code ?? '—',
          r.source ?? '—',
          num(r.answered),
          num(r.missed),
          num(r.counted),
          `$${r.rate.toFixed(2)}`,
          `$${Math.round(Number(r.total_bill)).toLocaleString('en-US')}`,
        ]
      })
      campBody.push(['TOTAL', String(campTotals.count), String(campDestCount), num(campTotals.answered), num(campTotals.missed), num(campTotals.counted), '—', `$${Math.round(campTotalBill).toLocaleString('en-US')}`])
      const campTotalIdx = campBody.length - 1

      const autoTable = (await import('jspdf-autotable')).default
      autoTable(doc, {
        startY: startY + 20,
        theme: 'grid',
        head: [campCols],
        body: campBody,
        styles: { fontSize: 8, cellPadding: 4, lineColor: WHITE, lineWidth: 1, textColor: INK, valign: 'middle' },
        headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', halign: 'center', lineColor: NAVY, lineWidth: 1 },
        bodyStyles: { fillColor: CYAN },
        columnStyles: {
          0: { fillColor: WHITE, halign: 'center', fontStyle: 'bold', valign: 'middle', cellWidth: 68 },
          3: { halign: 'right' as const },
          4: { halign: 'right' as const },
          5: { halign: 'right' as const },
          6: { halign: 'right' as const },
          7: { halign: 'right' as const },
        },
        margin: { left: 40, right: 40 },
        didParseCell: (data: any) => {
          if (data.section === 'body' && data.row.index === campTotalIdx) {
            data.cell.styles.fillColor = NAVY
            data.cell.styles.textColor = WHITE
            data.cell.styles.fontStyle = 'bold'
            if (data.column.index >= 3) data.cell.styles.halign = 'right'
          }
          if (data.section === 'body' && data.column.index === 0 && data.row.index !== campTotalIdx) {
            data.cell.styles.fillColor = WHITE
          }
        },
      })

      doc.save('records-export.pdf')
    } finally { setPdfLoading(false) }
  }
  */

  const meta = records.data?.meta
  const rows = records.data?.data ?? []

  const actions = (
    <>
      {/* Report downloads removed.
      <DownloadButton href={api.recordsExportUrl(filters)}>CSV</DownloadButton>
      <Button variant="secondary" onClick={handlePdf} disabled={pdfLoading}>
        {pdfLoading ? <Spinner className="h-3.5 w-3.5" /> : <PdfIcon />} PDF
      </Button>
      */}
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
          {!hideDateFilter && (
            <DateRangeFilter
              from={filters.from ?? ''}
              to={filters.to ?? ''}
              onFromChange={(iso) => set({ from: iso })}
              onToChange={(iso) => set({ to: iso })}
            />
          )}
          <Select
            label={entityLabel}
            value={isBuyer ? filters.buyer_id : filters.campaign_id}
            onChange={(e) =>
              set(isBuyer
                ? { buyer_id: e.target.value ? Number(e.target.value) : '' }
                : { campaign_id: e.target.value ? Number(e.target.value) : '' })
            }
          >
            <option value="">All {isBuyer ? 'destinations' : 'campaigns'}</option>
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
                  {!isFiltered && <th className="px-4 py-3 font-medium">#</th>}
                  <Th onClick={() => set({ sort: 'record_date', dir: nextDir(filters, 'record_date') })} active={filters.sort === 'record_date'} dir={filters.dir}>Date</Th>
                  <th className="px-4 py-3 font-medium">{entityLabel}</th>
                  {!isBuyer && <th className="px-4 py-3 font-medium">Destination</th>}
                  <ThNum onClick={() => set({ sort: 'answered',   dir: nextDir(filters, 'answered')   })} active={filters.sort === 'answered'}   dir={filters.dir}>Answered</ThNum>
                  <ThNum onClick={() => set({ sort: 'missed',     dir: nextDir(filters, 'missed')     })} active={filters.sort === 'missed'}     dir={filters.dir}>Missed</ThNum>
                  <ThNum onClick={() => set({ sort: 'counted',    dir: nextDir(filters, 'counted')    })} active={filters.sort === 'counted'}    dir={filters.dir}>Counted</ThNum>
                  <th className="px-4 py-3 text-right font-medium">Rate</th>
                  <ThNum onClick={() => set({ sort: 'total_bill', dir: nextDir(filters, 'total_bill') })} active={filters.sort === 'total_bill'} dir={filters.dir}>Total</ThNum>
                  {!isFiltered && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    {!isFiltered && <td className="px-4 py-3 tabular-nums text-slate-400">{(meta ? (meta.page - 1) * meta.per_page : 0) + i + 1}</td>}
                    {isSingleDay
                      ? i === 0 && <td className="whitespace-nowrap px-4 py-3 text-center align-middle text-slate-600 font-medium" rowSpan={rows.length}>{formatDate(r.record_date)}</td>
                      : isFiltered
                        ? <td className="whitespace-nowrap px-4 py-3 text-slate-600 font-medium">
                            {i === 0 ? formatDate(r.record_date) : i === rows.length - 1 ? formatDate(r.record_date) : ''}
                          </td>
                        : <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(r.record_date)}</td>
                    }
                    <td className="px-4 py-3 font-medium text-slate-800">{(isBuyer ? r.buyer_code : r.campaign_code) ?? '—'}</td>
                    {!isBuyer && <td className="px-4 py-3 text-slate-600">{r.source ?? '—'}</td>}
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{num(r.answered)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">{num(r.missed)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{num(r.counted)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">{money2(r.rate)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{money2(r.total_bill)}</td>
                    {!isFiltered && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => openEdit(r)} className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600" title="Edit"><EditIcon /></button>
                          <button onClick={() => onDelete(r)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><TrashIcon /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-900">
                    <td className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500" colSpan={isFiltered ? 1 : 2}>
                      TOTAL
                    </td>
                    <td className="px-4 py-3 tabular-nums">{num(totals.count)}</td>
                    {!isBuyer && <td className="px-4 py-3 tabular-nums">{num(new Set(allRecords.data?.data?.map(r => r.source).filter(Boolean) ?? []).size)}</td>}
                    <td className="px-4 py-3 text-right tabular-nums">{num(totals.answered)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{num(totals.missed)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{num(totals.counted)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-400">—</td>
                    <td className="px-4 py-3 text-right tabular-nums text-blue-700">{money2(totals.total_bill)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
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
        <RecordForm type={type} editing={editing} entities={entities.data ?? []} destinations={destinations.data ?? []} onSaved={onSaved} onCancel={() => setModalOpen(false)} />
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

  const total          = useMemo(() => (Number(counted) || 0) * (Number(rate) || 0), [counted, rate])
  const creatingNew    = !isEdit && entityId === '__new__'
  const creatingNewDest = !isBuyer && source === '__new__'

  const handleAnswered = (v: string) => { setAnswered(v); setCounted(String((Number(v) || 0) + (Number(missed) || 0))) }
  const handleMissed   = (v: string) => { setMissed(v);   setCounted(String((Number(answered) || 0) + (Number(v) || 0))) }

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setSaving(true); setError(null)
    try {
      const base = { record_date: date, answered: Number(answered)||0, missed: Number(missed)||0, counted: Number(counted)||0, rate: Number(rate)||0 }
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
            // Auto-create destination if it doesn't exist yet
            if (source === '__new__' && newDest) {
              try { await api.createDestination({ name: newDest }) } catch { /* already exists */ }
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
      {!isBuyer && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {isEdit ? (
            <Input label="Destination" value={editing!.source ?? ''} onChange={(e) => setSource(e.target.value)} placeholder="e.g. AdsTerra" />
          ) : (
            <Select label="Destination" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Select destination…</option>
              {destinations.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
              <option value="__new__">+ New destination…</option>
            </Select>
          )}
          {creatingNewDest && (
            <Input label="New destination name" placeholder="e.g. AdsTerra" value={newDest} onChange={(e) => setNewDest(e.target.value)} required />
          )}
        </div>
      )}
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