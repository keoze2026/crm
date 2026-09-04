import { jsPDF } from 'jspdf'
import autoTable, { type RowInput, type Styles } from 'jspdf-autotable'
import type { QueueAssignment, ReviewDepartment, ReviewEntry } from '../types'

/**
 * PDF exports for the Queues sheet and the Review tabs — the tables as filled in, and
 * nothing else: no entry rows, no empty department bands, none of the page's controls.
 *
 * Styling follows the other reports in the app (navy head, cyan body, white gridlines),
 * so a printed Queues sheet sits next to a printed Attendance report without looking like
 * it came from a different system.
 */

const NAVY: [number, number, number] = [26, 54, 84]
const CYAN: [number, number, number] = [212, 233, 242]
const BAND: [number, number, number] = [191, 222, 235]
const INK: [number, number, number] = [15, 23, 42]
const WHITE: [number, number, number] = [255, 255, 255]
const MUTED: [number, number, number] = [100, 116, 139]
const M = 40

const baseStyles: Partial<Styles> = {
  fontSize: 9, cellPadding: 5, lineColor: WHITE, lineWidth: 1, textColor: INK, valign: 'middle',
}
const navyHead: Partial<Styles> = {
  fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', halign: 'center', lineColor: NAVY, lineWidth: 1,
}

/** Title + generated stamp; returns the y content starts at. */
function drawHeader(doc: jsPDF, title: string, subtitle: string): number {
  const pageW = doc.internal.pageSize.getWidth()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...NAVY)
  doc.text(title, M, 46)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  if (subtitle !== '') doc.text(subtitle, M, 62)
  doc.text(`Generated ${new Date().toLocaleString()}`, pageW - M, 62, { align: 'right' })
  return 78
}

/** A full-width navy band naming the department a run of rows belongs to. */
function bandRow(name: string, columns: number): RowInput {
  return [{
    content: name,
    colSpan: columns,
    styles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', halign: 'left' },
  }]
}

// ─── Queues ───────────────────────────────────────────────────────────────────

/**
 * The Queues sheet: one row per person, their codes as the comma-separated list the
 * client's own spreadsheet uses, and the navy TOTAL row underneath.
 */
export function buildQueuesPdf(rows: QueueAssignment[]): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const total = rows.reduce((s, r) => s + r.codes.length, 0)
  const y = drawHeader(doc, 'QUEUES', `${rows.length} ${rows.length === 1 ? 'person' : 'people'} · ${total} queues assigned`)

  const body: RowInput[] = rows.map((r, i) => [
    String(i + 1),
    r.name,
    r.codes.map((c) => c.code).join(', '),
    String(r.codes.length),
  ])
  body.push([
    { content: 'TOTAL', colSpan: 3, styles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', halign: 'left' } },
    { content: String(total), styles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', halign: 'center' } },
  ])

  autoTable(doc, {
    startY: y,
    theme: 'grid',
    head: [['SR NO.', 'NAME', 'QUEUES', 'TOTAL']],
    body,
    styles: baseStyles,
    headStyles: navyHead,
    bodyStyles: { fillColor: CYAN },
    columnStyles: {
      0: { halign: 'center', cellWidth: 44, fillColor: BAND, fontStyle: 'bold' },
      1: { cellWidth: 150, fontStyle: 'bold' },
      2: { halign: 'left' },
      3: { halign: 'center', cellWidth: 48, fontStyle: 'bold' },
    },
    margin: { left: M, right: M },
  })
  return doc
}

// ─── Review ───────────────────────────────────────────────────────────────────

/** Group entries under their department, keeping the page's order and dropping empty bands. */
function grouped(entries: ReviewEntry[], departments: ReviewDepartment[]) {
  const groups = departments.map((d) => ({ name: d.name, rows: entries.filter((e) => e.department_id === d.id) }))
  const orphans = entries.filter((e) => e.department_id === null)
  if (orphans.length > 0) groups.push({ name: 'No department', rows: orphans })
  return groups.filter((g) => g.rows.length > 0)
}

/** Performance: rating and score per person, with the Notes column only when notes exist. */
export function buildPerformancePdf(entries: ReviewEntry[], departments: ReviewDepartment[]): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const withNotes = entries.some((e) => e.notes.trim() !== '')
  const head = ['SR', 'NAME', 'DEPARTMENT', 'PERFOMANCE', 'PERCENTAGE', ...(withNotes ? ['NOTES'] : [])]
  const y = drawHeader(doc, 'PERFORMANCE REVIEW', `${entries.length} ${entries.length === 1 ? 'person' : 'people'} reviewed`)

  const body: RowInput[] = []
  let sr = 0
  for (const group of grouped(entries, departments)) {
    body.push(bandRow(group.name, head.length))
    for (const e of group.rows) {
      sr += 1
      body.push([
        String(sr),
        e.person_name,
        e.department_note,
        e.rating,
        e.percentage === null ? '' : `${e.percentage}%`,
        ...(withNotes ? [e.notes] : []),
      ])
    }
  }

  autoTable(doc, {
    startY: y,
    theme: 'grid',
    head: [head],
    body,
    styles: baseStyles,
    headStyles: navyHead,
    bodyStyles: { fillColor: CYAN },
    // Only the narrow columns are pinned; NAME, DEPARTMENT (and NOTES when shown) size
    // themselves. At least one flexible column is required, or autoTable can't fill the
    // page width and warns that the content doesn't fit.
    columnStyles: {
      0: { halign: 'center', cellWidth: 34, fillColor: BAND, fontStyle: 'bold' },
      1: { fontStyle: 'bold' },
      3: { halign: 'center', cellWidth: 90 },
      4: { halign: 'center', cellWidth: 76 },
    },
    margin: { left: M, right: M },
  })
  return doc
}

