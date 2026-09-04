import { useRef, useState } from 'react'
import { api } from '../api/client'
import { NUMERIC, PERFORMANCE_RATINGS } from '../lib/review'
import type { ReviewDepartment } from '../types'
import { cx } from './ui'

/**
 * The Department tab: Sr. No · Department · Perfomance · %.
 *
 * It is also the catalogue the Performance and Behaviour tabs group by, so a department
 * added here becomes a band on both — and removing one leaves its people behind under
 * "No department" rather than deleting their reviews.
 */
export default function DepartmentSheet({
  departments, onChanged,
}: { departments: ReviewDepartment[]; onChanged: () => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-lg border-collapse text-xs [&_td]:border [&_td]:border-white [&_th]:border [&_th]:border-white">
        <colgroup>
          <col style={{ width: '9%' }} />
          <col style={{ width: '45%' }} />
          <col style={{ width: '24%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '8%' }} />
        </colgroup>
        <thead>
          <tr className="bg-[#1a3654] text-center text-[11px] font-bold uppercase tracking-wide text-white">
            <th className={headCls}>Sr. No</th>
            <th className={headCls}>Department</th>
            <th className={headCls}>Perfomance</th>
            <th className={headCls}>%</th>
            <th className={headCls} aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {departments.map((d, i) => (
            <Row key={d.id} index={i + 1} department={d} onChanged={onChanged} />
          ))}
          <AddRow onChanged={onChanged} />
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

interface Draft { name: string; performance: string; percentage: string }

const blank = (): Draft => ({ name: '', performance: '', percentage: '' })

/** The three editable cells, shared by the saved row and the add row. */
function Cells({
  draft, onDraft, onRating,
}: { draft: Draft; onDraft: (d: Draft) => void; onRating?: (value: string) => void }) {
  return (
    <>
      <td className={cellCls}>
        <input
          value={draft.name}
          placeholder="Department"
          onChange={(e) => onDraft({ ...draft, name: e.target.value })}
          className={cx(fieldCls, 'font-semibold')}
        />
      </td>
      <td className={cellCls}>
        <select
          value={draft.performance}
          onChange={(e) => {
            onDraft({ ...draft, performance: e.target.value })
            onRating?.(e.target.value)
          }}
          className={cx(fieldCls, 'font-semibold', draft.performance === '' && 'text-slate-500')}
        >
          <option value="">Select</option>
          {PERFORMANCE_RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </td>
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
    </>
  )
}

// ── Saved row ───────────────────────────────────────────────────────────────────
function Row({
  index, department, onChanged,
}: { index: number; department: ReviewDepartment; onChanged: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => ({
    name: department.name,
    performance: department.performance,
    percentage: department.percentage === null ? '' : String(department.percentage),
  }))
  const rowRef = useRef<HTMLTableRowElement>(null)
  const saving = useRef(false)

  const save = async (over?: Partial<Draft>) => {
    const next = { ...draft, ...over }
    const percentage = next.percentage === '' ? null : Number(next.percentage)
    const changed =
      next.name.trim() !== department.name ||
      next.performance !== department.performance ||
      percentage !== department.percentage
    if (saving.current || !changed || next.name.trim() === '') return
    saving.current = true
    try {
      await api.updateReviewDepartment(department.id, {
        name: next.name.trim(), performance: next.performance, percentage,
      })
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  const remove = async () => {
    if (!confirm(`Remove "${department.name}"? Its people keep their reviews under "No department".`)) return
    try {
      await api.deleteReviewDepartment(department.id)
      onChanged()
    } catch (err) { alert((err as Error).message) }
  }

  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className="bg-[#d4e9f2] text-[#0f172a]">
      <td className={idxCell}>{index}</td>
      <Cells draft={draft} onDraft={setDraft} onRating={(v) => save({ performance: v })} />
      <td className="p-0">
        <div className="flex items-center justify-center">
          <button
            onClick={remove}
            title={`Remove ${department.name}`}
            aria-label={`Remove ${department.name}`}
            className="flex h-5 w-5 items-center justify-center rounded border border-slate-400 bg-white text-slate-600 transition-colors hover:border-red-600 hover:bg-red-600 hover:text-white"
          >
            <TrashIcon />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Trailing add row ────────────────────────────────────────────────────────────
function AddRow({ onChanged }: { onChanged: () => void }) {
  const [draft, setDraft] = useState<Draft>(blank)
  const saving = useRef(false)

  const add = async () => {
    if (saving.current || draft.name.trim() === '') return
    saving.current = true
    try {
      await api.createReviewDepartment({
        name: draft.name.trim(),
        performance: draft.performance,
        percentage: draft.percentage === '' ? null : Number(draft.percentage),
      })
      setDraft(blank())
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  return (
    <tr className="bg-[#eaf5fa] text-[#0f172a]" onKeyDown={(e) => { if (e.key === 'Enter') add() }}>
      <td className={cx(idxCell, 'text-slate-400')}>+</td>
      <Cells draft={draft} onDraft={setDraft} />
      <td className="p-0">
        <div className="flex items-center justify-center">
          <button
            onClick={add}
            disabled={draft.name.trim() === ''}
            title="Add department"
            aria-label="Add department"
            className="flex h-5 w-5 items-center justify-center rounded bg-[#1a3654] text-white transition-colors hover:bg-[#24466b] disabled:bg-slate-300"
          >
            <PlusIcon />
          </button>
        </div>
      </td>
    </tr>
  )
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
