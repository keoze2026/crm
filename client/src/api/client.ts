import type {
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
  createUser: (data: { email: string; name?: string; username?: string; role: Role; permissions?: string[] }) =>
    request<ManagedUser & { enroll: EnrollLink }>('/admin/users', {
      method: 'POST', body: JSON.stringify(data),
    }),
  updateUser: (id: number, data: { name?: string; email?: string; username?: string; role?: Role; permissions?: string[]; is_active?: boolean }) =>
    request<ManagedUser>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  resetUserTotp: (id: number) =>
    request<{ reset: boolean; enroll: EnrollLink }>(`/admin/users/${id}/reset-totp`, { method: 'POST' }),
  deleteUser: (id: number) =>
    request<{ deleted: boolean }>(`/admin/users/${id}`, { method: 'DELETE' }),

  // Portal expenses (monthly provider expenses)
  portalExpenses: (month: string) =>
    request<PortalExpense[]>(`/portal-expenses${qs({ month })}`),
  createPortalExpense: (data: Partial<PortalExpense>) =>
    request<PortalExpense>('/portal-expenses', { method: 'POST', body: JSON.stringify(data) }),
  updatePortalExpense: (id: number, data: Partial<PortalExpense>) =>
    request<PortalExpense>(`/portal-expenses/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePortalExpense: (id: number) =>
    request<{ deleted: boolean }>(`/portal-expenses/${id}`, { method: 'DELETE' }),

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
  createVendorPayment: (data: Partial<VendorPayment>) =>
    request<VendorPayment>('/vendor-payments', { method: 'POST', body: JSON.stringify(data) }),
  updateVendorPayment: (id: number, data: Partial<VendorPayment>) =>
    request<VendorPayment>(`/vendor-payments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
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