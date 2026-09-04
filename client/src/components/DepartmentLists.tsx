import { useState } from 'react'
import { api } from '../api/client'
import type { Department } from '../types'
import { Badge, Card, Spinner, cx } from './ui'

/**
 * The department catalogue above the staff sheet: add, rename or remove a department.
 *
 * It is the same list the Review page bands its sheets by, so a department added here
 * becomes a band there — and removing one leaves its people (and their reviews) behind,
 * unfiled, rather than deleting them.
 */
export default function DepartmentLists({
  departments, onChanged,
}: {
  departments: Department[]
  onChanged: () => void
}) {
  // Open on a fresh install (nothing to file people into yet), collapsed once it exists.
  const [open, setOpen] = useState(departments.length === 0)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null)
  const [renaming, setRenaming] = useState<{ id: number; value: string } | null>(null)

  const add = async () => {
    if (draft.trim() === '' || busy) return
    setBusy(true); setMessage(null)
    try {
      await api.createDepartment(draft.trim())
      setDraft('')
      onChanged()
    } catch (err) {
      setMessage({ text: (err as Error).message, bad: true })
    } finally { setBusy(false) }
  }

  const rename = async () => {
    if (!renaming || renaming.value.trim() === '') return
    try {
      await api.renameDepartment(renaming.id, renaming.value.trim())
      setRenaming(null); setMessage(null)
      onChanged()
    } catch (err) { setMessage({ text: (err as Error).message, bad: true }) }
  }

  const remove = async (department: Department) => {
    const people = department.staff_count === 1 ? '1 person' : `${department.staff_count} people`
    const warning = department.staff_count > 0
      ? `Remove "${department.name}"? ${people} lose the department, and their reviews move to "No department".`
      : `Remove "${department.name}"?`
    if (!confirm(warning)) return
    try {
      await api.deleteDepartment(department.id)
      setMessage(null)
      onChanged()
    } catch (err) { setMessage({ text: (err as Error).message, bad: true }) }
  }

  return (
    <Card>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-white/60"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <svg
            width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={cx('shrink-0 text-slate-600 transition-transform', open && 'rotate-90')}
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          <h3 className="font-semibold text-slate-900">Departments</h3>
          <Badge color="blue">{`${departments.length} departments`}</Badge>
        </div>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {open ? 'Hide' : 'Show'}
        </span>
      </button>

      {open && (
        <div className="border-t border-white/50 p-4">
          <div className="rounded-xl border border-slate-300 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-1.5">
              <input
                value={draft}
                placeholder="Add a department…"
                onChange={(e) => { setDraft(e.target.value); setMessage(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') add() }}
                className={inputCls}
              />
              <button
                onClick={add}
                disabled={draft.trim() === '' || busy}
                title="Add department"
                aria-label="Add department"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1a3654] text-white shadow-sm transition-colors hover:bg-[#24466b] disabled:bg-slate-300"
              >
                {busy ? <Spinner className="h-4 w-4 text-white" /> : <PlusIcon />}
              </button>
            </div>

            {message && (
              <p className={cx('mt-1 text-[11px] font-medium', message.bad ? 'text-red-600' : 'text-emerald-700')}>
                {message.text}
              </p>
            )}

            {departments.length > 0 && (
              <div className="mt-2 flex max-h-40 flex-wrap content-start gap-1.5 overflow-y-auto border-t border-slate-200 pt-2">
                {departments.map((d) => renaming?.id === d.id ? (
                  <span key={d.id} className="flex items-center gap-1">
                    <input
                      value={renaming.value}
                      autoFocus
                      onChange={(e) => setRenaming({ id: d.id, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') rename()
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                      className={cx(inputCls, 'w-36 py-1')}
                    />
                    <IconButton label="Save" onClick={rename} tone="save"><CheckIcon /></IconButton>
                    <IconButton label="Cancel" onClick={() => setRenaming(null)}><CloseIcon /></IconButton>
                  </span>
                ) : (
                  <span key={d.id}
                    className="flex items-center gap-0.5 rounded-lg border border-slate-300 bg-white py-0.5 pl-2 pr-0.5 text-xs font-bold text-slate-800 shadow-sm">
                    {d.name}
                    <span className="ml-0.5 font-medium text-slate-500">{d.staff_count}</span>
                    <IconButton label={`Rename ${d.name}`} onClick={() => setRenaming({ id: d.id, value: d.name })}>
                      <PencilIcon />
                    </IconButton>
                    <IconButton label={`Remove ${d.name}`} onClick={() => remove(d)} tone="danger">
                      <TrashIcon />
                    </IconButton>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-inner shadow-slate-900/5 '
  + 'placeholder:text-slate-400 focus:border-[#1a3654] focus:outline-none focus:ring-2 focus:ring-[#1a3654]/25'

function IconButton({
  label, onClick, tone = 'plain', children,
}: { label: string; onClick: () => void; tone?: 'plain' | 'danger' | 'save'; children: React.ReactNode }) {
  const tones = {
    plain: 'text-slate-600 hover:bg-slate-200 hover:text-slate-900',
    danger: 'text-slate-600 hover:bg-red-600 hover:text-white',
    save: 'bg-emerald-600 text-white hover:bg-emerald-700',
  }
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors', tones[tone])}
    >
      {children}
    </button>
  )
}

const stroke = {
  fill: 'none' as const, stroke: 'currentColor', strokeWidth: 2.4,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}><path d="M12 5v14M5 12h14" /></svg>
)
const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" {...stroke}><path d="m20 6-11 11-5-5" /></svg>
)
const CloseIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" {...stroke}><path d="M18 6 6 18M6 6l12 12" /></svg>
)
const PencilIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" {...stroke}>
    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
)
const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" {...stroke}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </svg>
)
