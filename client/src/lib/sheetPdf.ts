import { jsPDF } from 'jspdf'
import autoTable, { type RowInput, type Styles } from 'jspdf-autotable'
import type {
  Department, QueueAssignment, ReviewDepartment, ReviewEntry,
  StaffAttendanceRow, StaffLeave, StaffMember, StaffSalary, StaffSalaryHold,
} from '../types'
import {
  clockLabel, earlyBy, emptyLoginTally, gapLabel, hoursLabel, lateBy, netHours, punctualityOf,
  returnVerdict, shortDay, staffStatus, sumLoginTallies, tallyPunctuality, type LoginTally,
} from './staff'
import { activeCriteria, type IncentiveSettings, type RankedRow } from './incentive'
import type { AnnualExport } from '../components/AnnualReviewSheet'

/**
 * PDF exports for the Queues, Review and Staff Management sheets — the tables as filled
 * in, and nothing else: no entry rows, no empty department bands, none of the page's
 * controls. The one exception is the attendance sheet, where a person with nothing
 * recorded is exactly what a daily roster is for, so those blank lines are kept.
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
const RED: [number, number, number] = [185, 28, 28]
const ROSE: [number, number, number] = [255, 228, 230]
const PALE_RED: [number, number, number] = [254, 226, 226]
const GREEN: [number, number, number] = [4, 120, 87]
const PALE_GREEN: [number, number, number] = [209, 250, 229]
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

/**
 * A strip of KPI tiles under a sheet's title — the scorecards the screen shows above the
 * same table, printed so a sheet handed round answers "how many late logins?" on its face.
 */
