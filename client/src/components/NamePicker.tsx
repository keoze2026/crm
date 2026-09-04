import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api/client'
import { matches, parseNameList } from '../lib/queues'
import type { QueuePerson } from '../types'
import { Spinner, cx } from './ui'

/**
 * A name cell that is a list, not a text box: pick someone in one click, and add or remove
 * people without leaving the row. The list is the shared staff roster (the same one the
 * Queues page keeps), so a name typed once anywhere is a click everywhere after that.
 *
 * Deleting only takes the person off the roster — rows already written keep the name they
 * were saved with, since a review stores the name as text, not a link.
 *
 * Rendered in a portal so it escapes the sheet's horizontal scroll container.
 */
export default function NamePicker({
  value, people, onChange, onRosterChanged, placeholder = 'Select name',
}: {
  value: string
  people: QueuePerson[]
  /** Called with the chosen name — the cell saves it like any other edit. */
  onChange: (name: string) => void
  /** The roster changed (a name was added or removed) — the page reloads it. */
  onRosterChanged: () => void
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
    const width = Math.min(280, window.innerWidth - margin * 2)
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

  const shown = people.filter((p) => search.trim() === '' || matches(p.name, search))

  const pick = (name: string) => { onChange(name); close() }

  const add = async () => {
    const names = parseNameList(draft)
    if (names.length === 0 || busy) return
    setBusy(true); setError(null)
    try {
      const res = await api.createQueuePeople(names)
      onRosterChanged()
      // Adding from a row means "this is the person" — select the first one straight away.
      const only = res.created[0] ?? res.existing[0]
      if (only) { onChange(only.name); close(); return }
      setDraft('')
    } catch (err) {
      setError((err as Error).message)
    } finally { setBusy(false) }
  }

  const remove = async (person: QueuePerson) => {
    const warning = person.assignment_id !== null
      ? `Remove "${person.name}" from the staff list? Their row on the Queues sheet goes too; reviews already saved keep the name.`
      : `Remove "${person.name}" from the staff list? Reviews already saved keep the name.`
    if (!confirm(warning)) return
    try {
      await api.deleteQueuePerson(person.id)
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
            placeholder="Search names…"
            onChange={(e) => setSearch(e.target.value)}
            className={inputCls}
          />

          {people.length === 0 ? (
            <p className="py-4 text-center text-[11px] font-medium text-slate-500">No names yet.</p>
          ) : shown.length === 0 ? (
            <p className="py-4 text-center text-[11px] font-medium text-slate-500">No match.</p>
          ) : (
            <ul className="mt-1.5 max-h-56 space-y-0.5 overflow-y-auto">
              {shown.map((p) => (
                <li key={p.id}>
                  <div className={cx(
                    'flex items-center gap-1 rounded border px-1.5 py-1 transition-colors',
                    p.name === value
                      ? 'border-[#1a3654] bg-[#1a3654]'
                      : 'border-transparent hover:border-slate-300 hover:bg-slate-100',
                  )}>
                    <button
                      onClick={() => pick(p.name)}
                      className={cx(
                        'min-w-0 flex-1 truncate text-left text-xs font-semibold',
                        p.name === value ? 'text-white' : 'text-slate-800',
                      )}
                    >
                      {p.name}
                    </button>
                    <button
                      onClick={() => remove(p)}
                      title={`Remove ${p.name} from the list`}
                      aria-label={`Remove ${p.name} from the list`}
                      className={cx(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-red-600 hover:text-white',
                        p.name === value ? 'text-white/70' : 'text-slate-500',
                      )}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </li>
              ))}
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
              title="Add to the list"
              aria-label="Add to the list"
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
