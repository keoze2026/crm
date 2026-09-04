import { useRef, useState } from 'react'
import { api } from '../api/client'
import { NUMERIC, PERFORMANCE_RATINGS } from '../lib/review'
import type { ReviewDepartment } from '../types'
import {
  addBtnCls, addRowCls, cellCls, fieldCls, headCls, idxCell, removeBtnCls, rowCls, tableCls, theadCls,
} from './sheet'
import { PlusIcon, TrashIcon } from './sheetIcons'
import { cx } from './ui'

/**
 * The Department tab: Sr. No · Department · Perfomance · %.
 *
 * The department NAMES are the shared catalogue (the same list the Staff page files people
 * into, and the bands the other two tabs group by), so a department added here becomes a
 * band everywhere — and removing one leaves its people behind under "No department" rather
 * than deleting their reviews.
 *
 * The rating and the % belong to the MONTH, not the department: each month gets its own
 * score, so last month's 65% is still there when this month reads 80%.
 */
export default function DepartmentSheet({
  month, departments, onChanged,
}: { month: string; departments: ReviewDepartment[]; onChanged: () => void }) {
  return (
    <div className="overflow-x-auto">
      <table className={cx(tableCls, "min-w-lg")}>
        <colgroup>
          <col style={{ width: '9%' }} />
          <col style={{ width: '45%' }} />
          <col style={{ width: '24%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '8%' }} />
        </colgroup>
        <thead>
          <tr className={theadCls}>
            <th className={headCls}>Sr. No</th>
            <th className={headCls}>Department</th>
            <th className={headCls}>Perfomance</th>
            <th className={headCls}>%</th>
            <th className={headCls} aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {departments.map((d, i) => (
            <Row key={d.id} index={i + 1} month={month} department={d} onChanged={onChanged} />
          ))}
          <AddRow month={month} onChanged={onChanged} />
        </tbody>
      </table>
    </div>
  )
}

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
  index, month, department, onChanged,
}: { index: number; month: string; department: ReviewDepartment; onChanged: () => void }) {
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
        month, name: next.name.trim(), performance: next.performance, percentage,
      })
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  const remove = async () => {
    // Deleting the department removes it everywhere, not just this month — the name is
    // the shared catalogue, so the confirm says what actually goes.
    if (!confirm(`Remove "${department.name}"? It goes from every month, and its people move to "No department".`)) return
    try {
      await api.deleteReviewDepartment(department.id)
      onChanged()
    } catch (err) { alert((err as Error).message) }
  }

  const onRowBlur = () => setTimeout(() => {
    if (rowRef.current && !rowRef.current.contains(document.activeElement)) save()
  }, 0)

  return (
    <tr ref={rowRef} onBlur={onRowBlur} className={rowCls}>
      <td className={idxCell}>{index}</td>
      <Cells draft={draft} onDraft={setDraft} onRating={(v) => save({ performance: v })} />
      <td className="p-0">
        <div className="flex items-center justify-center">
          <button
            onClick={remove}
            title={`Remove ${department.name}`}
            aria-label={`Remove ${department.name}`}
            className={removeBtnCls}
          >
            <TrashIcon />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Trailing add row ────────────────────────────────────────────────────────────
function AddRow({ month, onChanged }: { month: string; onChanged: () => void }) {
  const [draft, setDraft] = useState<Draft>(blank)
  const saving = useRef(false)

  const add = async () => {
    if (saving.current || draft.name.trim() === '') return
    saving.current = true
    try {
      await api.createReviewDepartment({
        month,
        name: draft.name.trim(),
        performance: draft.performance,
        percentage: draft.percentage === '' ? null : Number(draft.percentage),
      })
      setDraft(blank())
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { saving.current = false }
  }

  return (
    <tr className={addRowCls} onKeyDown={(e) => { if (e.key === 'Enter') add() }}>
      <td className={cx(idxCell, 'text-slate-400')}>+</td>
      <Cells draft={draft} onDraft={setDraft} />
      <td className="p-0">
        <div className="flex items-center justify-center">
          <button
            onClick={add}
            disabled={draft.name.trim() === ''}
            title="Add department"
            aria-label="Add department"
            className={addBtnCls}
          >
            <PlusIcon />
          </button>
        </div>
      </td>
    </tr>
  )
}

