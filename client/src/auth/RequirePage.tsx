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
    return AUTH_ONLY_PAGES.includes(page) ? <Navigate to="/" replace /> : <>{children}</>
  }
  if (loading) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace />
  if (canAccess(page)) return <>{children}</>
  return <Navigate to={firstAllowedPath()} replace />
}