function drawScores(
  doc: jsPDF,
  scores: { label: string; value: string; sub?: string; tone?: 'red' | 'green' }[],
  y: number,
): number {
  const pageW = doc.internal.pageSize.getWidth()
  const gap = 8
  const w = (pageW - 2 * M - gap * (scores.length - 1)) / scores.length
  const h = 42

  scores.forEach((s, i) => {
    const x = M + i * (w + gap)
    doc.setFillColor(...(s.tone === 'red' ? PALE_RED : CYAN))
    doc.roundedRect(x, y, w, h, 4, 4, 'F')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...MUTED)
    doc.text(s.label.toUpperCase(), x + 8, y + 13)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...(s.tone === 'red' ? RED : s.tone === 'green' ? GREEN : NAVY))
    doc.text(s.value, x + 8, y + 29)

    if (s.sub) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...MUTED)
      doc.text(s.sub, x + 8, y + 38)
    }
  })

  return y + h + 14
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
export function buildQueuesPdf(rows: QueueAssignment[], title = 'Queues'): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const total = rows.reduce((s, r) => s + r.codes.length, 0)
  const y = drawHeader(
    doc,
    title.toUpperCase(),
    `${rows.length} ${rows.length === 1 ? 'person' : 'people'} · ${total} queues assigned`,
  )

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
export function buildPerformancePdf(
  entries: ReviewEntry[], departments: ReviewDepartment[], monthLabel: string,
): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const withNotes = entries.some((e) => e.notes.trim() !== '')
  // No per-row DEPARTMENT column — the band names it, matching the sheet.
  const head = ['SR', 'NAME', 'PERFOMANCE', 'PERCENTAGE', ...(withNotes ? ['NOTES'] : [])]
  // The month is the one being reviewed, so it belongs in the subtitle of every export.
  const y = drawHeader(
    doc,
    'PERFORMANCE REVIEW',
    `${monthLabel} · ${entries.length} ${entries.length === 1 ? 'person' : 'people'} reviewed`,
  )

  const body: RowInput[] = []
  let sr = 0
  for (const group of grouped(entries, departments)) {
    body.push(bandRow(group.name, head.length))
    for (const e of group.rows) {
      sr += 1
      body.push([
        String(sr),
        e.person_name,
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
    // Only the narrow columns are pinned; NAME (and NOTES when shown) size themselves.
    // At least one flexible column is required, or autoTable can't fill the page width
    // and warns that the content doesn't fit.
    columnStyles: {
      0: { halign: 'center', cellWidth: 34, fillColor: BAND, fontStyle: 'bold' },
      1: { fontStyle: 'bold' },
      2: { halign: 'center', cellWidth: 90 },
      3: { halign: 'center', cellWidth: 76 },
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
    // No per-row DEPARTMENT column — the band names it, matching the sheet.
    body.push(bandRow(group.name, 4))
    for (const e of group.rows) {
      sr += 1
      body.push([
        String(sr),
        sr === 1 ? monthLabel.toUpperCase() : '',
        e.person_name,
        e.rating,
      ])
    }
  }

  autoTable(doc, {
    startY: y,
    theme: 'grid',
    head: [['SR.NO', 'MONTH', 'NAME', 'BEHAVIOUR ANALYSIS']],
    body,
    styles: baseStyles,
    headStyles: navyHead,
    bodyStyles: { fillColor: CYAN },
    columnStyles: {
      0: { halign: 'center', cellWidth: 40, fillColor: BAND, fontStyle: 'bold' },
      1: { halign: 'center', cellWidth: 70, fontStyle: 'bold' },
      2: { cellWidth: 170, fontStyle: 'bold' },
      3: { halign: 'left' },
    },
    margin: { left: M, right: M },
  })
  return doc
}

/** The department scorecard for one month — the whole tab is data, so every row goes in. */
export function buildDepartmentsPdf(departments: ReviewDepartment[], monthLabel: string): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const y = drawHeader(doc, 'DEPARTMENT REVIEW', `${monthLabel} · ${departments.length} departments`)

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

// ─── Staff Management ─────────────────────────────────────────────────────────

/** The roster: who is here, what they're in, and where they stand. */
export function buildStaffPdf(staff: StaffMember[]): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const active = staff.filter((s) => s.status === 'active').length
  const y = drawHeader(doc, 'STAFF', `${staff.length} on the roster · ${active} active`)

  autoTable(doc, {
    startY: y,
    theme: 'grid',
    head: [['SR. NO', 'NAME', 'DEPARTMENTS', 'EXPECTED LOGIN', 'EXPECTED LOGOUT', 'STATUS']],
    body: staff.map((s, i) => [
      String(i + 1),
      s.name,
      s.departments.map((d) => d.name).join(', '),
      // An em dash reads as "no schedule agreed", which is what an empty cell means.
      clockLabel(s.expected_login),
      clockLabel(s.expected_logout),
      staffStatus(s.status).label,
    ]),
    styles: baseStyles,
    headStyles: navyHead,
    bodyStyles: { fillColor: CYAN },
    columnStyles: {
      0: { halign: 'center', cellWidth: 42, fillColor: BAND, fontStyle: 'bold' },
      1: { cellWidth: 116, fontStyle: 'bold' },
      2: { halign: 'left' },
      3: { halign: 'center', cellWidth: 74 },
      4: { halign: 'center', cellWidth: 74 },
      5: { halign: 'center', cellWidth: 60 },
    },
    margin: { left: M, right: M },
  })
  return doc
}

/**
 * One day's attendance for the whole roster. Everyone appears, including the people with
 * nothing recorded — a blank line is the point of a daily sheet.
 *
 * A clock time that missed the hours that person is expected to keep carries how far it
 * missed by, the way the sheet on screen marks it — and the FLAG column carries the same
 * one-word verdict the screen shows, so a printed sheet reads down the same column.
 */
export function buildStaffAttendancePdf(
  staff: StaffMember[],
  rows: StaffAttendanceRow[],
  dateLabel: string,
  /** Each person's late / on-time logins over the month the day falls in, by staff id. */
  monthTallies: Map<number, LoginTally> = new Map(),
  monthLabel = '',
): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const byStaff = new Map(rows.map((r) => [r.staff_id, r]))
  const present = rows.filter((r) => r.login_at !== null).length
  const flags = new Map(staff.map((p) => {
    const row = byStaff.get(p.id)
    return [p.id, punctualityOf(row?.login_at ?? null, row?.logout_at ?? null, p.expected_login, p.expected_logout)]
  }))
  const tally = tallyPunctuality([...flags.values()])

  // How late each person was on the day being printed — read once, used by the summary
  // line, the LOGIN column's red fill and the list of names under the scorecards.
  const lateToday = new Map(staff.map((p) => {
    const at = byStaff.get(p.id)?.login_at ?? null
    return [p.id, at === null ? null : lateBy(at, p.expected_login)]
  }))
  const lateNames = staff
    .filter((p) => (lateToday.get(p.id) ?? 0) > 0)
    .sort((a, b) => (lateToday.get(b.id) ?? 0) - (lateToday.get(a.id) ?? 0))

  const month = sumLoginTallies(monthTallies.values())
  const monthLateStaff = [...monthTallies.values()].filter((t) => t.late > 0).length

  const header = drawHeader(
    doc,
    'ATTENDANCE',
    `${dateLabel} · ${present} of ${staff.length} logged in`
      + (tally.flagged > 0
        ? ` · ${tally.flagged} off schedule${tally.both > 0 ? ` (${tally.both} at both ends)` : ''}`
        : ''),
  )

  // The scorecards: the day's late logins first, then the month behind them, because a
  // late morning is only worth acting on once you know whether it is the first or the sixth.
  let y = drawScores(doc, [
    { label: `Late logins · ${dateLabel}`, value: String(lateNames.length), sub: `of ${present} logged in`, tone: 'red' },
    {
      label: `On-time logins · ${dateLabel}`,
      value: String(present - lateNames.length),
      sub: `of ${present} logged in`,
      tone: 'green',
    },
    {
      label: monthLabel ? `Late logins · ${monthLabel}` : 'Late logins this month',
      value: String(month.late),
      sub: `of ${month.judged} logins · ${gapLabel(month.lateMin)} lost`,
      tone: 'red',
    },
    {
      label: monthLabel ? `On-time logins · ${monthLabel}` : 'On-time logins this month',
      value: String(month.onTime),
      sub: `of ${month.judged} logins`,
      tone: 'green',
    },
    {
      label: 'Staff late this month',
      value: String(monthLateStaff),
      sub: `of ${staff.length} on the roster`,
    },
  ], header)

  // Who, by name — the same strip that sits above the sheet on screen. It wraps, so the
  // table below starts from however many lines the names actually took.
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...(lateNames.length > 0 ? RED : GREEN))
  const lateLine = lateNames.length === 0
    ? `Late in on ${dateLabel}: nobody`
    : `Late in on ${dateLabel}: `
      + lateNames.map((p) => `${p.name} (${gapLabel(lateToday.get(p.id) as number)})`).join(',  ')
  const lateLines: string[] = doc.splitTextToSize(lateLine, doc.internal.pageSize.getWidth() - 2 * M)
  doc.text(lateLines, M, y)
  y += 10 * lateLines.length + 8

  /** "9:07 AM (7m late)" — the time, and only where it matters how far off it was. */
  const marks = (at: string | null, off: number | null, word: string): string =>
    off !== null && off > 0 ? `${clockLabel(at)} (${gapLabel(off)} ${word})` : clockLabel(at)

  autoTable(doc, {
    startY: y,
    theme: 'grid',
    head: [[
      'SR. NO', 'NAME', 'DEPARTMENT', 'LOGIN', 'LOGOUT',
      monthLabel ? `LATE LOGINS\n${monthLabel.toUpperCase()}` : 'LATE LOGINS\nTHIS MONTH',
      'BREAK', 'HOURS', 'FLAG', 'STATUS', 'SOURCE',
    ]],
    body: staff.map((person, i) => {
      const row = byStaff.get(person.id) ?? null
      const t = monthTallies.get(person.id) ?? emptyLoginTally()
      return [
        String(i + 1),
        person.name,
        person.departments.map((d) => d.name).join(', '),
        marks(row?.login_at ?? null, lateBy(row?.login_at ?? null, person.expected_login), 'late'),
        marks(row?.logout_at ?? null, earlyBy(row?.logout_at ?? null, person.expected_logout), 'early'),
        t.judged === 0 ? '—' : `${t.late}/${t.judged}`,
        row ? `${row.break_min}m` : '—',
        // The same calculation the sheet shows, from the same clock times, so a printed
        // day always matches the screen it was printed from.
        hoursLabel(row ? netHours(row.login_at ?? '', row.logout_at ?? '', row.break_min) : null),
        flags.get(person.id)?.label ?? '—',
        row?.status ?? '—',
        row === null ? '—' : row.source === 'manual' ? 'Keyed in' : row.edited ? 'Corrected' : 'Fetched',
      ]
    }),
    styles: { ...baseStyles, fontSize: 8, cellPadding: 4 },
    headStyles: navyHead,
    bodyStyles: { fillColor: CYAN },
    columnStyles: {
      0: { halign: 'center', cellWidth: 34, fillColor: BAND, fontStyle: 'bold' },
      1: { cellWidth: 96, fontStyle: 'bold' },
      2: { halign: 'left' },
      3: { halign: 'center', cellWidth: 80 },
      4: { halign: 'center', cellWidth: 80 },
      5: { halign: 'center', cellWidth: 56, fontStyle: 'bold' },
      6: { halign: 'center', cellWidth: 36 },
      7: { halign: 'center', cellWidth: 42, fontStyle: 'bold' },
      8: { halign: 'center', cellWidth: 72, fontStyle: 'bold' },
      9: { halign: 'center', cellWidth: 54 },
      10: { halign: 'center', cellWidth: 52 },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      const person = staff[data.row.index]
      if (!person) return

      // A late login is printed red on its own tint in BOTH the day's login cell and the
      // month's count — the two questions a supervisor reading this page is asking.
      if (data.column.index === 3 && (lateToday.get(person.id) ?? 0) > 0) {
        data.cell.styles.textColor = RED
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fillColor = ROSE
      }
      if (data.column.index === 5) {
        const t = monthTallies.get(person.id) ?? emptyLoginTally()
        if (t.late > 0) {
          data.cell.styles.textColor = RED
          data.cell.styles.fillColor = ROSE
        } else if (t.judged > 0) {
          data.cell.styles.textColor = GREEN
        }
      }
      // The verdict is the column the sheet is scanned down, so it is coloured on paper
      // too: amber for one mark, red for a day that missed at both ends.
      if (data.column.index === 8) {
        const flag = flags.get(person.id)
        if (!flag || flag.id === 'on-time') return
        data.cell.styles.textColor = flag.marks === 2 ? [159, 18, 57] : [146, 64, 14]
        data.cell.styles.fillColor = flag.marks === 2 ? ROSE : [254, 243, 199]
      }
    },
    margin: { left: M, right: M },
  })
  return doc
}

