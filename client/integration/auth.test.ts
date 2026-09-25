import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, setUnauthorizedHandler } from '../src/api/client'
import { PAGES } from '../src/auth/pages'
import {
  createEnrolledUser, loginAs, resetTables, sql, totp, useServer, type Server, type TestUser,
} from './harness'
import {
  AccessPresetSpec, AuditLogSpec, AuditPageSpec, AuthUserSpec, EnrollInfoSpec, EnrollLinkSpec, ManagedUserSpec,
  arrayOf, expectShape, lastStatus, nullable, obj, oneOf, rejectionOf,
} from './shape-staff'
import type { ManagedUser } from '../src/types'

// Login, enrolment, logout and /me on the auth-on server; the admin Users, access-preset and
// System Logs endpoints; and how the api client surfaces the server's auth errors.

const TABLES = ['users', 'sessions', 'access_presets', 'audit_log', 'staff']

let server: Server
const onUnauthorized = vi.fn()

beforeEach(() => {
  resetTables(...TABLES)
  onUnauthorized.mockReset()
  setUnauthorizedHandler(onUnauthorized)
  server = useServer({ auth: true })
})
afterEach(() => setUnauthorizedHandler(null))

/** A second browser: a fresh cookie jar on the same server. */
function useFreshBrowser(): Server {
  vi.unstubAllGlobals()
  return useServer({ auth: true })
}

