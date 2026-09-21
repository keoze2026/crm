import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { anchorTo, focusQuietly, type Anchor } from '../lib/popover'
import { sheetStroke } from './sheet'
import { cx } from './ui'

/**
 * A one-line sheet cell that opens a proper writing box.
 *
 * Review notes run to a sentence or two, which an input in a dense sheet can't show, so the
 * cell previews the note and the popover holds the whole thing. Shared by the monthly
 * Performance sheet and the Annual Reviews roll-up, so a note reads and saves the same way
 * on both.
 */
export default function NoteCell({ value, onSave, placeholder = 'Add note', prompt = 'Note about this person’s review…' }: {
  value: string
  onSave: (text: string) => void
  /** The cell's wording while empty. */
  placeholder?: string
  /** The textarea's own placeholder. */
  prompt?: string
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(value)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const [pos, setPos] = useState<Anchor>({ top: 0, left: 0, width: 320 })

  const commit = () => {
    setOpen(false)
    if (text.trim() !== value.trim()) onSave(text.trim())
  }

  // Measured before the panel exists, so its first paint is already in place — see
  // anchorTo(). Opening any other way drags the page to the top of the document.
  const openPanel = () => {
    setText(value)
    setPos(anchorTo(triggerRef.current, 380))
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (open) focusQuietly(textRef.current)
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
        onClick={() => (open ? commit() : openPanel())}
        title={value || 'Add a note'}
        className={cx(
          'flex w-full items-center gap-1 rounded border bg-white px-1.5 py-0.5 text-left text-xs transition-colors',
          open ? 'border-[#1a3654] ring-1 ring-[#1a3654]/30' : 'border-slate-300 hover:border-[#1a3654]',
          value === '' ? 'text-slate-400' : 'text-slate-800',
        )}
      >
        <NoteIcon filled={value !== ''} />
        <span className="truncate">{value || placeholder}</span>
      </button>

      {open && createPortal(
        <div
          data-note-popover
          style={{ position: 'absolute', top: pos.top, left: pos.left, width: pos.width }}
          className="z-50 rounded-xl border border-slate-300 bg-white p-2 shadow-2xl shadow-slate-900/20"
        >
          <textarea
            ref={textRef}
            value={text}
            rows={4}
            placeholder={prompt}
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

/** Solid once a note exists, so a glance down the column shows who has one. */
const NoteIcon = ({ filled }: { filled: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" {...sheetStroke}
    className={cx('shrink-0', filled ? 'text-[#1a3654]' : 'text-slate-400')}
    fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.15 : 0}>
    <path d="M4 4h16v12H8l-4 4z" />
  </svg>
)
