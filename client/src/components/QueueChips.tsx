import { useEffect, useRef, useState } from 'react'
import { cx } from './ui'

/** A queue as the sheet shows it. */
export interface Chip {
  id: number
  code: string
}

/**
 * The queue chips in one row, draggable into any order.
 *
 * Built on POINTER events rather than HTML5 drag-and-drop, which does not fire on touch at
 * all — pointer events are one code path for mouse, pen and finger. The chips carry
 * `touch-action: none` because a finger that has grabbed a chip must not also be scrolling
 * the page; the rest of the row still scrolls normally.
 *
 * The move and release listeners live on the WINDOW, not on the chip. A chip is only ever
 * one of a list React re-sorts under the pointer, so the element the gesture started on
 * gets moved mid-drag — pointer capture on it cannot be relied upon to deliver the release,
 * and a release it never sees would leave the chip stuck in its held styling for good.
 *
 * Reordering is live and the new order is saved once, on release. Nothing is written while
 * dragging.
 */
export default function QueueChips({
  chips, disabled = false, onReorder,
}: {
  chips: Chip[]
  disabled?: boolean
  /** The full list in its new order — called once, when the drag ends on a change. */
  onReorder: (ids: number[]) => void
}) {
  // While dragging this holds the live preview; null the rest of the time, so the row
  // follows the server without a stale copy sitting in front of it.
  const [order, setOrder] = useState<Chip[] | null>(null)
  const [heldId, setHeldId] = useState<number | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // The listeners below close over these rather than over state, so they always read the
  // latest preview without being torn down and rebuilt on every pointermove.
  const orderRef = useRef<Chip[]>(chips)
  const startRef = useRef('')

  const dragging = heldId !== null
  const shown = order ?? chips

  useEffect(() => {
    if (!dragging) return

    /**
     * Where the pointer wants the held chip to go. A chip directly under the pointer wins;
     * otherwise the nearest one by centre, which is what makes dragging PAST the end of the
     * row drop the chip at the end instead of doing nothing.
     */
    const targetId = (x: number, y: number): number | null => {
      const nodes = [...(wrapRef.current?.querySelectorAll<HTMLElement>('[data-chip]') ?? [])]
      if (nodes.length === 0) return null

      let nearest: { id: number; distance: number } | null = null
      for (const node of nodes) {
        const r = node.getBoundingClientRect()
        const id = Number(node.dataset.chip)
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id
        const dx = x - (r.left + r.right) / 2
        const dy = y - (r.top + r.bottom) / 2
        const distance = dx * dx + dy * dy
        if (nearest === null || distance < nearest.distance) nearest = { id, distance }
      }
      return nearest?.id ?? null
    }

    const move = (e: PointerEvent) => {
      const overId = targetId(e.clientX, e.clientY)
      if (overId === null || overId === heldId) return

      // The ref is the source of truth for the gesture — the commit reads it too, so both
      // stay in step, and nothing mutates inside a state updater React may call twice.
      const list = orderRef.current
      const from = list.findIndex((c) => c.id === heldId)
      const to = list.findIndex((c) => c.id === overId)
      if (from < 0 || to < 0 || from === to) return

      const next = [...list]
      next.splice(to, 0, next.splice(from, 1)[0])
      orderRef.current = next
      setOrder(next)
    }

    const end = () => {
      const next = orderRef.current.map((c) => c.id)
      setHeldId(null)
      setOrder(null)
      if (next.join(',') !== startRef.current) onReorder(next)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    // The list is read through `orderRef`, and `onReorder` is captured for the gesture's
    // life on purpose — re-binding these listeners mid-drag would drop the gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, heldId])

  if (chips.length === 0) return <span className="text-slate-400">—</span>

  const start = (e: React.PointerEvent, id: number) => {
    if (disabled || chips.length < 2) return
    // Stops the mouse from starting a text selection across the sheet as the pointer moves.
    e.preventDefault()
    orderRef.current = chips
    startRef.current = chips.map((c) => c.id).join(',')
    setOrder(chips)
    setHeldId(id)
  }

  return (
    <div
      ref={wrapRef}
      className={cx('flex flex-wrap gap-0.5', dragging && 'select-none')}
    >
      {shown.map((chip) => (
        <span
          key={chip.id}
          data-chip={chip.id}
          onPointerDown={(e) => start(e, chip.id)}
          title={disabled ? chip.code : `${chip.code} — drag to reorder`}
          className={cx(
            'select-none rounded border px-1 text-[10px] font-bold leading-4',
            'border-blue-300 bg-blue-50 text-[#1d4ed8]',
            !disabled && chips.length > 1 && 'cursor-grab touch-none',
            heldId === chip.id && 'scale-110 cursor-grabbing border-[#1a3654] bg-[#1a3654] text-white shadow',
            dragging && heldId !== chip.id && 'opacity-70',
          )}
        >
          {chip.code}
        </span>
      ))}
    </div>
  )
}
