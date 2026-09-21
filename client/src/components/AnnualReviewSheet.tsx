// Annual Reviews — the Review page's half-yearly and yearly roll-up.
//
// Every month of the window is scored exactly as the Top Performer tab scores a month, and
// those monthly answers are added up into one row per person (see lib/annualReview.ts). So
// the six- and twelve-month figures are never a second opinion: correct a rating on the
// Performance tab and the yearly standing moves with it.
//
// The columns are fixed — a period is a report with a settled shape — but every cell can be
// typed over, and a typed figure is what the ranking and the two scorecards then read.
// Clearing the cell hands it back. Reset goes to the most recent version saved more than 24
// hours ago, so a day of edits can be dropped while yesterday's agreed sheet stands.
//
// Only the edits are stored (AnnualReviewController); the figures are never written down,
// which is what keeps a period and its months in step.
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import {
  COLUMNS,
  SPANS,
  SPAN_MONTHS,
  accumulate,
  cellValue,
  computedValue,
  fromWire,
  newRowKey,
  periodLabel as periodLabelOf,
  pickAnnual,
  rankAnnual,
  standingOf,
  toWire,
  type AnnualColumn,
  type AnnualContext,
  type AnnualOverrides,
  type AnnualRow,
  type AnnualSettings,
  type AnnualSpan,
  type ExtraRow,
  type MonthSlice,
} from '../lib/annualReview'
import { TOP_PERFORMER_PCT } from '../lib/incentive'
import { NUMERIC, PERFORMANCE_RATINGS } from '../lib/review'
import type { AnnualReviewSheet as AnnualSheetState } from '../types'
import NoteCell from './NoteCell'
import {
  addBtnCls, addRowCls, cellCls, fieldCls, headCls, idxCell, removeBtnCls, rowCls,
  tableCls, theadCls,
} from './sheet'
import { PlusIcon, TrashIcon } from './sheetIcons'
import { PerformerEndCard } from './TopPerformerSheet'
import { cx } from './ui'

/**
 * What the page needs back, so its PDF prints what the sheet is SHOWING — each cell as it
 * reads on screen, which means a typed-in figure prints as the figure. Flattened here
 * rather than handing the PDF the ranking, so the two can never render it differently.
 */
export interface AnnualExport {
  span: AnnualSpan
  periodLabel: string
  /** Months of the window a person must be reviewed in to be named. */
  minMonths: number
  columns: { id: string; label: string; align?: 'left' | 'center' | 'right' }[]
  rows: {
    name: string
    standing: 'top' | 'low' | null
    /** The cells, in the columns' order. */
    cells: string[]
    /** Ids of the columns on this row whose cell was typed in by hand. */
    typed: string[]
  }[]
}

