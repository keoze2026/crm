// Folding somebody else's save into what is being edited here, without losing either.
//
// Both helpers are three-way: `base` is the server's copy this edit started from, `mine` is
// what is on screen now, `theirs` is the server's newer copy. What this browser didn't touch
// takes theirs; what it changed keeps its own.

type Json = unknown

const isMap = (v: Json): v is Record<string, Json> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Equal as JSON, ignoring the order of a map's keys. */
export function same(a: Json, b: Json): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

function canonical(v: Json): Json {
  if (Array.isArray(v)) return v.map(canonical)
  if (isMap(v)) {
    const out: Record<string, Json> = {}
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = canonical(v[k])
    return out
  }
  return v
}

/**
 * Deep merge of a JSON document — the whole-month sheets' state. The server runs the same
 * merge on a save (server/src/Merge.php):
 *  - maps merge key by key, so edits to different cells both land;
 *  - lists are sets: this side's additions and removals apply, the other side's stay;
 *  - a value both sides changed takes this side's.
 */
export function merge3<T>(base: Json, mine: T, theirs: Json): T {
  if (same(mine, base)) return theirs as T
  if (same(theirs, base) || same(theirs, mine)) return mine
  if (Array.isArray(mine) && Array.isArray(theirs) && (base == null || Array.isArray(base))) {
    return mergeList((base ?? []) as Json[], mine, theirs) as T
  }
  if (isMap(mine) && isMap(theirs) && (base == null || isMap(base))) {
    return mergeMap((base ?? {}) as Record<string, Json>, mine, theirs) as T
  }
  return mine
}

function mergeMap(base: Record<string, Json>, mine: Record<string, Json>, theirs: Record<string, Json>) {
  const out: Record<string, Json> = {}
  for (const key of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
    let b = base[key], m = mine[key], t = theirs[key]
    // A collection missing on one side is an empty one of the same kind.
    const empty = [b, m, t].find((v) => v != null && typeof v === 'object')
    if (empty !== undefined) {
      const blank = () => (Array.isArray(empty) ? [] : {})
      b ??= blank(); m ??= blank(); t ??= blank()
    }
    const merged = merge3(b, m, t)
    if (merged !== undefined && merged !== null) out[key] = merged
  }
  return out
}

function mergeList(base: Json[], mine: Json[], theirs: Json[]) {
  const key = (v: Json) => JSON.stringify(canonical(v))
  const inBase = new Set(base.map(key))
  const inMine = new Set(mine.map(key))
  const seen = new Set<string>()
  const out: Json[] = []
  for (const item of theirs) {
    const k = key(item)
    if ((inBase.has(k) && !inMine.has(k)) || seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  for (const item of mine) {
    const k = key(item)
    if (inBase.has(k) || seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

/**
 * Shallow merge for one row's draft: a field somebody is editing here keeps what they typed,
 * every other field takes the server's newer value. Lists (a queue's ordered chips) are one
 * value, not a set — their order means something.
 */
export function mergeDraft<T>(base: T, draft: T, server: T): T {
  if (same(draft, base)) return server
  if (isMap(draft) && isMap(server) && isMap(base)) {
    const out: Record<string, Json> = { ...server }
    for (const k of Object.keys(draft)) if (!same(draft[k], base[k])) out[k] = draft[k]
    return out as T
  }
  return draft
}
