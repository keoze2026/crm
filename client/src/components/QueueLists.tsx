import { useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { parseCodeList, parseNameList } from '../lib/queues'
import type { QueueCode, QueuePerson } from '../types'
import { Badge, Card, Spinner, cx } from './ui'

/**
 * The small lists section above the sheet: the names and queue codes the sheet's two
 * dropdowns are filled from. Add, rename or remove either — nothing is assigned here,
 * so the edit controls sit right on each chip.
 *
 * Both add boxes take a list, so a whole roster ("Anna, Ben, Camp Team") or a pasted set
 * of codes ("BHS, BOP Q04") goes in at once.
 */
export default function QueueLists({
  people, codes, onChanged,
}: {
  people: QueuePerson[]
  codes: QueueCode[]
  onChanged: () => void
}) {
  // Open on a fresh install (nothing to pick from yet), collapsed once the lists exist.
  const [open, setOpen] = useState(people.length === 0 && codes.length === 0)

  return (
    <Card>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-white/60"
      >
        <div className="flex items-center gap-2.5">
          <svg
            width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={cx('shrink-0 text-slate-600 transition-transform', open && 'rotate-90')}
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          <h3 className="font-semibold text-slate-900">Names &amp; queues</h3>
          <Badge>{`${people.length} names`}</Badge>
          <Badge color="blue">{`${codes.length} queues`}</Badge>
        </div>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {open ? 'Hide' : 'Show'}
        </span>
      </button>

      {open && (
        <div className="grid gap-4 border-t border-white/50 p-4 lg:grid-cols-2">
          <List
            label="Names"
            placeholder="Add a name…"
            entries={people.map((p) => ({
              id: p.id,
              label: p.name,
              note: p.assignment_id !== null ? 'on sheet' : null,
            }))}
            onAdd={(raw) => api.createQueuePeople(parseNameList(raw))}
            onRename={(id, value) => api.updateQueuePerson(id, value)}
            onRemove={(id, label) => {
              const person = people.find((p) => p.id === id)
              const warning = person?.assignment_id != null
                ? `Remove "${label}"? Their row on the sheet goes with them.`
                : `Remove "${label}"?`
              return confirm(warning) ? api.deleteQueuePerson(id) : null
            }}
            onChanged={onChanged}
          />
          <List
            label="Queues"
            placeholder="Add queue codes…"
            uppercase
            entries={codes.map((c) => ({
              id: c.id,
              label: c.code,
              note: c.usage_count > 0 ? `×${c.usage_count}` : null,
            }))}
            onAdd={(raw) => api.createQueueCodes(parseCodeList(raw))}
            onRename={(id, value) => api.updateQueueCode(id, value)}
            onRemove={(id, label) => {
              const code = codes.find((c) => c.id === id)
              const warning = code && code.usage_count > 0
                ? `Remove "${label}"? It drops off ${code.usage_count} row${code.usage_count === 1 ? '' : 's'}.`
                : `Remove "${label}"?`
              return confirm(warning) ? api.deleteQueueCode(id) : null
            }}
            onChanged={onChanged}
          />
        </div>
      )}
    </Card>
  )
}

interface Entry {
  id: number
  label: string
  /** Small trailing marker on the chip — "on sheet", "×4". */
  note: string | null
}

/** One catalogue: an add box and the entries as chips, each renameable and removable. */
function List({
  label, placeholder, entries, uppercase, onAdd, onRename, onRemove, onChanged,
}: {
  label: string
  placeholder: string
  entries: Entry[]
  uppercase?: boolean
  onAdd: (raw: string) => Promise<{ created: unknown[]; existing: unknown[] }>
  onRename: (id: number, value: string) => Promise<unknown>
  /** Returns null when the user cancels the confirm. */
  onRemove: (id: number, label: string) => Promise<unknown> | null
  onChanged: () => void
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null)
  const [renaming, setRenaming] = useState<{ id: number; value: string } | null>(null)

  const add = async () => {
    if (draft.trim() === '' || busy) return
    setBusy(true); setMessage(null)
    try {
      const res = await onAdd(draft)
      setDraft('')
      const parts = []
      if (res.created.length > 0) parts.push(`Added ${res.created.length}`)
      if (res.existing.length > 0) parts.push(`${res.existing.length} already listed`)
      setMessage({ text: parts.join(' · '), bad: false })
      onChanged()
    } catch (err) {
      setMessage({ text: (err as Error).message, bad: true })
    } finally { setBusy(false) }
  }

  const rename = async () => {
    if (!renaming || renaming.value.trim() === '') return
    try {
      await onRename(renaming.id, renaming.value.trim())
      setRenaming(null); setMessage(null)
      onChanged()
    } catch (err) { setMessage({ text: (err as Error).message, bad: true }) }
  }

  const remove = async (entry: Entry) => {
    const pending = onRemove(entry.id, entry.label)
    if (!pending) return
    try {
      await pending
      setMessage(null)
      onChanged()
    } catch (err) { setMessage({ text: (err as Error).message, bad: true }) }
  }

  return (
    <div className="rounded-xl border border-slate-300 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-700">{label}</span>
        <span className="text-xs font-medium text-slate-500">{entries.length}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => { setDraft(e.target.value); setMessage(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          className={inputCls}
        />
        <button
          onClick={add}
          disabled={draft.trim() === '' || busy}
          title={`Add to ${label}`}
          aria-label={`Add to ${label}`}
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

      {entries.length > 0 && (
        <div className="mt-2 flex max-h-36 flex-wrap content-start gap-1.5 overflow-y-auto border-t border-slate-200 pt-2">
          {entries.map((entry) => renaming?.id === entry.id ? (
            <span key={entry.id} className="flex items-center gap-1">
              <input
                value={renaming.value}
                autoFocus
                onChange={(e) => setRenaming({ id: entry.id, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') rename()
                  if (e.key === 'Escape') setRenaming(null)
                }}
                className={cx(inputCls, 'w-28 py-1', uppercase && 'font-bold uppercase')}
              />
              <IconButton label="Save" onClick={rename} tone="save"><CheckIcon /></IconButton>
              <IconButton label="Cancel" onClick={() => setRenaming(null)}><CloseIcon /></IconButton>
            </span>
          ) : (
            <span key={entry.id}
              className="flex items-center gap-0.5 rounded-lg border border-slate-300 bg-white py-0.5 pl-2 pr-0.5 text-xs font-bold text-slate-800 shadow-sm">
              {entry.label}
              {entry.note && <span className="ml-0.5 font-medium text-slate-500">{entry.note}</span>}
              <IconButton label={`Rename ${entry.label}`} onClick={() => setRenaming({ id: entry.id, value: entry.label })}>
                <PencilIcon />
              </IconButton>
              <IconButton label={`Remove ${entry.label}`} onClick={() => remove(entry)} tone="danger">
                <TrashIcon />
              </IconButton>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-inner shadow-slate-900/5 '
  + 'placeholder:text-slate-400 focus:border-[#1a3654] focus:outline-none focus:ring-2 focus:ring-[#1a3654]/25'

function IconButton({
  label, onClick, tone = 'plain', children,
}: { label: string; onClick: () => void; tone?: 'plain' | 'danger' | 'save'; children: ReactNode }) {
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
