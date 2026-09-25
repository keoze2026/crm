import { crc32 } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildXlsx, saveCsv, saveXlsx, type XlsxSheet } from './xlsx'

interface ZipEntry {
  name: string
  data: Uint8Array
  crc: number
  method: number
}

const dec = new TextDecoder()

/** A minimal reader for the stored (uncompressed) ZIP the exporter writes. */
function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = bytes.length - 22
  expect(view.getUint32(eocd, true)).toBe(0x06054b50)
  const count = view.getUint16(eocd + 10, true)
  expect(view.getUint16(eocd + 8, true)).toBe(count)
  const cdSize = view.getUint32(eocd + 12, true)
  const cdOffset = view.getUint32(eocd + 16, true)
  expect(cdOffset + cdSize).toBe(eocd)

  const entries: ZipEntry[] = []
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50)
    const method = view.getUint16(p + 10, true)
    const crc = view.getUint32(p + 16, true)
    const compSize = view.getUint32(p + 20, true)
    const size = view.getUint32(p + 24, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const localOffset = view.getUint32(p + 42, true)
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    expect(compSize).toBe(size)

    expect(view.getUint32(localOffset, true)).toBe(0x04034b50)
    expect(view.getUint32(localOffset + 14, true)).toBe(crc)
    const localNameLen = view.getUint16(localOffset + 26, true)
    const localExtraLen = view.getUint16(localOffset + 28, true)
    expect(dec.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLen))).toBe(name)
    const start = localOffset + 30 + localNameLen + localExtraLen
    entries.push({ name, data: bytes.subarray(start, start + size), crc, method })

    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

const partsOf = (bytes: Uint8Array): Map<string, string> =>
  new Map(readZip(bytes).map((e) => [e.name, dec.decode(e.data)]))

const parseXml = (xml: string): Document => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
  return doc
}

const sheetDoc = (sheets: XlsxSheet[], i = 1): Document => {
  const xml = partsOf(buildXlsx(sheets)).get(`xl/worksheets/sheet${i}.xml`)
  expect(xml).toBeDefined()
  return parseXml(xml as string)
}

const cellAt = (doc: Document, ref: string): Element | undefined =>
  Array.from(doc.getElementsByTagName('c')).find((c) => c.getAttribute('r') === ref)

const basic: XlsxSheet = {
  name: 'Report',
  head: ['Name', 'Calls', 'Bill'],
  rows: [['Alice', 12, 99.5], ['Bob', 3, 10]],
  foot: ['Total', 15, 109.5],
  formats: ['text', 'integer', 'currency'],
}

describe('buildXlsx · ZIP container', () => {
  it('writes a readable stored ZIP with valid CRCs for every part', () => {
    const entries = readZip(buildXlsx([basic]))
    for (const e of entries) {
      expect(e.method).toBe(0)
      expect(e.crc).toBe(crc32(e.data))
    }
  })

  it('contains exactly the OOXML parts a workbook needs, one worksheet per sheet', () => {
    const names = readZip(buildXlsx([basic, { ...basic, name: 'Second' }])).map((e) => e.name)
    expect(names).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ])
  })

  it('produces well-formed XML in every part', () => {
    for (const xml of partsOf(buildXlsx([basic])).values()) parseXml(xml)
  })

  it('encodes non-ASCII text as UTF-8 and keeps sizes in bytes', () => {
    const parts = partsOf(buildXlsx([{ name: 'Ünïcode', head: ['Café'], rows: [['naïve — ✓']] }]))
    expect(parts.get('xl/worksheets/sheet1.xml')).toContain('naïve — ✓')
    expect(parts.get('xl/workbook.xml')).toContain('name="Ünïcode"')
  })
})

