/**
 * Overall staff reporting for the Attendance page.
 *
 * Aggregates the per-day rows from `/attendance/days` into per-member
 * statistics — worked hours, break time and **break time taken over the
 * 60-minute daily allowance** ("break-time exceeding allowance",
 * `over_break_min` summed across the range) — and renders them as
 * company-styled PDFs (and matching .xlsx sheets).
 *
 * Pure data + document builders; no React. The page owns fetching and layout.
 */

import { jsPDF } from 'jspdf'
import autoTable, { type RowInput, type Styles } from 'jspdf-autotable'
import type { AttendanceDay } from '../types'
import type { XlsxSheet } from './xlsx'
import { formatDmy } from './format'

const TZ = 'America/New_York'
export const BREAK_ALLOWANCE_MIN = 60

// Company report palette (matches the Reports page exports).
const NAVY: [number, number, number] = [26, 54, 84]
const CYAN: [number, number, number] = [212, 233, 242]
const INK: [number, number, number] = [15, 23, 42]
const WHITE: [number, number, number] = [255, 255, 255]
const RED: [number, number, number] = [185, 28, 28]
const MUTED: [number, number, number] = [100, 116, 139]

// ─── Aggregation ────────────────────────────────────────────────────────────────

export interface BreakStat {
  user_id: string
  staff_name: string | null
  username: string | null
  daysPresent: number       // days logged in (has a login)
  daysWithBreak: number     // days at least one break was taken
  totalHours: number        // worked hours summed over completed days
  totalBreakMin: number     // all break minutes in the range
  totalOverMin: number      // minutes beyond the daily allowance, summed
  overDays: number          // days that exceeded the allowance
  avgBreakMin: number       // mean break minutes per logged-in day
  worstOverMin: number      // single worst day's overage
  rows: AttendanceDay[]     // day rows, ascending by date
}

/** Display label: name → @handle → user id. */
export const labelOf = (s: { staff_name: string | null; username: string | null; user_id: string }): string =>
  s.staff_name || (s.username ? `@${s.username}` : s.user_id)

/** Minutes → "Xh Ym" / "Ym" / "0m". The break-overage unit. */
export function fmtHm(min: number | null | undefined): string {
  const total = Math.round(Number(min) || 0)
  if (total <= 0) return '0m'
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/** Decimal worked-hours cell, e.g. "12.7h"; em-dash when unknown (no logout). */
export function hoursCell(h: number | null | undefined): string {
  return h == null ? '—' : `${Number(h).toFixed(1)}h`
}

/**
 * Group day rows by member and roll up worked-hours / break / overage totals,
 * worst break-overage first. `onlineIds` marks who is currently checked in.
 */
export function aggregateBreaks(rows: AttendanceDay[]): BreakStat[] {
  const byUser = new Map<string, AttendanceDay[]>()
  for (const r of rows) {
    const arr = byUser.get(r.user_id) ?? []
    arr.push(r)
    byUser.set(r.user_id, arr)
  }

  const out: BreakStat[] = []
  for (const [id, userRows] of byUser) {
    const sorted = userRows.slice().sort((a, b) => (a.work_date < b.work_date ? -1 : 1))
    const present = sorted.filter((r) => r.login_at != null)
    const totalHours = sorted.reduce((s, r) => s + (r.hours ?? 0), 0)
    const totalBreakMin = sorted.reduce((s, r) => s + (r.break_min ?? 0), 0)
    const totalOverMin = sorted.reduce((s, r) => s + (r.over_break_min ?? 0), 0)
    out.push({
      user_id: id,
      staff_name: sorted[0]?.staff_name ?? null,
      username: sorted[0]?.username ?? null,
      daysPresent: present.length,
      daysWithBreak: sorted.filter((r) => (r.break_min ?? 0) > 0).length,
      totalHours,
      totalBreakMin,
      totalOverMin,
      overDays: sorted.filter((r) => (r.over_break_min ?? 0) > 0).length,
      avgBreakMin: present.length ? totalBreakMin / present.length : 0,
      worstOverMin: sorted.reduce((m, r) => Math.max(m, r.over_break_min ?? 0), 0),
      rows: sorted,
    })
  }

  // Worst break-overage first; ties broken alphabetically.
  return out.sort((a, b) => b.totalOverMin - a.totalOverMin || (labelOf(a) > labelOf(b) ? 1 : -1))
}

// ─── Shared PDF pieces ───────────────────────────────────────────────────────────

const M = 40
const REPORT_TITLE = 'OVERALL STAFF REPORT'

const baseStyles: Partial<Styles> = {
  fontSize: 9, cellPadding: 5, lineColor: WHITE, lineWidth: 1, textColor: INK, valign: 'middle',
}
const navyHead: Partial<Styles> = {
  fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', halign: 'center', lineColor: NAVY, lineWidth: 1,
}

/** Time-of-day in the org timezone, e.g. "8:48 AM". */
function fmtClockEST(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date(iso))
}

