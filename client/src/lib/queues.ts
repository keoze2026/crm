/**
 * Helpers for the Queues page. Records are built by picking a name and ticking queues, so
 * the sheet's Total is simply how many queues a record holds — nothing here counts text.
 * What is left is the parsing the two catalogue "add" boxes need: they accept a pasted
 * list, so a sheet can be seeded from the client's spreadsheet in one go.
 */

/** Split a pasted list of queue codes ("BHS, BOP Q04") into its codes. */
export function parseCodeList(raw: string): string[] {
  return dedupe(raw.split(/[,;/|\s]+/))
}

/** Split a pasted list of names ("Anna, Camp Team") — commas only, since names have spaces. */
export function parseNameList(raw: string): string[] {
  return dedupe(raw.split(/[,;\n]+/))
}

/** Trim, drop blanks, and collapse case-insensitive repeats, keeping the first spelling. */
function dedupe(parts: string[]): string[] {
  const out = new Map<string, string>()
  for (const part of parts) {
    const value = part.trim()
    if (value !== '' && !out.has(value.toLowerCase())) out.set(value.toLowerCase(), value)
  }
  return [...out.values()]
}

/** Case-insensitive "does this text appear in that value" — the panels' search. */
export const matches = (value: string, query: string): boolean =>
  value.toLowerCase().includes(query.trim().toLowerCase())

/**
 * Postgres hands back timestamps as "2026-09-03 09:13:33.062173-04" — a space instead of
 * the ISO "T", and a two-digit UTC offset. V8 accepts that as-is, but the spec doesn't, so
 * normalise to real ISO first rather than depending on a browser's date-parsing leniency.
 */
function toDate(ts: string): Date {
  const iso = ts.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
  return new Date(iso)
}

/**
 * The local calendar day (YYYY-MM-DD) of a timestamp from the API. Local parts, not
 * `toISOString()`, so an evening entry doesn't land on tomorrow's history group.
 */
export function entryDay(ts: string): string {
  const d = toDate(ts)
  if (Number.isNaN(d.getTime())) return ts.slice(0, 10)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Clock time of a timestamp, e.g. "2:45 PM" — the "keyed in at" detail in the history. */
export function entryTime(ts: string): string {
  const d = toDate(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
