import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '../src/api/client'
import { AUTH_ONLY_PAGES, DEFAULT_USER_PAGES, PAGES, userCanAccess } from '../src/auth/pages'
import { createEnrolledUser, loginAs, resetTables, useServer, type Server } from './harness'
import { lastStatus } from './shape-staff'

// The client's page guards (auth/pages.ts userCanAccess + RequirePage) against what the
// auth-on server's AuthMiddleware really lets a member do.
//
// Every probe is a read the UI actually makes, tagged with the pages that make it:
//   required — the page calls it unguarded; a 403 breaks or blanks part of that page
//   optional — the page calls it with a .catch() and degrades by design
// Probes marked `always` are the Daily Sheet's (/records), which every signed-in user sees.
// PerformerProvider (main.tsx) wraps every page and tolerates every refusal, so it adds
// nothing to either list.

interface Probe {
  name: string
  call: () => Promise<unknown>
  required: string[]
  optional?: string[]
  always?: boolean
}

const PROBES: Probe[] = [
  // Staff Management's roster is shared: Queues, Review, Attendance and the Users page's
  // "pick from the roster" all read it.
  { name: 'GET /staff', call: () => api.staff(), required: ['staff', 'queues', 'attendance', 'users'], optional: ['reviews'] },
  { name: 'GET /departments', call: () => api.departments(), required: ['staff'] },
  { name: 'GET /staff-attendance', call: () => api.staffAttendance({ from: '2026-08-01', to: '2026-08-31' }), required: ['staff', 'attendance'], optional: ['reviews'] },
  { name: 'GET /staff-leaves', call: () => api.staffLeaves({ from: '2026-08-01', to: '2026-08-31' }), required: ['staff'], optional: ['reviews'] },
  { name: 'GET /staff-salaries', call: () => api.staffSalaries('2026-08'), required: ['staff'] },
  { name: 'GET /staff-salary-holds', call: () => api.staffSalaryHolds(), required: ['staff'] },
  { name: 'GET /review-departments', call: () => api.reviewDepartments('2026-08'), required: ['reviews'] },
  // Staff.tsx's Staff tab previews the month's Top Performer standing from the review rows,
  // without a .catch() — its error lands in the page's red error line.
  { name: 'GET /review-entries', call: () => api.reviewEntries('performance', '2026-08'), required: ['reviews', 'staff'] },
  { name: 'GET /top-performer', call: () => api.topPerformer('2026-08'), required: ['reviews'], optional: ['staff'] },
  { name: 'GET /top-performer/range', call: () => api.topPerformerRange('2026-07', '2026-08'), required: [], optional: ['reviews'] },
  { name: 'GET /annual-reviews', call: () => api.annualReview('half', '2026-08'), required: ['reviews'] },
  { name: 'GET /queues', call: () => api.queues('forwarding'), required: ['queues'] },
  { name: 'GET /queue-codes', call: () => api.queueCodes(), required: ['queues'] },
  { name: 'GET /admin/users', call: () => api.users(), required: ['users'] },
  { name: 'GET /admin/access-presets', call: () => api.accessPresets(), required: ['users'] },
  { name: 'GET /audit-logs', call: () => api.auditLogs({}), required: ['logs'] },
  { name: 'GET /audit-logs/actions', call: () => api.auditActions(), required: ['logs'] },
  { name: 'GET /attendance/roster', call: () => api.attendanceRoster('2026-08-04'), required: ['dashboard', 'attendance'] },
  { name: 'GET /attendance/staff', call: () => api.attendanceStaff(), required: ['dashboard', 'attendance'] },
  { name: 'GET /attendance/live', call: () => api.attendanceLive(), required: ['attendance'] },
  { name: 'GET /attendance/on-break', call: () => api.attendanceOnBreak(), required: ['attendance'] },
  { name: 'GET /attendance/days', call: () => api.attendanceDays({ from: '2026-08-01', to: '2026-08-31' }), required: ['attendance'] },
  { name: 'GET /attendance/exceptions', call: () => api.attendanceExceptions('late_return', '2026-08-01', '2026-08-31'), required: ['attendance'] },
  { name: 'GET /attendance/breaks', call: () => api.attendanceBreaks('1', '2026-08-04'), required: ['attendance'] },
  { name: 'GET /analytics/summary', call: () => api.summary({}), required: ['dashboard'] },
  { name: 'GET /analytics/complete-report', call: () => api.completeReport(), required: ['complete-report'] },
  { name: 'GET /vendors', call: () => api.vendors(), required: ['vendors'] },
  { name: 'GET /portal-expenses', call: () => api.portalExpenses('2026-08'), required: ['portal-expenses'] },
  { name: 'GET /buyers', call: () => api.buyers(), required: ['buyers'], always: true },
  { name: 'GET /campaigns', call: () => api.campaigns(), required: ['campaigns'], always: true },
  { name: 'GET /records', call: () => api.records({}), required: [], always: true },
]