describe('buildXlsx · package parts', () => {
  it('declares a content type override for the workbook, styles and each sheet', () => {
    const ct = parseXml(partsOf(buildXlsx([basic, basic, basic])).get('[Content_Types].xml') as string)
    const names = Array.from(ct.getElementsByTagName('Override')).map((o) => o.getAttribute('PartName'))
    expect(names).toEqual([
      '/xl/workbook.xml', '/xl/styles.xml',
      '/xl/worksheets/sheet1.xml', '/xl/worksheets/sheet2.xml', '/xl/worksheets/sheet3.xml',
    ])
  })

  it('links each workbook sheet to its worksheet part and the styles to the next id', () => {
    const parts = partsOf(buildXlsx([basic, { ...basic, name: 'Two' }]))
    const wb = parseXml(parts.get('xl/workbook.xml') as string)
    const sheets = Array.from(wb.getElementsByTagName('sheet'))
    expect(sheets.map((s) => s.getAttribute('name'))).toEqual(['Report', 'Two'])
    expect(sheets.map((s) => s.getAttribute('sheetId'))).toEqual(['1', '2'])
    expect(sheets.map((s) => s.getAttribute('r:id'))).toEqual(['rId1', 'rId2'])

    const rels = parseXml(parts.get('xl/_rels/workbook.xml.rels') as string)
    const targets = Object.fromEntries(
      Array.from(rels.getElementsByTagName('Relationship')).map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]),
    )
    expect(targets).toEqual({ rId1: 'worksheets/sheet1.xml', rId2: 'worksheets/sheet2.xml', rId3: 'styles.xml' })
  })

  it('points the root relationship at the workbook', () => {
    const rels = parseXml(partsOf(buildXlsx([basic])).get('_rels/.rels') as string)
    expect(rels.getElementsByTagName('Relationship')[0].getAttribute('Target')).toBe('xl/workbook.xml')
  })

  it('defines ten cell styles, matching the indices the cells use', () => {
    const styles = parseXml(partsOf(buildXlsx([basic])).get('xl/styles.xml') as string)
    const xfs = styles.getElementsByTagName('cellXfs')[0]
    expect(xfs.getAttribute('count')).toBe('10')
    expect(xfs.getElementsByTagName('xf')).toHaveLength(10)
  })
})

describe('buildXlsx · sheet names', () => {
  const names = (sheets: XlsxSheet[]): (string | null)[] =>
    Array.from(parseXml(partsOf(buildXlsx(sheets)).get('xl/workbook.xml') as string).getElementsByTagName('sheet'))
      .map((s) => s.getAttribute('name'))

  it('replaces characters Excel forbids and trims', () => {
    expect(names([{ ...basic, name: ' a/b\\c[d]e:f*g?h ' }])).toEqual(['a b c d e f g h'])
  })

  it('truncates to Excel’s 31-character limit', () => {
    const [n] = names([{ ...basic, name: 'x'.repeat(40) }])
    expect(n).toHaveLength(31)
  })

  it('falls back to SheetN for a blank name', () => {
    expect(names([basic, { ...basic, name: '  ' }, { ...basic, name: '///' }])).toEqual(['Report', 'Sheet2', 'Sheet3'])
  })

  it('escapes XML-special characters in the name', () => {
    const xml = partsOf(buildXlsx([{ ...basic, name: 'P&L "Q1"' }])).get('xl/workbook.xml') as string
    expect(xml).toContain('name="P&amp;L &quot;Q1&quot;"')
    expect(names([{ ...basic, name: 'P&L "Q1"' }])).toEqual(['P&L "Q1"'])
  })
})

