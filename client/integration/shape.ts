// A tiny typed shape checker for the integration tests: describe what the client's
// TypeScript type promises, then check a real server response against it. The spec for an
// object is keyed by EVERY key of the declared type (optional ones included), so adding a
// field to src/types.ts without describing it here is a compile error, not a silent gap.

export type Check = (value: unknown, path: string) => string[]

const describe = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'string' ? `string ${JSON.stringify(v)}` : typeof v

/** A finite JS number — a numeric string such as "12.50" is rejected. */
export const num: Check = (v, p) =>
  typeof v === 'number' && Number.isFinite(v) ? [] : [`${p}: expected number, got ${describe(v)}`]

/** A whole number. */
export const int: Check = (v, p) =>
  typeof v === 'number' && Number.isInteger(v) ? [] : [`${p}: expected integer, got ${describe(v)}`]

export const str: Check = (v, p) => (typeof v === 'string' ? [] : [`${p}: expected string, got ${describe(v)}`])

export const bool: Check = (v, p) => (typeof v === 'boolean' ? [] : [`${p}: expected boolean, got ${describe(v)}`])

/** A calendar date, YYYY-MM-DD. */
export const isoDate: Check = (v, p) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? [] : [`${p}: expected YYYY-MM-DD, got ${describe(v)}`]

/** A Postgres timestamptz as the API prints it ("2026-09-03 09:13:33.062173-04") or ISO. */
export const timestamp: Check = (v, p) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)$/.test(v)) {
    return [`${p}: expected timestamp, got ${describe(v)}`]
  }
  const iso = v.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
  return Number.isNaN(new Date(iso).getTime()) ? [`${p}: unparseable timestamp ${v}`] : []
}

export const literal = (...allowed: (string | number | boolean | null)[]): Check => (v, p) =>
  allowed.includes(v as string) ? [] : [`${p}: expected one of ${JSON.stringify(allowed)}, got ${describe(v)}`]

/** `null` or the inner check — the "| null" of a declared type. */
export const nullable = (inner: Check): Check => (v, p) => (v === null ? [] : inner(v, p))

/** Missing (undefined) or the inner check — the "?:" of a declared type. Null is NOT accepted. */
export const optional = (inner: Check): Check => (v, p) => (v === undefined ? [] : inner(v, p))

/** A JSON array (never `{}`) whose every item passes. */
export const arrayOf = (item: Check): Check => (v, p) => {
  if (!Array.isArray(v)) return [`${p}: expected array, got ${describe(v)}`]
  return v.flatMap((x, i) => item(x, `${p}[${i}]`))
}

export type Spec<T> = { [K in keyof Required<T>]: Check }

/**
 * A JSON object (never an array) with every declared key. Declared-required keys must be
 * present; `strict` also reports keys the type does not declare.
 */
export function object<T>(spec: Spec<T>, { strict = false }: { strict?: boolean } = {}): Check {
  return (v, p) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return [`${p}: expected object, got ${describe(v)}`]
    const rec = v as Record<string, unknown>
    const issues: string[] = []
    for (const [key, check] of Object.entries(spec) as [string, Check][]) {
      const at = `${p}.${key}`
      if (!(key in rec)) {
        const missing = check(undefined, at)
        if (missing.length) issues.push(`${at}: missing`)
        continue
      }
      issues.push(...check(rec[key], at))
    }
    if (strict) {
      for (const key of Object.keys(rec)) if (!(key in spec)) issues.push(`${p}.${key}: not declared by the type`)
    }
    return issues
  }
}

/** Throw a readable list of every mismatch; returns the value typed as T otherwise. */
export function assertShape<T>(value: unknown, check: Check, label = 'response'): T {
  const issues = check(value, label)
  if (issues.length) throw new Error(`Shape mismatch:\n  ${issues.slice(0, 25).join('\n  ')}`)
  return value as T
}

/** The error message a rejected api call carried. */
export async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (e) {
    return (e as Error).message
  }
  throw new Error('expected the call to reject, but it resolved')
}
