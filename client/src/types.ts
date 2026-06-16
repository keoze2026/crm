export type RecordType = 'buyer' | 'campaign'

export interface Summary {
  revenue: number
  cost: number
  margin: number
  margin_pct: number
  answered: number
  missed: number
  counted: number
  answer_rate: number
  buyer_records: number
  campaign_records: number
  active_buyers: number
  active_campaigns: number
  deltas: {
    revenue: number | null
    cost: number | null
    margin: number | null
    counted: number | null
  }
}

export interface TrendPoint {
  period: string
  revenue: number
  cost: number
  margin: number
  counted: number
  answered: number
  missed: number
}

export interface TopBuyer {
  id: number
  code: string
  name: string | null
  revenue: number
  counted: number
  answered: number
  missed: number
}

export interface TopCampaign {
  id: number
  code: string
  name: string | null
  cost: number
  counted: number
  answered: number
  missed: number
}

export interface TopSource {
  source: string
  cost: number
  counted: number
}

export interface CompleteReportBuyerRow {
  code: string
  answered: number
  missed: number
  counted: number
  rate: number
  total_bill: number
}

export interface CompleteReportCampaignRow {
  camp: string
  destination: string
  answered: number
  missed: number
  counted: number
  rate: number
  total_bill: number
}

export interface CompleteReport {
  from: string | null
  to: string | null
  buyers: CompleteReportBuyerRow[]
  campaigns: CompleteReportCampaignRow[]
  buyer_totals: {
    destinations: number
    answered: number
    missed: number
    counted: number
    rate: number
    total_bill: number
  }
  campaign_totals: {
    camps: number
    destinations: number
    answered: number
    missed: number
    counted: number
    rate: number
    total_bill: number
  }
  revenue: number
  cost: number
  profit: number
}

export interface Destination {
  id: number
  name: string
  status: string
  created_at: string
}

export interface Buyer {
  id: number
  code: string
  name: string | null
  status: string
  notes: string | null
  created_at: string
  revenue: number
  counted: number
  answered: number
  missed: number
  records: number
  last_activity: string | null
}

export interface Campaign {
  id: number
  code: string
  name: string | null
  status: string
  notes: string | null
  created_at: string
  cost: number
  counted: number
  answered: number
  missed: number
  records: number
  sources: number
  last_activity: string | null
}

export interface CallRecord {
  id: number
  record_date: string
  record_type: RecordType
  buyer_id: number | null
  buyer_code: string | null
  campaign_id: number | null
  campaign_code: string | null
  source: string | null
  answered: number
  missed: number
  counted: number
  rate: number
  total_bill: number
}

export interface Paginated<T> {
  data: T[]
  meta: { page: number; per_page: number; total: number; pages: number }
}

export interface RecordFilters {
  from?: string
  to?: string
  type?: RecordType | ''
  buyer_id?: number | ''
  campaign_id?: number | ''
  search?: string
  sort?: string
  dir?: 'asc' | 'desc'
  page?: number
  per_page?: number
}