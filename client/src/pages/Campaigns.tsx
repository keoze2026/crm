import { Megaphone } from 'lucide-react'
import RecordsSection from '../components/RecordsSection'
import DashboardPageLayout from '@/components/dashboard/page-layout'

/**
 * Campaigns are managed entirely on the cost-side records sheet (the former
 * "Cost billing" section). The retired Monthly Sheet + add-campaign modal were
 * removed during the redesign; campaigns are added inline on the sheet's bottom row.
 */
export default function Campaigns() {
  return (
    <DashboardPageLayout header={{ title: 'Campaigns', icon: Megaphone }}>
      <RecordsSection
        type="campaign"
        title="Campaigns sheet"
        subtitle="Campaign call records — billing sheet"
        theme="navy"
        hideHeader
      />
    </DashboardPageLayout>
  )
}