/** The server's gated first path segments (AuthMiddleware::GATED_SEGMENTS). */
const GATED = /^GET \/(audit-logs|admin|queues|queue-codes|review-departments|review-entries|top-performer|annual-reviews|staff|departments|staff-attendance|staff-leaves|staff-salaries|staff-salary-holds)(\/|$)/

let server: Server
beforeEach(() => {
  resetTables('users', 'sessions', 'audit_log')
  server = useServer({ auth: true })
})

/** Run every probe as the signed-in user: probe name → allowed? (other failures reported). */
async function probeAll(): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>()
  for (const p of PROBES) {
    try {
      await p.call()
      out.set(p.name, true)
    } catch (e) {
      const status = lastStatus(server)
      if (status !== 403) throw new Error(`${p.name} failed with ${status}: ${(e as Error).message}`, { cause: e })
      out.set(p.name, false)
    }
  }
  return out
}

const uses = (p: Probe, page: string) => p.required.includes(page) || (p.optional ?? []).includes(page)

describe('a member holding exactly one page', () => {
  it.each(PAGES.map((p) => p.key))('%s: the client guard and the server agree about the page itself', async (key) => {
    const member = createEnrolledUser(`only-${key}`, 'member', [key])
    await loginAs(member)
    const { user } = await api.me()
    expect(user.permissions).toEqual([key])
    expect(PAGES.filter((p) => userCanAccess(user, p.key)).map((p) => p.key)).toEqual([key])

    const allowed = await probeAll()
    const problems: string[] = []
    for (const p of PROBES) {
      if (!GATED.test(p.name)) continue
      // A gated surface is open exactly when a page this member can see needs it.
      const canSee = PAGES.some((pg) => userCanAccess(user, pg.key) && uses(p, pg.key))
      if (p.required.includes(key) && !allowed.get(p.name)) problems.push(`${p.name}: 403, but the ${key} page calls it without a fallback`)
      if (!canSee && allowed.get(p.name)) problems.push(`${p.name}: allowed, though no page this member can open reads it`)
    }
    expect(problems).toEqual([])
  })
})

describe('server enforcement of the ungated page surfaces', () => {
  it('refuses a page\'s own endpoints to a member the client hides that page from', async () => {
    // A member with only Queues: the client offers no Vendors, Portal Expenses, Dashboard,
    // Complete Report or Attendance page, and the Daily Sheet needs none of these.
    const member = createEnrolledUser('queues-only', 'member', ['queues'])
    await loginAs(member)
    const allowed = await probeAll()
    const leaks = PROBES
      .filter((p) => !GATED.test(p.name) && !p.always && !uses(p, 'queues') && allowed.get(p.name))
      .map((p) => `${p.name} (page: ${p.required.join('/')})`)
    expect(leaks).toEqual([])
  })
})

describe('members with default access and admins', () => {
  it('a member whose permissions were never customised sees DEFAULT_USER_PAGES on both sides', async () => {
    await loginAs(createEnrolledUser('default-member', 'member', null))
    const { user } = await api.me()
    expect(user.permissions).toBeNull()
    expect(PAGES.filter((p) => userCanAccess(user, p.key)).map((p) => p.key)).toEqual(DEFAULT_USER_PAGES)

    const allowed = await probeAll()
    const problems: string[] = []
    for (const p of PROBES) {
      const needed = p.required.some((k) => DEFAULT_USER_PAGES.includes(k))
      if (needed && !allowed.get(p.name)) problems.push(`${p.name}: refused to a default member`)
      if (p.required.every((k) => AUTH_ONLY_PAGES.includes(k)) && p.required.length > 0 && allowed.get(p.name)) {
        problems.push(`${p.name}: an admin-only page's endpoint is open to a default member`)
      }
    }
    expect(problems).toEqual([])
  })

  it('an admin passes every page guard and every endpoint', async () => {
    await loginAs(createEnrolledUser('boss', 'admin', ['queues']))
    const { user } = await api.me()
    expect(PAGES.every((p) => userCanAccess(user, p.key))).toBe(true)
    const allowed = await probeAll()
    expect([...allowed].filter(([, ok]) => !ok).map(([name]) => name)).toEqual([])
  })

  it('a session-less browser is refused everywhere but the public routes', async () => {
    expect(await api.authStatus()).toEqual({ auth_enabled: true })
    for (const p of PROBES) {
      await expect(p.call()).rejects.toThrow('Unauthorized')
      expect(lastStatus(server)).toBe(401)
    }
  })
})
