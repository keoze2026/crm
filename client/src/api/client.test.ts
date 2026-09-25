import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { api, fmtAttendanceTime, setUnauthorizedHandler } from './client'

type FetchMock = Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>

let fetchMock: FetchMock

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => json({}))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  setUnauthorizedHandler(null)
})

/** The URL and init of the nth fetch call. */
function call(n = 0): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[n]
  return { url: String(url), init: init ?? {} }
}

const bodyOf = (n = 0): unknown => JSON.parse(String(call(n).init.body))

describe('request plumbing', () => {
  it('prefixes /api, sends the session cookie and a JSON content type', async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: 1 }]))
    await expect(api.staff()).resolves.toEqual([{ id: 1 }])
    const { url, init } = call()
    expect(url).toBe('/api/staff')
    expect(init.credentials).toBe('include')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init.method).toBeUndefined()
  })

  it('never forwards the silent401 flag to fetch', async () => {
    await api.authStatus()
    expect(call().init).not.toHaveProperty('silent401')
  })

  it('resolves undefined for a 204', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(api.logout()).resolves.toBeUndefined()
  })

  it('throws the server error message from a JSON error body', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'Name is required' }, 422))
    await expect(api.createDepartment('')).rejects.toThrow('Name is required')
  })

  it('falls back to the status when the error body has no message or is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(json({ message: 'nope' }, 500))
    await expect(api.staff()).rejects.toThrow('Request failed (500)')
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }))
    await expect(api.staff()).rejects.toThrow('Request failed (502)')
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(api.staff()).rejects.toThrow('Request failed (404)')
  })

  it('propagates a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(api.staff()).rejects.toThrow('Failed to fetch')
  })

  it('rejects when a 2xx body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 200 }))
    await expect(api.staff()).rejects.toThrow()
  })
})

describe('401 handling', () => {
  it('calls the registered handler on an unexpected 401 and still throws', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    fetchMock.mockResolvedValueOnce(json({ error: 'Not signed in' }, 401))
    await expect(api.staff()).rejects.toThrow('Not signed in')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not call the handler for other failures', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    fetchMock.mockResolvedValueOnce(json({}, 403))
    await expect(api.staff()).rejects.toThrow('Request failed (403)')
    expect(handler).not.toHaveBeenCalled()
  })

  it.each([
    ['authStatus', () => api.authStatus()],
    ['me', () => api.me()],
    ['login', () => api.login('anna')],
    ['verifyTotp', () => api.verifyTotp('123456')],
    ['enrollStart', () => api.enrollStart('tok')],
    ['enrollConfirm', () => api.enrollConfirm('tok', '123456')],
    ['logout', () => api.logout()],
  ])('keeps %s silent on a 401 so the auth flow can surface it', async (_name, run) => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    fetchMock.mockResolvedValueOnce(json({ error: 'Invalid code' }, 401))
    await expect(run()).rejects.toThrow('Invalid code')
    expect(handler).not.toHaveBeenCalled()
  })

  it('tolerates a 401 with no handler registered, and stops calling a cleared one', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 401))
    await expect(api.staff()).rejects.toThrow('Request failed (401)')

    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    setUnauthorizedHandler(null)
    fetchMock.mockResolvedValueOnce(json({}, 401))
    await expect(api.staff()).rejects.toThrow()
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('query strings', () => {
  it('drops undefined, null and empty values', async () => {
    await api.buyers('', { from: '2026-06-01', to: undefined })
    expect(call().url).toBe('/api/buyers?from=2026-06-01')
  })

  it('omits the question mark when nothing is left', async () => {
    await api.summary({})
    expect(call().url).toBe('/api/analytics/summary')
    await api.completeReport()
    expect(call(1).url).toBe('/api/analytics/complete-report')
  })

  it('encodes values and keeps zero', async () => {
    await api.topBuyers({ from: '2026-06-01', limit: 0, metric: 'a b&c' })
    expect(call().url).toBe('/api/analytics/top-buyers?from=2026-06-01&limit=0&metric=a+b%26c')
  })

  it('passes every analytics parameter through', async () => {
    await api.trends({ from: '2026-01-01', to: '2026-01-31', granularity: 'week' })
    await api.topCampaigns({ limit: 5 })
    await api.topSources({ to: '2026-01-31' })
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toEqual([
      '/api/analytics/trends?from=2026-01-01&to=2026-01-31&granularity=week',
      '/api/analytics/top-campaigns?limit=5',
      '/api/analytics/top-sources?to=2026-01-31',
    ])
  })

  it('serialises record and audit filters', async () => {
    await api.records({ page: 2, search: 'x' } as Parameters<typeof api.records>[0])
    await api.auditLogs({ action: 'login', page: 1 } as Parameters<typeof api.auditLogs>[0])
    expect(call(0).url).toBe('/api/records?page=2&search=x')
    expect(call(1).url).toBe('/api/audit-logs?action=login&page=1')
  })
})

