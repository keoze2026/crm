import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import './index.css'
import { AuthProvider } from './auth/AuthContext'
import { PerformerProvider } from './lib/performers'
import RequireAuth from './auth/RequireAuth'
import RequirePage from './auth/RequirePage'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import DailyBilling from './pages/DailyBilling'
import Buyers from './pages/Buyers'
import Vendors from './pages/Vendors'
import PortalExpenses from './pages/PortalExpenses'
import QueuesPage from './pages/Queues'
import Review from './pages/Review'
import StaffPage from './pages/Staff'
import CompleteReportPage from './pages/CompleteReport'
import Attendance from './pages/Attendance'
import Incentives from './pages/Incentives'
import Login from './pages/Login'
import Enroll from './pages/Enroll'
import SystemLogs from './pages/SystemLogs'
import Users from './pages/Users'
import UserManual from './pages/UserManual'

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
          // AHT Daily Billing is the Daily Sheet and the Campaigns sheet on one page. It is
          // always reachable, as the Daily Sheet was; its cost side needs the Campaigns
          // permission. The old addresses still land here.
          { path: 'daily-billing', element: <DailyBilling /> },
          { path: 'records', element: <Navigate to="/daily-billing" replace /> },
          { path: 'campaigns', element: <Navigate to="/daily-billing" replace /> },
          { path: 'buyers', element: <RequirePage page="buyers"><Buyers /></RequirePage> },
          { path: 'vendors', element: <RequirePage page="vendors"><Vendors /></RequirePage> },
          { path: 'portal-expenses', element: <RequirePage page="portal-expenses"><PortalExpenses /></RequirePage> },
          { path: 'queues', element: <RequirePage page="queues"><QueuesPage /></RequirePage> },
          { path: 'review', element: <RequirePage page="reviews"><Review /></RequirePage> },
          { path: 'staff', element: <RequirePage page="staff"><StaffPage /></RequirePage> },
          { path: 'complete-report', element: <RequirePage page="complete-report"><CompleteReportPage /></RequirePage> },
          { path: 'attendance', element: <RequirePage page="attendance"><Attendance /></RequirePage> },
          { path: 'incentives', element: <RequirePage page="incentives"><Incentives /></RequirePage> },
          { path: 'users', element: <RequirePage page="users"><Users /></RequirePage> },
          { path: 'system-logs', element: <RequirePage page="logs"><SystemLogs /></RequirePage> },
        ],
      },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      {/* The month's top and lowest performer, so their badges show beside their name on
          every page — fetched once, inside the session. */}
      <PerformerProvider>
        <RouterProvider router={router} />
      </PerformerProvider>
    </AuthProvider>
  </StrictMode>,
)
