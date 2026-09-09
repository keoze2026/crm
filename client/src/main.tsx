import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import { AuthProvider } from './auth/AuthContext'
import RequireAuth from './auth/RequireAuth'
import RequirePage from './auth/RequirePage'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Records from './pages/Records'
import Buyers from './pages/Buyers'
import Campaigns from './pages/Campaigns'
import Vendors from './pages/Vendors'
import PortalExpenses from './pages/PortalExpenses'
import QueuesPage from './pages/Queues'
import Review from './pages/Review'
import StaffPage from './pages/Staff'
import CompleteReportPage from './pages/CompleteReport'
import Attendance from './pages/Attendance'
import Login from './pages/Login'
import Enroll from './pages/Enroll'
import SystemLogs from './pages/SystemLogs'
import Users from './pages/Users'
import UserManual from './pages/UserManual'

// 🔑 SET YOUR SITE PASSWORD HERE
const SITE_PASSWORD = 'crmKeozx@2026.'

function SitePasswordGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(() => {
    return sessionStorage.getItem('site_unlocked') === 'true'
  })
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (password === SITE_PASSWORD) {
      sessionStorage.setItem('site_unlocked', 'true')
      setUnlocked(true)
    } else {
      setError(true)
    }
  }

  if (unlocked) {
    return children
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        width: '100vw',
        backgroundColor: '#f3f4f6',
        fontFamily: 'sans-serif',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          padding: '2rem',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          minWidth: '320px',
        }}
      >
        <h2 style={{ margin: 0, textAlign: 'center', color: '#1f2937' }}>
          Access Restricted
        </h2>
        <p style={{ margin: 0, textAlign: 'center', fontSize: '0.875rem', color: '#6b7280' }}>
          Please enter the site password to continue.
        </p>

        <div>
          <input
            type="password"
            placeholder="Enter Password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(false)
            }}
            style={{
              width: '100%',
              padding: '0.6rem 0.8rem',
              borderRadius: '4px',
              border: error ? '1px solid #ef4444' : '1px solid #d1d5db',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
          {error && (
            <p style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.3rem', marginBottom: 0 }}>
              Incorrect password. Try again.
            </p>
          )}
        </div>

        <button
          type="submit"
          style={{
            padding: '0.6rem 1rem',
            backgroundColor: '#2563eb',
            color: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: '600',
          }}
        >
          Enter Site
        </button>
      </form>
    </div>
  )
}

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/enroll', element: <Enroll /> },
  {
    // Everything below requires a session (a no-op when auth is disabled).
    element: <RequireAuth />,
    children: [
      // Full-screen standalone help page (own layout, no app sidebar).
      { path: '/manual', element: <UserManual /> },
      {
        path: '/',
        element: <Layout />,
        children: [
          { index: true, element: <RequirePage page="dashboard"><Dashboard /></RequirePage> },
          { path: 'records', element: <Records /> },
          { path: 'buyers', element: <RequirePage page="buyers"><Buyers /></RequirePage> },
          { path: 'campaigns', element: <RequirePage page="campaigns"><Campaigns /></RequirePage> },
          { path: 'vendors', element: <RequirePage page="vendors"><Vendors /></RequirePage> },
          { path: 'portal-expenses', element: <RequirePage page="portal-expenses"><PortalExpenses /></RequirePage> },
          { path: 'queues', element: <RequirePage page="queues"><QueuesPage /></RequirePage> },
          { path: 'review', element: <RequirePage page="reviews"><Review /></RequirePage> },
          { path: 'staff', element: <RequirePage page="staff"><StaffPage /></RequirePage> },
          { path: 'complete-report', element: <RequirePage page="complete-report"><CompleteReportPage /></RequirePage> },
          { path: 'attendance', element: <RequirePage page="attendance"><Attendance /></RequirePage> },
          { path: 'users', element: <RequirePage page="users"><Users /></RequirePage> },
          { path: 'system-logs', element: <RequirePage page="logs"><SystemLogs /></RequirePage> },
        ],
      },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SitePasswordGate>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </SitePasswordGate>
  </StrictMode>,
)