/** The leaves sheet, column for column as it is kept on screen. */
export function buildLeavesPdf(leaves: StaffLeave[], monthLabel: string): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const y = drawHeader(doc, 'LEAVES', `${monthLabel} · ${leaves.length} ${leaves.length === 1 ? 'row' : 'rows'}`)

  autoTable(doc, {
    startY: y,
    theme: 'grid',
    head: [['DATE', 'NAME', 'DEPARTMENT', 'SICK LEAVES', 'BREAK LEAVES', 'HALF DAY', 'LATE LOGIN', 'EXPECTED RETURN', 'ACTUAL RETURN', 'AOB']],
    body: leaves.map((l) => {
      // The verdict prints under the date it belongs to, the way the sheet shows it.
      const v = returnVerdict(l.expected_return, l.actual_return)
      const expected = [l.expected_return ? shortDay(l.expected_return) : '', v?.id === 'overdue' ? v.label : ''].filter(Boolean).join('\n')
      const actual = [l.actual_return ? shortDay(l.actual_return) : '', v && v.id !== 'overdue' ? v.label : ''].filter(Boolean).join('\n')
      return [
        shortDay(l.leave_date),
        l.staff_name,
        l.department_name ?? '',
        l.sick_leave,
        l.break_leave,
        l.half_day,
        l.late_login,
        expected,
        actual,
        l.aob,
      ]
    }),
    styles: baseStyles,
    headStyles: navyHead,
    bodyStyles: { fillColor: CYAN },
    columnStyles: {
      0: { halign: 'center', cellWidth: 54, fillColor: BAND, fontStyle: 'bold' },
      1: { cellWidth: 96, fontStyle: 'bold' },
      2: { cellWidth: 90 },
      3: { halign: 'center', cellWidth: 62 },
      4: { halign: 'center', cellWidth: 66 },
      5: { halign: 'center', cellWidth: 56 },
      6: { halign: 'center', cellWidth: 60 },
      7: { halign: 'center', cellWidth: 70 },
      8: { halign: 'center', cellWidth: 70 },
      9: { halign: 'left' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      const l = leaves[data.row.index]
      if (!l) return
      const v = returnVerdict(l.expected_return, l.actual_return)
      if (!v) return
      // A late return is the thing this sheet is scanned for, so it is red on its own
      // tint on paper too; "not back yet" is amber under the date they were due.
      if (data.column.index === 8 && v.id === 'late') {
        data.cell.styles.textColor = RED
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fillColor = ROSE
      } else if (data.column.index === 8 && v.id === 'on-time') {
        data.cell.styles.textColor = GREEN
      } else if (data.column.index === 7 && v.id === 'overdue') {
        data.cell.styles.textColor = [146, 64, 14]
        data.cell.styles.fillColor = [254, 243, 199]
      }
    },
    margin: { left: M, right: M },
  })
  return doc
}

