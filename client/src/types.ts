export type RecordType = 'buyer' | 'campaign'

export interface Summary {
  revenue: number
  /** Lead cost — what was paid to campaigns and traffic sources. */
  cost: number
  /**
   * Portal expenses charged to the period. They are stored per month, so only months the
   * range covers in full count. Optional: an older API predates it — treat missing as 0.
   */
  portal_expenses?: number
  /** Profit: revenue − cost − portal_expenses. */
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
  /**
   * Portal expenses charged to this bucket. Only month and year buckets can contain a whole
   * month, so shorter buckets carry 0. Optional — an older API predates the field.
   */
  portal_expenses?: number
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
  /**
   * Portal expenses charged to this range. Monthly figures, so only months the range covers
   * in full are counted. Optional: an older API predates the field — treat missing as 0.
   */
  portal_expenses?: number
  /** Revenue − Lead cost − portal expenses. */
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
  /**
   * The day in the attendance sheet's own words — 'present', 'absent', 'half day', 'leave',
   * 'holiday', 'still in'. A status keyed in by hand IS the day: it decides `present` too,
   * so a day the bot never recorded still counts as a half day once one is set.
   */
  status: string
  /** True when that status was set by hand rather than read off the clock times. */
  status_set: boolean
  /** True when any part of this day was keyed in over the bot's record. */
  edited: boolean
  /** False for a day that exists only as a hand-keyed row — the bot has no record of it. */
  bot_seen: boolean
  /** The roster id behind the bot account, when the two are linked. */
  staff_id: number | null
  hours: number | null
  net_hours: number | null
  break_min: number
  break_count: number
  break_detail: string
  over_break_min: number
  /**
   * What the returns show, from the bot's `returned_at`. `break_min` above is the STATED
   * minutes the allowance is judged on; these are measured — minutes actually away, breaks
   * back later than stated + grace (and the minutes past it), breaks never returned from once
   * the end-of-day cutoff passed, and whether one is running now. Roster and days rows only.
   */
  break_actual_min: number
  late_return_count: number
  late_return_min: number
  out_till_eod_count: number
  on_break: boolean
  /**
   * The hours this person is expected to keep, kept on the Staff page as "HH:MM". null
   * when no schedule has been set for them — and then nothing of theirs is marked.
   */
  expected_login: string | null
  expected_logout: string | null
  /**
   * Minutes late in and minutes early out against those, measured on the EFFECTIVE times
   * (so a day corrected on the Staff page is judged by the corrected figures). 0 means on
   * time; null means there was nothing to compare.
   */
  late_min: number | null
  early_min: number | null
}

export interface AttendanceRoster {
  timezone: string
  breakAllowanceMin: number
  date: string
  rows: AttendanceDay[]
}

export interface AttendanceBreakRecord {
  id: string
  taken_at: string
  /** null = the bot never saw an "I'm back" — `still_out` or `out_till_eod` says which. */
  returned_at: string | null
  /** What they said they would take. A claim, not a measurement. */
  duration_min: number
  /** Measured: to the return or, with none, to now but never past `eod_at`. */
  actual_min: number
  /** Minutes past stated + grace; 0 when back in time. */
  late_min: number
  /** Never returned, and the end-of-day cutoff has passed. */
  out_till_eod: boolean
  /** Never returned, and the cutoff hasn't passed yet — a break in progress. */
  still_out: boolean
  eod_at: string
  urgent: boolean
  raw: string | null
}

export interface AttendanceBreaks {
  userId: string
  date: string
  timezone: string
  allowanceMin: number
  graceMin: number
  /** "HH:MM" in the org timezone. */
  eodCutoff: string
  /** Stated minutes — the corrected figure when `overridden`. */
  totalMin: number
  overMin: number
  actualMin: number
  lateMin: number
  /** The day's break total was corrected on Staff Management; `breaks` stay the bot's own. */
  overridden: boolean
  breaks: AttendanceBreakRecord[]
}

