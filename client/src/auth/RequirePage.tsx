import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { AUTH_ONLY_PAGES } from './pages'
import { FullPageSpinner } from './RequireAuth'

/**
 * Gate a route behind a page permission. Admins (and auth-off mode) always pass; a user
 * without the permission is redirected to the first page they can see, so hiding a tab in
 * the sidebar also blocks direct navigation to its URL.
 */
export default function RequirePage({ page, children }: { page: string; children: ReactNode }) {
  const { authEnabled, loading, user, canAccess, firstAllowedPath } = useAuth()

  // Users / System Logs don't exist when auth is off — send stray URLs home.
  if (!authEnabled) {
    if (!AUTH_ONLY_PAGES.includes(page)) return <>{children}</>
    // `authEnabled` starts false until /auth/status answers, so a direct load of /users or
    // /system-logs must wait for it rather than bounce home before auth has been discovered.
    if (loading) return <FullPageSpinner />
    return <Navigate to="/" replace />
  }
  if (loading) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace />
  if (canAccess(page)) return <>{children}</>
  return <Navigate to={firstAllowedPath()} replace />
}