/**
 * The salary sheet: the month stamped once, then a band per department with Sr. No.
 * running continuously across them — the same shape the screen shows.
 */
export function buildSalariesPdf(
  salaries: StaffSalary[], departments: Department[], monthLabel: string,
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const received = salaries.filter((s) => s.status === 'Received').length
  const y = drawHeader(doc, 'SALARIES', `${monthLabel} · ${received} of ${salaries.length} received`)

  const bands: { id: number | null; name: string }[] = [
    ...departments.map((d) => ({ id: d.id as number | null, name: d.name })),
    { id: null, name: 'No department' },
  ]

  const body: RowInput[] = [[{
    content: monthLabel.toUpperCase(),
    colSpan: 3,
    styles: { fillColor: BAND, textColor: NAVY, fontStyle: 'bold', halign: 'left' },
  }]]
  let sr = 0
  for (const band of bands) {
    const rows = salaries.filter((s) => s.department_id === band.id)
    if (rows.length === 0) continue
    body.push(bandRow(band.name, 3))
    for (const row of rows) {
      sr += 1
      body.push([String(sr), row.staff_name, row.status])
    }
  }

  autoTable(doc, {
    startY: y,
    theme: 'grid',
    head: [['SR. NO', 'NAME', 'SALARY']],
    body,
    styles: baseStyles,
    headStyles: navyHead,
    bodyStyles: { fillColor: CYAN },
    columnStyles: {
      0: { halign: 'center', cellWidth: 60, fillColor: BAND, fontStyle: 'bold' },
      1: { fontStyle: 'bold' },
      2: { halign: 'center', cellWidth: 130 },
    },
    margin: { left: M, right: M },
  })
  return doc
}

