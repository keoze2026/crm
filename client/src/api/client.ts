import type {
  AccessPreset,
  Buyer,
  Destination,
  CallRecord,
  Campaign,
  CampaignSource,
  CompleteReport,
  Paginated,
  RecordFilters,
  Summary,
  TopBuyer,
  TopCampaign,
  TopSource,
  TrendPoint,
  AttendanceStaff,
  AttendanceRoster,
  AttendanceDay,
  AttendanceBreaks,
  AttendanceExceptions,
  AuthUser,
  EnrollInfo,
  EnrollLink,
  ManagedUser,
  AuditPage,
  AuditFilters,
  PortalExpense,
  CatalogueResult,
  StaffStatus,
  Department,
  StaffMember,
  StaffAttendancePage,
  StaffAttendanceRow,
  StaffLeave,
  StaffSalary,
  QueueAssignment,
  QueueBoard,
  QueueCode,
  ReviewDepartment,
  ReviewEntry,
  ReviewKind,
  Vendor,
  VendorLedger,
  VendorPayment,
  Role,
} from '../types'

const BASE = '/api'

function qs(params: object): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.append(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

// When a request unexpectedly returns 401 (session expired mid-use), the AuthProvider
// registers a handler here to clear its state so the route guards redirect to /login.
// Auth-flow endpoints opt out via the `silent401` flag so they can surface 401s themselves.
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

async function request<T>(path: string, options?: RequestInit & { silent401?: boolean }): Promise<T> {
  const { silent401, ...init } = options ?? {}
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include', // send the httpOnly session cookie
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    if (res.status === 401 && !silent401) onUnauthorized?.()
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export interface DateRange {
  from?: string
  to?: string
}

export const api = {
  // Analytics
  summary: (range: DateRange) =>
    request<Summary>(`/analytics/summary${qs(range)}`),
  trends: (range: DateRange & { granularity: 'day' | '4day' | 'week' | 'month' | 'year' }) =>
    request<TrendPoint[]>(`/analytics/trends${qs(range)}`),
  topBuyers: (params: DateRange & { limit?: number; metric?: string }) =>
    request<TopBuyer[]>(`/analytics/top-buyers${qs(params)}`),
  topCampaigns: (params: DateRange & { limit?: number }) =>
    request<TopCampaign[]>(`/analytics/top-campaigns${qs(params)}`),
  topSources: (params: DateRange & { limit?: number }) =>
    request<TopSource[]>(`/analytics/top-sources${qs(params)}`),
  completeReport: (range?: DateRange) =>
    request<CompleteReport>(`/analytics/complete-report${qs(range ?? {})}`),

  // Buyers
  buyers: (search?: string, range?: DateRange) =>
    request<Buyer[]>(`/buyers${qs({ search, ...range })}`),
  createBuyer: (data: Partial<Buyer>) =>
    request<Buyer>('/buyers', { method: 'POST', body: JSON.stringify(data) }),
  updateBuyer: (id: number, data: Partial<Buyer>) =>
    request<Buyer>(`/buyers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteBuyer: (id: number) =>
    request<{ deleted: boolean }>(`/buyers/${id}`, { method: 'DELETE' }),

  // Campaigns
  campaigns: (search?: string, range?: DateRange) =>
    request<Campaign[]>(`/campaigns${qs({ search, ...range })}`),
  campaignSources: (id: number) =>
    request<CampaignSource[]>(`/campaigns/${id}/sources`),
  createCampaign: (data: Partial<Campaign>) =>
    request<Campaign>('/campaigns', { method: 'POST', body: JSON.stringify(data) }),
  updateCampaign: (id: number, data: Partial<Campaign>) =>
    request<Campaign>(`/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCampaign: (id: number) =>
    request<{ deleted: boolean }>(`/campaigns/${id}`, { method: 'DELETE' }),

  // Destinations
  destinations: (search?: string) => request<Destination[]>(`/destinations${qs({ search })}`),
  createDestination: (data: Partial<Destination>) =>
    request<Destination>('/destinations', { method: 'POST', body: JSON.stringify(data) }),
  updateDestination: (id: number, data: Partial<Destination>) =>
    request<Destination>(`/destinations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDestination: (id: number) =>
    request<{ deleted: boolean }>(`/destinations/${id}`, { method: 'DELETE' }),

  // Records
  records: (filters: RecordFilters) =>
    request<Paginated<CallRecord>>(`/records${qs(filters as Record<string, unknown>)}`),
  createRecord: (data: Record<string, unknown>) =>
    request<CallRecord>('/records', { method: 'POST', body: JSON.stringify(data) }),
  updateRecord: (id: number, data: Record<string, unknown>) =>
    request<CallRecord>(`/records/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRecord: (id: number) =>
    request<{ deleted: boolean }>(`/records/${id}`, { method: 'DELETE' }),

  // Download URLs
  recordsExportUrl: (filters: RecordFilters) =>
    `${BASE}/records/export${qs(filters as Record<string, unknown>)}`,
  reportUrl: (range: DateRange) => `${BASE}/analytics/report${qs(range)}`,

  // Attendance
  attendanceStaff: () =>
    request<AttendanceStaff[]>('/attendance/staff'),
  attendanceRoster: (date?: string) =>
    request<AttendanceRoster>(`/attendance/roster${qs({ date })}`),
  attendanceLive: () =>
    request<AttendanceDay[]>('/attendance/live'),
  attendanceDays: (params: { from?: string; to?: string; user_id?: string }) =>
    request<{ timezone: string; breakAllowanceMin: number; rows: AttendanceDay[] }>(`/attendance/days${qs(params)}`),
  attendanceSummary: (params: { from?: string; to?: string }) =>
    request<{ user_id: string; staff_name: string | null; days_present: number; days_complete: number; total_hours: number; first_day: string; last_day: string }[]>(`/attendance/summary${qs(params)}`),
  attendanceBreaks: (userId: string, date: string) =>
    request<AttendanceBreaks>(`/attendance/breaks${qs({ user_id: userId, date })}`),
  attendanceExceptions: (type: 'missing_logout' | 'over_break' | 'late', from?: string, to?: string) =>
    request<AttendanceExceptions>(`/attendance/exceptions${qs({ type, from, to })}`),

  // Auth
  authStatus: () =>
    request<{ auth_enabled: boolean }>('/auth/status', { silent401: true }),
  me: () =>
    request<{ user: AuthUser }>('/auth/me', { silent401: true }),
  login: (identifier: string) =>
    request<{ mfa_required: boolean }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ identifier }), silent401: true,
    }),
  verifyTotp: (code: string) =>
    request<{ user: AuthUser }>('/auth/verify-totp', {
      method: 'POST', body: JSON.stringify({ code }), silent401: true,
    }),
  enrollStart: (token: string) =>
    request<EnrollInfo>('/auth/enroll/start', {
      method: 'POST', body: JSON.stringify({ token }), silent401: true,
    }),
  enrollConfirm: (token: string, code: string) =>
    request<{ user: AuthUser }>('/auth/enroll/confirm', {
      method: 'POST', body: JSON.stringify({ token, code }), silent401: true,
    }),
  logout: () =>
    request<void>('/auth/logout', { method: 'POST', silent401: true }),

  // Audit (admin)
  auditLogs: (filters: AuditFilters) =>
    request<AuditPage>(`/audit-logs${qs(filters as Record<string, unknown>)}`),
  auditActions: () =>
    request<string[]>('/audit-logs/actions'),
  auditExportUrl: (filters: AuditFilters) =>
    `${BASE}/audit-logs/export${qs(filters as Record<string, unknown>)}`,
  deleteAuditLog: (id: number) =>
    request<{ deleted: boolean }>(`/audit-logs/${id}`, { method: 'DELETE' }),
  clearAuditLogs: (filters: AuditFilters) =>
    request<{ deleted: number }>(`/audit-logs${qs(filters as Record<string, unknown>)}`, { method: 'DELETE' }),

  // Users (admin)
  users: () =>
    request<ManagedUser[]>('/admin/users'),
  // An account needs at least one of `email` / `username`. Passing `staff_id` picks someone
  // off the Staff roster: their name comes across and a username is derived from it unless
  // one is given. Either way the response carries the one-time enrolment link.
  // `preset_id` attaches the account to a named access preset, which then supplies its pages
  // live. An explicit `permissions` list instead gives the account its own; admins ignore both.
  createUser: (data: {
    email?: string
    name?: string
    username?: string
    staff_id?: number
    preset_id?: number
    role: Role
    permissions?: string[]
  }) =>
    request<ManagedUser & { enroll: EnrollLink }>('/admin/users', {
      method: 'POST', body: JSON.stringify(data),
    }),
  // `email: ''` clears the address (allowed as long as a username remains). `preset_id`
  // attaches to a preset, `preset_id: null` detaches; sending `permissions` also detaches.
  updateUser: (id: number, data: { name?: string; email?: string; username?: string; role?: Role; permissions?: string[]; preset_id?: number | null; is_active?: boolean }) =>
    request<ManagedUser>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  resetUserTotp: (id: number) =>
    request<{ reset: boolean; enroll: EnrollLink }>(`/admin/users/${id}/reset-totp`, { method: 'POST' }),
  deleteUser: (id: number) =>
    request<{ deleted: boolean }>(`/admin/users/${id}`, { method: 'DELETE' }),

  // Access presets (admin) — named page bundles the Add-user form applies.
  accessPresets: () =>
    request<AccessPreset[]>('/admin/access-presets'),
  createAccessPreset: (data: { name: string; pages: string[] }) =>
    request<AccessPreset>('/admin/access-presets', { method: 'POST', body: JSON.stringify(data) }),
  updateAccessPreset: (id: number, data: { name?: string; pages?: string[] }) =>
    request<AccessPreset>(`/admin/access-presets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAccessPreset: (id: number) =>
    request<{ deleted: boolean }>(`/admin/access-presets/${id}`, { method: 'DELETE' }),

  // Portal expenses (monthly provider expenses)
  portalExpenses: (month: string) =>
    request<PortalExpense[]>(`/portal-expenses${qs({ month })}`),
  createPortalExpense: (data: Partial<PortalExpense>) =>
    request<PortalExpense>('/portal-expenses', { method: 'POST', body: JSON.stringify(data) }),
  updatePortalExpense: (id: number, data: Partial<PortalExpense>) =>
    request<PortalExpense>(`/portal-expenses/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePortalExpense: (id: number) =>
    request<{ deleted: boolean }>(`/portal-expenses/${id}`, { method: 'DELETE' }),

  // Staff — the one roster the Queues, Review and Staff pages all pick names from.
  staff: () =>
    request<StaffMember[]>('/staff'),
  // Create takes a list, so a roster can be seeded from a pasted "Anna, Ben, Camp Team" in
  // one call; `departmentIds` files everyone it touches under those departments.
  createStaff: (names: string[], departmentIds?: number[]) =>
    request<CatalogueResult<StaffMember>>('/staff', {
      method: 'POST', body: JSON.stringify({ names, department_ids: departmentIds ?? [] }),
    }),
  // `department_ids` is the complete set the person should end up in, not an addition.
  // The expected hours are "HH:MM"; send null to clear a schedule, omit to leave it alone.
  updateStaff: (id: number, data: {
    name?: string
    department_ids?: number[]
    status?: StaffStatus
    expected_login?: string | null
    expected_logout?: string | null
    sort_order?: number
  }) =>
    request<StaffMember>(`/staff/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  // Cascades: their Queues record, departments, attendance, leaves and salary rows go too.
  // Reviews keep the name they were written with.
  deleteStaff: (id: number) =>
    request<{ deleted: boolean }>(`/staff/${id}`, { method: 'DELETE' }),

  // Departments — the catalogue shared by the Staff bands and the Review bands.
  departments: () =>
    request<Department[]>('/departments'),
  createDepartment: (name: string) =>
    request<Department>('/departments', { method: 'POST', body: JSON.stringify({ name }) }),
  renameDepartment: (id: number, name: string) =>
    request<Department>(`/departments/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteDepartment: (id: number) =>
    request<{ deleted: boolean }>(`/departments/${id}`, { method: 'DELETE' }),

  // Staff attendance — fetched and hand-keyed days merged. Only rows with an id (the
  // hand-keyed ones) can be written; a fetched day has none and is read-only by design.
  staffAttendance: (params: { from: string; to: string; staff_id?: number }) =>
    request<StaffAttendancePage>(`/staff-attendance${qs(params)}`),
  createStaffAttendance: (data: {
    staff_id: number
    work_date: string
    login_at?: string | null
    logout_at?: string | null
    break_min?: number
    status?: string
    note?: string
  }) =>
    request<StaffAttendanceRow>('/staff-attendance', { method: 'POST', body: JSON.stringify(data) }),
  updateStaffAttendance: (id: number, data: Partial<{
    login_at: string | null
    logout_at: string | null
    break_min: number
    status: string
    note: string
  }>) =>
    request<StaffAttendanceRow>(`/staff-attendance/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteStaffAttendance: (id: number) =>
    request<{ deleted: boolean }>(`/staff-attendance/${id}`, { method: 'DELETE' }),

  // Leaves sheet.
  staffLeaves: (range: { from: string; to: string }) =>
    request<StaffLeave[]>(`/staff-leaves${qs(range)}`),
  createStaffLeave: (data: Partial<StaffLeave>) =>
    request<StaffLeave>('/staff-leaves', { method: 'POST', body: JSON.stringify(data) }),
  updateStaffLeave: (id: number, data: Partial<StaffLeave>) =>
    request<StaffLeave>(`/staff-leaves/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteStaffLeave: (id: number) =>
    request<{ deleted: boolean }>(`/staff-leaves/${id}`, { method: 'DELETE' }),

  // Salary sheet — one row per person per month, so creating twice updates.
  staffSalaries: (month: string) =>
    request<StaffSalary[]>(`/staff-salaries${qs({ month })}`),
  createStaffSalary: (data: Partial<StaffSalary> & { month: string }) =>
    request<StaffSalary>('/staff-salaries', { method: 'POST', body: JSON.stringify(data) }),
  updateStaffSalary: (id: number, data: Partial<StaffSalary>) =>
    request<StaffSalary>(`/staff-salaries/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteStaffSalary: (id: number) =>
    request<{ deleted: boolean }>(`/staff-salaries/${id}`, { method: 'DELETE' }),

  // Queues — the per-person records. `day` (YYYY-MM-DD) narrows to the records keyed in
  // on one day; omit it for the whole sheet.
  queues: (board: QueueBoard, day?: string) =>
    request<QueueAssignment[]>(`/queues${qs({ board, day })}`),
  // Creating for a person who already has a record ON THIS BOARD updates that record
  // instead, so a sheet can never hold two rows for one name. The same person may still
  // hold a row on the other sheet.
  createQueueAssignment: (data: { board: QueueBoard; person_id: number; code_ids: number[] }) =>
    request<QueueAssignment>('/queues', { method: 'POST', body: JSON.stringify(data) }),
  // `code_ids` is ORDER-SENSITIVE — it is the order the chips end up in, so dragging one
  // and ticking one are the same call.
  updateQueueAssignment: (id: number, data: { person_id?: number; code_ids?: number[] }) =>
    request<QueueAssignment>(`/queues/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteQueueAssignment: (id: number) =>
    request<{ deleted: boolean }>(`/queues/${id}`, { method: 'DELETE' }),

  // Queues — the Queues catalogue, same list-on-create ("BHS, BOP, Q04").
  queueCodes: () =>
    request<QueueCode[]>('/queue-codes'),
  createQueueCodes: (codes: string[]) =>
    request<CatalogueResult<QueueCode>>('/queue-codes', { method: 'POST', body: JSON.stringify({ codes }) }),
  updateQueueCode: (id: number, code: string) =>
    request<QueueCode>(`/queue-codes/${id}`, { method: 'PUT', body: JSON.stringify({ code }) }),
  // Cascades: deleting a queue removes it from every record that included it.
  deleteQueueCode: (id: number) =>
    request<{ deleted: boolean }>(`/queue-codes/${id}`, { method: 'DELETE' }),

  // Reviews — the department scorecard for ONE month. `month` is the month being
  // reviewed (a September review judges August), and it is required on every call.
  reviewDepartments: (month: string) =>
    request<ReviewDepartment[]>(`/review-departments${qs({ month })}`),
  createReviewDepartment: (data: Partial<ReviewDepartment> & { month: string }) =>
    request<ReviewDepartment>('/review-departments', { method: 'POST', body: JSON.stringify(data) }),
  updateReviewDepartment: (id: number, data: Partial<ReviewDepartment> & { month: string }) =>
    request<ReviewDepartment>(`/review-departments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  // Entries keep their rows and resurface under "No department".
  deleteReviewDepartment: (id: number) =>
    request<{ deleted: boolean }>(`/review-departments/${id}`, { method: 'DELETE' }),

  // Reviews — the Performance / Behaviour rows, both scoped to the month reviewed.
  reviewEntries: (kind: ReviewKind, month: string) =>
    request<ReviewEntry[]>(`/review-entries${qs({ kind, month })}`),
  createReviewEntry: (data: Partial<ReviewEntry> & { month: string }) =>
    request<ReviewEntry>('/review-entries', { method: 'POST', body: JSON.stringify(data) }),
  updateReviewEntry: (id: number, data: Partial<ReviewEntry>) =>
    request<ReviewEntry>(`/review-entries/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteReviewEntry: (id: number) =>
    request<{ deleted: boolean }>(`/review-entries/${id}`, { method: 'DELETE' }),

  // Vendors (traffic-source payment sheets)
  vendors: () =>
    request<Vendor[]>('/vendors'),
  createVendor: (name: string) =>
    request<Vendor>('/vendors', { method: 'POST', body: JSON.stringify({ name }) }),
  // Upsert the vendor's opening advance by name (works for discovered vendors too).
  saveVendorMeta: (data: { name: string; opening_advance?: number }) =>
    request<Vendor>('/vendors', { method: 'PUT', body: JSON.stringify(data) }),
  deleteVendor: (id: number) =>
    request<{ deleted: boolean }>(`/vendors/${id}`, { method: 'DELETE' }),

  // The ledger endpoint returns an envelope (rows + the balance carried into the range).
  // An older deployed API answers with a bare array — treat that as a zero carry-forward
  // rather than crashing the page.
  vendorPayments: async (vendor: string, range: DateRange): Promise<VendorLedger> => {
    const res = await request<VendorLedger | VendorPayment[]>(`/vendor-payments${qs({ vendor, ...range })}`)
    return Array.isArray(res)
      ? { rows: res, opening_advance: 0, prior_net: 0, initial_advance: 0 }
      : res
  },
  // Only the amount is writable — Converted Lead and Price come from the campaign records.
  // Posting twice for the same vendor and day SETS the amount rather than adding a row.
  createVendorPayment: (data: { vendor: string; entry_date: string; amount_paid: number }) =>
    request<{ id: number; vendor: string; entry_date: string; amount_paid: number }>(
      '/vendor-payments', { method: 'POST', body: JSON.stringify(data) },
    ),
  updateVendorPayment: (id: number, data: { entry_date?: string; amount_paid?: number }) =>
    request<{ id: number; vendor: string; entry_date: string; amount_paid: number }>(
      `/vendor-payments/${id}`, { method: 'PUT', body: JSON.stringify(data) },
    ),
  deleteVendorPayment: (id: number) =>
    request<{ deleted: boolean }>(`/vendor-payments/${id}`, { method: 'DELETE' }),
}

// Format a UTC timestamp to org timezone display
export function fmtAttendanceTime(isoStr: string | null): string {
  if (!isoStr) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(isoStr))
}