describe('buildXlsx · worksheet cells', () => {
  it('writes the head as bold inline strings in row 1 with style 1', () => {
    const doc = sheetDoc([basic])
    const head = doc.getElementsByTagName('row')[0]
    expect(head.getAttribute('r')).toBe('1')
    const cells = Array.from(head.getElementsByTagName('c'))
    expect(cells.map((c) => c.getAttribute('r'))).toEqual(['A1', 'B1', 'C1'])
    expect(cells.every((c) => c.getAttribute('s') === '1' && c.getAttribute('t') === 'inlineStr')).toBe(true)
    expect(cells.map((c) => c.textContent)).toEqual(['Name', 'Calls', 'Bill'])
  })

  it('keeps numbers as numbers and text as inline strings', () => {
    const doc = sheetDoc([basic])
    const b2 = cellAt(doc, 'B2')
    expect(b2?.getAttribute('t')).toBeNull()
    expect(b2?.getElementsByTagName('v')[0].textContent).toBe('12')
    expect(cellAt(doc, 'A2')?.getAttribute('t')).toBe('inlineStr')
    expect(cellAt(doc, 'A2')?.textContent).toBe('Alice')
  })

  it('applies the column formats to body and foot cells', () => {
    const doc = sheetDoc([basic])
    expect(cellAt(doc, 'A2')?.getAttribute('s')).toBe('0')
    expect(cellAt(doc, 'B2')?.getAttribute('s')).toBe('3')
    expect(cellAt(doc, 'C2')?.getAttribute('s')).toBe('2')
    expect(cellAt(doc, 'A4')?.getAttribute('s')).toBe('4')
    expect(cellAt(doc, 'B4')?.getAttribute('s')).toBe('6')
    expect(cellAt(doc, 'C4')?.getAttribute('s')).toBe('5')
  })

  it('writes empty cells for null, undefined and the empty string', () => {
    const doc = sheetDoc([{ name: 's', head: ['a', 'b', 'c'], rows: [[null, undefined, '']] }])
    for (const ref of ['A2', 'B2', 'C2']) {
      const c = cellAt(doc, ref)
      expect(c).toBeDefined()
      expect(c?.childNodes).toHaveLength(0)
    }
  })

  it('writes zero as a number, not an empty cell', () => {
    const doc = sheetDoc([{ name: 's', head: ['n'], rows: [[0]] }])
    expect(cellAt(doc, 'A2')?.getElementsByTagName('v')[0].textContent).toBe('0')
  })

  it('writes non-finite numbers as text so the file stays valid', () => {
    const doc = sheetDoc([{ name: 's', head: ['n', 'm'], rows: [[Number.NaN, Number.POSITIVE_INFINITY]] }])
    expect(cellAt(doc, 'A2')?.getAttribute('t')).toBe('inlineStr')
    expect(cellAt(doc, 'A2')?.textContent).toBe('NaN')
    expect(cellAt(doc, 'B2')?.textContent).toBe('Infinity')
  })

  it('escapes XML-special characters and preserves whitespace in text', () => {
    const doc = sheetDoc([{ name: 's', head: ['<h>'], rows: [[`  a < b & "c" 'd' >  `]] }])
    expect(cellAt(doc, 'A1')?.textContent).toBe('<h>')
    const t = cellAt(doc, 'A2')?.getElementsByTagName('t')[0]
    expect(t?.textContent).toBe(`  a < b & "c" 'd' >  `)
    expect(t?.getAttribute('xml:space')).toBe('preserve')
  })

  it('numbers rows consecutively and puts the foot after the last body row', () => {
    const doc = sheetDoc([basic])
    expect(Array.from(doc.getElementsByTagName('row')).map((r) => r.getAttribute('r'))).toEqual(['1', '2', '3', '4'])
  })

  it('omits the foot row when there is no foot', () => {
    const doc = sheetDoc([{ ...basic, foot: undefined }])
    expect(doc.getElementsByTagName('row')).toHaveLength(3)
    expect(doc.getElementsByTagName('dimension')[0].getAttribute('ref')).toBe('A1:C3')
  })

  it('sets the dimension from the widest row and the row count', () => {
    const doc = sheetDoc([{ name: 's', head: ['a'], rows: [['x', 'y', 'z', 'w']], foot: ['t', 1] }])
    expect(doc.getElementsByTagName('dimension')[0].getAttribute('ref')).toBe('A1:D3')
  })

  it('still has a valid dimension for a sheet with no columns or rows', () => {
    const doc = sheetDoc([{ name: 'empty', head: [], rows: [] }])
    expect(doc.getElementsByTagName('dimension')[0].getAttribute('ref')).toBe('A1:A1')
    expect(doc.getElementsByTagName('col')).toHaveLength(1)
  })

  it('names columns past Z as AA, AB … and past AZ as BA', () => {
    const head = Array.from({ length: 53 }, (_, i) => `h${i}`)
    const doc = sheetDoc([{ name: 's', head, rows: [] }])
    const refs = Array.from(doc.getElementsByTagName('c')).map((c) => c.getAttribute('r'))
    expect(refs[25]).toBe('Z1')
    expect(refs[26]).toBe('AA1')
    expect(refs[27]).toBe('AB1')
    expect(refs[51]).toBe('AZ1')
    expect(refs[52]).toBe('BA1')
    expect(doc.getElementsByTagName('dimension')[0].getAttribute('ref')).toBe('A1:BA1')
  })

  it('freezes the header row', () => {
    const pane = sheetDoc([basic]).getElementsByTagName('pane')[0]
    expect(pane.getAttribute('ySplit')).toBe('1')
    expect(pane.getAttribute('topLeftCell')).toBe('A2')
    expect(pane.getAttribute('state')).toBe('frozen')
  })

  it('sizes columns by format and header length, capped at 46', () => {
    const doc = sheetDoc([{
      name: 's',
      head: ['A', 'B', 'C', 'A much longer column heading here', 'y'.repeat(80)],
      rows: [],
      formats: ['currency', 'integer', 'text', 'text', 'text'],
    }])
    const widths = Array.from(doc.getElementsByTagName('col')).map((c) => Number(c.getAttribute('width')))
    expect(widths).toEqual([14, 11, 12, 35, 46])
  })
})