/**
 * Salary Hold: the running log as the tab shows it — not month-scoped like Salaries, so
 * every row prints with its own month rather than one stamped once, newest first, exactly
 * as the sheet lists them.
 */
export function buildSalaryHoldsPdf(holds: StaffSalaryHold[], monthLabel: string): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const onHold = holds.filter((h) => h.status === 'On Hold').length
  const y = drawHeader(doc, 'SALARY HOLD', `${monthLabel} · ${onHold} of ${holds.length} still on hold`)

  autoTable(doc, {
    startY: y,
    theme: 'grid',
    head: [['SR. NO', 'NAME', 'MONTH', 'REASON', 'STATUS']],
    body: holds.map((h, i) => [String(i + 1), h.staff_name, shortMonth(h.month), h.reason, h.status]),
    styles: baseStyles,
    headStyles: navyHead,
    bodyStyles: { fillColor: CYAN },
    columnStyles: {
      0: { halign: 'center', cellWidth: 40, fillColor: BAND, fontStyle: 'bold' },
      1: { cellWidth: 100, fontStyle: 'bold' },
      2: { halign: 'center', cellWidth: 60 },
      4: { halign: 'center', cellWidth: 70 },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 4) {
        data.cell.styles.textColor = data.cell.raw === 'Disbursed' ? GREEN : RED
        data.cell.styles.fontStyle = 'bold'
      }
    },
    margin: { left: M, right: M },
  })
  return doc
}