describe('download URLs', () => {
  it('builds export and report links without fetching', () => {
    expect(api.recordsExportUrl({ search: 'abc' } as Parameters<typeof api.recordsExportUrl>[0])).toBe('/api/records/export?search=abc')
    expect(api.reportUrl({ from: '2026-06-01', to: '2026-06-30' })).toBe('/api/analytics/report?from=2026-06-01&to=2026-06-30')
    expect(api.auditExportUrl({} as Parameters<typeof api.auditExportUrl>[0])).toBe('/api/audit-logs/export')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('CRUD endpoints', () => {
  it.each([
    ['createBuyer', () => api.createBuyer({ name: 'B' }), 'POST', '/api/buyers', { name: 'B' }],
    ['updateBuyer', () => api.updateBuyer(3, { name: 'B' }), 'PUT', '/api/buyers/3', { name: 'B' }],
    ['deleteBuyer', () => api.deleteBuyer(3), 'DELETE', '/api/buyers/3', undefined],
    ['createCampaign', () => api.createCampaign({ name: 'C' }), 'POST', '/api/campaigns', { name: 'C' }],
    ['updateCampaign', () => api.updateCampaign(4, { name: 'C' }), 'PUT', '/api/campaigns/4', { name: 'C' }],
    ['deleteCampaign', () => api.deleteCampaign(4), 'DELETE', '/api/campaigns/4', undefined],
    ['createDestination', () => api.createDestination({ name: 'D' }), 'POST', '/api/destinations', { name: 'D' }],
    ['updateDestination', () => api.updateDestination(5, { name: 'D' }), 'PUT', '/api/destinations/5', { name: 'D' }],
    ['deleteDestination', () => api.deleteDestination(5), 'DELETE', '/api/destinations/5', undefined],
    ['createRecord', () => api.createRecord({ a: 1 }), 'POST', '/api/records', { a: 1 }],
    ['updateRecord', () => api.updateRecord(6, { a: 1 }), 'PUT', '/api/records/6', { a: 1 }],
    ['deleteRecord', () => api.deleteRecord(6), 'DELETE', '/api/records/6', undefined],
    ['login', () => api.login('anna'), 'POST', '/api/auth/login', { identifier: 'anna' }],
    ['verifyTotp', () => api.verifyTotp('123456'), 'POST', '/api/auth/verify-totp', { code: '123456' }],
    ['enrollStart', () => api.enrollStart('tok'), 'POST', '/api/auth/enroll/start', { token: 'tok' }],
    ['enrollConfirm', () => api.enrollConfirm('tok', '1'), 'POST', '/api/auth/enroll/confirm', { token: 'tok', code: '1' }],
    ['logout', () => api.logout(), 'POST', '/api/auth/logout', undefined],
    ['deleteAuditLog', () => api.deleteAuditLog(9), 'DELETE', '/api/audit-logs/9', undefined],
    ['createUser', () => api.createUser({ email: 'a@b.c', role: 'admin' }), 'POST', '/api/admin/users', { email: 'a@b.c', role: 'admin' }],
    ['updateUser', () => api.updateUser(2, { preset_id: null }), 'PATCH', '/api/admin/users/2', { preset_id: null }],
    ['resetUserTotp', () => api.resetUserTotp(2), 'POST', '/api/admin/users/2/reset-totp', undefined],
    ['refreshEnrollLink', () => api.refreshEnrollLink(2), 'POST', '/api/admin/users/2/enroll-link', undefined],
    ['refreshPendingEnrollLinks', () => api.refreshPendingEnrollLinks(), 'POST', '/api/admin/users/enroll-links', undefined],
    ['deleteUser', () => api.deleteUser(2), 'DELETE', '/api/admin/users/2', undefined],
    ['createAccessPreset', () => api.createAccessPreset({ name: 'P', pages: ['a'] }), 'POST', '/api/admin/access-presets', { name: 'P', pages: ['a'] }],
    ['updateAccessPreset', () => api.updateAccessPreset(1, { pages: [] }), 'PUT', '/api/admin/access-presets/1', { pages: [] }],
    ['deleteAccessPreset', () => api.deleteAccessPreset(1), 'DELETE', '/api/admin/access-presets/1', undefined],
    ['createPortalExpense', () => api.createPortalExpense({ id: 1 }), 'POST', '/api/portal-expenses', { id: 1 }],
    ['updatePortalExpense', () => api.updatePortalExpense(1, { id: 1 }), 'PUT', '/api/portal-expenses/1', { id: 1 }],
    ['deletePortalExpense', () => api.deletePortalExpense(1), 'DELETE', '/api/portal-expenses/1', undefined],
    ['createStaff', () => api.createStaff(['Anna', 'Ben'], [2]), 'POST', '/api/staff', { names: ['Anna', 'Ben'], department_ids: [2] }],
    ['createStaff (no departments)', () => api.createStaff(['Anna']), 'POST', '/api/staff', { names: ['Anna'], department_ids: [] }],
    ['updateStaff', () => api.updateStaff(1, { expected_login: null }), 'PUT', '/api/staff/1', { expected_login: null }],
    ['deleteStaff', () => api.deleteStaff(1), 'DELETE', '/api/staff/1', undefined],
    ['createDepartment', () => api.createDepartment('Billing'), 'POST', '/api/departments', { name: 'Billing' }],
    ['renameDepartment', () => api.renameDepartment(1, 'Sales'), 'PUT', '/api/departments/1', { name: 'Sales' }],
    ['deleteDepartment', () => api.deleteDepartment(1), 'DELETE', '/api/departments/1', undefined],
    ['createStaffAttendance', () => api.createStaffAttendance({ staff_id: 1, work_date: '2026-09-01' }), 'POST', '/api/staff-attendance', { staff_id: 1, work_date: '2026-09-01' }],
    ['updateStaffAttendance', () => api.updateStaffAttendance(1, { break_min: 30 }), 'PUT', '/api/staff-attendance/1', { break_min: 30 }],
    ['deleteStaffAttendance', () => api.deleteStaffAttendance(1), 'DELETE', '/api/staff-attendance/1', undefined],
    ['createStaffLeave', () => api.createStaffLeave({ staff_id: 1 }), 'POST', '/api/staff-leaves', { staff_id: 1 }],
    ['updateStaffLeave', () => api.updateStaffLeave(1, { aob: 'x' }), 'PUT', '/api/staff-leaves/1', { aob: 'x' }],
    ['deleteStaffLeave', () => api.deleteStaffLeave(1), 'DELETE', '/api/staff-leaves/1', undefined],
    ['createStaffSalary', () => api.createStaffSalary({ month: '2026-09' }), 'POST', '/api/staff-salaries', { month: '2026-09' }],
    ['updateStaffSalary', () => api.updateStaffSalary(1, { status: 'Received' }), 'PUT', '/api/staff-salaries/1', { status: 'Received' }],
    ['deleteStaffSalary', () => api.deleteStaffSalary(1), 'DELETE', '/api/staff-salaries/1', undefined],
    ['createStaffSalaryHold', () => api.createStaffSalaryHold({ staff_id: 1, month: '2026-09' }), 'POST', '/api/staff-salary-holds', { staff_id: 1, month: '2026-09' }],
    ['updateStaffSalaryHold', () => api.updateStaffSalaryHold(1, { status: 'Disbursed' }), 'PUT', '/api/staff-salary-holds/1', { status: 'Disbursed' }],
    ['deleteStaffSalaryHold', () => api.deleteStaffSalaryHold(1), 'DELETE', '/api/staff-salary-holds/1', undefined],
    ['createQueueAssignment', () => api.createQueueAssignment({ board: 'forwarding', person_id: 1, code_ids: [3, 1] }), 'POST', '/api/queues', { board: 'forwarding', person_id: 1, code_ids: [3, 1] }],
    ['updateQueueAssignment', () => api.updateQueueAssignment(1, { code_ids: [2, 1] }), 'PUT', '/api/queues/1', { code_ids: [2, 1] }],
    ['deleteQueueAssignment', () => api.deleteQueueAssignment(1), 'DELETE', '/api/queues/1', undefined],
    ['createQueueCodes', () => api.createQueueCodes(['BHS', 'BOP']), 'POST', '/api/queue-codes', { codes: ['BHS', 'BOP'] }],
    ['updateQueueCode', () => api.updateQueueCode(1, 'Q04'), 'PUT', '/api/queue-codes/1', { code: 'Q04' }],
    ['deleteQueueCode', () => api.deleteQueueCode(1), 'DELETE', '/api/queue-codes/1', undefined],
    ['createReviewDepartment', () => api.createReviewDepartment({ name: 'B', month: '2026-08' }), 'POST', '/api/review-departments', { name: 'B', month: '2026-08' }],
    ['updateReviewDepartment', () => api.updateReviewDepartment(1, { percentage: 80, month: '2026-08' }), 'PUT', '/api/review-departments/1', { percentage: 80, month: '2026-08' }],
    ['deleteReviewDepartment', () => api.deleteReviewDepartment(1), 'DELETE', '/api/review-departments/1', undefined],
    ['createReviewEntry', () => api.createReviewEntry({ person_name: 'A', month: '2026-08' }), 'POST', '/api/review-entries', { person_name: 'A', month: '2026-08' }],
    ['updateReviewEntry', () => api.updateReviewEntry(1, { rating: 'Good' }), 'PUT', '/api/review-entries/1', { rating: 'Good' }],
    ['deleteReviewEntry', () => api.deleteReviewEntry(1), 'DELETE', '/api/review-entries/1', undefined],
    ['saveTopPerformer', () => api.saveTopPerformer('2026-08', { settings: { additional: [], min_performance: 80 }, ticks: {} }), 'PUT', '/api/top-performer?month=2026-08', { settings: { additional: [], min_performance: 80 }, ticks: {} }],
    ['saveAnnualReview', () => api.saveAnnualReview('half', '2026-08', { overrides: {}, extra_rows: [], settings: { min_months: 3 } } as unknown as Parameters<typeof api.saveAnnualReview>[2]), 'PUT', '/api/annual-reviews?span=half&month=2026-08', { overrides: {}, extra_rows: [], settings: { min_months: 3 } }],
    ['resetAnnualReview', () => api.resetAnnualReview('year', '2026-08'), 'POST', '/api/annual-reviews/reset?span=year&month=2026-08', undefined],
    ['createVendor', () => api.createVendor('V'), 'POST', '/api/vendors', { name: 'V' }],
    ['saveVendorMeta', () => api.saveVendorMeta({ name: 'V', opening_advance: 100 }), 'PUT', '/api/vendors', { name: 'V', opening_advance: 100 }],
    ['deleteVendor', () => api.deleteVendor(1), 'DELETE', '/api/vendors/1', undefined],
    ['createVendorPayment', () => api.createVendorPayment({ vendor: 'V', entry_date: '2026-09-01', amount_paid: 5 }), 'POST', '/api/vendor-payments', { vendor: 'V', entry_date: '2026-09-01', amount_paid: 5 }],
    ['updateVendorPayment', () => api.updateVendorPayment(1, { amount_paid: 6 }), 'PUT', '/api/vendor-payments/1', { amount_paid: 6 }],
    ['deleteVendorPayment', () => api.deleteVendorPayment(1), 'DELETE', '/api/vendor-payments/1', undefined],
  ] as [string, () => Promise<unknown>, string, string, unknown][])('%s sends %s %s', async (_name, run, method, url, body) => {
    await run()
    const c = call()
    expect(c.init.method).toBe(method)
    expect(c.url).toBe(url)
    if (body === undefined) expect(c.init.body).toBeUndefined()
    else expect(bodyOf()).toEqual(body)
    expect(c.init.credentials).toBe('include')
  })

  it('clears audit logs with a filtered DELETE', async () => {
    await api.clearAuditLogs({ action: 'login' } as Parameters<typeof api.clearAuditLogs>[0])
    expect(call().url).toBe('/api/audit-logs?action=login')
    expect(call().init.method).toBe('DELETE')
  })
})

describe('GET endpoints', () => {
  it.each([
    ['buyers', () => api.buyers('acme', { from: '2026-01-01' }), '/api/buyers?search=acme&from=2026-01-01'],
    ['campaigns', () => api.campaigns(undefined, { to: '2026-01-31' }), '/api/campaigns?to=2026-01-31'],
    ['campaignSources', () => api.campaignSources(7), '/api/campaigns/7/sources'],
    ['destinations', () => api.destinations('x'), '/api/destinations?search=x'],
    ['destinations (all)', () => api.destinations(), '/api/destinations'],
    ['attendanceStaff', () => api.attendanceStaff(), '/api/attendance/staff'],
    ['attendanceRoster', () => api.attendanceRoster('2026-09-01'), '/api/attendance/roster?date=2026-09-01'],
    ['attendanceRoster (today)', () => api.attendanceRoster(), '/api/attendance/roster'],
    ['attendanceLive', () => api.attendanceLive(), '/api/attendance/live'],
    ['attendanceOnBreak', () => api.attendanceOnBreak(), '/api/attendance/on-break'],
    ['attendanceDays', () => api.attendanceDays({ from: '2026-09-01', user_id: 'u1' }), '/api/attendance/days?from=2026-09-01&user_id=u1'],
    ['attendanceSummary', () => api.attendanceSummary({ from: '2026-09-01', to: '2026-09-30' }), '/api/attendance/summary?from=2026-09-01&to=2026-09-30'],
    ['attendanceBreaks', () => api.attendanceBreaks('u1', '2026-09-01'), '/api/attendance/breaks?user_id=u1&date=2026-09-01'],
    ['attendanceExceptions', () => api.attendanceExceptions('late', '2026-09-01'), '/api/attendance/exceptions?type=late&from=2026-09-01'],
    ['authStatus', () => api.authStatus(), '/api/auth/status'],
    ['me', () => api.me(), '/api/auth/me'],
    ['auditActions', () => api.auditActions(), '/api/audit-logs/actions'],
    ['users', () => api.users(), '/api/admin/users'],
    ['accessPresets', () => api.accessPresets(), '/api/admin/access-presets'],
    ['portalExpenses', () => api.portalExpenses('2026-09'), '/api/portal-expenses?month=2026-09'],
    ['departments', () => api.departments(), '/api/departments'],
    ['staffAttendance', () => api.staffAttendance({ from: '2026-09-01', to: '2026-09-30', staff_id: 4 }), '/api/staff-attendance?from=2026-09-01&to=2026-09-30&staff_id=4'],
    ['staffLeaves', () => api.staffLeaves({ from: '2026-09-01', to: '2026-09-30' }), '/api/staff-leaves?from=2026-09-01&to=2026-09-30'],
    ['staffSalaries', () => api.staffSalaries('2026-09'), '/api/staff-salaries?month=2026-09'],
    ['staffSalaryHolds', () => api.staffSalaryHolds(), '/api/staff-salary-holds'],
    ['queues', () => api.queues('camp_flow', '2026-09-01'), '/api/queues?board=camp_flow&day=2026-09-01'],
    ['queues (whole sheet)', () => api.queues('forwarding'), '/api/queues?board=forwarding'],
    ['queueCodes', () => api.queueCodes(), '/api/queue-codes'],
    ['reviewDepartments', () => api.reviewDepartments('2026-08'), '/api/review-departments?month=2026-08'],
    ['reviewEntries', () => api.reviewEntries('behaviour', '2026-08'), '/api/review-entries?kind=behaviour&month=2026-08'],
    ['reviewEntriesAllMonths', () => api.reviewEntriesAllMonths('performance'), '/api/review-entries?kind=performance'],
    ['topPerformer', () => api.topPerformer('2026-08'), '/api/top-performer?month=2026-08'],
    ['topPerformerRange', () => api.topPerformerRange('2026-01', '2026-06'), '/api/top-performer/range?from=2026-01&to=2026-06'],
    ['annualReview', () => api.annualReview('half', '2026-08'), '/api/annual-reviews?span=half&month=2026-08'],
    ['vendors', () => api.vendors(), '/api/vendors'],
  ] as [string, () => Promise<unknown>, string][])('%s fetches the right URL', async (_name, run, url) => {
    await run()
    expect(call().url).toBe(url)
    expect(call().init.method).toBeUndefined()
  })
})

describe('vendorPayments', () => {
  it('returns the ledger envelope as sent', async () => {
    const ledger = { rows: [{ vendor: 'V' }], opening_advance: 10, prior_net: -5, initial_advance: 5 }
    fetchMock.mockResolvedValueOnce(json(ledger))
    await expect(api.vendorPayments('V', { from: '2026-09-01', to: '2026-09-30' })).resolves.toEqual(ledger)
    expect(call().url).toBe('/api/vendor-payments?vendor=V&from=2026-09-01&to=2026-09-30')
  })

  it('wraps a bare array from an older API as a zero carry-forward', async () => {
    fetchMock.mockResolvedValueOnce(json([{ vendor: 'V', amount_paid: 3 }]))
    await expect(api.vendorPayments('V', {})).resolves.toEqual({
      rows: [{ vendor: 'V', amount_paid: 3 }], opening_advance: 0, prior_net: 0, initial_advance: 0,
    })
  })

  it('propagates errors', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'Unknown vendor' }, 404))
    await expect(api.vendorPayments('X', {})).rejects.toThrow('Unknown vendor')
  })
})

describe('fmtAttendanceTime', () => {
  it('shows an em dash for no timestamp', () => {
    expect(fmtAttendanceTime(null)).toBe('—')
    expect(fmtAttendanceTime('')).toBe('—')
  })

  it('formats a UTC timestamp in New York time, 12-hour', () => {
    expect(fmtAttendanceTime('2026-06-01T13:05:00Z')).toBe('09:05 AM')
    expect(fmtAttendanceTime('2026-01-05T22:30:00Z')).toBe('05:30 PM')
  })
})
