import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { FullPageSpinner } from './RequireAuth'

/** Wrap admin-only content. Non-admins are redirected home; the backend also enforces 403. */
export default function RequireAdmin({ children }: { children: ReactNode }) {
  const { authEnabled, user, loading, isAdmin } = useAuth()

  if (!authEnabled) return <>{children}</>
  if (loading) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}