/** "Aug 2026" from a stored YYYY-MM-DD. */
function shortMonth(iso: string): string {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

/**
 * Top Performer of the Month: the ranked incentive table as the tab shows it — one column
 * per criterion in play (numbered as on the client's list), the score, and the incentive
 * mark. Standard PDF fonts have no tick glyph, so verdicts print as YES / no / ?, with the
 * same green / red / grey the screen uses.
 */
export function buildTopPerformerPdf(rows: RankedRow[], settings: IncentiveSettings, monthLabel: string): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const active = activeCriteria(settings)
  const winners = rows.filter((r) => r.allMet)
  const y = drawHeader(
    doc,
    'TOP PERFORMER OF THE MONTH',
    `${monthLabel} · ${active.length} criteria in play · ${winners.length ? `${winners.length} eligible: ${winners.map((w) => w.candidate.member.name).join(', ')}` : 'nobody meets every criterion yet'}`,
  )

  // Criteria key under the title, so the numbered columns can be read.
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...MUTED)
  const key = active.map((c) => `${c.n}. ${c.label}${c.source === 'manual' ? '' : ' *'}`).join('   ')
  const lines = doc.splitTextToSize(`${key}   (* checked from the month's Review, Attendance and Leaves sheets)`, doc.internal.pageSize.getWidth() - M * 2) as string[]
  doc.text(lines, M, y)
  const startY = y + lines.length * 10 + 6

  const first = 3 // index of the first criterion column
  autoTable(doc, {
    startY,
    theme: 'grid',
    head: [['#', 'NAME', 'DEPARTMENTS', ...active.map((c) => String(c.n)), 'SCORE', 'INCENTIVE']],
    body: rows.map((r) => [
      String(r.rank),
      r.candidate.member.name,
      r.candidate.member.departments.map((d) => d.name).join(', '),
      ...active.map((c) => { const v = r.verdicts[c.id]; return v.unknown ? '?' : v.met ? 'YES' : 'no' }),
      `${r.met} / ${r.total}`,
      r.allMet ? 'ELIGIBLE' : `${r.total - r.met} to go`,
    ]),
    styles: { ...baseStyles, fontSize: 8, cellPadding: 4 },
    headStyles: navyHead,
    bodyStyles: { fillColor: CYAN },
    columnStyles: {
      0: { halign: 'center', cellWidth: 28, fillColor: BAND, fontStyle: 'bold' },
      1: { cellWidth: 120, fontStyle: 'bold' },
      2: { cellWidth: 130 },
      ...Object.fromEntries(active.map((_, i) => [first + i, { halign: 'center', cellWidth: 34 }])),
      [first + active.length]: { halign: 'center', cellWidth: 48, fontStyle: 'bold' },
      [first + active.length + 1]: { halign: 'center', cellWidth: 64, fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      const col = data.column.index
      const text = String(data.cell.raw)
      if (col >= first && col < first + active.length) {
        if (text === 'YES') { data.cell.styles.textColor = GREEN; data.cell.styles.fontStyle = 'bold' }
        else if (text === 'no') { data.cell.styles.textColor = RED; data.cell.styles.fillColor = ROSE }
        else data.cell.styles.textColor = MUTED
      }
      if (col === first + active.length + 1 && text === 'ELIGIBLE') {
        data.cell.styles.textColor = GREEN
      }
    },
    margin: { left: M, right: M },
  })
  return doc
}

