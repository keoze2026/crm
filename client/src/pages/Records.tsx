import { LayoutGrid } from 'lucide-react'
import RecordsSection from '../components/RecordsSection'
import DashboardPageLayout from '@/components/dashboard/page-layout'

export default function Records() {
  return (
    <DashboardPageLayout header={{ title: 'Daily Sheet', icon: LayoutGrid }}>
      <RecordsSection
        type="buyer"
        title="Daily Sheet"
        subtitle="Revenue — buyer call records"
        theme="navy"
        hideHeader
      />
    </DashboardPageLayout>
  )
}
