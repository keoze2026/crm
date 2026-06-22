import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Records from './pages/Records'
import Buyers from './pages/Buyers'
import Campaigns from './pages/Campaigns'
import CompleteReportPage from './pages/CompleteReport'
import Attendance from './pages/Attendance'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'records', element: <Records /> },
      { path: 'buyers', element: <Buyers /> },
      { path: 'campaigns', element: <Campaigns /> },
      { path: 'complete-report', element: <CompleteReportPage /> },
      { path: 'attendance', element: <Attendance /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)