/** Someone out on a break right now. */
export interface AttendanceOnBreak {
  user_id: string
  staff_name: string | null
  username: string | null
  work_date: string
  taken_at: string
  duration_min: number
  urgent: boolean
  raw: string | null
  out_for_min: number
  late_min: number
}

export interface AttendanceException {
  user_id: string
  staff_name: string | null
  work_date: string
  login_at?: string
  local_login?: string
  break_min?: number
  over_min?: number
  expected_login?: string
  late_min?: number
  taken_at?: string
  returned_at?: string | null
  duration_min?: number
  actual_min?: number
  urgent?: boolean
  out_till_eod?: boolean
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
  /** Optional: an account may be identified by username alone (see ManagedUser). */
  email: string | null
  name: string | null
  role: Role
  username: string | null
  totp_enabled: boolean
  permissions: string[] | null
}

export interface EnrollInfo {
  otpauth_uri: string
  secret: string
  email: string | null
  /** What the authenticator app shows — the email, or the username when there is no email. */
  label: string
}

export interface EnrollLink {
  token: string
  path: string
  expires_at: string
}

/**
 * An account as the Users page sees it. An account carries an email, a username, or both —
 * never neither, since one of them is what it logs in with. `staff_id` is set when the
 * account was created by picking someone off the Staff roster.
 */
export interface ManagedUser {
  id: number
  email: string | null
  name: string | null
  username: string | null
  staff_id: number | null
  /** Attached access preset, if any — it supplies `permissions` while set. */
  preset_id: number | null
  preset_name: string | null
  role: Role
  is_active: boolean
  totp_enabled: boolean
  /** When the current enrolment link stops working; null once enrolled. */
  enroll_expires_at: string | null
  /** A link has been issued and hasn't expired — false means a pending user needs a new one. */
  enroll_link_active: boolean
  /** EFFECTIVE pages: the preset's list while attached, otherwise the account's own. */
  permissions: string[] | null
  /** The account's own list, kept so detaching from a preset can pre-fill the editor. */
  own_permissions: string[] | null
  last_login_at: string | null
  created_at: string
}

/**
 * A named bundle of page access ("Agent", "Finance", …). Accounts are *attached* to a preset,
 * not stamped from it: adding a page here grants it to every attached user as soon as they
 * reload. Detaching (or deleting the preset) copies the pages onto the account so nobody's
 * access changes at that moment.
 */
