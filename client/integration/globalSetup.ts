import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { connect } from 'node:net'
import { resolve } from 'node:path'

// Builds the test database once and starts two API servers for the whole run:
// auth OFF on INT_PORT_BASE and auth ON on INT_PORT_BASE + 1 (the /auth, /admin and
// /audit-logs routes only exist with auth on). Both use server/tests/server.php, which pins
// the database to the *_test one before .env loads.

export const SERVER_DIR = resolve(import.meta.dirname, '../../server')
export const DB_NAME = process.env.INT_DB_NAME || 'crm_int_test'
export const PORT_BASE = Number(process.env.INT_PORT_BASE || 8200)
const PHP = process.env.PHP || 'php'

const servers: ChildProcess[] = []

function waitForPort(port: number, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms
  return new Promise((ok, fail) => {
    const probe = () => {
      const sock = connect(port, '127.0.0.1')
      sock.once('connect', () => { sock.destroy(); ok() })
      sock.once('error', () => {
        sock.destroy()
        if (Date.now() > deadline) fail(new Error(`php -S did not open port ${port}`))
        else setTimeout(probe, 100)
      })
    }
    probe()
  })
}

export async function setup() {
  if (!DB_NAME.endsWith('_test')) throw new Error(`INT_DB_NAME '${DB_NAME}' must end in _test`)
  const env = { ...process.env, TEST_DB_NAME: DB_NAME }

  if (!process.env.INT_SKIP_DB_SETUP) {
    execFileSync(PHP, ['tests/setup_test_db.php'], { cwd: SERVER_DIR, env, stdio: 'inherit' })
  }

  for (const auth of [false, true]) {
    const port = PORT_BASE + (auth ? 1 : 0)
    servers.push(spawn(
      PHP,
      ['-S', `127.0.0.1:${port}`, '-t', 'public', 'tests/server.php'],
      { cwd: SERVER_DIR, env: { ...env, TEST_AUTH_ENABLED: String(auth) }, stdio: 'ignore' },
    ))
    await waitForPort(port)
  }
}

export async function teardown() {
  for (const s of servers) s.kill()
}
