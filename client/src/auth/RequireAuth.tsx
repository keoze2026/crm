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
  // Dark, so the wait between the sign-in page and the app's dark bar doesn't flash white.
  return <PageLoader className="min-h-screen bg-[#04060b]" />
}
