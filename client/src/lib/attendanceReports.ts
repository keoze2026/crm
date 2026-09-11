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

/**
 * The flat late threshold — 9:00 AM EST — used only for someone whose expected hours have
 * not been set on the Staff page. It is the same fallback the Attendance roster marks its
 * clock cells with, so a report and the screen it was exported from never disagree about
 * who was late.
 */
export const TARGET_LOGIN_MIN = 9 * 60

// Company report palette (matches the Reports page exports).
const NAVY: [number, number, number] = [26, 54, 84]
const CYAN: [number, number, number] = [212, 233, 242]
const INK: [number, number, number] = [15, 23, 42]
const WHITE: [number, number, number] = [255, 255, 255]
const RED: [number, number, number] = [185, 28, 28]
const ROSE: [number, number, number] = [255, 228, 230]
const GREEN: [number, number, number] = [4, 120, 87]
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
  lateDays: number          // days the login was past the expected hour
  onTimeDays: number        // days the login was on or before it
  totalLateMin: number      // minutes late summed over the late days
  worstLateMin: number      // single worst late login
  rows: AttendanceDay[]     // day rows, ascending by date
}

// ─── Late logins ────────────────────────────────────────────────────────────────

/** Minutes-since-midnight of a UTC timestamp, in the org timezone. */
function minutesEST(iso: string | null): number | null {
  if (!iso) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso))
  const h = Number(parts.find((p) => p.type === 'hour')?.value) % 24
  const m = Number(parts.find((p) => p.type === 'minute')?.value)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}

/**
 * How late the login was, in minutes, against the hours kept for that person on the Staff
 * page — falling back to the flat 9:00 AM this app has always used where none are set.
 *
 * null means there was nothing to judge: no login recorded at all. 0 means on time, and
 * that is worth saying out loud, which is why it is not folded in with null.
 */
export function loginLateMinutes(r: AttendanceDay): number | null {
  if (r.login_at == null) return null
  if (r.late_min != null) return r.late_min
  const m = minutesEST(r.login_at)
  return m == null ? null : Math.max(0, m - TARGET_LOGIN_MIN)
}

/** Was this day a late login? The one question the summaries and scorecards are read for. */
export const isLateLogin = (r: AttendanceDay): boolean => (loginLateMinutes(r) ?? 0) > 0

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
    const lateMins = present.map(loginLateMinutes).filter((m): m is number => m != null)
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
      lateDays: lateMins.filter((m) => m > 0).length,
      onTimeDays: lateMins.filter((m) => m === 0).length,
      totalLateMin: lateMins.reduce((s, m) => s + m, 0),
      worstLateMin: lateMins.reduce((a, m) => Math.max(a, m), 0),
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

// ─── Scorecards ─────────────────────────────────────────────────────────────────

/** One KPI tile on a report's scorecard strip. */
interface Score {
  label: string
  value: string
  sub?: string
  /** Red marks a figure nobody wants to see rise; green, one they do. */
  tone?: 'red' | 'green'
}

/**
 * The strip of KPI tiles every report opens with — the same figures, in the same order,
 * as the cards on the page above the table, so a printed report answers "how many late
 * logins?" without anyone having to count a column.
 */
function drawScores(doc: jsPDF, scores: Score[], y: number): number {
  const pageW = doc.internal.pageSize.getWidth()
  const gap = 8
  const w = (pageW - 2 * M - gap * (scores.length - 1)) / scores.length
  const h = 44

  scores.forEach((s, i) => {
    const x = M + i * (w + gap)
    doc.setFillColor(...(s.tone === 'red' ? ([254, 226, 226] as [number, number, number]) : CYAN))
    doc.roundedRect(x, y, w, h, 4, 4, 'F')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...MUTED)
    doc.text(s.label.toUpperCase(), x + 8, y + 14)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...(s.tone === 'red' ? RED : s.tone === 'green' ? GREEN : NAVY))
    doc.text(s.value, x + 8, y + 31)

    if (s.sub) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...MUTED)
      doc.text(s.sub, x + 8, y + 40)
    }
  })

  return y + h + 14
}

