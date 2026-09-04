/** Where a popover panel sits: page coordinates, for a portal positioned absolutely. */
export interface Anchor {
  top: number
  left: number
  width: number
}

/**
 * Place a panel under its trigger, clamped inside the viewport.
 *
 * Call this in the CLICK handler, before opening — not in an effect after the portal has
 * rendered. A panel that renders at 0,0 and is only moved afterwards will have dragged the
 * page to the top of the document first, because focusing anything inside it scrolls it
 * into view. Measuring first means the panel's very first paint is already in the right
 * place, so there is nothing to scroll to.
 */
export function anchorTo(trigger: HTMLElement | null, maxWidth = 280, gap = 4): Anchor {
  if (!trigger) return { top: 0, left: 0, width: maxWidth }

  const margin = 8
  const r = trigger.getBoundingClientRect()
  const width = Math.min(maxWidth, window.innerWidth - margin * 2)

  let left = r.left
  if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width
  if (left < margin) left = margin

  return { top: r.bottom + gap + window.scrollY, left: left + window.scrollX, width }
}

/**
 * Focus without moving the page. The default focus() scrolls the element into view, which
 * inside a freshly-opened popover is exactly the jump we are avoiding.
 */
export function focusQuietly(el: HTMLElement | null): void {
  el?.focus({ preventScroll: true })
}
