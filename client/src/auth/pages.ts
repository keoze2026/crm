import type { AuthUser } from '../types'

/** A gateable page: its permission key, sidebar/route label, and route path. */
export interface PageDef {
  key: string
  label: string
  path: string
}

/**
 * Access-controlled pages, in the order the admin ticks them in the Users editor
 * (dashboard, buyers, campaigns, vendors, portal expenses, attendance, users, logs,
 * complete report).
 */
export const PAGES: PageDef[] = [
  { key: 'dashboard', label: 'Dashboard', path: '/' },
  { key: 'buyers', label: 'Buyers', path: '/buyers' },
  { key: 'campaigns', label: 'Campaigns', path: '/campaigns' },
  { key: 'vendors', label: 'Traffic Source', path: '/vendors' },
  { key: 'portal-expenses', label: 'Portal Expenses', path: '/portal-expenses' },
  { key: 'attendance', label: 'Attendance', path: '/attendance' },
  { key: 'users', label: 'Users', path: '/users' },
  { key: 'logs', label: 'System Logs', path: '/system-logs' },
  { key: 'complete-report', label: 'Complete Report', path: '/complete-report' },
]

/** Pages a non-admin user sees when their permissions have never been customised. */
export const DEFAULT_USER_PAGES = ['dashboard', 'buyers', 'campaigns', 'vendors', 'portal-expenses', 'attendance', 'complete-report']

/** Pages that only make sense while auth is enabled — hidden entirely when AUTH_ENABLED=false. */
export const AUTH_ONLY_PAGES = ['users', 'logs']

/** Whether a user may see a given page. Admins (and the auth-off mode) see everything. */
export function userCanAccess(user: AuthUser | null, key: string): boolean {
  if (!user) return false
  if (user.role === 'admin') return true
  const perms = user.permissions ?? DEFAULT_USER_PAGES
  return perms.includes(key)
}
