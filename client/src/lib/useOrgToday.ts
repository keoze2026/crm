import { useEffect, useState } from 'react'
import { orgToday } from './staff'

/**
 * Today as the organisation reckons it, kept current while the page stays open.
 *
 * A date picked at mount and never revisited is wrong twice over: the attendance sheet is
 * the page most likely to be left open all day, so a browser sitting on it through
 * midnight in New York would go on showing yesterday and quietly stop agreeing with the
 * check-in bot; and a viewer in a timezone hours ahead never had the right day to begin
 * with. Polling the clock costs nothing and fixes both.
 *
 * The minute tick is deliberate rather than a timer aimed at midnight — a laptop that
 * sleeps through midnight never fires that timer, but does come back and tick.
 */
export function useOrgToday(): string {
  const [day, setDay] = useState(orgToday)

  useEffect(() => {
    const id = setInterval(() => setDay((current) => {
      const now = orgToday()
      // Same string means no re-render: this ticks every minute all day long.
      return now === current ? current : now
    }), 60_000)
    return () => clearInterval(id)
  }, [])

  return day
}