/** Human period label: single day or "from – to". */
export function periodLabel(from: string, to: string): string {
  return from === to ? formatDmy(from) : `${formatDmy(from)}  –  ${formatDmy(to)}`
}

/** jspdf-autotable records the last table's end position on the doc. */
function lastY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
}

/** Title / subtitle / period block shared by every report. Returns the y to start content. */
function drawHeader(doc: jsPDF, subtitle: string, from: string, to: string): number {
  const pageW = doc.internal.pageSize.getWidth()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...NAVY)
  doc.text(REPORT_TITLE, M, 46)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  doc.text(subtitle, M, 62)
  doc.text(`Period: ${periodLabel(from, to)}`, M, 76)
  doc.text(`Generated ${new Date().toLocaleString()}`, pageW - M, 62, { align: 'right' })
  return 92
}

// ─── Team report ─────────────────────────────────────────────────────────────────

/** One page: every member as a row, ranked by break-time exceeding the allowance. */
export function buildTeamBreakPdf(stats: BreakStat[], from: string, to: string): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const y = drawHeader(doc, `Worked hours and break time over the ${BREAK_ALLOWANCE_MIN}-minute daily allowance`, from, to)

  const totalOver = stats.reduce((s, x) => s + x.totalOverMin, 0)
  const totalBreak = stats.reduce((s, x) => s + x.totalBreakMin, 0)
  const totalHours = stats.reduce((s, x) => s + x.totalHours, 0)
  const totalDays = stats.reduce((s, x) => s + x.daysPresent, 0)
  const overMembers = stats.filter((x) => x.totalOverMin > 0).length

  doc.setFontSize(9)
  doc.setTextColor(...INK)
  doc.text(
    `Worked hours ${hoursCell(totalHours)}   ·   Exceeding allowance ${fmtHm(totalOver)}   ·   ` +
      `Members exceeding ${overMembers}/${stats.length}`,
    M, y + 4,
  )

  const body: RowInput[] = stats.map((s) => [
    labelOf(s),
    String(s.daysPresent),
    fmtHm(s.totalBreakMin),
    fmtHm(s.totalOverMin),
    hoursCell(s.totalHours),
  ])
  if (body.length === 0) body.push(['No members active in this period', '0', '0m', '0m', '0.0h'])
  body.push(['TEAM TOTAL', String(totalDays), fmtHm(totalBreak), fmtHm(totalOver), hoursCell(totalHours)])
  const totalIdx = body.length - 1

  autoTable(doc, {
    startY: y + 16,
    theme: 'grid',
    head: [['STAFF', 'DAYS LOGGED IN', 'BREAK USED', 'BREAK-TIME\nEXCEEDING\nALLOWANCE', 'WORKED HOURS']],
    body,
    styles: baseStyles,
    headStyles: navyHead,
    bodyStyles: { fillColor: CYAN },
    columnStyles: {
      0: { halign: 'left' }, 1: { halign: 'center' }, 2: { halign: 'right' },
      3: { halign: 'right' }, 4: { halign: 'right' },
    },
    margin: { left: M, right: M },
    didParseCell: (d) => {
      if (d.section !== 'body') return
      if (d.row.index === totalIdx) {
        d.cell.styles.fillColor = NAVY
        d.cell.styles.textColor = WHITE
        d.cell.styles.fontStyle = 'bold'
        return
      }
      const stat = stats[d.row.index]
      if (!stat) return
      if (d.column.index === 3 && stat.totalOverMin > 0) {
        d.cell.styles.textColor = RED
        d.cell.styles.fontStyle = 'bold'
      }
    },
  })

  return doc
}

// ─── Per-member report ───────────────────────────────────────────────────────────

