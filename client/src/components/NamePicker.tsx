import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api/client'
import { matches, parseNameList } from '../lib/queues'
import type { StaffMember } from '../types'
import { Spinner, cx } from './ui'

/**
 * A name cell that is a list, not a text box: pick someone in one click, and add or remove
 * people without leaving the row. The list is the shared staff roster managed on the Staff
 * page — the same one the Queues sheet reads — so a name added once is a click everywhere
 * after that, and each entry shows the departments that person belongs to.
 *
 * Deleting takes the person off the roster entirely (their Queues record and their
 * attendance, leave and salary rows go with them). Rows already written keep the name they
 * were saved with, since a review stores the name as text as well as a link.
 *
 * Rendered in a portal so it escapes the sheet's horizontal scroll container.
 */
export default function NamePicker({
  value, people, onChange, onRosterChanged, departmentId = null, placeholder = 'Select name',
}: {
  value: string
  people: StaffMember[]
  /** Called with the chosen name — the cell saves it like any other edit. */
  onChange: (name: string, staffId: number | null) => void
  /** The roster changed (a name was added or removed) — the page reloads it. */
  onRosterChanged: () => void
  /**
   * The department band this cell sits in. Someone added from here joins that department,
   * so the person lands in the band they were typed under rather than nowhere.
   */
  departmentId?: number | null
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 260 })

  const close = () => { setOpen(false); setSearch(''); setDraft(''); setError(null) }

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const margin = 8
    const width = Math.min(300, window.innerWidth - margin * 2)
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
      if (document.querySelector('[data-name-picker]')?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  })

  // Searching matches a department too, so "audits" finds everyone in it.
  const shown = people.filter((p) =>
    search.trim() === '' || matches(p.name, search) || p.departments.some((d) => matches(d.name, search)),
  )

  const pick = (person: StaffMember) => { onChange(person.name, person.id); close() }

  const add = async () => {
    const names = parseNameList(draft)
    if (names.length === 0 || busy) return
    setBusy(true); setError(null)
    try {
      const res = await api.createStaff(names, departmentId === null ? [] : [departmentId])
      onRosterChanged()
      // Adding from a row means "this is the person" — select the first one straight away.
      const only = res.created[0] ?? res.existing[0]
      if (only) { onChange(only.name, only.id); close(); return }
      setDraft('')
    } catch (err) {
      setError((err as Error).message)
    } finally { setBusy(false) }
  }

  const remove = async (person: StaffMember) => {
    if (!confirm(`Remove ${person.name} from the staff list? Their queue, attendance, leave and salary rows go too.`)) return
    try {
      await api.deleteStaff(person.id)
      onRosterChanged()
    } catch (err) { setError((err as Error).message) }
  }

  return (
    <div ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        title={value || placeholder}
        className={cx(
          'flex w-full items-center justify-between gap-1 rounded border bg-white px-1.5 py-0.5 text-left text-xs transition-colors',
          open ? 'border-[#1a3654] ring-1 ring-[#1a3654]/30' : 'border-slate-300 hover:border-[#1a3654]',
          value === '' ? 'text-slate-400' : 'font-semibold text-slate-900',
        )}
      >
        <span className="truncate">{value || placeholder}</span>
        <CaretIcon open={open} />
      </button>

      {open && createPortal(
        <div
          data-name-picker
          style={{ position: 'absolute', top: pos.top, left: pos.left, width: pos.width }}
          className="z-50 rounded-xl border border-slate-300 bg-white p-2 shadow-2xl shadow-slate-900/20"
        >
          <input
            value={search}
            autoFocus
            placeholder="Search names or departments…"
            onChange={(e) => setSearch(e.target.value)}
            className={inputCls}
          />

          {people.length === 0 ? (
            <p className="py-4 text-center text-[11px] font-medium text-slate-500">
              No staff yet.
            </p>
          ) : shown.length === 0 ? (
            <p className="py-4 text-center text-[11px] font-medium text-slate-500">No match.</p>
          ) : (
            <ul className="mt-1.5 max-h-56 space-y-0.5 overflow-y-auto">
              {shown.map((p) => {
                const selected = p.name === value
                return (
                  <li key={p.id}>
                    <div className={cx(
                      'flex items-center gap-1 rounded border px-1.5 py-1 transition-colors',
                      selected
                        ? 'border-[#1a3654] bg-[#1a3654]'
                        : 'border-transparent hover:border-slate-300 hover:bg-slate-100',
                    )}>
                      <button
                        onClick={() => pick(p)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className={cx(
                          'block truncate text-xs font-semibold',
                          selected ? 'text-white' : 'text-slate-800',
                        )}>
                          {p.name}
                        </span>
                        {/* The departments are the reason this list is shared — a name is
                            never picked without seeing which band the person belongs to. */}
                        <span className={cx(
                          'block truncate text-[10px] font-medium',
                          selected ? 'text-white/70' : 'text-slate-500',
                        )}>
                          {p.departments.length === 0
                            ? 'No department'
                            : p.departments.map((d) => d.name).join(' · ')}
                        </span>
                      </button>
                      <button
                        onClick={() => remove(p)}
                        title={`Remove ${p.name} from the staff list`}
                        aria-label={`Remove ${p.name} from the staff list`}
                        className={cx(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-red-600 hover:text-white',
                          selected ? 'text-white/70' : 'text-slate-500',
                        )}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="mt-2 flex items-center gap-1.5 border-t border-slate-200 pt-2">
            <input
              value={draft}
              placeholder="Add a name…"
              onChange={(e) => { setDraft(e.target.value); setError(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') add() }}
              className={inputCls}
            />
            <button
              onClick={add}
              disabled={draft.trim() === '' || busy}
              title="Add to the staff list"
              aria-label="Add to the staff list"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#1a3654] text-white transition-colors hover:bg-[#24466b] disabled:bg-slate-300"
            >
              {busy ? <Spinner className="h-4 w-4 text-white" /> : <PlusIcon />}
            </button>
          </div>
          {error && <p className="mt-1 text-[11px] font-medium text-red-600">{error}</p>}
        </div>,
        document.body,
      )}
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 '
  + 'placeholder:text-slate-400 focus:border-[#1a3654] focus:outline-none focus:ring-2 focus:ring-[#1a3654]/25'

const stroke = {
  fill: 'none' as const, stroke: 'currentColor', strokeWidth: 2.4,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}><path d="M12 5v14M5 12h14" /></svg>
)
const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" {...stroke}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </svg>
)
const CaretIcon = ({ open }: { open: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" {...stroke}
    className={cx('shrink-0 text-slate-600 transition-transform', open && 'rotate-180')}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)