/** Behaviour: the month stamped once on the first row, exactly as the sheet shows it. */
export function buildBehaviourPdf(
  entries: ReviewEntry[], departments: ReviewDepartment[], monthLabel: string,
): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const y = drawHeader(doc, 'BEHAVIOUR ANALYSIS', monthLabel)

  const body: RowInput[] = []
  let sr = 0
  for (const group of grouped(entries, departments)) {
    body.push(bandRow(group.name, 5))
    for (const e of group.rows) {
      sr += 1
      body.push([
        String(sr),
        sr === 1 ? monthLabel.toUpperCase() : '',
        e.person_name,
        e.department_note,
        e.rating,
      ])
    }
  }

  autoTable(doc, {
    startY: y,
    theme: 'grid',
    head: [['SR.NO', 'MONTH', 'NAME', 'DEPARTMENT', 'BEHAVIOUR ANALYSIS']],
    body,
    styles: baseStyles,
    headStyles: navyHead,
    bodyStyles: { fillColor: CYAN },
    columnStyles: {
      0: { halign: 'center', cellWidth: 40, fillColor: BAND, fontStyle: 'bold' },
      1: { halign: 'center', cellWidth: 70, fontStyle: 'bold' },
      2: { cellWidth: 150, fontStyle: 'bold' },
      3: { cellWidth: 110 },
      4: { halign: 'left' },
    },
    margin: { left: M, right: M },
  })
  return doc
}

/** The department scorecard — the whole tab is data, so every row goes in. */
export function buildDepartmentsPdf(departments: ReviewDepartment[]): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const y = drawHeader(doc, 'DEPARTMENT REVIEW', `${departments.length} departments`)

  autoTable(doc, {
    startY: y,
    theme: 'grid',
    head: [['SR. NO', 'DEPARTMENT', 'PERFOMANCE', '%']],
    body: departments.map((d, i) => [
      String(i + 1),
      d.name,
      d.performance,
      d.percentage === null ? '' : `${d.percentage}%`,
    ]),
    styles: baseStyles,
    headStyles: navyHead,
    bodyStyles: { fillColor: CYAN },
    columnStyles: {
      0: { halign: 'center', cellWidth: 56, fillColor: BAND, fontStyle: 'bold' },
      1: { fontStyle: 'bold' },
      2: { halign: 'center', cellWidth: 110 },
      3: { halign: 'center', cellWidth: 60 },
    },
    margin: { left: M, right: M },
  })
  return doc
}
