/**
 * Minimal, dependency-free spreadsheet exporters.
 *
 * `saveXlsx` writes a real OOXML .xlsx workbook (numbers stay numbers, currency
 * formatting, bold header band, multiple sheets, frozen header row) that Excel
 * and Google Sheets open and edit natively — unlike a flat CSV. `saveCsv` is a
 * correctly-quoted UTF-8 CSV for the same data.
 */

export type XlsxValue = string | number | null | undefined
export type XlsxFormat = 'currency' | 'integer' | 'number' | 'text'

export interface XlsxSheet {
  name: string
  head: string[]
  rows: XlsxValue[][]
  foot?: XlsxValue[]
  /** Per-column number format (index → format). Defaults to text/auto. */
  formats?: XlsxFormat[]
}

const enc = new TextEncoder()

/* ── CRC32 (for the ZIP container) ─────────────────────────────────────────── */
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/* ── byte / XML helpers ────────────────────────────────────────────────────── */
function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0
  for (const p of parts) len += p.length
  const out = new Uint8Array(len)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
const u16 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff])
const u32 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff])

function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;')
}
function colRef(col: number): string {
  let s = ''
  let n = col + 1
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
  return s
}
function sheetName(name: string, i: number): string {
  return name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`
}

/* ── cell styles ───────────────────────────────────────────────────────────────
   0 default | 1 header | 2 currency | 3 integer | 4 foot | 5 foot$ | 6 foot int */
function styleFor(fmt: XlsxFormat | undefined, foot: boolean): number {
  if (foot) return fmt === 'currency' ? 5 : fmt === 'integer' ? 6 : 4
  return fmt === 'currency' ? 2 : fmt === 'integer' ? 3 : 0
}

function cell(ref: string, value: XlsxValue, fmt: XlsxFormat | undefined, foot: boolean): string {
  const s = styleFor(fmt, foot)
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" s="${s}"><v>${value}</v></c>`
  }
  const text = value == null ? '' : String(value)
  if (text === '') return `<c r="${ref}" s="${s}"/>`
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`
}

function rowXml(r: number, values: XlsxValue[], formats: XlsxFormat[], mode: 'head' | 'body' | 'foot'): string {
  const cells = values.map((v, c) => {
    if (mode === 'head') {
      return `<c r="${colRef(c)}${r}" s="1" t="inlineStr"><is><t xml:space="preserve">${esc(String(v ?? ''))}</t></is></c>`
    }
    return cell(`${colRef(c)}${r}`, v, formats[c], mode === 'foot')
  })
  return `<row r="${r}">${cells.join('')}</row>`
}

function sheetXml(sheet: XlsxSheet): string {
  const formats = sheet.formats ?? []
  const ncols = Math.max(sheet.head.length, ...sheet.rows.map((r) => r.length), sheet.foot?.length ?? 0, 1)
  const nrows = 1 + sheet.rows.length + (sheet.foot ? 1 : 0)

  const cols = Array.from({ length: ncols }, (_, c) => {
    const fmt = formats[c]
    const base = fmt === 'currency' ? 14 : fmt === 'integer' || fmt === 'number' ? 11 : 12
    const w = Math.min(46, Math.max(base, (sheet.head[c]?.length ?? 8) + 2))
    return `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`
  }).join('')

  let body = rowXml(1, sheet.head, formats, 'head')
  let r = 2
  for (const row of sheet.rows) { body += rowXml(r, row, formats, 'body'); r++ }
  if (sheet.foot) body += rowXml(r, sheet.foot, formats, 'foot')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${colRef(ncols - 1)}${nrows}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FF1A3654"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="7">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
  `<xf numFmtId="164" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>` +
  `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`

function workbookXml(sheets: XlsxSheet[]): string {
  const tags = sheets
    .map((s, i) => `<sheet name="${esc(sheetName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${tags}</sheets></workbook>`
}

function workbookRels(n: number): string {
  const rels: string[] = []
  for (let i = 0; i < n; i++) {
    rels.push(`<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
  }
  rels.push(`<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`)
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`
}

function contentTypes(n: number): string {
  const overrides = [
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`,
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`,
  ]
  for (let i = 0; i < n; i++) {
    overrides.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>${overrides.join('')}</Types>`
}

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const nameBytes = enc.encode(f.name)
    const crc = crc32(f.data)
    const size = f.data.length
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0),
      nameBytes, f.data,
    ])
    locals.push(local)
    centrals.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset),
      nameBytes,
    ]))
    offset += local.length
  }
  let cdSize = 0
  for (const c of centrals) cdSize += c.length
  const eocd = concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(cdSize), u32(offset), u16(0),
  ])
  return concat([...locals, ...centrals, eocd])
}

/** Build the raw .xlsx bytes for one or more sheets. */
export function buildXlsx(sheets: XlsxSheet[]): Uint8Array {
  const files = [
    { name: '[Content_Types].xml', data: enc.encode(contentTypes(sheets.length)) },
    { name: '_rels/.rels', data: enc.encode(ROOT_RELS) },
    { name: 'xl/workbook.xml', data: enc.encode(workbookXml(sheets)) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(workbookRels(sheets.length)) },
    { name: 'xl/styles.xml', data: enc.encode(STYLES) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s)) })),
  ]
  return zip(files)
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Generate and download an .xlsx workbook. */
export function saveXlsx(filename: string, sheets: XlsxSheet[]): void {
  const body = buildXlsx(sheets) as unknown as BlobPart
  triggerDownload(
    new Blob([body], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename,
  )
}

/** Generate and download a UTF-8 CSV (quoted as needed). */
export function saveCsv(filename: string, head: string[], rows: XlsxValue[][], foot?: XlsxValue[]): void {
  const cellCsv = (v: XlsxValue) => {
    const s = v == null ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [head, ...rows]
  if (foot) lines.push(foot)
  const csv = lines.map((r) => r.map(cellCsv).join(',')).join('\r\n')
  triggerDownload(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), filename)
}