// ─── By month ───────────────────────────────────────────────────────────────────

/** A month's login record, for the breakdown every report carries under its scorecards. */
export interface MonthScore {
  /** 'YYYY-MM'. */
  month: string
  label: string
  late: number
  onTime: number
  lateMin: number
  days: number
}

/** Human label for a 'YYYY-MM' month, e.g. "June 2026". */
export function monthName(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/**
 * Late and on-time logins split by calendar month, oldest first.
 *
 * A report's period is whatever was asked for — a week, a fortnight, a run of months — but
 * the question put to it is nearly always monthly, so every report carries the split rather
 * than only a period total that a two-month range would quietly blur together.
 */
export function tallyByMonth(rows: AttendanceDay[]): MonthScore[] {
  const byMonth = new Map<string, MonthScore>()
  const dates = new Map<string, Set<string>>()

  for (const r of rows) {
    const ym = r.work_date.slice(0, 7)
    const m = byMonth.get(ym) ?? { month: ym, label: monthName(ym), late: 0, onTime: 0, lateMin: 0, days: 0 }
    const late = loginLateMinutes(r)
    if (late !== null) {
      if (late > 0) { m.late += 1; m.lateMin += late } else m.onTime += 1
    }
    byMonth.set(ym, m)
    const seen = dates.get(ym) ?? new Set<string>()
    seen.add(r.work_date)
    dates.set(ym, seen)
  }

  for (const [ym, m] of byMonth) m.days = dates.get(ym)?.size ?? 0
  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1))
}

/** The by-month table drawn under a report's scorecards. Returns the y beneath it. */
function drawMonthTable(doc: jsPDF, months: MonthScore[], startY: number): number {
  if (months.length === 0) return startY

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...NAVY)
  doc.text('LATE LOGINS BY MONTH', M, startY)

  autoTable(doc, {
    startY: startY + 8,
    theme: 'grid',
    head: [['MONTH', 'OPERATIONAL DAYS', 'ON-TIME LOGINS', 'LATE LOGINS', 'TIME LOST']],
    body: months.map((m) => [m.label, String(m.days), String(m.onTime), String(m.late), fmtHm(m.lateMin)]),
    styles: { ...baseStyles, fontSize: 8, cellPadding: 4 },
    headStyles: navyHead,
    bodyStyles: { fillColor: CYAN },
    columnStyles: {
      0: { halign: 'left', fontStyle: 'bold' }, 1: { halign: 'center' },
      2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'right' },
    },
    margin: { left: M, right: M },
    didParseCell: (d) => {
      if (d.section !== 'body') return
      const m = months[d.row.index]
      if (!m) return
      if (d.column.index === 2 && m.onTime > 0) d.cell.styles.textColor = GREEN
      if ((d.column.index === 3 || d.column.index === 4) && m.late > 0) {
        d.cell.styles.textColor = RED
        d.cell.styles.fontStyle = 'bold'
        d.cell.styles.fillColor = ROSE
      }
    },
  })

  return lastY(doc) + 18
}

/** The scorecard strip + by-month breakdown both reports open with. */
function drawLoginSummary(doc: jsPDF, stats: BreakStat[], rows: AttendanceDay[], y: number): number {
  const late = stats.reduce((s, x) => s + x.lateDays, 0)
  const onTime = stats.reduce((s, x) => s + x.onTimeDays, 0)
  const lateMin = stats.reduce((s, x) => s + x.totalLateMin, 0)
  const judged = late + onTime
  const lateMembers = stats.filter((x) => x.lateDays > 0).length

  const next = drawScores(doc, [
    { label: 'Late logins', value: String(late), sub: `of ${judged} logins`, tone: 'red' },
    { label: 'On-time logins', value: String(onTime), sub: `of ${judged} logins`, tone: 'green' },
    { label: 'Time lost to late starts', value: fmtHm(lateMin), sub: 'summed over late days', tone: late > 0 ? 'red' : undefined },
    { label: 'Staff logging in late', value: String(lateMembers), sub: `of ${stats.length} active` },
  ], y)

  return drawMonthTable(doc, tallyByMonth(rows), next)
}