export interface AccessPreset {
  id: number
  name: string
  /** Page keys from PAGES in auth/pages.ts. */
  pages: string[]
  created_at: string
  updated_at: string
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
  /** The account an entry is about, by its current name — only for entries about a user. */
  entity_label?: string | null
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

// ─── Staff (the roster the Queues, Review and Staff pages all read) ────────────

/** A department, shared by the Staff page's bands and the Review page's. */
export interface Department {
  id: number
  name: string
  sort_order: number
  /** How many people are in it — what a delete would unfile. */
  staff_count: number
  created_at: string
  updated_at: string
}

/** Where a staff member stands: on the job, gone, or away for a while. */
export type StaffStatus = 'active' | 'inactive' | 'leave'

/** A staff member. The one roster; a person may sit in more than one department. */
export interface StaffMember {
  id: number
  name: string
  departments: { id: number; name: string }[]
  /**
   * The check-in account they clock in with, resolved from their name by the server — it
   * is never picked. null = no account, so their attendance is keyed in by hand.
   */
  attendance_user_id: string | null
  status: StaffStatus
  /**
   * The hours they are expected to keep, "HH:MM", or null for no schedule. Both attendance
   * pages read these to mark a late login or an early logout; with neither set, none of
   * their days is ever flagged.
   */
  expected_login: string | null
  expected_logout: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

/**
 * One attendance day. `source` is the whole story: 'fetched' rows come from the check-in
 * bot and carry no id, which is exactly why they cannot be edited; 'manual' rows are the
 * ones keyed in here for people the bot never saw.
 */
export interface StaffAttendanceRow {
  /**
   * The row this app owns. For a hand-keyed day that is the day itself; for a day the bot
   * recorded it is the record that replaces it, and null until the day is first edited.
   */
  id: number | null
  /** Whether the check-in bot recorded this day at all. */
  source: 'fetched' | 'manual'
  /**
   * True when the values here are this app's rather than the bot's. On a `fetched` row that
   * means the day has been corrected and reverting will put the bot's record back.
   */
  edited: boolean
  staff_id: number
  staff_name: string
  work_date: string
  /** Org-local clock time, "HH:MM", or null when not recorded. */
  login_at: string | null
  logout_at: string | null
  break_min: number
  status: string
  note: string
  // Hours are not carried: the page computes them from the clock times it is showing, so
  // the figure moves while a row is being typed. See netHours() in lib/staff.ts.
}

export interface StaffAttendancePage {
  timezone: string
  from: string
  to: string
  /** False where the check-in bot's tables aren't installed — everything is hand-keyed. */
  fetched: boolean
  rows: StaffAttendanceRow[]
}

/** A row of the Leaves sheet. Every marker is free text ("Approved", a reason). */
export interface StaffLeave {
  id: number
  staff_id: number
  staff_name: string
  department_id: number | null
  department_name: string | null
  leave_date: string
  sick_leave: string
  break_leave: string
  half_day: string
  late_login: string
  aob: string
  /** "YYYY-MM-DD" the person was due back; null for a row with nothing to return from. */
  expected_return: string | null
  /** "YYYY-MM-DD" they actually came back; null until recorded. */
  actual_return: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

/** A row of the Salary sheet — one per person per month. */
export interface StaffSalary {
  id: number
  staff_id: number
  staff_name: string
  department_id: number | null
  department_name: string | null
  /** First of the month being paid, YYYY-MM-DD. */
  month: string
  /** The SALARY cell as the sheet words it — "Received". */
  status: string
  /** Optional figure beside the status; null when only the status is recorded. */
  amount: number | null
  note: string
  sort_order: number
  created_at: string
  updated_at: string
}

/**
 * One row of the Salary Hold log — a running list, NOT scoped to a month like StaffSalary:
 * a hold is a note about a problem that needs to stay visible until it is resolved, so every
 * row carries its own month rather than inheriting a page-wide one.
 */
export interface StaffSalaryHold {
  id: number
  staff_id: number
  staff_name: string
  /** First of the month the hold is about, YYYY-MM-DD. */
  month: string
  /** Free text — why the salary is held, like a Notes cell elsewhere in the app. */
  reason: string
  /** 'On Hold' or 'Disbursed' — nothing else is accepted. */
  status: string
  sort_order: number
  created_at: string
  updated_at: string
}

// ─── Queues (per-person queue records + the queue catalogue) ───────────────────

/** A queue in the Queues catalogue the page ticks. */
export interface QueueCode {
  id: number
  code: string
  /** How many records currently include this queue — what a delete would touch. */
  usage_count: number
  created_at: string
  updated_at: string
}

/** Which of the two Queues sheets a record belongs to. */
export type QueueBoard = 'forwarding' | 'camp_flow'

/** One person's record: the name plus every queue they cover, in the order they hold them. */
export interface QueueAssignment {
  id: number
  board: QueueBoard
  person_id: number
  /** Denormalised from the staff roster for display. */
  name: string
  /** In the row's own order — this is what dragging a chip rewrites. */
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

/**
 * A department as the Review page sees it: the shared `Department` plus the rating and %
 * it scored for ONE month. The name lives in the catalogue, the score lives in the month.
 */
export interface ReviewDepartment {
  id: number
  name: string
  /** Excellent / Good / Average / Below Average / Poor — stored as the shown wording. */
  performance: string
  /** null = not scored this month, so the cell stays blank rather than reading 0. */
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
  /** The roster link; null when the name matches nobody on the Staff page. */
  staff_id: number | null
  person_name: string
  /** The per-row DEPARTMENT cell ("Billing", "Billing/Audits") — free text. */
  department_note: string
  /** Performance rating, or the behaviour analysis. */
  rating: string
  /** Performance rows only. */
  percentage: number | null
  /** Free-text remark on the individual — shown on the Performance tab. */
  notes: string
  /**
   * The month the review is ABOUT — the first of that month, YYYY-MM-DD. A review keyed
   * in during September judges August, so this is never the month it was written in.
   */
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

/**
 * One day of a traffic source's ledger.
 *
 * Converted Lead, Price and Payments are DERIVED from that source's campaign records — they
 * are not stored here and cannot be edited on the Vendors page. Only `amount_paid` is
 * hand-entered, which is why `payment_id` may be null: a day with campaign activity but no
 * payment yet has no vendor_payments row behind it.
 */
export interface VendorPayment {
  vendor: string
  /** Entry date, YYYY-MM-DD — one row per day. */
  entry_date: string
  /** Σ counted from the campaign records for this source on this day. */
  converted_calls: number
  /** Derived rate: payments ÷ converted_calls. Display only. */
  price: number
  /** Σ total_bill from those same records — what the Campaigns side charged. */
  payments: number
  /** USD actually paid — the one hand-entered figure. */
  amount_paid: number
  /** The vendor_payments row holding amount_paid, or null if nothing has been paid yet. */
  payment_id: number | null
}

/**
 * One vendor's ledger for a date range, plus the balance carried INTO that range — which
 * is what keeps the Due/Advance figure accurate when you move to the next viewing period.
 */
export interface VendorLedger {
  rows: VendorPayment[]
  /** The vendor's stored seed (`vendors.opening_advance`), before any ledger row. */
  opening_advance: number
  /** Σ(amount paid) − Σ(campaign charges) over every day before the range. */
  prior_net: number
  /** opening_advance + prior_net — the "Initial Advance" the period opens with. */
  initial_advance: number
}
// ─── Top Performer (the Review page's incentive tab) ───────────────────────────

/**
 * The month's shared state behind the Top Performer tab: which of the optional criteria
 * (8–12) are in play, the performance % that meets Goal Achievement, and the criteria each
 * person has been confirmed for by a manager (staff id → criterion ids). The data-driven
 * criteria are judged from reviews/attendance/leaves and are not stored.
 */
export interface TopPerformerState {
  /** First of the month judged, YYYY-MM-DD. */
  month: string
  settings: { additional: string[]; min_performance: number }
  ticks: Record<string, string[]>
}

// ─── Annual Reviews (the Review page's roll-up tab) ────────────────────────────

/**
 * The stored half of an Annual Reviews sheet — the six- or twelve-month roll-up.
 *
 * The figures themselves are NOT here: the client accumulates them from the monthly review
 * rows, the attendance and leaves sheets and the saved Top Performer ticks, so a period can
 * never disagree with the months it is made of (see lib/annualReview.ts). What the server
 * keeps is only what a manager put on top of that — hence every field below being an edit
 * rather than a number.
 */
export interface AnnualReviewSheet {
  /** 'half' (6 months) or 'year' (12). */
  span: string
  /** First of the LAST month in the window — the month the page's selector is showing. */
  period_end: string
  /** Months in the window: 6 or 12. */
  months: number
  /** Cells typed over a computed one: row key → column id → text. */
  overrides: Record<string, Record<string, string>>
  /** Rows added by hand for somebody the period's reviews produced no row for. */
  extra_rows: { key: string; name: string }[]
  /** `min_months`: months of the window a person must be reviewed in to be named. */
  settings: { min_months?: number }
  /** When the sheet was last saved; null when nothing has been edited yet. */
  updated_at: string | null
  /**
   * The save the Reset button would restore — the most recent one more than 24 hours old.
   * Null means today's edits are all there is, and Reset has nowhere to go.
   */
  reset_to: string | null
  /** Only on a reset's answer: the version it just restored. */
  restored_from?: string
}
