import { useCallback, useEffect, useRef, useState } from 'react'

interface AsyncState<T> {
  data: T | null
  loading: boolean
  /** True while a background refresh (dep change or reload()) is in flight, once data already exists. */
  refreshing: boolean
  error: string | null
  reload: () => void
}

/**
 * Runs an async function whenever `deps` change and tracks loading/error state.
 * Pass a stable `fn` (e.g. wrapped in useCallback) or rely on the deps array.
 *
 * Stale-while-revalidate: `loading` is only true until the first successful load.
 * After that, dep changes and reload() refresh in the background (`refreshing`)
 * while the previous data stays on screen, so a reload (e.g. after adding a
 * campaign) updates just the affected data instead of blanking whole sections.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const loaded = useRef(false)

  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let cancelled = false
    // Block with the spinner only for the very first load; later fetches refresh
    // in the background so the existing content isn't unmounted / flickered.
    if (loaded.current) setRefreshing(true)
    else setLoading(true)
    setError(null)
    fn()
      .then((result) => {
        if (!cancelled) { setData(result); loaded.current = true }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) { setLoading(false); setRefreshing(false) }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  return { data, loading, refreshing, error, reload }
}
