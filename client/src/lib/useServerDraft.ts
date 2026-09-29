import { useState, type Dispatch, type SetStateAction } from 'react'
import { mergeDraft } from './merge'

/**
 * Local, editable state for a value the server owns — a sheet cell, or a whole row's draft.
 *
 * `useState(prop)` reads the prop once, so a row kept showing its first value after somebody
 * else changed it; resetting on every change instead would wipe what is being typed. This
 * does neither. When the server's value changes:
 *  - a draft nobody has touched takes the new value;
 *  - a draft somebody is editing keeps what they typed (an object keeps just the fields they
 *    changed and takes the rest), so a live update never eats a half-finished edit.
 *
 * It is the render-phase reset React prescribes for state derived from props, the pattern
 * the sheets already use, with the "is it being edited?" check added.
 */
export function useServerDraft<T>(server: T): [T, Dispatch<SetStateAction<T>>] {
  const key = JSON.stringify(server)
  const [draft, setDraft] = useState<T>(server)
  const [seen, setSeen] = useState<{ key: string; value: T }>({ key, value: server })
  if (seen.key !== key) {
    setSeen({ key, value: server })
    setDraft(mergeDraft(seen.value, draft, server))
  }
  return [draft, setDraft]
}
