import { StrictMode } from 'react'
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
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
)
