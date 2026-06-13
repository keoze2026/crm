import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { useState } from 'react'
import { api } from '../api/client'
import { DateRangeControl, DownloadButton, type Range } from '../components/DateRange'
import { PageHeader } from '../components/Layout'
import { Button, Card, CardHeader, EmptyState, Spinner } from '../components/ui'
import { daysAgo, formatPeriod, money, money2, num, today } from '../lib/format'
import { useAsync } from '../lib/useAsync'

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
  doc.setFontSize(18)
  doc.setTextColor(30, 64, 175)
  doc.setFont('helvetica', 'bold')
  doc.text('CallFlow CRM', 40, 44)

  doc.setFontSize(13)
  doc.setTextColor(15, 23, 42)
  doc.text(title, 40, 64)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 116, 139)
  doc.text(subtitle, 40, 80)
  doc.text(`Generated ${new Date().toLocaleString()}`, pageW - 40, 80, { align: 'right' })

  autoTable(doc, {
    startY: 96,
    head: [columns],
    body: rows.map((r) => r.map(String)),
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: {
      fillColor: [30, 64, 175],
      textColor: 255,
      fontStyle: 'bold',
      halign: 'left',
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: Object.fromEntries(
      columns.slice(1).map((_, i) => [i + 1, { halign: 'right' }])
    ),
    margin: { left: 40, right: 40 },
  })

  return doc
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Reports() {
  const [range, setRange] = useState<Range>({ from: daysAgo(89), to: today() })
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

  const downloadRecordsPdf = withPdfLoading('records', async () => {
    const result = await api.records({ from: range.from, to: range.to, per_page: 5000, page: 1 })
    const rows: AnyRow[] = result.data.map((r) => [
      r.record_date,
      r.record_type,
      r.buyer_code ?? '',
      r.campaign_code ?? '',
      r.source ?? '',
      r.answered,
      r.missed,
      r.counted,
      `$${r.rate.toFixed(2)}`,
      `$${r.total_bill.toFixed(2)}`,
    ])
    buildPdf(
      'Call Records Export',
      rangeLabel,
      ['Date', 'Type', 'Buyer', 'Campaign', 'Source', 'Answered', 'Missed', 'Counted', 'Rate', 'Total Bill'],
      rows,
    ).save('call-records.pdf')
  })

  const downloadBuyerPdf = withPdfLoading('buyers', async () => {
    const buyers = await api.topBuyers({ ...range, limit: 50 })
    const rows: AnyRow[] = buyers.map((b) => [
      b.code,
      b.name ?? '',
      b.answered,
      b.missed,
      b.counted,
      `$${b.revenue.toFixed(2)}`,
    ])
    buildPdf(
      'Buyer Performance Report',
      rangeLabel,
      ['Buyer', 'Name', 'Answered', 'Missed', 'Counted', 'Revenue'],
      rows,
    ).save('buyer-performance.pdf')
  })

  const downloadMonthlyPdf = withPdfLoading('monthly', async () => {
    const months = monthly.data ?? []
    const rows: AnyRow[] = months.map((m) => [
      formatPeriod(m.period),
      `$${m.revenue.toFixed(2)}`,
      `$${m.cost.toFixed(2)}`,
      `$${m.margin.toFixed(2)}`,
      m.counted,
      m.answered,
      m.missed,
    ])
    buildPdf(
      'Monthly Breakdown',
      rangeLabel,
      ['Month', 'Revenue', 'Running Fee', 'Profit', 'Counted', 'Answered', 'Missed'],
      rows,
    ).save('monthly-breakdown.pdf')
  })

  return (
    <div>
      <PageHeader title="Reports" subtitle="Download data and review performance rankings">
        <DateRangeControl value={range} onChange={setRange} />
      </PageHeader>

      {/* Download cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DownloadCard
          title="Call records export"
          desc="Every call record in the selected range — dates, buyers, campaigns, sources and billing."
          csvHref={api.recordsExportUrl({ from: range.from, to: range.to })}
          onPdf={downloadRecordsPdf}
          pdfLoading={!!pdfLoading['records']}
        />
        <DownloadCard
          title="Buyer performance"
          desc="Per-buyer totals: answered, missed, counted and revenue, ranked by revenue."
          csvHref={api.reportUrl(range)}
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

      {/* Monthly breakdown */}
      <Card className="mt-6">
        <CardHeader
          title="Monthly breakdown"
          subtitle="Revenue, running fee and profit by month"
          action={
            <div className="flex gap-2">
              <DownloadButton href={api.reportUrl(range)}>CSV</DownloadButton>
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
                <DownloadButton href={api.reportUrl(range)}>CSV</DownloadButton>
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
        <CardHeader title="Top traffic sources" subtitle="Campaign spend by source" />
        <Table
          loading={topSources.loading}
          empty={(topSources.data?.length ?? 0) === 0}
          head={['Source', 'Running Fee', 'Counted', 'Avg. fee / call']}
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

function DownloadCard({
  title,
  desc,
  csvHref,
  onPdf,
  pdfLoading,
}: {
  title: string
  desc: string
  csvHref: string
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
      <div className="mt-4 flex gap-2">
        <DownloadButton href={csvHref}>CSV</DownloadButton>
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