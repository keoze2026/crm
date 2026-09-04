import { cx } from './ui'

/**
 * The spreadsheet look the Queues, Review and Staff sheets share: navy head, cyan body,
 * white gridlines, a darker Sr. No. band. Kept in one place so a new sheet can't drift
 * from the ones already printed.
 */

/**
 * The table itself. `table-fixed` is the important part: with it the `<colgroup>` widths
 * are binding, so one long note or department name wraps inside its column instead of
 * stretching it and squeezing everything else. Add a `min-w-*` per sheet for the width
 * below which it should scroll rather than crush.
 */
export const tableCls =
  'w-full table-fixed border-collapse text-xs [&_td]:border [&_td]:border-white '
  + '[&_th]:border [&_th]:border-white [&_td]:break-words'

export const headCls = 'px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide'
export const cellCls = 'px-1.5 py-0.5'

/** The Sr. No. column — the darker label band down the left edge. */
export const idxCell = cx(cellCls, 'bg-[#bfdeeb] text-center text-xs font-bold text-[#1a3654]')

/** A saved row. */
export const rowCls = 'bg-[#d4e9f2] text-[#0f172a]'
/** The trailing "add one" row, a shade lighter so it reads as not-yet-saved. */
export const addRowCls = 'bg-[#eaf5fa] text-[#0f172a]'
/** A full-width band naming the run of rows beneath it. */
export const bandCls = 'bg-[#1a3654] text-white'
/** The head row. */
export const theadCls = 'bg-[#1a3654] text-center text-[11px] font-bold uppercase tracking-wide text-white'

/** Any editable cell control. */
export const fieldCls =
  'w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-900 '
  + 'placeholder:text-slate-400 focus:border-[#1a3654] focus:outline-none focus:ring-1 focus:ring-[#1a3654]/30'

/** A read-only cell that looks like a field but isn't one — a fetched value. */
export const lockedCls =
  'w-full rounded border border-dashed border-slate-300 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-600'

/** The small square action button at the end of a row. */
export const addBtnCls =
  'flex h-5 w-5 items-center justify-center rounded bg-[#1a3654] text-white transition-colors '
  + 'hover:bg-[#24466b] disabled:bg-slate-300'
export const removeBtnCls =
  'flex h-5 w-5 items-center justify-center rounded border border-slate-400 bg-white text-slate-600 '
  + 'transition-colors hover:border-red-600 hover:bg-red-600 hover:text-white'

const stroke = {
  fill: 'none' as const, stroke: 'currentColor', strokeWidth: 2.4,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}

export const sheetStroke = stroke
