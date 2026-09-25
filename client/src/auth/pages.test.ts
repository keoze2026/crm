import { describe, expect, it } from 'vitest'
import type { AuthUser } from '../types'
import { AUTH_ONLY_PAGES, DEFAULT_USER_PAGES, PAGES, userCanAccess } from './pages'

const user = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 1,
  email: 'someone@example.com',
  name: 'Someone',
  role: 'user',
  username: 'someone',
  totp_enabled: false,
  permissions: null,
  ...over,
})

describe('PAGES', () => {
  it('has unique keys and unique paths', () => {
    const keys = PAGES.map((p) => p.key)
    const paths = PAGES.map((p) => p.path)
    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('gives every page an absolute path and a label', () => {
    for (const p of PAGES) {
      expect(p.path.startsWith('/')).toBe(true)
      expect(p.label.trim()).not.toBe('')
    }
  })

  it('keeps the documented Users-editor order', () => {
    expect(PAGES.map((p) => p.key)).toEqual([
      'dashboard', 'buyers', 'campaigns', 'vendors', 'portal-expenses', 'queues', 'reviews',
      'staff', 'attendance', 'users', 'logs', 'complete-report',
    ])
  })

  it('puts the dashboard at the root', () => {
    expect(PAGES.find((p) => p.key === 'dashboard')?.path).toBe('/')
  })
})

describe('DEFAULT_USER_PAGES and AUTH_ONLY_PAGES', () => {
  const known = new Set(PAGES.map((p) => p.key))

  it('only name pages that exist', () => {
    for (const k of DEFAULT_USER_PAGES) expect(known.has(k)).toBe(true)
    for (const k of AUTH_ONLY_PAGES) expect(known.has(k)).toBe(true)
  })

  it('do not hand the admin-only pages to a default user', () => {
    expect(DEFAULT_USER_PAGES).not.toContain('users')
    expect(DEFAULT_USER_PAGES).not.toContain('logs')
  })

  it('mark users and logs as auth-only', () => {
    expect([...AUTH_ONLY_PAGES].sort()).toEqual(['logs', 'users'])
  })
})

describe('userCanAccess', () => {
  it('denies everything when there is no user', () => {
    for (const p of PAGES) expect(userCanAccess(null, p.key)).toBe(false)
  })

  it('lets an admin see every page, whatever their permissions list says', () => {
    const admin = user({ role: 'admin', permissions: [] })
    for (const p of PAGES) expect(userCanAccess(admin, p.key)).toBe(true)
    expect(userCanAccess(admin, 'anything-at-all')).toBe(true)
  })

  it('falls back to the default pages when permissions were never customised', () => {
    const u = user({ permissions: null })
    for (const p of PAGES) {
      expect(userCanAccess(u, p.key)).toBe(DEFAULT_USER_PAGES.includes(p.key))
    }
  })

  it('honours a customised permissions list exactly', () => {
    const u = user({ permissions: ['queues', 'users'] })
    expect(userCanAccess(u, 'queues')).toBe(true)
    expect(userCanAccess(u, 'users')).toBe(true)
    expect(userCanAccess(u, 'dashboard')).toBe(false)
    expect(userCanAccess(u, 'reviews')).toBe(false)
  })

  it('treats an empty permissions list as no access rather than the defaults', () => {
    const u = user({ permissions: [] })
    for (const p of PAGES) expect(userCanAccess(u, p.key)).toBe(false)
  })

  it('applies the same rules to the member role as to user', () => {
    const m = user({ role: 'member', permissions: ['buyers'] })
    expect(userCanAccess(m, 'buyers')).toBe(true)
    expect(userCanAccess(m, 'campaigns')).toBe(false)
  })

  it('denies an unknown page key to a non-admin', () => {
    expect(userCanAccess(user(), 'no-such-page')).toBe(false)
  })
})
