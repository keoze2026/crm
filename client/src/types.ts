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
  /**
   * % change vs the immediately preceding period of the same length.
   * The fields marked optional were added later — the client is deployed independently
   * of the PHP API, so a client release can briefly run against an API that predates
   * them. Treat "missing" as "no comparison available", never as an error.
   */
  deltas: {
    revenue: number | null
    cost: number | null
    margin: number | null
    counted: number | null
    answered?: number | null
    active_buyers?: number | null
    active_campaigns?: number | null
  }
  /**
   * Percentage-POINT difference vs the previous period, for metrics that are already
   * percentages (a "% change of a %" would read as nonsense). Optional for the same
   * independent-deploy reason as above.
   */
  point_deltas?: {
    margin_pct: number | null
    answer_rate: number | null
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
  /** Call recording, USD. */
  call_recording: number
  /** Voip shield, USD. */
  voip_shield: number
  /** Catch-all for the remaining expenses (payout, fixed float, …), USD. */
  other_expenses: number
  total_amount: number
  sort_order: number
  created_at: string
  updated_at: string
}

// ─── Queues (per-person queue records + the two catalogues) ────────────────────

/** A name in the Names catalogue the Queues page picks from. */
export interface QueuePerson {
  id: number
  name: string
  /** Their record's id, or null when they have no record yet. */
  assignment_id: number | null
  created_at: string
  updated_at: string
}

/** A queue in the Queues catalogue the page ticks. */
export interface QueueCode {
  id: number
  code: string
  /** How many records currently include this queue — what a delete would touch. */
  usage_count: number
  created_at: string
  updated_at: string
}

/** One person's record: the name plus every queue they cover. */
export interface QueueAssignment {
  id: number
  person_id: number
  /** Denormalised from the Names catalogue for display. */
  name: string
  codes: { id: number; code: string }[]
  sort_order: number
  /** When the record was keyed in — the date the History section groups by. */
  created_at: string
  updated_at: string
}

/** What a catalogue create answers with: the rows it added, and the ones already there. */
export interface CatalogueResult<T> {
  created: T[]
  existing: T[]
}

// ─── Reviews (the Review page's three tabs) ────────────────────────────────────

/** Which tab an entry belongs to. */
export type ReviewKind = 'performance' | 'behaviour'

/** A row of the Department tab — and the catalogue the other tabs group by. */
export interface ReviewDepartment {
  id: number
  name: string
  /** Excellent / Good / Average / Below Average / Poor — stored as the shown wording. */
  performance: string
  /** null = never scored, so the cell stays blank rather than reading 0. */
  percentage: number | null
  sort_order: number
  created_at: string
  updated_at: string
}

/** One person's row on the Performance or Behaviour tab. */
export interface ReviewEntry {
  id: number
  kind: ReviewKind
  /** The department band the row sits under; null = "No department". */
  department_id: number | null
  person_name: string
  /** The per-row DEPARTMENT cell ("Billing", "Billing/Audits") — free text. */
  department_note: string
  /** Performance rating, or the behaviour analysis. */
  rating: string
  /** Performance rows only. */
  percentage: number | null
  /** Free-text remark on the individual — shown on the Performance tab. */
  notes: string
  /** Behaviour rows only — the first day of the month, YYYY-MM-DD. */
  month: string | null
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
  /**
   * The balance the vendor's ledger starts from, before any `vendor_payments` row —
   * USD, signed: positive = Advance (green), negative = Due (red). Everything after it
   * is derived from the ledger; see `VendorLedger`.
   */
  opening_advance: number
  sort_order: number
}

export interface VendorPayment {
  id: number
  vendor: string
  /** Entry date, YYYY-MM-DD. */
  entry_date: string
  converted_calls: number
  /** USD per converted Lead. */
  price: number
  /** USD actually paid. */
  amount_paid: number
  created_at: string
  updated_at: string
}

/**
 * One vendor's ledger for a date range, plus the balance carried INTO that range — which
 * is what keeps the Due/Advance figure accurate when you move to the next viewing period.
 */
export interface VendorLedger {
  rows: VendorPayment[]
  /** The vendor's stored seed (`vendors.opening_advance`), before any ledger row. */
  opening_advance: number
  /** Σ(amount_paid − converted_calls × price) over every row dated before the range. */
  prior_net: number
  /** opening_advance + prior_net — the "Initial Advance" the period opens with. */
  initial_advance: number
}