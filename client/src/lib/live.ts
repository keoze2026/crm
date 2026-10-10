// Live updates — the browser half.
//
// Every successful write on the server bumps a change counter for its AREA (server/src/
// Changes.php). One poller per tab reads those counters every few seconds and tells the
// subscribers whose areas moved; useAsync subscribes every query automatically, from the
// GET paths it makes, so a page picks up another user's save — or the check-in bot's —
// without anybody pressing Refresh.
//
// Nobody's work is lost to one of these reloads:
//  - a reload waits while somebody is typing in a field, or while a save is on its way;
//  - it is quiet — the data already on screen stays there, with no spinner and no error;
//  - sheet rows keep what is typed in them through a reload (useServerDraft), and the
//    whole-month sheets merge a fresh copy into their edits rather than replacing them.
//
// Until the server can count changes (migration 033), pages re-read every 30 seconds.
import { api, setWriteListener } from '../api/client'

/**
 * GET path's first segment → the areas its answer depends on; '*' = any area. The write
 * side is server/src/Changes.php — keep the two in step. A segment missing here is treated
 * as reading everything, which is only ever too eager, never stale.
 */
const READ_AREAS: Record<string, string[]> = {
  analytics:            ['calls'],
  buyers:               ['calls'],
  campaigns:            ['calls'],
  destinations:         ['calls'],
  records:              ['calls'],
  'portal-expenses':    ['calls'],
  vendors:              ['calls'],
  'vendor-payments':    ['calls'],
  staff:                ['staff'],
  departments:          ['staff'],
  'staff-leaves':       ['staff'],
  'staff-salaries':     ['staff'],
  'staff-salary-holds': ['staff'],
  // Hand-keyed days override the bot's, and both are shown against the roster.
  'staff-attendance':   ['attendance', 'bot', 'staff'],
  attendance:           ['attendance', 'bot', 'staff'],
  queues:               ['queues', 'staff'],
  'queue-codes':        ['queues'],
  'review-departments': ['reviews', 'staff'],
  'review-entries':     ['reviews', 'staff'],
  'top-performer':      ['reviews', 'staff'],
  'annual-reviews':     ['reviews'],
  incentives:           ['incentives', 'staff'],
  admin:                ['users', 'staff'],
  // Every write is logged, so the log moves with everything.
  'audit-logs':         ['*'],
  auth:                 [],
  changes:              [],
  health:               [],
}

/** The areas a GET of `path` ("/staff-leaves?from=…") depends on. */
export function areasOf(path: string): string[] {
  const segment = path.replace(/^\/+/, '').split(/[/?]/)[0]
  return READ_AREAS[segment] ?? ['*']
}

const POLL_MS = 5_000
/** Without change counters (migration 033 not applied), re-read this often instead. */
const FALLBACK_MS = 30_000
/** How long a pause in typing must be before a reload may land under a focused field. */
const TYPING_IDLE_MS = 20_000
/** A click or key this recent holds a reload back, so nothing moves under the pointer. */
const ACTIVITY_MS = 1_000
const RETRY_MS = 1_000

interface Sub { areas: string[]; fire: () => void }

const subs = new Set<Sub>()
const due = new Set<Sub>()
let versions: Record<string, unknown> | null = null
let pollTimer: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let polling = false
/** A write landed mid-poll: look again straight after it rather than a full interval later. */
let pollSoon = false
let started = false
let lastFallback = Date.now()
let lastActivity = 0
let writesInFlight = 0

/**
 * Be told when any of `areas` changes. The call may be held back while the user is busy
 * (see isBusy). Returns the unsubscribe.
 */
export function subscribe(areas: string[], fire: () => void): () => void {
  const sub: Sub = { areas, fire }
  subs.add(sub)
  start()
  return () => {
    subs.delete(sub)
    due.delete(sub)
    if (subs.size === 0) stop()
  }
}

const NOT_TYPED = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color'])

function isEditable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  return tag === 'INPUT' && !NOT_TYPED.has((el as HTMLInputElement).type)
}

/**
 * True while a reload would get in somebody's way: a save still on its way to the server
 * (its reload follows it), a click or key a moment ago, or a field with the cursor in it
 * that was typed in recently. A field left focused and idle doesn't hold the page forever
 * — what is typed in it survives the reload anyway.
 */
export function isBusy(now = Date.now()): boolean {
  if (writesInFlight > 0) return true
  if (now - lastActivity < ACTIVITY_MS) return true
  return isEditable(document.activeElement) && now - lastActivity < TYPING_IDLE_MS
}

function markDue(changed: string[]) {
  const any = changed.includes('*') || changed.includes('other')
  for (const sub of subs) {
    if (any || sub.areas.includes('*') || sub.areas.some((a) => changed.includes(a))) due.add(sub)
  }
}

function flush() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  if (due.size === 0) return
  if (isBusy()) {
    retryTimer = setTimeout(flush, RETRY_MS)
    return
  }
  const ready = [...due]
  due.clear()
  for (const sub of ready) sub.fire()
}

async function poll() {
  if (polling) return
  polling = true
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
  try {
    const snap = await api.changes()
    if (!snap.tracking) {
      versions = null
      fallback()
    } else {
      const next: Record<string, unknown> = { ...snap.versions, bot: snap.bot }
      if (versions) {
        const changed = [...new Set([...Object.keys(versions), ...Object.keys(next)])]
          .filter((k) => versions?.[k] !== next[k])
        if (changed.length) markDue(changed)
      }
      versions = next
    }
  } catch (err) {
    // An API older than /changes answers 404: fall back to the timer. Anything else — the
    // network, an expired session — waits for the next poll; reloading into a 401 would
    // throw somebody out of what they are typing.
    if ((err as { status?: number }).status === 404) fallback()
  } finally {
    polling = false
    flush()
    schedule(pollSoon ? 250 : POLL_MS)
    pollSoon = false
  }
}

function fallback() {
  if (Date.now() - lastFallback < FALLBACK_MS) return
  lastFallback = Date.now()
  markDue(['*'])
}

function schedule(delay = POLL_MS) {
  if (!started || document.visibilityState === 'hidden') return
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = setTimeout(poll, delay)
}

const onVisible = () => { if (document.visibilityState === 'visible') poll() }
const onFocus = () => poll()
const onActivity = () => { lastActivity = Date.now() }
// Leaving a field lets a held-back reload through — after the field's own save has begun.
const onFocusOut = () => { setTimeout(flush, 0) }

function start() {
  if (started || typeof document === 'undefined') return
  started = true
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onFocus)
  document.addEventListener('focusout', onFocusOut)
  for (const type of ['keydown', 'pointerdown', 'input'] as const) {
    document.addEventListener(type, onActivity, true)
  }
  poll()
}

function stop() {
  if (!started) return
  started = false
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('focus', onFocus)
  document.removeEventListener('focusout', onFocusOut)
  for (const type of ['keydown', 'pointerdown', 'input'] as const) {
    document.removeEventListener(type, onActivity, true)
  }
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  due.clear()
  versions = null
}

// A write holds reloads back until it settles; one that landed is looked for straight
// away, so the rest of this page (and its badges) catch up without waiting for the timer.
setWriteListener((phase, ok) => {
  if (phase === 'start') { writesInFlight += 1; return }
  writesInFlight = Math.max(0, writesInFlight - 1)
  if (!ok || !started) return
  if (polling) pollSoon = true
  else schedule(250)
})
