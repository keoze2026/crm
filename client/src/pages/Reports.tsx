import { useState } from 'react'
import { api } from '../api/client'
import { DateRangeControl, type Range } from '../components/DateRange'
import { PageHeader } from '../components/Layout'
import { Card, EmptyState, Spinner } from '../components/ui'
import { daysAgo, formatDmy, money, money2, num, today } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import type { CompleteReport } from '../types'

// Palette mirrors the downloadable PDF (navy bands, cyan body, cyan date column).
const NAVY = 'rgb(26, 54, 84)'
const CYAN = 'rgb(212, 233, 242)'
const CYAN_DATE = 'rgb(191, 222, 235)'
const INK = 'rgb(15, 23, 42)'

/** Human-readable date label: single day, range, or em-dash when unset. */
function rangeText(from: string | null, to: string | null): string {
  if (!from && !to) return '—'
  if (from && to && from !== to) return `${formatDmy(from)}  –  ${formatDmy(to)}`
  return formatDmy(from ?? to)
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Reports() {
  const [range, setRange] = useState<Range>({ from: daysAgo(6), to: today() })
  const report = useAsync(() => api.completeReport(range), [range.from, range.to])
  const data = report.data

  return (
    <div>
      <PageHeader title="Reports" subtitle="Complete report for the selected period">
        <DateRangeControl value={range} onChange={setRange} />
      </PageHeader>

      <Card className="p-6">
        {report.loading ? (
          <div className="flex justify-center py-16"><Spinner className="h-7 w-7" /></div>
        ) : report.error ? (
          <p className="py-10 text-center text-sm text-red-600">{report.error}</p>
        ) : !data || (data.buyers.length === 0 && data.campaigns.length === 0) ? (
          <EmptyState message="No data for this period." />
        ) : (
          <CompleteReportView data={data} />
        )}
      </Card>
    </div>
  )
}

// ─── Rendered complete report (same layout as the PDF) ─────────────────────────

function CompleteReportView({ data }: { data: CompleteReport }) {
  const dateLabel = rangeText(data.from, data.to)
  const bt = data.buyer_totals
  const ct = data.campaign_totals

  const buyerRows = data.buyers.map((b) => [
    b.code, num(b.answered), num(b.missed), num(b.counted), money2(b.rate), money2(b.total_bill),
  ])
  const buyerFoot = [
    'TOTAL', num(bt.destinations), num(bt.answered), num(bt.missed),
    num(bt.counted), money(bt.rate), money(bt.total_bill),
  ]

  const campRows = data.campaigns.map((c) => [
    c.camp, c.destination, num(c.answered), num(c.missed), num(c.counted), money2(c.rate), money2(c.total_bill),
  ])
  const campFoot = [
    'TOTAL', num(ct.camps), num(ct.destinations), num(ct.answered),
    num(ct.missed), num(ct.counted), money(ct.rate), money(ct.total_bill),
  ]

  return (
    <div className="mx-auto max-w-3xl">
      {/* Title block */}
      <div className="mb-4">
        <h2 className="text-lg font-bold" style={{ color: NAVY }}>Complete Report</h2>
        <div className="mt-0.5 flex flex-wrap justify-between gap-x-4 text-xs text-slate-500">
          <span>Period: {dateLabel}</span>
          <span>Generated {new Date().toLocaleString()}</span>
        </div>
      </div>

      {/* Revenue side — one row per destination (buyer) */}
      <div className="overflow-x-auto">
        <ReportTable
          columns={['DATE', 'DESTINATION', 'ANSWERED', 'MISSED', 'COUNTED', 'RATE', 'TOTAL BILL']}
          rows={buyerRows}
          foot={buyerFoot}
          dateLabel={dateLabel}
          cyanBody
        />
      </div>

      {/* Profit badge */}
      <div className="my-5 flex justify-center">
        <div style={{ backgroundColor: NAVY }} className="rounded-lg px-10 py-2.5 text-2xl font-bold text-white shadow-md">
          {money(data.profit)}
        </div>
      </div>

      {/* Cost side — one row per campaign + destination */}
      <div className="overflow-x-auto">
        <ReportTable
          columns={['DATE', 'CAMP', 'DESTINATION', 'ANSWERED', 'MISSED', 'COUNTED', 'RATE', 'TOTAL BILL']}
          rows={campRows}
          foot={campFoot}
          dateLabel={dateLabel}
          cyanBody={false}
        />
      </div>
    </div>
  )
}

/** A single report table with a navy header/footer and a merged DATE column. */
function ReportTable({
  columns,
  rows,
  foot,
  dateLabel,
  cyanBody,
}: {
  columns: string[]
  rows: string[][]
  foot: string[]
  dateLabel: string
  cyanBody: boolean
}) {
  const bodyBg = cyanBody ? CYAN : 'white'
  const cellBorder = '1px solid white'
  return (
    <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c}
              style={{ backgroundColor: NAVY, color: 'white', border: cellBorder }}
              className="px-2 py-1.5 text-center font-bold uppercase tracking-wide"
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td style={{ backgroundColor: CYAN_DATE, color: INK, border: cellBorder }} className="px-2 py-1.5 text-center font-semibold">
              {dateLabel}
            </td>
            {columns.slice(1).map((_, i) => (
              <td key={i} style={{ backgroundColor: bodyBg, color: INK, border: cellBorder }} className="px-2 py-1.5">—</td>
            ))}
          </tr>
        ) : (
          rows.map((cells, ri) => (
            <tr key={ri}>
              {ri === 0 && (
                <td
                  rowSpan={rows.length}
                  style={{ backgroundColor: CYAN_DATE, color: INK, border: cellBorder }}
                  className="whitespace-nowrap px-2 text-center align-middle font-semibold"
                >
                  {dateLabel}
                </td>
              )}
              {cells.map((cell, ci) => (
                <td key={ci} style={{ backgroundColor: bodyBg, color: INK, border: cellBorder }} className="px-2 py-1.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
      <tfoot>
        <tr>
          {foot.map((cell, i) => (
            <td key={i} style={{ backgroundColor: NAVY, color: 'white', border: cellBorder }} className="px-2 py-1.5 font-bold">
              {cell}
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  )
}

/* =============================================================================
   PREVIOUS REPORTS PAGE — commented out (kept for reference / re-enabling).
   This was the multi-report page with downloadable CSV / Excel / PDF exports,
   including the downloadable complete report. The active page above renders the
   complete report on screen instead.
=============================================================================

import { jsPDF } from 'jspdf'
import autoTable, { type CellDef, type RowInput, type Styles } from 'jspdf-autotable'
import { useState } from 'react'
import { api } from '../api/client'
import { DateRangeControl, DownloadButton, type Range } from '../components/DateRange'
import { PageHeader } from '../components/Layout'
import { Button, Card, CardHeader, EmptyState, Spinner } from '../components/ui'
import { daysAgo, fileDateRange, formatDmy, formatPeriod, money, money2, num, today } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { saveCsv, saveXlsx, type XlsxSheet } from '../lib/xlsx'
import type { CompleteReport } from '../types'

// ─── PDF generation ──────────────────────────────────────────────────────────

type AnyRow = (string | number)[]

function buildPdf(
  title: string,
  subtitle: string,
  columns: string[],
  rows: AnyRow[],
): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  // Header
  doc.setFontSize(13)
  doc.setTextColor(15, 23, 42)
  doc.setFont('helvetica', 'bold')
  doc.text(title, 40, 46)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 116, 139)
  doc.text(subtitle, 40, 62)
  doc.text(`Generated ${new Date().toLocaleString()}`, pageW - 40, 62, { align: 'right' })

  autoTable(doc, {
    startY: 78,
    theme: 'grid',
    head: [columns],
    body: rows.map((r) => r.map(String)),
    styles: { fontSize: 9, cellPadding: 5, lineColor: [255, 255, 255], lineWidth: 1, textColor: [15, 23, 42], valign: 'middle' },
    headStyles: { fillColor: [26, 54, 84], textColor: 255, fontStyle: 'bold', halign: 'left', lineColor: [26, 54, 84], lineWidth: 1 },
    bodyStyles: { fillColor: [212, 233, 242] },
    columnStyles: Object.fromEntries(
      columns.slice(1).map((_, i) => [i + 1, { halign: 'right' }])
    ),
    margin: { left: 40, right: 40 },
  })

  return doc
}

// ─── Complete report PDF (styled to match the company layout) ──────────────────

const NAVY: [number, number, number] = [26, 54, 84]
const CYAN: [number, number, number] = [212, 233, 242]
const CYAN_DATE: [number, number, number] = [191, 222, 235]
const INK: [number, number, number] = [15, 23, 42]
const WHITE: [number, number, number] = [255, 255, 255]

// Human-readable date label: single day, range, or em-dash when unset.
function rangeText(from: string | null, to: string | null): string {
  if (!from && !to) return '—'
  if (from && to && from !== to) return `${formatDmy(from)}  –  ${formatDmy(to)}`
  return formatDmy(from ?? to)
}

// Renders the two stacked tables + profit badge exactly like the company report.
function buildCompleteReportPdf(data: CompleteReport): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const M = 36

  const dateLabel = rangeText(data.from, data.to)

  // Title block
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...NAVY)
  doc.text('Complete Report', M, 46)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(100, 116, 139)
  doc.text(`Period: ${dateLabel}`, M, 62)
  doc.text(`Generated ${new Date().toLocaleString()}`, pageW - M, 62, { align: 'right' })

  const baseStyles: Partial<Styles> = {
    fontSize: 8,
    cellPadding: 4,
    lineColor: WHITE,
    lineWidth: 1,
    textColor: INK,
    valign: 'middle',
  }
  const navyBand: Partial<Styles> = {
    fillColor: NAVY,
    textColor: WHITE,
    fontStyle: 'bold',
    halign: 'left',
    lineColor: NAVY,
    lineWidth: 1,
  }
  const dateColStyles: Partial<Styles> = {
    fillColor: CYAN_DATE,
    halign: 'center',
    fontStyle: 'bold',
    valign: 'middle',
    cellWidth: 62,
  }
  const dateCell = (rowSpan: number): CellDef => ({
    content: dateLabel,
    rowSpan,
    styles: { fillColor: CYAN_DATE, halign: 'center', fontStyle: 'bold', valign: 'middle' },
  })

  // Table 1 — revenue side (one row per buyer / destination)
  const bt = data.buyer_totals
  const buyerBody: RowInput[] = data.buyers.map((b, i) => {
    const cells: (string | CellDef)[] = [
      b.code,
      num(b.answered),
      num(b.missed),
      num(b.counted),
      money2(b.rate),
      money2(b.total_bill),
    ]
    if (i === 0) cells.unshift(dateCell(data.buyers.length))
    return cells
  })
  if (buyerBody.length === 0) {
    buyerBody.push([dateCell(1), '—', '—', '—', '—', '—'])
  }

  autoTable(doc, {
    startY: 78,
    theme: 'grid',
    head: [['DATE', 'DESTINATION', 'ANSWERED', 'MISSED', 'COUNTED', 'RATE', 'TOTAL BILL']],
    body: buyerBody,
    foot: [[
      'TOTAL', String(bt.destinations), num(bt.answered), num(bt.missed),
      num(bt.counted), money(bt.rate), money(bt.total_bill),
    ]],
    styles: baseStyles,
    headStyles: { ...navyBand, halign: 'center' },
    footStyles: navyBand,
    bodyStyles: { fillColor: CYAN },
    columnStyles: { 0: dateColStyles },
    margin: { left: M, right: M },
  })

  // Profit badge
  let y = lastY(doc) + 18
  const boxW = 160
  const boxH = 34
  if (y + boxH + 70 > pageH - M) {
    doc.addPage()
    y = M + 10
  }
  doc.setFillColor(...NAVY)
  doc.roundedRect((pageW - boxW) / 2, y, boxW, boxH, 6, 6, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.setTextColor(...WHITE)
  doc.text(money(data.profit), pageW / 2, y + boxH / 2, { align: 'center', baseline: 'middle' })

  // Table 2 — cost side (one row per campaign + destination)
  const ct = data.campaign_totals
  const campBody: RowInput[] = data.campaigns.map((c, i) => {
    const cells: (string | CellDef)[] = [
      c.camp,
      c.destination,
      num(c.answered),
      num(c.missed),
      num(c.counted),
      money2(c.rate),
      money2(c.total_bill),
    ]
    if (i === 0) cells.unshift(dateCell(data.campaigns.length))
    return cells
  })
  if (campBody.length === 0) {
    campBody.push([dateCell(1), '—', '—', '—', '—', '—', '—'])
  }

  autoTable(doc, {
    startY: y + boxH + 18,
    theme: 'grid',
    head: [['DATE', 'CAMP', 'DESTINATION', 'ANSWERED', 'MISSED', 'COUNTED', 'RATE', 'TOTAL BILL']],
    body: campBody,
    foot: [[
      'TOTAL', String(ct.camps), String(ct.destinations), num(ct.answered),
      num(ct.missed), num(ct.counted), money(ct.rate), money(ct.total_bill),
    ]],
    styles: baseStyles,
    headStyles: { ...navyBand, halign: 'center' },
    footStyles: navyBand,
    columnStyles: { 0: dateColStyles },
    margin: { left: M, right: M },
  })

  return doc
}

// jspdf-autotable records the last table's end position on the doc.
function lastY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
}

// The same complete report as an .xlsx workbook (Summary + Revenue + Cost sheets).
function completeReportSheets(data: CompleteReport): XlsxSheet[] {
  const label = rangeText(data.from, data.to)
  const bt = data.buyer_totals
  const ct = data.campaign_totals
  return [
    {
      name: 'Summary',
      head: ['Metric', 'Value'],
      formats: ['text', 'currency'],
      rows: [
        ['Period', label],
        ['Revenue', data.revenue],
        ['Cost', data.cost],
        ['Profit', data.profit],
      ],
    },
    {
      name: 'Revenue (Destinations)',
      head: ['DATE', 'DESTINATION', 'ANSWERED', 'MISSED', 'COUNTED', 'RATE', 'TOTAL BILL'],
      formats: ['text', 'text', 'integer', 'integer', 'integer', 'currency', 'currency'],
      rows: data.buyers.map((b) => [label, b.code, b.answered, b.missed, b.counted, b.rate, b.total_bill]),
      foot: ['TOTAL', bt.destinations, bt.answered, bt.missed, bt.counted, bt.rate, bt.total_bill],
    },
    {
      name: 'Cost (Campaigns)',
      head: ['DATE', 'CAMP', 'DESTINATION', 'ANSWERED', 'MISSED', 'COUNTED', 'RATE', 'TOTAL BILL'],
      formats: ['text', 'text', 'text', 'integer', 'integer', 'integer', 'currency', 'currency'],
      rows: data.campaigns.map((c) => [label, c.camp, c.destination, c.answered, c.missed, c.counted, c.rate, c.total_bill]),
      foot: ['TOTAL', ct.camps, ct.destinations, ct.answered, ct.missed, ct.counted, ct.rate, ct.total_bill],
    },
  ]
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Reports() {
  const [range, setRange] = useState<Range>({ from: daysAgo(6), to: today() })
  const [pdfLoading, setPdfLoading] = useState<Record<string, boolean>>({})

  const summary      = useAsync(() => api.summary(range),                              [range.from, range.to])
  const topBuyers    = useAsync(() => api.topBuyers({ ...range, limit: 10 }),          [range.from, range.to])
  const topCampaigns = useAsync(() => api.topCampaigns({ ...range, limit: 10 }),       [range.from, range.to])
  const topSources   = useAsync(() => api.topSources({ ...range, limit: 10 }),         [range.from, range.to])
  const monthly      = useAsync(() => api.trends({ ...range, granularity: 'month' }),  [range.from, range.to])

  const s = summary.data
  const rangeLabel = `${range.from}  →  ${range.to}`

  function withPdfLoading(key: string, fn: () => Promise<void>) {
    return async () => {
      setPdfLoading((p) => ({ ...p, [key]: true }))
      try { await fn() } finally {
        setPdfLoading((p) => ({ ...p, [key]: false }))
      }
    }
  }

  // All downloads share one naming scheme: AHT_<Report>_<date or range>.<ext>
  const fileTag = fileDateRange(range.from, range.to)
  const recordsName = `AHT_Call_Records_${fileTag}`
  const buyerName = `AHT_Buyer_Performance_${fileTag}`
  const monthlyName = `AHT_Monthly_Breakdown_${fileTag}`

  const fetchRecords = () =>
    api.records({ from: range.from, to: range.to, per_page: 5000, page: 1 }).then((r) => r.data)

  const RECORDS_HEAD = ['Date', 'Type', 'Buyer', 'Campaign', 'Answered', 'Missed', 'Counted', 'Rate', 'Total Bill']
  const BUYER_HEAD = ['Buyer', 'Name', 'Answered', 'Missed', 'Counted', 'Revenue']
  const MONTHLY_HEAD = ['Month', 'Revenue', 'Running Fee', 'Profit', 'Counted', 'Answered', 'Missed']
  const monthlyRows = (): AnyRow[] =>
    (monthly.data ?? []).map((m) => [formatPeriod(m.period), m.revenue, m.cost, m.margin, m.counted, m.answered, m.missed])

  const downloadRecordsPdf = withPdfLoading('records', async () => {
    const records = await fetchRecords()
    const rows: AnyRow[] = records.map((r) => [
      r.record_date, r.record_type, r.buyer_code ?? '', r.campaign_code ?? '',
      r.answered, r.missed, r.counted, `$${r.rate.toFixed(2)}`, `$${r.total_bill.toFixed(2)}`,
    ])
    buildPdf('Call Records Export', rangeLabel, RECORDS_HEAD, rows).save(`${recordsName}.pdf`)
  })

  const downloadRecordsXlsx = withPdfLoading('records-xlsx', async () => {
    const records = await fetchRecords()
    saveXlsx(`${recordsName}.xlsx`, [{
      name: 'Call Records',
      head: RECORDS_HEAD,
      formats: ['text', 'text', 'text', 'text', 'integer', 'integer', 'integer', 'currency', 'currency'],
      rows: records.map((r) => [
        r.record_date, r.record_type, r.buyer_code ?? '', r.campaign_code ?? '',
        r.answered, r.missed, r.counted, r.rate, r.total_bill,
      ]),
    }])
  })

  const downloadBuyerPdf = withPdfLoading('buyers', async () => {
    const buyers = await api.topBuyers({ ...range, limit: 50 })
    const rows: AnyRow[] = buyers.map((b) => [b.code, b.name ?? '', b.answered, b.missed, b.counted, `$${b.revenue.toFixed(2)}`])
    buildPdf('Buyer Performance Report', rangeLabel, BUYER_HEAD, rows).save(`${buyerName}.pdf`)
  })

  const downloadBuyerXlsx = withPdfLoading('buyers-xlsx', async () => {
    const buyers = await api.topBuyers({ ...range, limit: 50 })
    saveXlsx(`${buyerName}.xlsx`, [{
      name: 'Buyer Performance',
      head: BUYER_HEAD,
      formats: ['text', 'text', 'integer', 'integer', 'integer', 'currency'],
      rows: buyers.map((b) => [b.code, b.name ?? '', b.answered, b.missed, b.counted, b.revenue]),
    }])
  })

  const downloadCompletePdf = withPdfLoading('complete', async () => {
    const data = await api.completeReport(range)
    buildCompleteReportPdf(data).save(`AHT_Report_${fileDateRange(data.from, data.to)}.pdf`)
  })

  const downloadCompleteXlsx = withPdfLoading('complete-xlsx', async () => {
    const data = await api.completeReport(range)
    saveXlsx(`AHT_Report_${fileDateRange(data.from, data.to)}.xlsx`, completeReportSheets(data))
  })

  const downloadMonthlyPdf = withPdfLoading('monthly', async () => {
    const rows: AnyRow[] = (monthly.data ?? []).map((m) => [
      formatPeriod(m.period), `$${m.revenue.toFixed(2)}`, `$${m.cost.toFixed(2)}`, `$${m.margin.toFixed(2)}`,
      m.counted, m.answered, m.missed,
    ])
    buildPdf('Monthly Breakdown', rangeLabel, MONTHLY_HEAD, rows).save(`${monthlyName}.pdf`)
  })

  const downloadMonthlyXlsx = withPdfLoading('monthly-xlsx', async () => {
    saveXlsx(`${monthlyName}.xlsx`, [{
      name: 'Monthly Breakdown',
      head: MONTHLY_HEAD,
      formats: ['text', 'currency', 'currency', 'currency', 'integer', 'integer', 'integer'],
      rows: monthlyRows(),
    }])
  })

  const downloadMonthlyCsv = () => saveCsv(`${monthlyName}.csv`, MONTHLY_HEAD, monthlyRows())

  return (
    <div>
      <PageHeader title="Reports" subtitle="Download data and review performance rankings">
        <DateRangeControl value={range} onChange={setRange} />
      </PageHeader>

      {/* Complete report — the full-system formatted export *}
      <Card className="mb-6 flex flex-col items-start gap-4 border-white/20 bg-linear-to-br from-slate-800 to-blue-900 p-5 text-white shadow-xl shadow-blue-900/25 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M16 13H8M16 17H8M10 9H8" />
            </svg>
          </span>
          <div>
            <h3 className="text-lg font-bold">Complete report</h3>
            <p className="mt-0.5 max-w-xl text-sm text-blue-100">
              The selected date range in one formatted PDF — revenue per destination, profit,
              and cost per campaign and destination, with grand totals.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={downloadCompleteXlsx} disabled={!!pdfLoading['complete-xlsx']}>
            {pdfLoading['complete-xlsx'] ? <Spinner className="h-4 w-4" /> : <ExcelIcon />}
            Excel
          </Button>
          <Button variant="secondary" onClick={downloadCompletePdf} disabled={!!pdfLoading['complete']}>
            {pdfLoading['complete'] ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
            )}
            PDF
          </Button>
        </div>
      </Card>

      {/* Download cards *}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DownloadCard
          title="Call records export"
          desc="Every call record in the selected range — dates, buyers, campaigns and billing."
          csvHref={api.recordsExportUrl({ from: range.from, to: range.to })}
          csvName={`${recordsName}.csv`}
          onXlsx={downloadRecordsXlsx}
          xlsxLoading={!!pdfLoading['records-xlsx']}
          onPdf={downloadRecordsPdf}
          pdfLoading={!!pdfLoading['records']}
        />
        <DownloadCard
          title="Buyer performance"
          desc="Per-buyer totals: answered, missed, counted and revenue, ranked by revenue."
          csvHref={api.reportUrl(range)}
          csvName={`${buyerName}.csv`}
          onXlsx={downloadBuyerXlsx}
          xlsxLoading={!!pdfLoading['buyers-xlsx']}
          onPdf={downloadBuyerPdf}
          pdfLoading={!!pdfLoading['buyers']}
        />
        <Card className="flex flex-col justify-center border-white/20 bg-linear-to-br from-blue-500 to-blue-700 p-5 text-white shadow-xl shadow-blue-600/25">
          <div className="text-sm text-blue-100">Profit this period</div>
          <div className="mt-1 text-3xl font-bold">{s ? money(s.margin) : '—'}</div>
          <div className="mt-1 text-sm text-blue-100">
            {s ? `${money(s.revenue)} revenue − ${money(s.cost)} running fee` : ''}
          </div>
        </Card>
      </div>

      {/* Monthly breakdown *}
      <Card className="mt-6">
        <CardHeader
          title="Monthly breakdown"
          subtitle="Revenue, running fee and profit by month"
          action={
            <div className="flex gap-2">
              <CsvButton onClick={downloadMonthlyCsv} />
              <XlsxButton onClick={downloadMonthlyXlsx} loading={!!pdfLoading['monthly-xlsx']} />
              <PdfButton onClick={downloadMonthlyPdf} loading={!!pdfLoading['monthly']} />
            </div>
          }
        />
        <Table
          loading={monthly.loading}
          empty={(monthly.data?.length ?? 0) === 0}
          head={['Month', 'Revenue', 'Running Fee', 'Profit', 'Counted', 'Answered', 'Missed']}
          rows={(monthly.data ?? []).map((m) => [
            formatPeriod(m.period),
            money(m.revenue),
            money(m.cost),
            <span key="margin" className={m.margin >= 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-red-500'}>{money(m.margin)}</span>,
            num(m.counted),
            num(m.answered),
            num(m.missed),
          ])}
          numericFrom={1}
        />
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Top buyers"
            subtitle="By revenue"
            action={
              <div className="flex gap-2">
                <DownloadButton href={api.reportUrl(range)} filename={`${buyerName}.csv`}>CSV</DownloadButton>
                <XlsxButton onClick={downloadBuyerXlsx} loading={!!pdfLoading['buyers-xlsx']} />
                <PdfButton onClick={downloadBuyerPdf} loading={!!pdfLoading['buyers']} />
              </div>
            }
          />
          <Table
            loading={topBuyers.loading}
            empty={(topBuyers.data?.length ?? 0) === 0}
            head={['Buyer', 'Revenue', 'Counted', 'Answered']}
            rows={(topBuyers.data ?? []).map((b) => [b.code, money(b.revenue), num(b.counted), num(b.answered)])}
            numericFrom={1}
          />
        </Card>

        <Card>
          <CardHeader title="Top campaigns" subtitle="By running fee" />
          <Table
            loading={topCampaigns.loading}
            empty={(topCampaigns.data?.length ?? 0) === 0}
            head={['Campaign', 'Running Fee', 'Counted', 'Answered']}
            rows={(topCampaigns.data ?? []).map((c) => [c.code, money(c.cost), num(c.counted), num(c.answered)])}
            numericFrom={1}
          />
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Top destinations" subtitle="Campaign spend by destination" />
        <Table
          loading={topSources.loading}
          empty={(topSources.data?.length ?? 0) === 0}
          head={['Destination', 'Running Fee', 'Counted', 'Avg. fee / call']}
          rows={(topSources.data ?? []).map((s) => [
            s.source,
            money(s.cost),
            num(s.counted),
            money2(s.counted > 0 ? s.cost / s.counted : 0),
          ])}
          numericFrom={1}
        />
      </Card>

      {summary.error && <p className="mt-4 text-sm text-red-600">{summary.error}</p>}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PdfButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <Button variant="secondary" onClick={onClick} disabled={loading}>
      {loading ? (
        <Spinner className="h-3.5 w-3.5" />
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M16 13H8M16 17H8M10 9H8" />
        </svg>
      )}
      PDF
    </Button>
  )
}

function ExcelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </svg>
  )
}

function XlsxButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <Button variant="secondary" onClick={onClick} disabled={loading}>
      {loading ? <Spinner className="h-3.5 w-3.5" /> : <ExcelIcon />}
      Excel
    </Button>
  )
}

function CsvButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="secondary" onClick={onClick}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
      </svg>
      CSV
    </Button>
  )
}

function DownloadCard({
  title,
  desc,
  csvHref,
  csvName,
  onXlsx,
  xlsxLoading,
  onPdf,
  pdfLoading,
}: {
  title: string
  desc: string
  csvHref: string
  csvName: string
  onXlsx: () => void
  xlsxLoading: boolean
  onPdf: () => void
  pdfLoading: boolean
}) {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
        </span>
        <h3 className="font-semibold text-slate-900">{title}</h3>
      </div>
      <p className="mt-2 flex-1 text-sm text-slate-500">{desc}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <DownloadButton href={csvHref} filename={csvName}>CSV</DownloadButton>
        <XlsxButton onClick={onXlsx} loading={xlsxLoading} />
        <PdfButton onClick={onPdf} loading={pdfLoading} />
      </div>
    </Card>
  )
}

function Table({
  head,
  rows,
  loading,
  empty,
  numericFrom = 99,
}: {
  head: string[]
  rows: React.ReactNode[][]
  loading: boolean
  empty: boolean
  numericFrom?: number
}) {
  if (loading) return <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
  if (empty) return <EmptyState message="No data for this period." />
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
            {head.map((h, i) => (
              <th key={h} className={i >= numericFrom ? 'px-4 py-3 text-right font-medium' : 'px-4 py-3 text-left font-medium'}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-slate-50 hover:bg-slate-50/60">
              {r.map((cell, ci) => (
                <td key={ci} className={ci >= numericFrom ? 'px-4 py-3 text-right tabular-nums text-slate-700' : 'px-4 py-3 font-medium text-slate-800'}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

============================================================================= */
