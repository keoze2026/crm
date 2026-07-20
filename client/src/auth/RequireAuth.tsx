import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { PageLoader } from '../components/ui'

/** Gate for all app routes. When auth is disabled it lets everything through (legacy mode). */
export default function RequireAuth() {
  const { authEnabled, user, loading } = useAuth()
  const location = useLocation()

  if (!authEnabled) return <Outlet />
  if (loading) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

export function FullPageSpinner() {
  return <PageLoader className="min-h-screen" />
}
