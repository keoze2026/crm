import { api } from '../api/client'
import type { Buyer } from '../types'

/**
 * Save an edit to a buyer — a rename from the Daily Sheet's Destination cell, or a rename /
 * rate change from the Monthly Sheet.
 *
 * A code names one buyer whatever its case, so renaming onto a code another buyer already
 * holds ("test" → "TEST" while "TEST" exists) comes back 409. Once confirmed, the edit is
 * resent as a merge: every record of the other buyer moves onto this one, each keeping its
 * own date, volumes and rate, so nothing is lost. Resolves false when the merge is declined
 * (nothing was saved), so the caller can put the old code back in the cell.
 */
export async function saveBuyer(id: number, from: string, data: Partial<Buyer>): Promise<boolean> {
  try {
    await api.updateBuyer(id, data)
    return true
  } catch (e) {
    if ((e as { status?: number }).status !== 409 || !data.code) throw e
    const ok = confirm(
      `Destination "${data.code}" already exists. Merge "${from}" into it?\n\n` +
      `Every record of both stays, all under "${data.code}".`,
    )
    if (!ok) return false
    await api.updateBuyer(id, { ...data, merge: true })
    return true
  }
}
