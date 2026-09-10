import { sheetStroke as stroke } from './sheet'

/** The three row controls every sheet uses, so they are drawn identically everywhere. */

export const PlusIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" {...stroke}><path d="M12 5v14M5 12h14" /></svg>
)

export const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" {...stroke}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </svg>
)


/** Undo a hand-made correction and fall back to what the source system said. */
export const RevertIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" {...stroke}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
  </svg>
)
