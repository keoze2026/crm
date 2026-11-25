import { jsPDF } from 'jspdf'
import autoTable, { type RowInput, type Styles } from 'jspdf-autotable'
import type { BillingRow, BillingTotals } from './dailyBilling'
import { money2, num } from './format'

/**
 * The AHT Daily Billing sheet as a printed page — the three figures, the two tables with
 * their TOTAL bands, and the Final Profit line — in the same light report theme as the
 * app's other PDFs (navy head, cyan body, white gridlines).
 */

export interface DailyBillingPdfInput {
  dateLabel: string
  client: BillingRow[]
  clientTotals: BillingTotals
  clients: number
  /** Null when the viewer may not see the cost side; the page then prints billing only. */
  traffic: BillingRow[] | null
  trafficTotals: BillingTotals
  camps: number
  sources: number
  profit: number
  margin: number | null
}

const NAVY: [number, number, number] = [26, 54, 84]
const CYAN: [number, number, number] = [212, 233, 242]
const INK: [number, number, number] = [15, 23, 42]
const WHITE: [number, number, number] = [255, 255, 255]
const MUTED: [number, number, number] = [100, 116, 139]
const BLUE_TILE: [number, number, number] = [232, 240, 254]
const BLUE: [number, number, number] = [30, 64, 175]
const ROSE_TILE: [number, number, number] = [254, 236, 234]
const RED: [number, number, number] = [185, 28, 28]
const GREEN_TILE: [number, number, number] = [231, 247, 239]
const GREEN: [number, number, number] = [4, 120, 87]
const M = 36

const baseStyles: Partial<Styles> = {
  fontSize: 8, cellPadding: 3.5, lineColor: WHITE, lineWidth: 0.8, textColor: INK, valign: 'middle',
}
const navyHead: Partial<Styles> = {
  fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', halign: 'center', lineColor: NAVY, lineWidth: 0.8, fontSize: 7,
}
const right = { halign: 'right' as const }

function tile(doc: jsPDF, x: number, y: number, w: number, h: number, fill: [number, number, number], ink: [number, number, number], label: string, value: string, sub: string) {
  doc.setFillColor(...fill)
  doc.roundedRect(x, y, w, h, 4, 4, 'F')
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...MUTED)
  doc.text(label.toUpperCase(), x + 9, y + 13)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...ink)
  doc.text(value, x + 9, y + 31)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...MUTED)
  doc.text(sub, x + 9, y + 42)
}

/** The navy TOTAL band; `leftCells` says how many leading cells are labels, not figures. */
function totalBand(cells: (string | number)[], leftCells = 1): RowInput {
  return cells.map((c, i) => ({
    content: String(c),
    styles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', halign: i < leftCells ? 'left' : 'right' },
  }))
}

function sectionTitle(doc: jsPDF, y: number, title: string, note: string): number {
  const pageW = doc.internal.pageSize.getWidth()
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...INK)
  doc.text(title, M, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED)
  doc.text(note, pageW - M, y, { align: 'right' })
  return y + 6
}

