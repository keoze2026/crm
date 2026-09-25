import { execFileSync } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { vi } from 'vitest'
import { api } from '../src/api/client'

// Helpers shared by the client ↔ server integration tests. The api client calls the relative
// path `/api/...` with `credentials: 'include'`, as a browser would; useServer() stands in for
// the browser by prefixing the server's origin and keeping the session cookie.

const SERVER_DIR = resolve(import.meta.dirname, '../../server')
const DB_NAME = process.env.INT_DB_NAME || 'crm_int_test'
const PORT_BASE = Number(process.env.INT_PORT_BASE || 8200)
const PHP = process.env.PHP || 'php'

export interface Server {
  /** The browser's cookie jar for this server (crm_session). */
  cookies: Map<string, string>
  /** Every request the api client made, in order. */
  calls: { method: string, url: string, status: number }[]
}

/**
 * Point the api client at a live server: `auth: false` is the everyday mode, `auth: true` the
 * one with login, page permissions and the audit trail. Call in beforeEach (restoreMocks
 * unstubs it after each test).
 */
export function useServer({ auth = false }: { auth?: boolean } = {}): Server {
  const origin = `http://127.0.0.1:${PORT_BASE + (auth ? 1 : 0)}`
  const server: Server = { cookies: new Map(), calls: [] }
  const realFetch = globalThis.fetch

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input).startsWith('/') ? origin + String(input) : String(input)
    const headers = new Headers(init.headers)
    if (init.credentials === 'include' && server.cookies.size > 0) {
      headers.set('Cookie', [...server.cookies].map(([k, v]) => `${k}=${v}`).join('; '))
    }
    const res = await realFetch(url, { ...init, headers })
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';')
      const eq = pair.indexOf('=')
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (value === '' || value === 'deleted' || /max-age=0|expires=thu, 01 jan 1970/i.test(line)) server.cookies.delete(name)
      else server.cookies.set(name, value)
    }
    server.calls.push({ method: init.method ?? 'GET', url, status: res.status })
    return res
  })
  return server
}

/** Run one SQL statement on the test database; returns the rows. */
export function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): T[] {
  const out = execFileSync(PHP, ['tests/sql.php'], {
    cwd: SERVER_DIR,
    env: { ...process.env, TEST_DB_NAME: DB_NAME },
    input: JSON.stringify({ sql: query, params }),
    encoding: 'utf8',
  })
  return JSON.parse(out) as T[]
}

/** Empty tables (identity reset, cascading). */
export function resetTables(...tables: string[]): void {
  if (tables.length) sql(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`)
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

function base32Decode(s: string): Buffer {
  let bits = 0, value = 0
  const out: number[] = []
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | B32.indexOf(ch)
    bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}

/** The current RFC 6238 code (SHA1, 6 digits, 30 s) — what Google Authenticator shows. */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const o = h[h.length - 1] & 15
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(n % 1_000_000).padStart(6, '0')
}

export interface TestUser { id: number, username: string, secret: string }

/** An already-enrolled account, inserted directly (enrolment itself is tested separately). */
export function createEnrolledUser(username: string, role: 'admin' | 'member' = 'member', permissions: string[] | null = null): TestUser {
  const secret = base32Encode(randomBytes(20))
  const [row] = sql<{ id: number }>(
    `INSERT INTO users (email, name, username, role, totp_secret, totp_confirmed_at, is_active, permissions)
     VALUES (?, ?, ?, ?, ?, now(), true, ?::jsonb) RETURNING id`,
    [`${username}@example.test`, username, username, role, secret, permissions === null ? null : JSON.stringify(permissions)],
  )
  return { id: Number(row.id), username, secret }
}

/** Log in through the api client exactly as the Login page does (identifier → code). */
export async function loginAs(user: TestUser): Promise<void> {
  await api.login(user.username)
  await api.verifyTotp(totp(user.secret))
}

/** Today's date in the org timezone (America/New_York), as YYYY-MM-DD. */
export function orgToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}