const IconUndo = ({ size = 11 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 8h11a5 5 0 0 1 0 10H8" /><path d="m7 4-4 4 4 4" />
  </svg>
)

/** "19 Sep, 14:05" — short enough for a button's label. */
const stamp = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** A percentage column reads as a figure; the sign is the cell's, not the value's. */
const withPercent = (col: AnnualColumn, text: string): string =>
  col.kind === 'percent' && text.trim() !== '' ? `${text}%` : text

export default function AnnualReviewSheet({
  span, onSpan, months, saved, onExport,
}: {
  span: AnnualSpan
  onSpan: (s: AnnualSpan) => void
  /** The window, oldest month first — already scored, one slice per month. */
  months: MonthSlice[]
  /** The period's stored edits (null = nothing saved yet → the defaults). */
  saved: AnnualSheetState | null
  /** Told what the sheet is showing, so the page's PDF prints that and not the raw figures. */
  onExport?: (state: AnnualExport) => void
}) {
  const initial = useMemo(() => fromWire(saved, span), [saved, span])
  const [overrides, setOverrides] = useState<AnnualOverrides>(initial.overrides)
  const [extraRows, setExtraRows] = useState<ExtraRow[]>(initial.extraRows)
  const [settings, setSettings] = useState<AnnualSettings>(initial.settings)
  const [sync, setSync] = useState<'saved' | 'saving' | 'error'>('saved')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [resetTo, setResetTo] = useState<string | null>(saved?.reset_to ?? null)
  const [resetting, setResetting] = useState(false)
  const [addName, setAddName] = useState('')

  const endMonth = months.length ? months[months.length - 1].month : ''
  const label = useMemo(() => periodLabelOf(months.map((m) => m.month)), [months])

  // ─── Saving ────────────────────────────────────────────────────────────────
  //
  // Same contract as the Top Performer tab: the page remounts this sheet when the period
  // changes (key=…), so the initialisers above read that period's own state, and every
  // change is sent a moment later as one PUT of the whole sheet. A render that changes
  // nothing must not write anything — a re-sent payload could only overwrite the period
  // with what it already says, and would append a pointless version behind Reset.
  const onServer = useRef(JSON.stringify(toWire(initial.overrides, initial.extraRows, initial.settings)))
  const dirty = useRef(false)
  useEffect(() => {
    if (!dirty.current) { dirty.current = true; return }
    if (endMonth === '') return
    const payload = toWire(overrides, extraRows, settings)
    const json = JSON.stringify(payload)
    if (json === onServer.current) { setSync('saved'); return }
    setSync('saving')
    const handle = setTimeout(() => {
      api.saveAnnualReview(span, endMonth, payload)
        .then((state) => {
          onServer.current = json
          setSync('saved')
          setSyncError(null)
          // The save just became a version, so what Reset reaches for may have moved.
          setResetTo(state.reset_to)
        })
        .catch((err: Error) => { setSync('error'); setSyncError(err.message) })
    }, 600)
    return () => clearTimeout(handle)
  }, [span, endMonth, overrides, extraRows, settings])

  /** Back to the most recent save more than 24 hours old — the whole sheet at once. */
  const reset = async () => {
    if (endMonth === '') return
    if (!confirm(
      `Put this sheet back to how it was saved on ${stamp(resetTo)}?\n\n`
      + 'Everything typed in since then is replaced by that version. The version you are '
      + 'replacing is kept, so tomorrow\'s reset can undo this one.',
    )) return
    setResetting(true)
    try {
      const state = await api.resetAnnualReview(span, endMonth)
      const next = fromWire(state, span)
      setOverrides(next.overrides)
      setExtraRows(next.extraRows)
      setSettings(next.settings)
      // The restore IS now what the server holds, so the autosave above must not re-send it.
      onServer.current = JSON.stringify(toWire(next.overrides, next.extraRows, next.settings))
      setResetTo(state.reset_to)
      setSync('saved')
      setSyncError(null)
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setResetting(false)
    }
  }

  // ─── The roll-up ───────────────────────────────────────────────────────────

  const tallies = useMemo(() => accumulate(months, extraRows), [months, extraRows])
  const rows = useMemo(() => rankAnnual(tallies, overrides, settings.minMonths), [tallies, overrides, settings.minMonths])
  const picks = useMemo(() => pickAnnual(rows, settings.minMonths), [rows, settings.minMonths])
  const standing = useMemo(() => standingOf(picks), [picks])

  const ctxFor = (row: AnnualRow): AnnualContext => ({ minMonths: settings.minMonths, standing, row })
  const cell = (row: AnnualRow, col: AnnualColumn) =>
    withPercent(col, cellValue(col, row.tally, ctxFor(row), overrides))

  const scored = rows.filter((r) => r.score !== null)
  const avg = scored.length
    ? Math.round(scored.reduce((s, r) => s + (r.score as number), 0) / scored.length)
    : 0

  // The page's PDF prints exactly what is on screen, overrides included.
  useEffect(() => {
    onExport?.({
      span,
      periodLabel: label,
      minMonths: settings.minMonths,
      columns: COLUMNS.map((c) => ({ id: c.id, label: c.label, align: c.align })),
      rows: rows.map((r) => ({
        name: r.tally.name,
        standing: standing(r.tally.key),
        cells: COLUMNS.map((c) => cell(r, c)),
        typed: COLUMNS.filter((c) => overrides[r.tally.key]?.[c.id] !== undefined).map((c) => c.id),
      })),
    })
    // `cell` closes over exactly the state this list covers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [span, label, rows, overrides, standing, settings.minMonths, onExport])

  // ─── Editing ───────────────────────────────────────────────────────────────

  /** Type over a cell. An empty value is not an override — it hands the cell back. */
  const setCell = (rowKey: string, colId: string, value: string) => {
    setOverrides((prev) => {
      const own = { ...(prev[rowKey] ?? {}) }
      if (value.trim() === '') delete own[colId]
      else own[colId] = value
      const next = { ...prev }
      if (Object.keys(own).length === 0) delete next[rowKey]
      else next[rowKey] = own
      return next
    })
    // An added row's name is the row's own, not an override on top of an accumulation, so
    // renaming the cell renames the row — otherwise the stored row would keep the name it
    // was created with and the two would read differently after a reload.
    if (colId === 'name') {
      setExtraRows((prev) => prev.map((r) => (r.key === rowKey ? { ...r, name: value.trim() } : r)))
    }
  }

  const revertRow = (rowKey: string) =>
    setOverrides((prev) => {
      const next = { ...prev }
      delete next[rowKey]
      return next
    })

  const removeRow = (rowKey: string) => {
    setExtraRows((prev) => prev.filter((r) => r.key !== rowKey))
    revertRow(rowKey)
  }

  const addRow = () => {
    const name = addName.trim()
    if (name === '') return
    setExtraRows((prev) => [...prev, { key: newRowKey(), name }])
    setAddName('')
  }

  const spanName = SPANS.find((s) => s.id === span)?.short ?? ''

  return (
    <div className="space-y-4">
      {/* ── The period ───────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="inline-flex self-start rounded-lg border border-slate-200 p-0.5" role="tablist" aria-label="Period length">
          {SPANS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={span === s.id}
              onClick={() => onSpan(s.id)}
              className={cx(
                'rounded-md px-3 py-1 text-xs font-semibold transition-colors',
                span === s.id ? 'bg-brand text-white' : 'text-slate-500 hover:text-brand',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label
            className="inline-flex items-center gap-1.5 text-[11px] text-slate-600"
            title={`Somebody reviewed in fewer than this many of the period's ${SPAN_MONTHS[span]} months is still listed, but the period will not name them its top or its lowest.`}
          >
            Name on
            <input
              type="number"
              min={0}
              max={SPAN_MONTHS[span]}
              value={settings.minMonths}
              onChange={(e) => setSettings({
                minMonths: Math.max(0, Math.min(SPAN_MONTHS[span], Number(e.target.value) || 0)),
              })}
              className="w-12 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-center text-[11px] tabular-nums focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            + months
          </label>
          <span
            className={cx('text-[11px] font-medium', sync === 'error' ? 'text-rose-600' : sync === 'saving' ? 'text-slate-400' : 'text-emerald-600')}
            title={sync === 'error' ? syncError ?? 'Could not save' : undefined}
          >
            {sync === 'saving' ? 'Saving…' : sync === 'error' ? 'Not saved' : 'Saved'}
          </span>
          <button
            type="button"
            onClick={reset}
            disabled={resetTo === null || resetting}
            title={resetTo === null
              ? 'Nothing saved on this sheet is more than 24 hours old yet, so there is no earlier version to go back to.'
              : `Put the sheet back to how it was saved on ${stamp(resetTo)} — the most recent version more than 24 hours old.`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-brand hover:text-brand disabled:border-slate-200 disabled:text-slate-400 disabled:hover:border-slate-200 disabled:hover:text-slate-400"
          >
            <IconUndo size={12} />
            {resetting ? 'Resetting…' : resetTo === null ? 'Reset unavailable' : `Reset to ${stamp(resetTo)}`}
          </button>
        </div>
      </div>

      {/* ── The period's two names ───────────────────────────────────────── */}
      <div className="grid gap-2 xl:grid-cols-2">
        <PerformerEndCard
          end="top"
          people={picks.top.map((r) => ({ key: r.tally.key, name: r.tally.name, pct: picks.topPct }))}
          title={`${spanName} top performer`}
          empty={scored.length === 0 ? 'No reviews in this period yet' : `No one averaging ${TOP_PERFORMER_PCT}% over the period`}
          periodLabel={label}
        />
        <PerformerEndCard
          end="low"
          people={picks.low.map((r) => ({ key: r.tally.key, name: r.tally.name, pct: picks.lowPct }))}
          title={`${spanName} lowest performer`}
          empty={scored.length > 1 ? 'No one behind the rest over the period' : 'Not enough of the period reviewed to say'}
          periodLabel={label}
        />
      </div>

      {/* ── What the period is made of ───────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'People in the roll-up', value: String(rows.length), of: null, tone: 'text-slate-900' },
          { label: 'Average performance', value: `${avg}%`, of: null, tone: 'text-slate-900' },
          {
            label: `Reviewed in ${settings.minMonths}+ months`,
            value: String(scored.length - picks.uncovered.length),
            of: scored.length,
            tone: picks.uncovered.length ? 'text-amber-600' : 'text-slate-900',
          },
        ].map((t) => (
          <div key={t.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] font-medium text-slate-500">{t.label}</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className={cx('text-xl font-bold tabular-nums', t.tone)}>{t.value}</span>
              {t.of !== null && <span className="text-[11px] text-slate-400">of {t.of}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* ── The sheet ────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className={cx(tableCls, 'min-w-4xl')}>
          <colgroup>
            <col style={{ width: '5%' }} />
            {COLUMNS.map((c) => <col key={c.id} style={{ width: c.width }} />)}
            <col style={{ width: '4%' }} />
          </colgroup>
          <thead>
            <tr className={theadCls}>
              <th className={headCls}>Sr</th>
              {COLUMNS.map((c) => <th key={c.id} className={headCls}>{c.label}</th>)}
              <th className={headCls} aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className={rowCls}>
                <td className={cx(cellCls, 'py-6 text-center text-slate-500')} colSpan={COLUMNS.length + 2}>
                  No reviews in {label} yet — pick a rating on the monthly tabs, or add a row below.
                </td>
              </tr>
            ) : rows.map((row, i) => (
              <Row
                key={row.tally.key}
                sr={i + 1}
                row={row}
                ctx={ctxFor(row)}
                overrides={overrides}
                standing={standing(row.tally.key)}
                onCell={setCell}
                onRevert={revertRow}
                onRemove={removeRow}
              />
            ))}
            {/* Somebody the period's reviews produced no row for. */}
            <tr className={addRowCls} onKeyDown={(e) => { if (e.key === 'Enter') addRow() }}>
              <td className={cx(idxCell, 'text-slate-400')}>+</td>
              <td className={cellCls} colSpan={COLUMNS.length}>
                <input
                  value={addName}
                  placeholder="Add a row"
                  onChange={(e) => setAddName(e.target.value)}
                  className={cx(fieldCls, 'max-w-xs')}
                />
              </td>
              <td className="p-0">
                <div className="flex items-center justify-center">
                  <button
                    onClick={addRow}
                    disabled={addName.trim() === ''}
                    title="Add row"
                    aria-label="Add row"
                    className={addBtnCls}
                  >
                    <PlusIcon />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── One person over the period ──────────────────────────────────────────────────

function Row({
  sr, row, ctx, overrides, standing, onCell, onRevert, onRemove,
}: {
  sr: number
  row: AnnualRow
  ctx: AnnualContext
  overrides: AnnualOverrides
  standing: 'top' | 'low' | null
  onCell: (rowKey: string, colId: string, value: string) => void
  onRevert: (rowKey: string) => void
  onRemove: (rowKey: string) => void
}) {
  const t = row.tally
  const own = overrides[t.key] ?? {}
  const edited = Object.keys(own).length > 0

  return (
    <tr className={cx(
      rowCls,
      standing === 'top' && 'bg-emerald-50',
      standing === 'low' && 'bg-rose-50',
    )}>
      <td className={cx(idxCell, 'whitespace-nowrap')}>{sr}</td>
      {COLUMNS.map((col) => (
        <Cell
          key={col.id}
          col={col}
          row={row}
          ctx={ctx}
          typed={own[col.id] ?? null}
          onChange={(v) => onCell(t.key, col.id, v)}
        />
      ))}
      <td className="p-0">
        <div className="flex items-center justify-center">
          {t.manual ? (
            <button
              onClick={() => onRemove(t.key)}
              title={`Remove ${t.name || 'this'} row`}
              aria-label={`Remove ${t.name || 'this'} row`}
              className={removeBtnCls}
            >
              <TrashIcon />
            </button>
          ) : (
            <button
              onClick={() => onRevert(t.key)}
              disabled={!edited}
              title={edited
                ? `Hand every cell on ${t.name}'s row back to the accumulation`
                : 'Nothing on this row has been typed over'}
              aria-label={`Revert ${t.name}'s row`}
              className={cx(removeBtnCls, 'hover:border-brand hover:bg-brand', !edited && 'opacity-30')}
            >
              <IconUndo />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

/**
 * One cell — the accumulated value until somebody types over it, and then theirs.
 *
 * A typed cell is ringed and says what the accumulation would have shown, so a sheet handed
 * round is never ambiguous about which figures are the CRM's and which are a manager's.
 * Emptying it is how it goes back.
 */
function Cell({ col, row, ctx, typed, onChange }: {
  col: AnnualColumn
  row: AnnualRow
  ctx: AnnualContext
  /** The typed-in text, or null when the cell is still the accumulation's. */
  typed: string | null
  onChange: (value: string) => void
}) {
  const computed = computedValue(col, row.tally, ctx)
  const value = typed ?? computed
  const mine = typed !== null
  const title = mine && col.compute
    ? `Yours. The accumulation says: ${withPercent(col, computed) || '—'} · clear the cell to go back to it`
    : mine ? 'Yours'
    : col.compute ? 'Accumulated from the months — type to put your own figure here' : undefined

  const ring = mine ? 'ring-1 ring-amber-400' : ''
  const align = col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''

  if (col.kind === 'prose') {
    return (
      <td className={cellCls}>
        <NoteCell value={value} onSave={onChange} prompt="What the figures do not say…" />
      </td>
    )
  }

  if (col.kind === 'rating') {
    // A rating the accumulation produced, or one left over from a renamed vocabulary, stays
    // selectable — opening the dropdown must not quietly rewrite the cell.
    const options = [...PERFORMANCE_RATINGS]
    if (value !== '' && !options.includes(value)) options.push(value)
    return (
      <td className={cellCls}>
        <select
          value={value}
          title={title}
          onChange={(e) => onChange(e.target.value === computed ? '' : e.target.value)}
          className={cx(fieldCls, 'font-semibold', ring, value === '' && 'text-slate-500')}
        >
          <option value="">Select</option>
          {options.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </td>
    )
  }

  const numeric = col.kind === 'percent' || col.kind === 'number'
  return (
    <td className={cellCls}>
      <div className="flex items-center gap-0.5">
        <input
          value={value}
          placeholder={col.compute ? '—' : ''}
          title={title}
          inputMode={numeric ? 'decimal' : undefined}
          onChange={(e) => {
            const next = e.target.value
            // A figure cell takes digits; anything else takes what it is given. Typing the
            // accumulated value back is the same as not typing at all.
            if (numeric && !NUMERIC.test(next)) return
            onChange(next === computed ? '' : next)
          }}
          className={cx(fieldCls, ring, align, numeric && 'font-semibold tabular-nums', col.id === 'name' && 'font-semibold')}
        />
        {col.kind === 'percent' && <span className="text-[11px] font-bold text-slate-500">%</span>}
      </div>
    </td>
  )
}