describe('auth status', () => {
  it('tells the client whether auth is enforced, on both servers', async () => {
    expect(await api.authStatus()).toEqual({ auth_enabled: true })
    vi.unstubAllGlobals()
    useServer({ auth: false })
    expect(await api.authStatus()).toEqual({ auth_enabled: false })
    // With auth off the rest of the auth surface does not exist.
    expect(await rejectionOf(api.me())).toBe('Not found')
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})

describe('login → verify → me → logout', () => {
  let member: TestUser
  beforeEach(() => { member = createEnrolledUser('casey', 'member') })

  it('runs the Login page flow and answers the declared AuthUser', async () => {
    expect(await api.login('CASEY')).toEqual({ mfa_required: true })
    expect(server.cookies.has('crm_session')).toBe(true)

    // Mid-MFA the session is not a login yet — and /me is a silent401 call, so the
    // AuthProvider's handler is not tripped by it.
    expect(await rejectionOf(api.me())).toBe('Unauthorized')
    expect(lastStatus(server)).toBe(401)

    const { user } = await api.verifyTotp(totp(member.secret))
    expectShape(user, AuthUserSpec)
    expect(user).toMatchObject({ id: member.id, username: 'casey', email: 'casey@example.test', role: 'member', totp_enabled: true, permissions: null })
    expect(sql<{ set: boolean }>('SELECT last_login_at IS NOT NULL AS set FROM users WHERE id = ?', [member.id])).toEqual([{ set: true }])

    const me = await api.me()
    expectShape(me, obj({ user: AuthUserSpec }))
    expect(me.user).toEqual(user)

    expect(await api.logout()).toBeUndefined()
    expect(lastStatus(server)).toBe(204)
    expect(server.cookies.has('crm_session')).toBe(false)
    expect(await rejectionOf(api.me())).toBe('Unauthorized')
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(sql('SELECT action FROM audit_log ORDER BY id')).toEqual([{ action: 'auth.login' }, { action: 'auth.logout' }])
  })

  it('logs in by email as well as username, ignoring case', async () => {
    expect(await api.login('Casey@Example.TEST')).toEqual({ mfa_required: true })
    const { user } = await api.verifyTotp(totp(member.secret))
    expect(user.id).toBe(member.id)
  })

  it('surfaces each refusal with the server\'s message and never trips the 401 handler', async () => {
    expect(await rejectionOf(api.login('  '))).toBe('Identifier is required')
    expect(lastStatus(server)).toBe(422)
    expect(await rejectionOf(api.login('nobody'))).toBe('Invalid credentials')
    expect(lastStatus(server)).toBe(401)
    expect(await rejectionOf(api.verifyTotp('123456'))).toBe('No pending login')

    sql("INSERT INTO users (username, role, is_active) VALUES ('pending', 'member', true)")
    expect(await rejectionOf(api.login('pending'))).toBe('Account not set up yet. Use the enrolment link from your admin.')
    expect(lastStatus(server)).toBe(403)

    await api.login('casey')
    const wrong = totp(member.secret) === '000000' ? '111111' : '000000'
    expect(await rejectionOf(api.verifyTotp(wrong))).toBe('Invalid code')
    expect(sql('SELECT failed_attempts FROM users WHERE id = ?', [member.id])).toEqual([{ failed_attempts: 1 }])
    expect(sql('SELECT action, status_code FROM audit_log')).toEqual([{ action: 'auth.login_failed', status_code: 401 }])
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('locks the account after five wrong codes', async () => {
    const wrong = totp(member.secret) === '000000' ? '111111' : '000000'
    await api.login('casey')
    for (let i = 0; i < 5; i++) await rejectionOf(api.verifyTotp(wrong))
    expect(await rejectionOf(api.login('casey'))).toBe('Account temporarily locked. Try again later.')
    expect(lastStatus(server)).toBe(429)
  })

  it('fires the unauthorized handler for an ordinary call once the session is gone', async () => {
    await loginAs(member)
    expect((await api.staff())).toEqual([])
    sql('DELETE FROM sessions')
    expect(await rejectionOf(api.staff())).toBe('Unauthorized')
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
})

describe('enrolment through an admin-issued link', () => {
  it('takes a new user from the Users page link to a signed-in session', async () => {
    const admin = createEnrolledUser('root', 'admin')
    await loginAs(admin)
    const preset = await api.createAccessPreset({ name: 'Agents', pages: ['queues', 'reviews'] })
    const created = await api.createUser({ username: 'newbie', name: 'New Bie', role: 'member', preset_id: preset.id })
    expect(created).toMatchObject({ username: 'newbie', email: null, preset_id: preset.id, permissions: ['queues', 'reviews'], totp_enabled: false })
    expectShape(created.enroll, EnrollLinkSpec)
    expect(created.enroll.path).toBe(`/enroll?token=${created.enroll.token}`)
    expect(Date.parse(created.enroll.expires_at) - Date.now()).toBeGreaterThan(23 * 3600_000)

    // The new user's own browser, holding only the link.
    useFreshBrowser()
    const { token } = created.enroll
    expect(await rejectionOf(api.enrollConfirm(token, '123456'))).toBe('Start enrolment first')
    expect(await rejectionOf(api.enrollStart('not-a-token'))).toBe('Invalid or expired enrolment link')

    const info = await api.enrollStart(token)
    expectShape(info, EnrollInfoSpec)
    expect(info).toMatchObject({ email: null, label: 'newbie' })
    expect(info.otpauth_uri).toContain(`secret=${info.secret}`)

    const wrong = totp(info.secret) === '000000' ? '111111' : '000000'
    expect(await rejectionOf(api.enrollConfirm(token, wrong))).toBe('Invalid code')
    const { user } = await api.enrollConfirm(token, totp(info.secret))
    expectShape(user, AuthUserSpec)
    expect(user).toMatchObject({ username: 'newbie', totp_enabled: true, permissions: ['queues', 'reviews'] })
    expect((await api.me()).user.id).toBe(user.id)

    // The link is single-use, and a returning login works with the enrolled secret.
    expect(await rejectionOf(api.enrollStart(token))).toBe('Invalid or expired enrolment link')
    await api.logout()
    await api.login('newbie')
    expect((await api.verifyTotp(totp(info.secret))).user.id).toBe(user.id)
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})

describe('admin: users', () => {
  let admin: TestUser
  beforeEach(async () => {
    admin = createEnrolledUser('root', 'admin')
    await loginAs(admin)
  })

  it('lists accounts in the declared ManagedUser shape', async () => {
    await api.createUser({ email: 'Pat@Example.com', role: 'member' })
    const list = await api.users()
    expectShape(list, arrayOf(ManagedUserSpec))
    const pat = list.find((u) => u.email === 'pat@example.com') as ManagedUser
    expect(pat).toMatchObject({
      username: null, totp_enabled: false, enroll_link_active: true, is_active: true, preset_id: null, preset_name: null,
      permissions: ['dashboard', 'buyers', 'campaigns', 'vendors', 'portal-expenses', 'queues', 'reviews', 'staff', 'attendance', 'complete-report'],
    })
    expect(pat.enroll_expires_at).not.toBeNull()
    const root = list.find((u) => u.id === admin.id) as ManagedUser
    expect(root).toMatchObject({ role: 'admin', totp_enabled: true, enroll_link_active: false })
    expect(root.last_login_at).not.toBeNull()
  })

  it('answers create and update with the fields the Users page reads', async () => {
    // The create/update answers are narrower than ManagedUser (no preset_name, own_permissions,
    // enroll_expires_at, enroll_link_active); the page reads only these and reloads the list.
    const narrow = obj<Omit<ManagedUser, 'preset_name' | 'own_permissions' | 'enroll_expires_at' | 'enroll_link_active'>>({
      id: 'int', email: nullable('string'), name: nullable('string'), username: nullable('string'), staff_id: nullable('int'),
      preset_id: nullable('int'), role: oneOf('admin', 'member', 'user'), is_active: 'boolean', totp_enabled: 'boolean',
      permissions: nullable(arrayOf('string')), last_login_at: nullable('timestamp'), created_at: 'timestamp',
    })
    const created = await api.createUser({ username: 'sam', role: 'member', permissions: ['queues', 'bogus', 'logs'] })
    expectShape(created, narrow)
    expect(created.permissions).toEqual(['queues', 'logs'])
    const updated = await api.updateUser(created.id, { name: 'Sam Smith', is_active: false })
    expectShape(updated, narrow)
    expect(updated).toMatchObject({ name: 'Sam Smith', is_active: false })
  })

  it('creates an account from the Staff roster, deriving a username', async () => {
    const [ada] = (await api.createStaff(['Ada Lovelace'])).created
    const u = await api.createUser({ staff_id: ada.id, role: 'member' })
    expect(u).toMatchObject({ staff_id: ada.id, name: 'Ada Lovelace', username: 'ada.lovelace' })
    expect(await rejectionOf(api.createUser({ staff_id: ada.id, role: 'member' }))).toBe('That staff member already has an account')
    expect(lastStatus(server)).toBe(409)
  })

  it('surfaces validation, conflict and not-found messages', async () => {
    const u = await api.createUser({ username: 'lee', role: 'member' })
    expect(await rejectionOf(api.createUser({ role: 'member' }))).toBe('An email or a username is required')
    expect(await rejectionOf(api.createUser({ email: 'nope', role: 'member' }))).toBe('That email address is not valid')
    expect(await rejectionOf(api.createUser({ username: 'LEE', role: 'member' }))).toBe('That username is already taken')
    expect(await rejectionOf(api.updateUser(u.id, { username: '' }))).toBe('An account needs an email or a username — it cannot have neither')
    expect(lastStatus(server)).toBe(422)
    expect(await rejectionOf(api.updateUser(99_999, { name: 'x' }))).toBe('User not found')
    expect(lastStatus(server)).toBe(404)
    expect(await rejectionOf(api.deleteUser(admin.id))).toBe('You cannot delete your own account')
    expect(await rejectionOf(api.deleteUser(99_999))).toBe('User not found')
    expect(await api.deleteUser(u.id)).toEqual({ deleted: true })
  })

  it('issues, refreshes and resets enrolment links', async () => {
    const pending = await api.createUser({ username: 'pend', role: 'member' })
    const enrolled = createEnrolledUser('done', 'member')

    const fresh = await api.refreshEnrollLink(pending.id)
    expectShape(fresh, obj({ enroll: EnrollLinkSpec }))
    expect(fresh.enroll.token).not.toBe(pending.enroll.token)
    expect(await rejectionOf(api.refreshEnrollLink(enrolled.id)))
      .toBe('This user has already set up their authenticator. Use Reset authenticator instead.')
    expect(lastStatus(server)).toBe(409)

    const batch = await api.refreshPendingEnrollLinks()
    expectShape(batch, obj({ links: arrayOf(obj({ id: 'int', email: nullable('string'), name: nullable('string'), username: nullable('string'), enroll: EnrollLinkSpec })) }))
    expect(batch.links.map((l) => l.username)).toEqual(['pend'])

    const reset = await api.resetUserTotp(enrolled.id)
    expect(reset.reset).toBe(true)
    expectShape(reset.enroll, EnrollLinkSpec)
    expect((await api.users()).find((u) => u.id === enrolled.id)).toMatchObject({ totp_enabled: false, enroll_link_active: true })
  })
})

describe('admin: access presets', () => {
  beforeEach(async () => { await loginAs(createEnrolledUser('root', 'admin')) })

  it('keeps every page key the client offers (Pages.php and pages.ts agree)', async () => {
    const all = await api.createAccessPreset({ name: 'Everything', pages: PAGES.map((p) => p.key) })
    expectShape(all, AccessPresetSpec)
    expect([...all.pages].sort()).toEqual(PAGES.map((p) => p.key).sort())
  })

  it('is a live link: editing a preset changes an attached member\'s access at once', async () => {
    const preset = await api.createAccessPreset({ name: 'Agent', pages: ['queues'] })
    const member = createEnrolledUser('agent1', 'member')
    await api.updateUser(member.id, { preset_id: preset.id })
    await api.updateAccessPreset(preset.id, { pages: ['queues', 'reviews', 'nonsense'] })
    const listed = (await api.users()).find((u) => u.id === member.id) as ManagedUser
    expect(listed).toMatchObject({ preset_id: preset.id, preset_name: 'Agent', permissions: ['queues', 'reviews'], own_permissions: null })

    // Deleting the preset copies its pages onto the account, so access does not widen.
    expect(await api.deleteAccessPreset(preset.id)).toMatchObject({ deleted: true })
    const after = (await api.users()).find((u) => u.id === member.id) as ManagedUser
    expect(after).toMatchObject({ preset_id: null, permissions: ['queues', 'reviews'], own_permissions: ['queues', 'reviews'] })

    useFreshBrowser()
    await loginAs(member)
    expect((await api.me()).user.permissions).toEqual(['queues', 'reviews'])
  })

  it('surfaces 422 / 409 / 404', async () => {
    await api.createAccessPreset({ name: 'Finance', pages: [] })
    expect(await rejectionOf(api.createAccessPreset({ name: ' ', pages: [] }))).toBe('A preset name is required')
    expect(await rejectionOf(api.createAccessPreset({ name: 'Finance', pages: [] }))).toBe('A preset with that name already exists')
    expect(await rejectionOf(api.updateAccessPreset(99_999, { name: 'X' }))).toBe('Preset not found')
    expect(await rejectionOf(api.deleteAccessPreset(99_999))).toBe('Preset not found')
    expectShape(await api.accessPresets(), arrayOf(AccessPresetSpec))
  })
})

describe('admin: audit logs', () => {
  it('records mutations with sanitised details and serves them in the declared shape', async () => {
    const admin = createEnrolledUser('root', 'admin')
    await loginAs(admin)
    const [ada] = (await api.createStaff(['Ada Lovelace'])).created
    await api.updateStaff(ada.id, { status: 'leave' })

    const page = await api.auditLogs({ entity_type: 'staff-member' })
    expectShape(page, AuditPageSpec)
    expect(page).toMatchObject({ total: 2, limit: 50, offset: 0 })
    expect(page.rows.map((r) => [r.action, r.method, r.entity_id, r.status_code, r.user_id])).toEqual([
      ['staff-member.update', 'PUT', ada.id, 200, admin.id],
      ['staff-member.create', 'POST', null, 201, admin.id],
    ])
    expect(page.rows[1].details).toEqual({ names: ['Ada Lovelace'], department_ids: [] })

    const logins = await api.auditLogs({ action: 'auth.login' })
    expectShape(logins.rows, arrayOf(AuditLogSpec))
    expect(logins.rows[0]).toMatchObject({ entity_type: 'user', entity_id: admin.id, entity_label: 'root', user_email: 'root@example.test' })

    const actions = await api.auditActions()
    expect(actions).toEqual(['auth.login', 'staff-member.create', 'staff-member.update'])

    expect(await api.deleteAuditLog(page.rows[0].id)).toEqual({ deleted: true })
    expect(await api.deleteAuditLog(page.rows[0].id)).toEqual({ deleted: false })
    expect(await api.clearAuditLogs({ entity_type: 'staff-member' })).toEqual({ deleted: 1 })
    // Each prune leaves a record of itself.
    expect((await api.auditActions())).toEqual(['audit-log.clear', 'audit-log.delete', 'auth.login'])
  })

  it('is closed to a member without the logs page, with a plain 403', async () => {
    await loginAs(createEnrolledUser('m', 'member', ['staff']))
    expect(await rejectionOf(api.auditLogs({}))).toBe('Forbidden')
    expect(lastStatus(server)).toBe(403)
    expect(await rejectionOf(api.users())).toBe('Forbidden')
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})
