import { useCallback, useEffect, useRef, useState } from 'react'
import { captureReads } from '../api/client'
import { areasOf, subscribe } from './live'

interface AsyncState<T> {
  data: T | null
  loading: boolean
  /** True while a background refresh (dep change or reload()) is in flight, once data already exists. */
  refreshing: boolean
  error: string | null
  reload: () => void
}

/** JSON for comparing two answers; null when the value can't be compared that way. */
function jsonOf(value: unknown): string | null {
  try { return JSON.stringify(value) ?? null } catch { return null }
}

/**
 * Runs an async function whenever `deps` change and tracks loading/error state.
 * Pass a stable `fn` (e.g. wrapped in useCallback) or rely on the deps array.
 *
 * Stale-while-revalidate: `loading` is only true until the first successful load.
 * After that, dep changes and reload() refresh in the background (`refreshing`)
 * while the previous data stays on screen, so a reload (e.g. after adding a
 * campaign) updates just the affected data instead of blanking whole sections.
 *
 * Live: the GET paths `fn` starts (synchronously, before its first await) decide which
 * change counters the query watches (lib/live.ts), and it re-runs by itself when one of
 * them moves — someone else saved, or the check-in bot wrote. Those runs are quiet: no
 * `refreshing`, and a failure keeps the data on screen instead of replacing it with an
 * error. An answer identical to the one on screen keeps the old object, so a reload that
 * found nothing new re-renders nothing.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const loaded = useRef(false)
  const shown = useRef<string | null>(null)
  // Set by a live update just before it bumps `tick`, so that run knows to be quiet.
  const quiet = useRef(false)

  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let cancelled = false
    const background = quiet.current && loaded.current
    quiet.current = false
    // Block with the spinner only for the very first load; later fetches refresh
    // in the background so the existing content isn't unmounted / flickered.
    if (!background) {
      if (loaded.current) setRefreshing(true)
      else setLoading(true)
      setError(null)
    }
    const areas = new Set<string>()
    captureReads(fn, (path) => { for (const a of areasOf(path)) areas.add(a) })
      .then((result) => {
        if (cancelled) return
        loaded.current = true
        const json = jsonOf(result)
        if (json === null || json !== shown.current) {
          shown.current = json
          setData(result)
        }
        setError(null)
      })
      .catch((err: Error) => {
        // A quiet reload that fails leaves what is on screen alone.
        if (!cancelled && !(background && loaded.current)) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) { setLoading(false); setRefreshing(false) }
      })
    const unsubscribe = areas.size > 0
      ? subscribe([...areas], () => { quiet.current = true; setTick((t) => t + 1) })
      : null
    return () => {
      cancelled = true
      unsubscribe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  return { data, loading, refreshing, error, reload }
}