/** Renders one member's heading + day-by-day table at `startY`. */
function renderUserSection(doc: jsPDF, stat: BreakStat, startY: number): void {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...NAVY)
  doc.text(labelOf(stat), M, startY)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...MUTED)
  doc.text(
    `Days logged in ${stat.daysPresent}     Worked hours ${hoursCell(stat.totalHours)}` +
      `     Total break ${fmtHm(stat.totalBreakMin)}` +
      `     Break-time exceeding allowance ${fmtHm(stat.totalOverMin)} on ${stat.overDays} day${stat.overDays === 1 ? '' : 's'}`,
    M, startY + 14,
  )

  const body: RowInput[] = stat.rows.map((r) => [
    formatDmy(r.work_date),
    fmtClockEST(r.login_at),
    fmtClockEST(r.logout_at),
    hoursCell(r.hours),
    `${r.break_min ?? 0}m`,
    `${BREAK_ALLOWANCE_MIN}m`,
    fmtHm(r.over_break_min ?? 0),
  ])
  if (body.length === 0) body.push(['—', '—', '—', '—', '0m', `${BREAK_ALLOWANCE_MIN}m`, '0m'])
  body.push(['TOTAL', '', '', hoursCell(stat.totalHours), `${stat.totalBreakMin}m`, '', fmtHm(stat.totalOverMin)])
  const totalIdx = body.length - 1

  autoTable(doc, {
    startY: startY + 22,
    theme: 'grid',
    head: [['DATE', 'LOGIN', 'LOGOUT', 'WORKED HOURS', 'BREAK', 'ALLOWANCE', 'EXCEEDING\nALLOWANCE']],
    body,
    styles: { ...baseStyles, fontSize: 8, cellPadding: 4 },
    headStyles: navyHead,
    bodyStyles: { fillColor: CYAN },
    columnStyles: {
      0: { halign: 'left' }, 1: { halign: 'center' }, 2: { halign: 'center' },
      3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'center' }, 6: { halign: 'right' },
    },
    margin: { left: M, right: M },
    didParseCell: (d) => {
      if (d.section !== 'body') return
      if (d.row.index === totalIdx) {
        d.cell.styles.fillColor = NAVY
        d.cell.styles.textColor = WHITE
        d.cell.styles.fontStyle = 'bold'
      } else if (d.column.index === 6 && (stat.rows[d.row.index]?.over_break_min ?? 0) > 0) {
        d.cell.styles.textColor = RED
        d.cell.styles.fontStyle = 'bold'
      }
    },
  })
}

/** Single member, day-by-day. */
export function buildUserBreakPdf(stat: BreakStat, from: string, to: string): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const y = drawHeader(doc, `Individual report — ${labelOf(stat)}`, from, to)
  renderUserSection(doc, stat, y + 8)
  return doc
}

/** Every member, each with their own day-by-day section (flows across pages). */
export function buildAllUsersBreakPdf(stats: BreakStat[], from: string, to: string): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageH = doc.internal.pageSize.getHeight()
  let y = drawHeader(doc, 'Per-member breakdown for every active member', from, to) + 8

  if (stats.length === 0) {
    doc.setFontSize(10)
    doc.setTextColor(...MUTED)
    doc.text('No members were active in this period.', M, y + 10)
    return doc
  }

  stats.forEach((stat, i) => {
    // Avoid orphaning a member's heading at the foot of a page; long tables
    // paginate themselves inside autoTable.
    if (i > 0 && y > pageH - 140) {
      doc.addPage()
      y = 56
    }
    renderUserSection(doc, stat, y)
    y = lastY(doc) + 28
  })

  return doc
}

// ─── Excel parity ────────────────────────────────────────────────────────────────

const round1 = (n: number): number => Math.round(n * 10) / 10

/** Team report as a single .xlsx sheet with a TOTAL footer. */
export function teamBreakSheet(stats: BreakStat[]): XlsxSheet {
  return {
    name: 'Overall Staff Report',
    head: ['Staff', 'Username', 'Days logged in', 'Break used (min)', 'Break-time exceeding allowance (min)', 'Worked hours'],
    formats: ['text', 'text', 'integer', 'integer', 'integer', 'number'],
    rows: stats.map((s) => [
      s.staff_name ?? '',
      s.username ? `@${s.username}` : '',
      s.daysPresent,
      s.totalBreakMin,
      s.totalOverMin,
      round1(s.totalHours),
    ]),
    foot: [
      'TOTAL', '',
      stats.reduce((s, x) => s + x.daysPresent, 0),
      stats.reduce((s, x) => s + x.totalBreakMin, 0),
      stats.reduce((s, x) => s + x.totalOverMin, 0),
      round1(stats.reduce((s, x) => s + x.totalHours, 0)),
    ],
  }
}

/** One member's day-by-day breakdown as an .xlsx sheet. */
export function userBreakSheet(stat: BreakStat): XlsxSheet {
  return {
    name: 'Overall Staff Report',
    head: ['Date', 'Login', 'Logout', 'Worked hours', 'Break (min)', 'Allowance (min)', 'Break-time exceeding allowance (min)'],
    formats: ['text', 'text', 'text', 'number', 'integer', 'integer', 'integer'],
    rows: stat.rows.map((r) => [
      r.work_date,
      fmtClockEST(r.login_at),
      fmtClockEST(r.logout_at),
      r.hours == null ? '' : round1(r.hours),
      r.break_min ?? 0,
      BREAK_ALLOWANCE_MIN,
      r.over_break_min ?? 0,
    ]),
    foot: ['TOTAL', '', '', round1(stat.totalHours), stat.totalBreakMin, '', stat.totalOverMin],
  }
}