// ─── Team report ─────────────────────────────────────────────────────────────────

/**
 * One page: every member as a row, opening on the late-login scorecards and the month
 * breakdown behind them, then the table ranked by break-time exceeding the allowance.
 *
 * `rows` is the raw day list the stats were aggregated from — the month split needs the
 * dates, which the per-member totals no longer carry.
 */
export function buildTeamBreakPdf(stats: BreakStat[], from: string, to: string, rows: AttendanceDay[] = []): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const header = drawHeader(doc, `Late logins, worked hours and break time over the ${BREAK_ALLOWANCE_MIN}-minute daily allowance`, from, to)
  const y = drawLoginSummary(doc, stats, rows.length ? rows : stats.flatMap((s) => s.rows), header)

  const totalOver = stats.reduce((s, x) => s + x.totalOverMin, 0)
  const totalBreak = stats.reduce((s, x) => s + x.totalBreakMin, 0)
  const totalHours = stats.reduce((s, x) => s + x.totalHours, 0)
  const totalDays = stats.reduce((s, x) => s + x.daysPresent, 0)
  const totalLate = stats.reduce((s, x) => s + x.lateDays, 0)
  const totalOnTime = stats.reduce((s, x) => s + x.onTimeDays, 0)
  const overMembers = stats.filter((x) => x.totalOverMin > 0).length

  doc.setFont('helvetica', 'normal')
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
    String(s.onTimeDays),
    String(s.lateDays),
    fmtHm(s.totalLateMin),
    fmtHm(s.totalBreakMin),
    fmtHm(s.totalOverMin),
    hoursCell(s.totalHours),
  ])
  if (body.length === 0) body.push(['No members active in this period', '0', '0', '0', '0m', '0m', '0m', '0.0h'])
  body.push([
    'TEAM TOTAL', String(totalDays), String(totalOnTime), String(totalLate),
    fmtHm(stats.reduce((s, x) => s + x.totalLateMin, 0)),
    fmtHm(totalBreak), fmtHm(totalOver), hoursCell(totalHours),
  ])
  const totalIdx = body.length - 1

  autoTable(doc, {
    startY: y + 16,
    theme: 'grid',
    head: [[
      'STAFF', 'DAYS\nLOGGED IN', 'ON-TIME\nLOGINS', 'LATE\nLOGINS', 'TIME\nLOST',
      'BREAK USED', 'BREAK-TIME\nEXCEEDING\nALLOWANCE', 'WORKED\nHOURS',
    ]],
    body,
    styles: { ...baseStyles, fontSize: 8, cellPadding: 4 },
    headStyles: navyHead,
    bodyStyles: { fillColor: CYAN },
    columnStyles: {
      0: { halign: 'left' }, 1: { halign: 'center' }, 2: { halign: 'center' },
      3: { halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' },
      6: { halign: 'right' }, 7: { halign: 'right' },
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
      // Late logins are the column this report is scanned down, so they are the ones
      // printed in red on their own tint — a page of black figures with three red cells
      // answers "who is turning up late?" before anything is read.
      if ((d.column.index === 3 || d.column.index === 4) && stat.lateDays > 0) {
        d.cell.styles.textColor = RED
        d.cell.styles.fontStyle = 'bold'
        d.cell.styles.fillColor = ROSE
      }
      if (d.column.index === 2 && stat.onTimeDays > 0) d.cell.styles.textColor = GREEN
      if (d.column.index === 6 && stat.totalOverMin > 0) {
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

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...(stat.lateDays > 0 ? RED : GREEN))
  doc.text(
    `Late logins ${stat.lateDays} of ${stat.lateDays + stat.onTimeDays}` +
      (stat.lateDays > 0 ? `  ·  ${fmtHm(stat.totalLateMin)} lost  ·  worst ${fmtHm(stat.worstLateMin)}` : '  ·  never late in this period'),
    M, startY + 26,
  )

  const lateOf = (r: AttendanceDay): number | null => loginLateMinutes(r)

  const body: RowInput[] = stat.rows.map((r) => [
    formatDmy(r.work_date),
    fmtClockEST(r.login_at),
    (lateOf(r) ?? 0) > 0 ? fmtHm(lateOf(r) as number) : r.login_at ? 'On time' : '—',
    fmtClockEST(r.logout_at),
    hoursCell(r.hours),
    `${r.break_min ?? 0}m`,
    `${BREAK_ALLOWANCE_MIN}m`,
    fmtHm(r.over_break_min ?? 0),
  ])
  if (body.length === 0) body.push(['—', '—', '—', '—', '—', '0m', `${BREAK_ALLOWANCE_MIN}m`, '0m'])
  body.push([
    'TOTAL', '', `${stat.lateDays} late`, '', hoursCell(stat.totalHours),
    `${stat.totalBreakMin}m`, '', fmtHm(stat.totalOverMin),
  ])
  const totalIdx = body.length - 1

  autoTable(doc, {
    startY: startY + 34,
    theme: 'grid',
    head: [['DATE', 'LOGIN', 'LATE BY', 'LOGOUT', 'WORKED HOURS', 'BREAK', 'ALLOWANCE', 'EXCEEDING\nALLOWANCE']],
    body,
    styles: { ...baseStyles, fontSize: 8, cellPadding: 4 },
    headStyles: navyHead,
    bodyStyles: { fillColor: CYAN },
    columnStyles: {
      0: { halign: 'left' }, 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' },
      4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'center' }, 7: { halign: 'right' },
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
      const row = stat.rows[d.row.index]
      if (!row) return
      // A late day is marked across BOTH clock columns — the time it happened and how far
      // out it was — so the day itself is findable, not just the number beside it.
      if ((d.column.index === 1 || d.column.index === 2) && isLateLogin(row)) {
        d.cell.styles.textColor = RED
        d.cell.styles.fontStyle = 'bold'
        d.cell.styles.fillColor = ROSE
      } else if (d.column.index === 2 && row.login_at != null) {
        d.cell.styles.textColor = GREEN
      }
      if (d.column.index === 7 && (row.over_break_min ?? 0) > 0) {
        d.cell.styles.textColor = RED
        d.cell.styles.fontStyle = 'bold'
      }
    },
  })
}

/** Single member, day-by-day, opening on their own late-login scorecards. */
export function buildUserBreakPdf(stat: BreakStat, from: string, to: string): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const header = drawHeader(doc, `Individual report — ${labelOf(stat)}`, from, to)
  const y = drawLoginSummary(doc, [stat], stat.rows, header)
  renderUserSection(doc, stat, y + 8)
  return doc
}

/** Every member, each with their own day-by-day section (flows across pages). */
export function buildAllUsersBreakPdf(stats: BreakStat[], from: string, to: string): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageH = doc.internal.pageSize.getHeight()
  const header = drawHeader(doc, 'Per-member breakdown for every active member', from, to)
  let y = (stats.length ? drawLoginSummary(doc, stats, stats.flatMap((s) => s.rows), header) : header) + 8

  if (stats.length === 0) {
    doc.setFontSize(10)
    doc.setTextColor(...MUTED)
    doc.text('No members were active in this period.', M, y + 10)
    return doc
  }

  stats.forEach((stat) => {
    // Avoid orphaning a member's heading at the foot of a page; long tables paginate
    // themselves inside autoTable. The FIRST section is checked too, because the scorecards
    // and the month breakdown now sit above it and a long enough period can push it down.
    if (y > pageH - 140) {
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

/**
 * Team report as a single .xlsx sheet with a TOTAL footer.
 *
 * The two late-login columns are printed red on a pale red fill exactly as the PDF prints
 * them, so a workbook mailed on is read the same way as a page pinned to a wall.
 */
export function teamBreakSheet(stats: BreakStat[]): XlsxSheet {
  const LATE = 4  // the "Late logins" column — the one highlighted
  return {
    name: 'Overall Staff Report',
    head: [
      'Staff', 'Username', 'Days logged in', 'On-time logins', 'Late logins', 'Late by (min)',
      'Break used (min)', 'Break-time exceeding allowance (min)', 'Worked hours',
    ],
    formats: ['text', 'text', 'integer', 'integer', 'integer', 'integer', 'integer', 'integer', 'number'],
    rows: stats.map((s) => [
      s.staff_name ?? '',
      s.username ? `@${s.username}` : '',
      s.daysPresent,
      s.onTimeDays,
      s.lateDays,
      s.totalLateMin,
      s.totalBreakMin,
      s.totalOverMin,
      round1(s.totalHours),
    ]),
    red: (row, col) => (col === LATE || col === LATE + 1) && (stats[row]?.lateDays ?? 0) > 0,
    foot: [
      'TOTAL', '',
      stats.reduce((s, x) => s + x.daysPresent, 0),
      stats.reduce((s, x) => s + x.onTimeDays, 0),
      stats.reduce((s, x) => s + x.lateDays, 0),
      stats.reduce((s, x) => s + x.totalLateMin, 0),
      stats.reduce((s, x) => s + x.totalBreakMin, 0),
      stats.reduce((s, x) => s + x.totalOverMin, 0),
      round1(stats.reduce((s, x) => s + x.totalHours, 0)),
    ],
  }
}

/** One member's day-by-day breakdown as an .xlsx sheet; late days highlighted in red. */
export function userBreakSheet(stat: BreakStat): XlsxSheet {
  return {
    name: 'Overall Staff Report',
    head: [
      'Date', 'Login', 'Late by (min)', 'Logout', 'Worked hours', 'Break (min)',
      'Allowance (min)', 'Break-time exceeding allowance (min)',
    ],
    formats: ['text', 'text', 'integer', 'text', 'number', 'integer', 'integer', 'integer'],
    rows: stat.rows.map((r) => [
      r.work_date,
      fmtClockEST(r.login_at),
      loginLateMinutes(r) ?? '',
      fmtClockEST(r.logout_at),
      r.hours == null ? '' : round1(r.hours),
      r.break_min ?? 0,
      BREAK_ALLOWANCE_MIN,
      r.over_break_min ?? 0,
    ]),
    // A late day is marked along its date and both login columns, so the DAY stands out in
    // the sheet rather than one lone number in the middle of it.
    red: (row, col) => col <= 2 && !!stat.rows[row] && isLateLogin(stat.rows[row]),
    foot: [
      'TOTAL', '', stat.totalLateMin, '', round1(stat.totalHours),
      stat.totalBreakMin, '', stat.totalOverMin,
    ],
  }
}

/**
 * The late-login scorecards, month by month, as their own sheet — the figure the reports
 * are actually asked for, kept out of the per-person tables so it can be charted or pasted
 * into a monthly summary on its own.
 */
export function loginMonthSheet(rows: AttendanceDay[]): XlsxSheet {
  const months = tallyByMonth(rows)
  return {
    name: 'Late Logins by Month',
    head: ['Month', 'Operational days', 'On-time logins', 'Late logins', 'Late by (min)'],
    formats: ['text', 'integer', 'integer', 'integer', 'integer'],
    rows: months.map((m) => [m.label, m.days, m.onTime, m.late, m.lateMin]),
    red: (row, col) => col >= 3 && (months[row]?.late ?? 0) > 0,
    foot: [
      'TOTAL',
      months.reduce((s, m) => s + m.days, 0),
      months.reduce((s, m) => s + m.onTime, 0),
      months.reduce((s, m) => s + m.late, 0),
      months.reduce((s, m) => s + m.lateMin, 0),
    ],
  }
}
