import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api/client'
import { anchorTo, focusQuietly, type Anchor } from '../lib/popover'
import { matches } from '../lib/queues'
import { STAFF_STATUSES, staffStatus } from '../lib/staff'
import type { Department, StaffMember, StaffStatus } from '../types'
import {
  addBtnCls, addRowCls, cellCls, fieldCls, headCls, idxCell, removeBtnCls, rowCls, tableCls, theadCls,
} from './sheet'
import { PlusIcon, TrashIcon } from './sheetIcons'
import { Spinner, cx } from './ui'

/**
 * The staff roster: Sr. No. · Name · Departments · Status.
 *
 * This is the one list the Queues and Review sheets pick their names from, which is why
 * departments are edited here and nowhere else. A person may belong to SEVERAL, so the
 * cell is a tick-list rather than a dropdown.
 */
export default function StaffSheet({
  staff, departments, onChanged,
}: {
  staff: StaffMember[]
  departments: Department[]
  onChanged: () => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className={cx(tableCls, "min-w-2xl")}>
        <colgroup>
          <col style={{ width: '7%' }} />
          <col style={{ width: '32%' }} />
          <col style={{ width: '40%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '7%' }} />
        </colgroup>
        <thead>
          <tr className={theadCls}>
            <th className={headCls}>Sr. No.</th>
            <th className={headCls}>Name</th>
            <th className={headCls}>Departments</th>
            <th className={headCls}>Status</th>
            <th className={headCls} aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {staff.map((person, i) => (
            <Row
              key={person.id}
              index={i + 1}
              person={person}
              departments={departments}
              onChanged={onChanged}
            />
          ))}
          <AddRow departments={departments} onChanged={onChanged} />
        </tbody>
      </table>
    </div>
  )
}

// ── Saved row ───────────────────────────────────────────────────────────────────

function Row({
  index, person, departments, onChanged,
}: {
  index: number
  person: StaffMember
  departments: Department[]
  onChanged: () => void
}) {
  const [name, setName] = useState(person.name)
  const [busy, setBusy] = useState(false)

  const save = async (data: Parameters<typeof api.updateStaff>[1]) => {
    setBusy(true)
    try {
      await api.updateStaff(person.id, data)
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { setBusy(false) }
  }

  const saveName = () => {
    const next = name.trim()
    if (next === '' || next === person.name) { setName(person.name); return }
    save({ name: next })
  }

  const remove = async () => {
    if (!confirm(`Remove ${person.name} from the staff list? Their queue, attendance, leave and salary rows go too.`)) return
    setBusy(true)
    try {
      await api.deleteStaff(person.id)
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <tr className={rowCls}>
      <td className={idxCell}>{index}</td>
      <td className={cellCls}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          className={cx(fieldCls, 'font-semibold')}
        />
      </td>
      <td className={cellCls}>
        <DepartmentPicker
          departments={departments}
          value={person.departments.map((d) => d.id)}
          onCommit={(ids) => save({ department_ids: ids })}
        />
      </td>
      <td className={cellCls}>
        <StatusSelect value={person.status} onChange={(status) => save({ status })} />
      </td>
      <td className="p-0">
        <div className="flex items-center justify-center">
          {busy ? <Spinner className="h-4 w-4" /> : (
            <button onClick={remove} title={`Remove ${person.name}`} aria-label={`Remove ${person.name}`} className={removeBtnCls}>
              <TrashIcon />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Trailing add row ────────────────────────────────────────────────────────────

function AddRow({ departments, onChanged }: { departments: Department[]; onChanged: () => void }) {
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [status, setStatus] = useState<StaffStatus>('active')
  const [busy, setBusy] = useState(false)

  const add = async () => {
    // Names may be pasted as a list, so one keystroke can seed a whole department.
    if (name.trim() === '' || busy) return
    setBusy(true)
    try {
      const res = await api.createStaff([name], picked)
      if (status !== 'active') {
        await Promise.all(res.created.map((p) => api.updateStaff(p.id, { status })))
      }
      setName(''); setPicked([]); setStatus('active')
      onChanged()
    } catch (err) { alert((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <tr className={addRowCls} onKeyDown={(e) => { if (e.key === 'Enter') add() }}>
      <td className={cx(idxCell, 'text-slate-400')}>+</td>
      <td className={cellCls}>
        <input
          value={name}
          placeholder="Add a name — or paste a list"
          onChange={(e) => setName(e.target.value)}
          className={cx(fieldCls, 'font-semibold')}
        />
      </td>
      <td className={cellCls}>
        <DepartmentPicker departments={departments} value={picked} onCommit={setPicked} />
      </td>
      <td className={cellCls}>
        <StatusSelect value={status} onChange={setStatus} />
      </td>
      <td className="p-0">
        <div className="flex items-center justify-center">
          <button
            onClick={add}
            disabled={name.trim() === '' || busy}
            title="Add staff member"
            aria-label="Add staff member"
            className={addBtnCls}
          >
            {busy ? <Spinner className="h-4 w-4 text-white" /> : <PlusIcon />}
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Status ──────────────────────────────────────────────────────────────────────

/**
 * Active / Inactive / Leave, coloured so a glance down the column reads as a traffic
 * light rather than three words that have to be compared.
 */
function StatusSelect({ value, onChange }: { value: StaffStatus; onChange: (v: StaffStatus) => void }) {
  const tone = staffStatus(value)
  return (
    <div className={cx('flex items-center gap-1.5 rounded border px-1 py-0.5', tone.cell)}>
      <span className={cx('h-2 w-2 shrink-0 rounded-full', tone.dot)} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as StaffStatus)}
        aria-label="Status"
        className="w-full cursor-pointer appearance-none bg-transparent text-xs font-bold focus:outline-none"
      >
        {STAFF_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
    </div>
  )
}

// ── The departments tick-list ───────────────────────────────────────────────────

/**
 * Multi-select for the Departments cell — a person can be in several, so this ticks rather
 * than picks. The trigger shows the chosen departments; the panel commits when it closes,
 * so moving someone between three departments is one request, not three.
 *
 * Rendered in a portal so it escapes the sheet's horizontal scroll container.
 */
function DepartmentPicker({
  departments, value, onCommit,
}: {
  departments: Department[]
  value: number[]
  /** Called with the final set once the panel closes. */
  onCommit: (ids: number[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<number[]>(value)
  const [seen, setSeen] = useState(value.join(','))
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<Anchor>({ top: 0, left: 0, width: 260 })

  // Adopt the server's answer whenever the row changes underneath us — the render-phase
  // reset React prescribes for state derived from props, rather than an effect.
  const signature = value.join(',')
  if (seen !== signature) {
    setSeen(signature)
    setDraft(value)
  }

  const close = () => {
    setOpen(false)
    setSearch('')
    if ([...draft].sort().join(',') !== [...value].sort().join(',')) onCommit(draft)
  }

  // Measured before the panel exists, so its first paint is already in place — see
  // anchorTo(). Opening any other way drags the page to the top of the document.
  const openPanel = () => {
    setPos(anchorTo(triggerRef.current, 280))
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (open) focusQuietly(searchRef.current)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (document.querySelector('[data-department-picker]')?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setDraft(value); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  })

  const toggle = (id: number) =>
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]))

  const chosen = departments.filter((d) => draft.includes(d.id))
  const shown = departments.filter((d) => search.trim() === '' || matches(d.name, search))

  return (
    <div ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : openPanel())}
        title={chosen.map((d) => d.name).join(', ') || 'No department'}
        className={cx(
          'flex w-full items-center justify-between gap-1 rounded border bg-white px-1.5 py-0.5 text-left text-xs transition-colors',
          open ? 'border-[#1a3654] ring-1 ring-[#1a3654]/30' : 'border-slate-300 hover:border-[#1a3654]',
        )}
      >
        {chosen.length === 0 ? (
          <span className="text-slate-400">No department</span>
        ) : (
          <span className="flex flex-wrap gap-0.5">
            {chosen.map((d) => (
              <span key={d.id} className="rounded border border-slate-300 bg-slate-50 px-1 text-[10px] font-bold leading-4 text-slate-700">
                {d.name}
              </span>
            ))}
          </span>
        )}
        <CaretIcon open={open} />
      </button>

      {open && createPortal(
        <div
          data-department-picker
          style={{ position: 'absolute', top: pos.top, left: pos.left, width: pos.width }}
          className="z-50 rounded-xl border border-slate-300 bg-white p-2 shadow-2xl shadow-slate-900/20"
        >
          <input
            ref={searchRef}
            value={search}
            placeholder="Search departments…"
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#1a3654] focus:outline-none focus:ring-2 focus:ring-[#1a3654]/25"
          />

          {departments.length === 0 ? (
            <p className="py-4 text-center text-[11px] font-medium text-slate-500">
              No departments yet.
            </p>
          ) : shown.length === 0 ? (
            <p className="py-4 text-center text-[11px] font-medium text-slate-500">No match.</p>
          ) : (
            <ul className="mt-1.5 max-h-56 space-y-0.5 overflow-y-auto">
              {shown.map((d) => {
                const on = draft.includes(d.id)
                return (
                  <li key={d.id}>
                    <button
                      onClick={() => toggle(d.id)}
                      className={cx(
                        'flex w-full items-center gap-2 rounded border px-1.5 py-1 text-left text-xs font-semibold transition-colors',
                        on ? 'border-[#1a3654] bg-[#1a3654] text-white' : 'border-transparent text-slate-800 hover:bg-slate-100',
                      )}
                    >
                      <span className={cx(
                        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                        on ? 'border-white bg-white text-[#1a3654]' : 'border-slate-400',
                      )}>
                        {on && <CheckIcon />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{d.name}</span>
                      <span className={cx('text-[10px] font-medium', on ? 'text-white/70' : 'text-slate-500')}>
                        {d.staff_count}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2">
            <button
              onClick={() => setDraft([])}
              disabled={draft.length === 0}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:border-slate-200 disabled:text-slate-400"
            >
              Clear
            </button>
            <button onClick={close} className="rounded-lg bg-[#1a3654] px-3 py-1 text-[11px] font-bold text-white hover:bg-[#24466b]">
              Done
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

const stroke = {
  fill: 'none' as const, stroke: 'currentColor', strokeWidth: 3,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}

const CheckIcon = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" {...stroke}><path d="m20 6-11 11-5-5" /></svg>
)
const CaretIcon = ({ open }: { open: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" {...stroke} strokeWidth={2.4}
    className={cx('shrink-0 text-slate-600 transition-transform', open && 'rotate-180')}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)
