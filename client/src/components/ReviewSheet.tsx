import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api/client'
import { BEHAVIOUR_RATINGS, NUMERIC, PERFORMANCE_RATINGS } from '../lib/review'
import type { QueuePerson, ReviewDepartment, ReviewEntry, ReviewKind } from '../types'
import NamePicker from './NamePicker'
import { cx } from './ui'

/**
 * The Performance and Behaviour sheets — the same table with one column swapped, so both
 * tabs read and behave identically.
 *
 *   Performance   Sr · Name · Department · Performance · Percentage
 *   Behaviour     Sr · Month · Name · Department · Behaviour analysis
 *
 * Rows sit under a navy band per department, exactly as the client's sheet groups them,
 * and Sr. No. runs continuously across the bands. Every band ends in a blank row that adds
 * a person to that department, so the band you type under decides where the row lands.
 *
 * Ratings are dropdowns; the DEPARTMENT cell stays free text because it carries the
 * cross-department notes ("Billing/Audits") rather than the band's own name.
 */
export default function ReviewSheet({
  kind, month, entries, departments, people, onChanged, onRosterChanged,
}: {
  kind: ReviewKind
  /** The month new behaviour rows are filed under (YYYY-MM); ignored for performance. */
  month: string
  entries: ReviewEntry[]
  departments: ReviewDepartment[]
  /** The staff roster the NAME cell picks from. */
  people: QueuePerson[]
  onChanged: () => void
  /** A name was added to or removed from the roster. */
  onRosterChanged: () => void
}) {
  const behaviour = kind === 'behaviour'

  // One group per department, in the Department tab's order. "No department" only appears
  // when it holds rows — or when there are no departments at all, so entry is still possible.
  const orphans = entries.filter((e) => e.department_id === null)
  const groups: { id: number | null; name: string }[] = [
    ...departments.map((d) => ({ id: d.id as number | null, name: d.name })),
    ...(orphans.length > 0 || departments.length === 0
      ? [{ id: null as number | null, name: 'No department' }]
      : []),
  ]

  // Sr · [Month] · Name · Department · rating · [Percentage · Notes] · actions.
  const COLUMNS = behaviour ? 6 : 8
  let sr = 0

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-2xl border-collapse text-xs [&_td]:border [&_td]:border-white [&_th]:border [&_th]:border-white">
        <colgroup>
          <col style={{ width: '5%' }} />
          {behaviour && <col style={{ width: '9%' }} />}
          <col style={{ width: behaviour ? '20%' : '19%' }} />
          <col style={{ width: behaviour ? '16%' : '14%' }} />
          <col style={{ width: behaviour ? '44%' : '16%' }} />
          {!behaviour && <col style={{ width: '10%' }} />}
          {!behaviour && <col style={{ width: '30%' }} />}
          <col style={{ width: '6%' }} />
        </colgroup>
        <thead>
          <tr className="bg-[#1a3654] text-center text-[11px] font-bold uppercase tracking-wide text-white">
            <th className={headCls}>{behaviour ? 'Sr. No' : 'Sr'}</th>
            {behaviour && <th className={headCls}>Month</th>}
            <th className={headCls}>Name</th>
            <th className={headCls}>Department</th>
            <th className={headCls}>{behaviour ? 'Behaviour Analysis' : 'Perfomance'}</th>
            {!behaviour && <th className={headCls}>Percentage</th>}
            {!behaviour && <th className={headCls}>Notes</th>}
            <th className={headCls} aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const rows = entries.filter((e) => e.department_id === group.id)
            return (
              <Fragment key={`group-${group.id ?? 'none'}`}>
                <tr className="bg-[#1a3654] text-white">
                  <td className="px-2 py-1" />
                  <td className="px-2 py-1 text-[11px] font-bold uppercase tracking-wide" colSpan={COLUMNS - 1}>
                    {group.name}
                  </td>
                </tr>
                {rows.map((entry) => {
                  sr += 1
                  return (
                    <Row
                      key={entry.id}
                      sr={sr}
                      first={sr === 1}
                      entry={entry}
                      kind={kind}
                      departments={departments}
                      people={people}
                      onChanged={onChanged}
                      onRosterChanged={onRosterChanged}
                    />
                  )
                })}
                <AddRow
                  kind={kind}
                  month={month}
                  departmentId={group.id}
                  departments={departments}
                  people={people}
                  onChanged={onChanged}
                  onRosterChanged={onRosterChanged}
                />
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const headCls = 'px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide'
const cellCls = 'px-1.5 py-0.5'
const idxCell = cx(cellCls, 'bg-[#bfdeeb] text-center text-xs font-bold text-[#1a3654]')
const fieldCls =
  'w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-900 '
  + 'placeholder:text-slate-400 focus:border-[#1a3654] focus:outline-none focus:ring-1 focus:ring-[#1a3654]/30'

/** The editable half of a row — the same shape whether it is being added or edited. */
interface Draft {
  person_name: string
  department_note: string
  rating: string
  percentage: string
  notes: string
}

const blank = (): Draft => ({ person_name: '', department_note: '', rating: '', percentage: '', notes: '' })
const draftOf = (e: ReviewEntry): Draft => ({
  person_name: e.person_name,
  department_note: e.department_note,
  rating: e.rating,
  percentage: e.percentage === null ? '' : String(e.percentage),
  notes: e.notes,
})

/** The cells shared by both rows, so the add row can't drift from the saved one. */
function Cells({
  draft, onDraft, kind, departments, people, onRosterChanged, onRating, onDepartmentNote, onName, onNotes,
}: {
  draft: Draft
  onDraft: (d: Draft) => void
  kind: ReviewKind
  /** The DEPARTMENT cell's options — the Department tab's list. */
  departments: ReviewDepartment[]
  /** The NAME cell's list. */
  people: QueuePerson[]
  onRosterChanged: () => void
  /** Pickers save at once rather than waiting for the row to lose focus. */
  onRating?: (value: string) => void
  onDepartmentNote?: (value: string) => void
  onName?: (value: string) => void
  onNotes?: (value: string) => void
}) {
  const ratings = kind === 'behaviour' ? BEHAVIOUR_RATINGS : PERFORMANCE_RATINGS
  // A note left over from a department that has since been renamed or removed stays
  // selectable, so opening the dropdown can't silently rewrite it.
  const options = departments.map((d) => d.name)
  if (draft.department_note !== '' && !options.includes(draft.department_note)) {
    options.push(draft.department_note)
  }

  return (
    <>
      <td className={cellCls}>
        <NamePicker
          value={draft.person_name}
          people={people}
          onRosterChanged={onRosterChanged}
          onChange={(name) => {
            onDraft({ ...draft, person_name: name })
            onName?.(name)
          }}
        />
      </td>
      <td className={cellCls}>
        <select
          value={draft.department_note}
          title="Only when the person's department differs from the band above"
          onChange={(e) => {
            onDraft({ ...draft, department_note: e.target.value })
            onDepartmentNote?.(e.target.value)
          }}
          className={cx(fieldCls, draft.department_note === '' && 'text-slate-400')}
        >
          <option value="">—</option>
          {options.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </td>
      <td className={cellCls}>
        <select
          value={draft.rating}
          onChange={(e) => {
            onDraft({ ...draft, rating: e.target.value })
            onRating?.(e.target.value)
          }}
          className={cx(fieldCls, 'font-semibold', draft.rating === '' && 'text-slate-500')}
        >
          <option value="">Select</option>
          {ratings.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </td>
      {kind === 'performance' && (
        <>
          <td className={cellCls}>
            <div className="flex items-center gap-0.5">
              <input
                value={draft.percentage}
                placeholder="—"
                inputMode="decimal"
                onChange={(e) => { if (NUMERIC.test(e.target.value)) onDraft({ ...draft, percentage: e.target.value }) }}
                className={cx(fieldCls, 'text-right font-semibold')}
              />
              <span className="text-[11px] font-bold text-slate-500">%</span>
            </div>
          </td>
          <td className={cellCls}>
            <NoteCell
              value={draft.notes}
              onSave={(text) => {
                onDraft({ ...draft, notes: text })
                onNotes?.(text)
              }}
            />
          </td>
        </>
      )}
    </>
  )
}

// ── The notes cell ──────────────────────────────────────────────────────────────

/**
 * A one-line cell that opens a proper writing box: review notes run to a sentence or two,
 * which an input in a dense sheet can't show, so the cell previews the note and the popover
 * holds the whole thing.
 */
function NoteCell({ value, onSave }: { value: string; onSave: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(value)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 320 })

  const commit = () => {
    setOpen(false)
    if (text.trim() !== value.trim()) onSave(text.trim())
  }

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const margin = 8
    const width = Math.min(380, window.innerWidth - margin * 2)
    let left = r.left
    if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width
    if (left < margin) left = margin
    setPos({ top: r.bottom + 4 + window.scrollY, left: left + window.scrollX, width })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (document.querySelector('[data-note-popover]')?.contains(t)) return
      commit()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setText(value); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  })

  return (
    <div ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? commit() : (setText(value), setOpen(true)))}
        title={value || 'Add a note'}
        className={cx(
          'flex w-full items-center gap-1 rounded border bg-white px-1.5 py-0.5 text-left text-xs transition-colors',
          open ? 'border-[#1a3654] ring-1 ring-[#1a3654]/30' : 'border-slate-300 hover:border-[#1a3654]',
          value === '' ? 'text-slate-400' : 'text-slate-800',
        )}
      >
        <NoteIcon filled={value !== ''} />
        <span className="truncate">{value || 'Add note'}</span>
      </button>

      {open && createPortal(
        <div
          data-note-popover
          style={{ position: 'absolute', top: pos.top, left: pos.left, width: pos.width }}
          className="z-50 rounded-xl border border-slate-300 bg-white p-2 shadow-2xl shadow-slate-900/20"
        >
          <textarea
            value={text}
            autoFocus
            rows={4}
            placeholder="Note about this person's review…"
            onChange={(e) => setText(e.target.value)}
            className="w-full resize-y rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#1a3654] focus:outline-none focus:ring-2 focus:ring-[#1a3654]/25"
          />
          <div className="mt-1.5 flex items-center justify-between">
            <button
              onClick={() => { setText(''); onSave(''); setOpen(false) }}
              disabled={value === '' && text === ''}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:border-slate-200 disabled:text-slate-400"
            >
              Clear
            </button>
            <button
              onClick={commit}
              className="rounded-lg bg-[#1a3654] px-3 py-1 text-[11px] font-bold text-white hover:bg-[#24466b]"
            >
              Save note
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

// ── Saved row ───────────────────────────────────────────────────────────────────
function Row({
  sr, first, entry, kind, departments, people, onChanged, onRosterChanged,
}: {
  sr: number
  /** The client's sheet stamps the month once, on the first row. */
  first: boolean
  entry: ReviewEntry
  kind: ReviewKind
  departments: ReviewDepartment[]
  people: QueuePerson[]
  onChanged: () => void
  onRosterChanged: () => void
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(entry))
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)

  const save = async (over?: Partial<Draft>) => {
    const next = { ...draft, ...over }
    const changed =
      next.person_name.trim() !== entry.person_name ||
      next.department_note.trim() !== entry.department_note ||
      next.rating !== entry.rating ||
      next.notes.trim() !== entry.notes ||
      (next.percentage === '' ? null : Number(next.percentage)) !== entry.percentage
    if (saving.current || !changed || next.person_name.trim() === '') return
    saving.current = true
    try {
      await api.updateReviewEntry(entry.id, {
        person_name: next.person_name.trim(),
        department_note: next.department_note.trim(),
        rating: next.rating,
        ...(kind === 'performance'
          ? {
            percentage: next.percentage === '' ? null : Number(next.percentage),
            notes: next.notes.trim(),
          }
          : {}),
      })
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  const remove = async () => {
    if (!confirm(`Delete ${entry.person_name}'s row?`)) return
    try {
      await api.deleteReviewEntry(entry.id)
      onChanged()
    } catch (err) { alert((err as Error).message) }
  }

  // Save once focus has left the row entirely, not on every cell-to-cell hop.
  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className="bg-[#d4e9f2] text-[#0f172a]">
      <td className={idxCell}>{sr}</td>
      {kind === 'behaviour' && (
        <td className={first ? idxCell : cx(cellCls, 'text-center')}>
          {first ? monthName(entry.month) : ''}
        </td>
      )}
      <Cells
        draft={draft} onDraft={setDraft} kind={kind} departments={departments}
        people={people} onRosterChanged={onRosterChanged}
        onRating={(v) => save({ rating: v })}
        onDepartmentNote={(v) => save({ department_note: v })}
        onName={(v) => save({ person_name: v })}
        onNotes={(v) => save({ notes: v })}
      />
      <td className="p-0">
        <div className="flex items-center justify-center">
          <button
            onClick={remove}
            title={`Delete ${entry.person_name}'s row`}
            aria-label={`Delete ${entry.person_name}'s row`}
            className="flex h-5 w-5 items-center justify-center rounded border border-slate-400 bg-white text-slate-600 transition-colors hover:border-red-600 hover:bg-red-600 hover:text-white"
          >
            <TrashIcon />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Trailing "add to this department" row ───────────────────────────────────────
function AddRow({
  kind, month, departmentId, departments, people, onChanged, onRosterChanged,
}: {
  kind: ReviewKind
  month: string
  departmentId: number | null
  departments: ReviewDepartment[]
  people: QueuePerson[]
  onChanged: () => void
  onRosterChanged: () => void
}) {
  const [draft, setDraft] = useState<Draft>(blank)
  const saving = useRef(false)

  const add = async () => {
    if (saving.current || draft.person_name.trim() === '') return
    saving.current = true
    try {
      await api.createReviewEntry({
        kind,
        department_id: departmentId,
        person_name: draft.person_name.trim(),
        department_note: draft.department_note.trim(),
        rating: draft.rating,
        ...(kind === 'performance'
          ? {
            percentage: draft.percentage === '' ? null : Number(draft.percentage),
            notes: draft.notes.trim(),
          }
          : { month }),
      })
      setDraft(blank())
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  return (
    <tr className="bg-[#eaf5fa] text-[#0f172a]" onKeyDown={(e) => { if (e.key === 'Enter') add() }}>
      <td className={cx(idxCell, 'text-slate-400')}>+</td>
      {kind === 'behaviour' && <td className={cx(cellCls, 'bg-[#eaf5fa]')} />}
      <Cells
        draft={draft} onDraft={setDraft} kind={kind} departments={departments}
        people={people} onRosterChanged={onRosterChanged}
      />
      <td className="p-0">
        <div className="flex items-center justify-center">
          <button
            onClick={add}
            disabled={draft.person_name.trim() === ''}
            title="Add row"
            aria-label="Add row"
            className="flex h-5 w-5 items-center justify-center rounded bg-[#1a3654] text-white transition-colors hover:bg-[#24466b] disabled:bg-slate-300"
          >
            <PlusIcon />
          </button>
        </div>
      </td>
    </tr>
  )
}

/** "JULY" from a stored YYYY-MM-DD — the way the client's sheet stamps the month. */
function monthName(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'long' }).toUpperCase()
}

const stroke = {
  fill: 'none' as const, stroke: 'currentColor', strokeWidth: 2.4,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}

const PlusIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" {...stroke}><path d="M12 5v14M5 12h14" /></svg>
)
const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" {...stroke}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </svg>
)
/** Solid once a note exists, so a glance down the column shows who has one. */
const NoteIcon = ({ filled }: { filled: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" {...stroke}
    className={cx('shrink-0', filled ? 'text-[#1a3654]' : 'text-slate-400')}
    fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.15 : 0}>
    <path d="M4 4h16v12H8l-4 4z" />
  </svg>
)