// ─── Annual Reviews ───────────────────────────────────────────────────────────

/**
 * The Annual Reviews roll-up, printed exactly as the sheet is showing it — the columns the
 * manager left visible, in their order and under their wording, and every cell as it reads
 * on screen, which means a figure typed over the accumulation prints as the figure.
 *
 * A typed cell is marked with a small ring rather than a colour, so it survives a
 * black-and-white print; the key under the title says so. The period's top and lowest
 * performers are banded green and red, the way the sheet bands their rows.
 */
export function buildAnnualReviewPdf(state: AnnualExport): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const { columns, rows, periodLabel, span, minMonths } = state
  const months = span === 'half' ? 6 : 12
  const named = rows.filter((r) => r.standing !== null)

  const y = drawHeader(
    doc,
    `${span === 'half' ? 'HALF-YEARLY' : 'YEARLY'} REVIEW`,
    `${periodLabel} · ${months} months accumulated · ${rows.length} ${rows.length === 1 ? 'person' : 'people'}`
      + ` · ranked on average performance · named only on ${minMonths}+ months reviewed`,
  )

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...MUTED)
  const verdict = named.length
    ? named.map((r) => `${r.standing === 'top' ? 'Top performer' : 'Lowest performer'}: ${r.name}`).join('   ')
    : 'Neither end of the period is named yet'
  const lines = doc.splitTextToSize(
    `${verdict}   (\u00b0 a figure typed in by hand, over the accumulation)`,
    doc.internal.pageSize.getWidth() - M * 2,
  ) as string[]
  doc.text(lines, M, y)

  autoTable(doc, {
    startY: y + lines.length * 10 + 6,
    theme: 'grid',
    head: [['#', ...columns.map((c) => c.label.toUpperCase())]],
    body: rows.map((r, i) => [
      String(i + 1),
      ...r.cells.map((text, j) => `${text}${r.typed.includes(columns[j].id) ? '\u00b0' : ''}`),
    ]),
    styles: { ...baseStyles, fontSize: 8, cellPadding: 4 },
    headStyles: navyHead,
    bodyStyles: { fillColor: CYAN },
    columnStyles: {
      0: { halign: 'center', cellWidth: 26, fillColor: BAND, fontStyle: 'bold' },
      ...Object.fromEntries(columns.map((c, i) => [i + 1, {
        halign: c.align ?? 'left',
        fontStyle: c.id === 'name' ? 'bold' : 'normal',
      }])),
    },
    // The two named rows are banded, and their Sr. No. cell carries the colour solid so the
    // band is unmistakable at the left edge.
    didParseCell: (data) => {
      if (data.section !== 'body') return
      const row = rows[data.row.index]
      if (row.standing === null) return
      const solid = row.standing === 'top' ? GREEN : RED
      data.cell.styles.fillColor = row.standing === 'top' ? PALE_GREEN : ROSE
      if (data.column.index === 0) {
        data.cell.styles.fillColor = solid
        data.cell.styles.textColor = WHITE
      }
    },
    margin: { left: M, right: M },
  })
  return doc
}