export function buildDailyBillingPdf(input: DailyBillingPdfInput): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const showCost = input.traffic !== null

  // Title line
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...NAVY)
  doc.text('AHT Daily Billing', M, 44)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
  doc.text('Client billing vs traffic source cost', M, 58)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...INK)
  doc.text(input.dateLabel, pageW - M, 44, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
  doc.text('Final profit report', pageW - M, 58, { align: 'right' })
  doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.6)
  doc.line(M, 66, pageW - M, 66)

  // The three figures
  let y = 78
  const gap = 10
  const tiles = showCost ? 3 : 1
  const w = showCost ? (pageW - 2 * M - gap * 2) / 3 : 180
  const ct = input.clientTotals
  const tt = input.trafficTotals
  tile(doc, M, y, w, 52, BLUE_TILE, BLUE, 'Client Billing', money2(ct.totalBill),
    `${num(ct.finalCount)} final count · ${num(ct.replaced)} replaced`)
  if (showCost) {
    tile(doc, M + w + gap, y, w, 52, ROSE_TILE, RED, 'Traffic Source Cost', money2(tt.totalBill),
      `${num(tt.finalCount)} final count · ${num(tt.replaced)} replaced`)
    tile(doc, M + 2 * (w + gap), y, w, 52, input.profit >= 0 ? GREEN_TILE : ROSE_TILE, input.profit >= 0 ? GREEN : RED,
      'Final Profit', money2(input.profit), input.margin === null ? 'no client billing' : `${input.margin}% margin`)
  }
  y += 52 + 18
  void tiles

  // Client Billing
  y = sectionTitle(doc, y, 'Client Billing', `${num(input.clients)} ${input.clients === 1 ? 'client' : 'clients'} · price high to low`)
  const clientBody: RowInput[] = input.client.map((r) => [
    r.code, money2(r.rate), num(r.answered), num(r.missed), num(r.replaced), num(r.finalCount), money2(r.totalBill),
  ])
  clientBody.push(totalBand(['TOTAL', money2(ct.avgRate), num(ct.answered), num(ct.missed), num(ct.replaced), num(ct.finalCount), money2(ct.totalBill)]))
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    head: [['Destination', 'Rate', 'Answered', 'Missed', 'Replaced', 'Final Count', 'Total Bill']],
    body: clientBody,
    styles: baseStyles,
    headStyles: navyHead,
    bodyStyles: { fillColor: CYAN },
    columnStyles: { 0: { fontStyle: 'bold' }, 1: right, 2: right, 3: right, 4: right, 5: { ...right, fontStyle: 'bold' }, 6: { ...right, fontStyle: 'bold' } },
    margin: { left: M, right: M },
  })
  y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 20

  // Traffic Source Cost
  if (showCost && input.traffic) {
    if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 44 }
    y = sectionTitle(doc, y, 'Traffic Source Cost',
      `${num(input.camps)} ${input.camps === 1 ? 'camp' : 'camps'} · ${num(input.sources)} ${input.sources === 1 ? 'source' : 'sources'} · price high to low`)
    const trafficBody: RowInput[] = input.traffic.map((r) => [
      r.code, r.source, money2(r.rate), num(r.answered), num(r.missed), num(r.replaced), num(r.finalCount), money2(r.totalBill),
    ])
    trafficBody.push(totalBand([
      'TOTAL', `${num(input.sources)} ${input.sources === 1 ? 'source' : 'sources'}`, money2(tt.avgRate),
      num(tt.answered), num(tt.missed), num(tt.replaced), num(tt.finalCount), money2(tt.totalBill),
    ], 2))
    autoTable(doc, {
      startY: y,
      theme: 'grid',
      head: [['Camp', 'Source', 'Rate', 'Answered', 'Missed', 'Replaced', 'Final Count', 'Total Bill']],
      body: trafficBody,
      styles: baseStyles,
      headStyles: navyHead,
      bodyStyles: { fillColor: CYAN },
      columnStyles: { 0: { fontStyle: 'bold' }, 2: right, 3: right, 4: right, 5: right, 6: { ...right, fontStyle: 'bold' }, 7: { ...right, fontStyle: 'bold' } },
      margin: { left: M, right: M },
    })
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 18

    // Final Profit band
    if (y > doc.internal.pageSize.getHeight() - 70) { doc.addPage(); y = 44 }
    const ok = input.profit >= 0
    doc.setFillColor(...(ok ? GREEN_TILE : ROSE_TILE))
    doc.roundedRect(M, y, pageW - 2 * M, 36, 4, 4, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...(ok ? GREEN : RED))
    doc.text('FINAL PROFIT', M + 12, y + 22)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
    const big = money2(input.profit)
    const bigW = doc.getTextWidth(big)
    doc.text(big, pageW - M - 12, y + 24, { align: 'right' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
    doc.text(`${money2(ct.totalBill)}  −  ${money2(tt.totalBill)}  =`, pageW - M - 12 - bigW - 10, y + 22, { align: 'right' })
    y += 36 + 14
  }

  // Formula footnote
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...MUTED)
  const note = showCost
    ? 'Final Count: Client = Answered + Missed − Replaced  ·  Traffic = Answered − Replaced  ·  Total Bill = Final Count × Rate  ·  Final Profit = Client Billing − Traffic Source Cost'
    : 'Final Count: Client = Answered + Missed − Replaced  ·  Total Bill = Final Count × Rate'
  doc.text(note, M, Math.min(y, doc.internal.pageSize.getHeight() - 30))
  return doc
}
