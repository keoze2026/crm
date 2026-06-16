import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Records from './pages/Records'
import Buyers from './pages/Buyers'
import Campaigns from './pages/Campaigns'
// import Reports from './pages/Reports'  // reports page disabled — see CompleteReport
import CompleteReportPage from './pages/CompleteReport'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'records', element: <Records /> },
      { path: 'buyers', element: <Buyers /> },
      { path: 'campaigns', element: <Campaigns /> },
      // { path: 'reports', element: <Reports /> },  // reports page disabled
      { path: 'complete-report', element: <CompleteReportPage /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
