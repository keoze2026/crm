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
  replacement: number
  counted: number
  rate: number
  total_bill: number
}

export interface CompleteReportCampaignRow {
  camp: string
  destination: string
  answered: number
  missed: number
  replacement: number
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
    replacement: number
    counted: number
    rate: number
    total_bill: number
  }
  campaign_totals: {
    camps: number
    destinations: number
    answered: number
    missed: number
    replacement: number
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
  rate: number
  campaign_id: number | null
  created_at: string
}

export interface Buyer {
  id: number
  code: string
  name: string | null
  status: string
  notes: string | null
  rate: number
  created_at: string
  revenue: number
  counted: number
  answered: number
  missed: number
  record_days: number
  records: number
  last_activity: string | null
}

export interface CampaignSource {
  destination_id: number | null
  name: string
  rate: number
  counted: number
  cost: number
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
  replacement: number
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

// ── Attendance ────────────────────────────────────────────────────────────────

export interface AttendanceStaff {
  user_id: string
  username: string | null
  staff_name: string | null
  first_seen: string
  last_seen: string
}

export interface AttendanceDay {
  user_id: string
  staff_name: string | null
  username: string | null
  work_date: string
  login_at: string | null
  login_stated: string | null
  logout_at: string | null
  logout_stated: string | null
  present: boolean
  still_in: boolean
  completed: boolean
  hours: number | null
  net_hours: number | null
  break_min: number
  break_count: number
  break_detail: string
  over_break_min: number
}

export interface AttendanceRoster {
  timezone: string
  breakAllowanceMin: number
  date: string
  rows: AttendanceDay[]
}

export interface AttendanceBreakRecord {
  taken_at: string
  duration_min: number
  urgent: boolean
  raw: string | null
}

export interface AttendanceBreaks {
  userId: string
  date: string
  allowanceMin: number
  totalMin: number
  overMin: number
  breaks: AttendanceBreakRecord[]
}

export interface AttendanceException {
  user_id: string
  staff_name: string | null
  work_date: string
  login_at?: string
  local_login?: string
  break_min?: number
  over_min?: number
}

export interface AttendanceExceptions {
  type: string
  from: string
  to: string
  rows: AttendanceException[]
}

// ─── Auth ───────────────────────────────────────────────────────────────────

export type Role = 'admin' | 'member' | 'user'

export interface AuthUser {
  id: number
  email: string
  name: string | null
  role: Role
  username: string | null
  totp_enabled: boolean
  permissions: string[] | null
}

export interface EnrollInfo {
  otpauth_uri: string
  secret: string
  email: string
}

export interface EnrollLink {
  token: string
  path: string
  expires_at: string
}

export interface ManagedUser {
  id: number
  email: string
  name: string | null
  username: string | null
  role: Role
  is_active: boolean
  totp_enabled: boolean
  permissions: string[] | null
  last_login_at: string | null
  created_at: string
}

export interface AuditLog {
  id: number
  user_id: number | null
  user_email: string | null
  action: string
  method: string | null
  path: string | null
  entity_type: string | null
  entity_id: number | null
  details: Record<string, unknown> | null
  status_code: number | null
  ip: string | null
  user_agent: string | null
  created_at: string
}

export interface AuditPage {
  rows: AuditLog[]
  total: number
  limit: number
  offset: number
}

export interface AuditFilters {
  user_id?: number
  action?: string
  entity_type?: string
  from?: string
  to?: string
  q?: string
  limit?: number
  offset?: number
}

// ─── Portal expenses ─────────────────────────────────────────────────────────

export interface PortalExpense {
  id: number
  /** First day of the month, YYYY-MM-DD. */
  month: string
  name: string
  voice_minutes: number
  rejected_calls: number
  rent_values: number
  /** Payout expenses, USD. */
  payout_expenses: number
  total_amount: number
  sort_order: number
  created_at: string
  updated_at: string
}

// ─── Vendors (traffic-source payment sheets) ───────────────────────────────────

export interface Vendor {
  /** null for a discovered campaign source that has no `vendors` metadata row yet. */
  id: number | null
  name: string
  /** true = added via the "+" tab (not present on the Campaigns side). */
  is_manual: boolean
  /** Hand-entered balance, USD, signed: positive = Due (red), negative = Advance (green). */
  manual_due: number
  sort_order: number
}

export interface VendorPayment {
  id: number
  vendor: string
  /** Entry date, YYYY-MM-DD. */
  entry_date: string
  converted_calls: number
  /** USD per converted call. */
  price: number
  /** USD actually paid. */
  amount_paid: number
  created_at: string
  updated_at: string
}