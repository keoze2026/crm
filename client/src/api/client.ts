import type {
  Buyer,
  Destination,
  CallRecord,
  Campaign,
  CompleteReport,
  Paginated,
  RecordFilters,
  Summary,
  TopBuyer,
  TopCampaign,
  TopSource,
  TrendPoint,
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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
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
  buyers: (search?: string) => request<Buyer[]>(`/buyers${qs({ search })}`),
  createBuyer: (data: Partial<Buyer>) =>
    request<Buyer>('/buyers', { method: 'POST', body: JSON.stringify(data) }),
  updateBuyer: (id: number, data: Partial<Buyer>) =>
    request<Buyer>(`/buyers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteBuyer: (id: number) =>
    request<{ deleted: boolean }>(`/buyers/${id}`, { method: 'DELETE' }),

  // Campaigns
  campaigns: (search?: string) => request<Campaign[]>(`/campaigns${qs({ search })}`),
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

  // Download URLs (open in a new tab / anchor to trigger browser download)
  recordsExportUrl: (filters: RecordFilters) =>
    `${BASE}/records/export${qs(filters as Record<string, unknown>)}`,
  reportUrl: (range: DateRange) => `${BASE}/analytics/report${qs(range)}`,
}