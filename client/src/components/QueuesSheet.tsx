import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api/client'
import { num } from '../lib/format'
import { matches } from '../lib/queues'
import type { QueueAssignment, QueueCode, StaffMember } from '../types'
import {
  addBtnCls, addRowCls, cellCls, fieldCls, headCls, idxCell, removeBtnCls, rowCls, sheetStroke,
  tableCls, theadCls,
} from './sheet'
import { Spinner, cx } from './ui'

/**
 * The Queues sheet: Sr. No. · Name · Department · Queues · Total, keyed straight into the
 * table.
 *
 * Name is a dropdown of the shared staff roster (managed on the Staff page), and
 * DEPARTMENT is read straight off whoever is picked — it is never typed here, so it can
 * never disagree with the Staff page. Queues is a dropdown that ticks as many queue codes
 * as you like. Sr. No. is the row's position and Total is how many queues the row holds —
 * none of the three is typed, and none is stored.
 *
 * Existing rows save as soon as you change them (the queue dropdown saves once, when it
 * closes, rather than on every tick). The trailing row adds a record.
 *
 * `rows` may be a filtered view, so each row carries the Sr. No. it has in the full sheet
 * and numbering stays stable while searching.
 */
export default function QueuesSheet({
  rows, people, codes, filtered, onChanged,
}: {
  rows: { index: number; row: QueueAssignment }[]
  people: StaffMember[]
  codes: QueueCode[]
  /** True while a search narrows the sheet — the totals bar says so. */
  filtered: boolean
  onChanged: () => void
}) {
  const total = rows.reduce((s, r) => s + r.row.codes.length, 0)
  // Names still free to take a record — everyone else already holds one.
  const free = people.filter((p) => p.assignment_id === null)

  return (
    <div className="overflow-x-auto">
      <table className={cx(tableCls, "min-w-2xl")}>
        <colgroup>
          <col style={{ width: '6%' }} />
          <col style={{ width: '19%' }} />
          <col style={{ width: '17%' }} />
          <col style={{ width: '45%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '6%' }} />
        </colgroup>
        <thead>
          <tr className={theadCls}>
            <th className={headCls}>Sr. No.</th>
            <th className={headCls}>Name</th>
            <th className={headCls}>Department</th>
            <th className={headCls}>Queues</th>
            <th className={headCls}>Total</th>
            <th className={headCls} aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ index, row }) => (
            <Row key={row.id} index={index} row={row} people={people} codes={codes} onChanged={onChanged} />
          ))}
          {!filtered && <AddRow free={free} codes={codes} onChanged={onChanged} />}
        </tbody>
        <tfoot>
          <tr className="bg-[#1a3654] font-bold text-white">
            <td className="px-2 py-1.5 text-center text-[11px] font-bold uppercase" colSpan={4}>
              {filtered ? 'Total (shown)' : 'Total'}
            </td>
            <td className="px-2 py-1.5 text-center text-xs tabular-nums">{num(total)}</td>
            <td className="px-2 py-1.5" />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

const selectCls = cx(fieldCls, 'font-semibold')
/** Queue code as it reads in the sheet — small, bordered, spreadsheet blue. */
const chipCls = 'rounded border border-blue-300 bg-blue-50 px-1 text-[10px] font-bold leading-4 text-[#1d4ed8]'