describe('buildXlsx · red cells', () => {
  const sheet: XlsxSheet = {
    name: 's',
    head: ['Name', 'Late', 'Fine'],
    rows: [['A', 3, 5], ['B', 0, 0]],
    foot: ['Total', 3, 5],
    formats: ['text', 'integer', 'currency'],
  }

  it('marks the body cells the callback picks, by zero-based row and column', () => {
    const calls: [number, number][] = []
    const doc = sheetDoc([{ ...sheet, red: (r, c) => { calls.push([r, c]); return r === 0 } }])
    expect(cellAt(doc, 'A2')?.getAttribute('s')).toBe('7')
    expect(cellAt(doc, 'B2')?.getAttribute('s')).toBe('8')
    expect(cellAt(doc, 'C2')?.getAttribute('s')).toBe('9')
    expect(cellAt(doc, 'A3')?.getAttribute('s')).toBe('0')
    expect(cellAt(doc, 'B3')?.getAttribute('s')).toBe('3')
    expect(calls).toEqual([[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]])
  })

  it('never marks the head or the foot', () => {
    const doc = sheetDoc([{ ...sheet, red: () => true }])
    expect(cellAt(doc, 'A1')?.getAttribute('s')).toBe('1')
    expect(cellAt(doc, 'A4')?.getAttribute('s')).toBe('4')
    expect(cellAt(doc, 'B4')?.getAttribute('s')).toBe('6')
    expect(cellAt(doc, 'C4')?.getAttribute('s')).toBe('5')
  })

  it('only marks on an explicit true', () => {
    const doc = sheetDoc([{ ...sheet, red: () => 1 as unknown as boolean }])
    expect(cellAt(doc, 'A2')?.getAttribute('s')).toBe('0')
  })
})

describe('saveXlsx and saveCsv', () => {
  let blobs: Blob[]
  let downloads: string[]
  const created = 'blob:mock-url'

  beforeEach(() => {
    blobs = []
    downloads = []
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true, writable: true, value: vi.fn((b: Blob) => { blobs.push(b); return created }),
    })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download)
      expect(this.href).toBe(created)
      expect(document.body.contains(this)).toBe(true)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(URL, 'createObjectURL')
    Reflect.deleteProperty(URL, 'revokeObjectURL')
  })

  const bytesOf = (b: Blob): Promise<Uint8Array> => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(b)
  })

  it('downloads the workbook under the given name, cleans up the link and revokes the URL', async () => {
    vi.useFakeTimers()
    saveXlsx('report.xlsx', [basic])
    expect(downloads).toEqual(['report.xlsx'])
    expect(document.querySelectorAll('a')).toHaveLength(0)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(created)
    vi.useRealTimers()

    expect(blobs[0].type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(await bytesOf(blobs[0])).toEqual(buildXlsx([basic]))
  })

  it('writes a UTF-8 CSV with a BOM and CRLF line endings, head then rows then foot', async () => {
    saveCsv('out.csv', ['Name', 'Calls'], [['Alice', 12], ['Bob', null]], ['Total', 12])
    expect(downloads).toEqual(['out.csv'])
    expect(blobs[0].type).toBe('text/csv;charset=utf-8')
    const bytes = await bytesOf(blobs[0])
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(bytes.subarray(3))).toBe('Name,Calls\r\nAlice,12\r\nBob,\r\nTotal,12')
  })

  it('quotes CSV fields containing commas, quotes or line breaks and doubles inner quotes', async () => {
    saveCsv('q.csv', ['a'], [['x,y'], ['say "hi"'], ['two\nlines'], ['cr\rhere'], ['plain'], [undefined], [0]])
    const text = new TextDecoder().decode((await bytesOf(blobs[0])).subarray(3))
    expect(text).toBe('a\r\n"x,y"\r\n"say ""hi"""\r\n"two\nlines"\r\n"cr\rhere"\r\nplain\r\n\r\n0')
  })

  it('omits the foot line when no foot is given', async () => {
    saveCsv('n.csv', ['h'], [['v']])
    expect(new TextDecoder().decode((await bytesOf(blobs[0])).subarray(3))).toBe('h\r\nv')
  })
})