// ── Existing record ─────────────────────────────────────────────────────────────
function Row({
  index, row, people, codes, onChanged,
}: { index: number; row: QueueAssignment; people: StaffMember[]; codes: QueueCode[]; onChanged: () => void }) {
  // The queue dropdown edits this draft live (so Total moves with it) and saves once,
  // when it closes — one request per edit instead of one per tick.
  const signature = row.codes.map((c) => c.id).join(',')
  const [draft, setDraft] = useState<number[]>(() => row.codes.map((c) => c.id))
  const [seen, setSeen] = useState(signature)
  const [busy, setBusy] = useState(false)

  // Adopt the server's answer whenever the row changes underneath us — the render-phase
  // reset React prescribes for state derived from props, rather than an effect.
  if (seen !== signature) {
    setSeen(signature)
    setDraft(signature === '' ? [] : signature.split(',').map(Number))
  }

  const changePerson = async (personId: number) => {
    setBusy(true)
    try {
      await api.updateQueueAssignment(row.id, { person_id: personId })
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { setBusy(false) }
  }

  const commitCodes = async (ids: number[]) => {
    // Order-insensitive: the draft is in tick order, the server answers in code order.
    if ([...ids].sort().join(',') === [...row.codes.map((c) => c.id)].sort().join(',')) return
    setBusy(true)
    try {
      await api.updateQueueAssignment(row.id, { code_ids: ids })
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!confirm(`Delete ${row.name}'s record (${row.codes.length} queues)?`)) return
    try {
      await api.deleteQueueAssignment(row.id)
      onChanged()
    } catch (err) { alert((err as Error).message) }
  }

  return (
    <tr className={rowCls}>
      <td className={idxCell}>{index}</td>
      <td className={cellCls}>
        <select
          value={row.person_id}
          disabled={busy}
          onChange={(e) => changePerson(Number(e.target.value))}
          className={selectCls}
        >
          {people.map((p) => (
            // A name that already holds another record can't take this one too.
            <option key={p.id} value={p.id} disabled={p.assignment_id !== null && p.assignment_id !== row.id}>
              {p.name}
            </option>
          ))}
        </select>
      </td>
      <td className={cx(cellCls, 'text-[11px] font-semibold text-slate-700')}>
        <DepartmentCell departments={row.departments} />
      </td>
      <td className={cellCls}>
        <QueuePicker codes={codes} value={draft} onChange={setDraft} onClose={() => commitCodes(draft)} />
      </td>
      <td className={cx(cellCls, 'text-center text-xs font-bold tabular-nums')}>{draft.length}</td>
      <td className="p-0">
        <div className="flex items-center justify-center">
          {busy ? <Spinner className="h-4 w-4" /> : (
            <button
              onClick={remove}
              title={`Delete ${row.name}'s record`}
              aria-label={`Delete ${row.name}'s record`}
              className={removeBtnCls}
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Trailing "add a record" row ─────────────────────────────────────────────────
function AddRow({ free, codes, onChanged }: { free: StaffMember[]; codes: QueueCode[]; onChanged: () => void }) {
  const [personId, setPersonId] = useState<number | ''>('')
  const [picked, setPicked] = useState<number[]>([])
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (personId === '' || busy) return
    setBusy(true)
    try {
      await api.createQueueAssignment({ person_id: Number(personId), code_ids: picked })
      setPersonId(''); setPicked([])
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <tr className={addRowCls}>
      <td className={cx(idxCell, 'text-slate-400')}>+</td>
      <td className={cellCls}>
        <select
          value={personId}
          disabled={free.length === 0}
          onChange={(e) => setPersonId(e.target.value === '' ? '' : Number(e.target.value))}
          className={cx(selectCls, personId === '' && 'text-slate-500')}
        >
          <option value="">{free.length === 0 ? 'All names used' : 'Select name'}</option>
          {free.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </td>
      {/* Follows the picked name straight away, so the band is visible before saving. */}
      <td className={cx(cellCls, 'text-[11px] font-semibold text-slate-700')}>
        <DepartmentCell departments={free.find((p) => p.id === personId)?.departments ?? []} />
      </td>
      <td className={cellCls}>
        <QueuePicker codes={codes} value={picked} onChange={setPicked} />
      </td>
      <td className={cx(cellCls, 'text-center text-xs font-bold tabular-nums text-slate-500')}>{picked.length}</td>
      <td className="p-0">
        <div className="flex items-center justify-center">
          <button
            onClick={add}
            disabled={personId === '' || busy}
            title="Add record"
            aria-label="Add record"
            className={addBtnCls}
          >
            {busy ? <Spinner className="h-4 w-4 text-white" /> : <PlusIcon />}
          </button>
        </div>
      </td>
    </tr>
  )
}

/**
 * The DEPARTMENT cell — read-only on purpose. Departments are edited on the Staff page, so
 * showing them here can never let the two lists drift apart.
 */
function DepartmentCell({ departments }: { departments: { id: number; name: string }[] }) {
  if (departments.length === 0) return <span className="text-slate-400">—</span>
  return (
    <div className="flex flex-wrap gap-0.5">
      {departments.map((d) => (
        <span key={d.id} className="rounded border border-slate-300 bg-slate-50 px-1 text-[10px] font-bold leading-4 text-slate-700">
          {d.name}
        </span>
      ))}
    </div>
  )
}

// ── The queues dropdown ─────────────────────────────────────────────────────────

/**
 * Multi-select dropdown for a Queues cell: the trigger shows what is picked, the panel
 * ticks as many codes as needed. Rendered in a portal so it escapes the sheet's
 * horizontal scroll container.
 */
function QueuePicker({
  codes, value, onChange, onClose,
}: {
  codes: QueueCode[]
  value: number[]
  onChange: (ids: number[]) => void
  /** Called when the panel closes — where a row saves its edit. */
  onClose?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 320 })

  const close = () => { setOpen(false); setSearch(''); onClose?.() }

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const margin = 8
    const width = Math.min(360, window.innerWidth - margin * 2)
    let left = r.left
    if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width
    if (left < margin) left = margin
    setPos({ top: r.bottom + 6 + window.scrollY, left: left + window.scrollX, width })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (document.querySelector('[data-queue-picker]')?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  })  // no dep list on purpose: `close` closes over the current draft, which changes as you tick

  const selected = codes.filter((c) => value.includes(c.id))
  const shown = codes.filter((c) => search.trim() === '' || matches(c.code, search))
  const toggle = (id: number) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])

  return (
    <div ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        title={selected.map((c) => c.code).join(', ')}
        className={cx(
          'flex w-full items-center justify-between gap-1.5 rounded border bg-white px-1.5 py-0.5 text-left transition-colors',
          open ? 'border-[#1a3654] ring-1 ring-[#1a3654]/30' : 'border-slate-300 hover:border-[#1a3654]',
        )}
      >
        {selected.length === 0 ? (
          <span className="py-0.5 text-xs font-medium text-slate-500">Select queues</span>
        ) : (
          <span className="flex flex-wrap gap-0.5 py-0.5">
            {selected.map((c) => (
              <span key={c.id} className={chipCls}>{c.code}</span>
            ))}
          </span>
        )}
        <CaretIcon open={open} />
      </button>

      {open && createPortal(
        <div
          data-queue-picker
          style={{ position: 'absolute', top: pos.top, left: pos.left, width: pos.width }}
          className="z-50 rounded-xl border border-slate-300 bg-white p-2.5 shadow-2xl shadow-slate-900/20"
        >
          <div className="mb-2 flex items-center gap-1.5">
            <input
              value={search}
              autoFocus
              placeholder="Search…"
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#1a3654] focus:outline-none focus:ring-2 focus:ring-[#1a3654]/25"
            />
            <button
              onClick={() => onChange([...new Set([...value, ...shown.map((c) => c.id)])])}
              className="shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              All
            </button>
            <button
              onClick={() => onChange([])}
              disabled={value.length === 0}
              className="shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:border-slate-200 disabled:text-slate-400"
            >
              None
            </button>
          </div>

          {codes.length === 0 ? (
            <p className="py-6 text-center text-xs font-medium text-slate-500">No queues in the list yet.</p>
          ) : shown.length === 0 ? (
            <p className="py-6 text-center text-xs font-medium text-slate-500">No match.</p>
          ) : (
            <div className="flex max-h-60 flex-wrap content-start gap-1.5 overflow-y-auto">
              {shown.map((c) => {
                const on = value.includes(c.id)
                return (
                  <button
                    key={c.id}
                    onClick={() => toggle(c.id)}
                    aria-pressed={on}
                    className={cx(
                      'flex items-center gap-1 rounded-lg border-2 px-2 py-1 text-xs font-bold transition-all',
                      on
                        ? 'border-[#1a3654] bg-[#1a3654] text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-[#1a3654] hover:bg-slate-100',
                    )}
                  >
                    {on && <CheckIcon />}
                    {c.code}
                  </button>
                )
              })}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2">
            <span className="text-xs font-bold text-slate-600">{value.length} selected</span>
            <button
              onClick={close}
              className="rounded-lg bg-[#1a3654] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#24466b]"
            >
              Done
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

// ── Icons ───────────────────────────────────────────────────────────────────────
// Sized larger than the shared row icons — these sit in the queue picker, not in a cell.

const PlusIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" {...sheetStroke}><path d="M12 5v14M5 12h14" /></svg>
)
const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" {...sheetStroke}><path d="m20 6-11 11-5-5" /></svg>
)
const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" {...sheetStroke}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </svg>
)
const CaretIcon = ({ open }: { open: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" {...sheetStroke}
    className={cx('shrink-0 text-slate-600 transition-transform', open && 'rotate-180')}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)
