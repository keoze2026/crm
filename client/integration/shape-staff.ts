import { expect } from 'vitest'
import type {
  AccessPreset,
  AnnualReviewSheet,
  AttendanceBreakRecord,
  AttendanceBreaks,
  AttendanceDay,
  AttendanceOnBreak,
  AttendanceRoster,
  AttendanceStaff,
  AuditLog,
  AuditPage,
  AuthUser,
  Department,
  EnrollInfo,
  EnrollLink,
  ManagedUser,
  ReviewDepartment,
  ReviewEntry,
  StaffAttendancePage,
  StaffAttendanceRow,
  StaffLeave,
  StaffMember,
  StaffSalary,
  StaffSalaryHold,
  TopPerformerState,
} from '../src/types'

// A small runtime mirror of the client's declared types (src/types.ts), for asserting that
// what the live server answers really is what the TypeScript says it is — number vs numeric
// string, null vs a missing key, {} vs [], and the date / clock / timestamp formats the UI
// parses. `Shape<T>` makes the compiler insist every declared field has a spec.

export type Spec =
  | 'string' | 'number' | 'int' | 'boolean'
  /** "YYYY-MM-DD" */
  | 'date'
  /** "YYYY-MM-01" — the first of a month, as every month-scoped row is dated */
  | 'month'
  /** "HH:MM" */
  | 'hhmm'
  /** A timestamp with an explicit offset that Date.parse understands */
  | 'timestamp'
  | 'unknown'
  | { nullable: Spec }
  | { optional: Spec }
  | { array: Spec }
  | { record: Spec }
  | { oneOf: readonly (string | number | boolean)[] }
  | { object: Record<string, Spec> }

export type Shape<T> = { [K in keyof T]-?: Spec }

export const nullable = (s: Spec): Spec => ({ nullable: s })
export const optional = (s: Spec): Spec => ({ optional: s })
export const arrayOf = (s: Spec): Spec => ({ array: s })
export const recordOf = (s: Spec): Spec => ({ record: s })
export const oneOf = (...values: (string | number | boolean)[]): Spec => ({ oneOf: values })
export const obj = <T>(shape: Shape<T>): Spec => ({ object: shape as Record<string, Spec> })

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const show = (v: unknown): string => JSON.stringify(v) ?? String(v)

function realDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCDate() === Number(m[3]) && d.getUTCMonth() === Number(m[2]) - 1
}

/** Every way `value` departs from `spec`, as "path: problem" lines. Empty = conforms. */
export function shapeErrors(value: unknown, spec: Spec, path = '$'): string[] {
  if (typeof spec === 'string') {
    const bad = (want: string) => [`${path}: expected ${want}, got ${show(value)}`]
    switch (spec) {
      case 'unknown': return value === undefined ? bad('a value') : []
      case 'string': return typeof value === 'string' ? [] : bad('string')
      case 'number': return typeof value === 'number' && Number.isFinite(value) ? [] : bad('number')
      case 'int': return Number.isInteger(value) ? [] : bad('integer')
      case 'boolean': return typeof value === 'boolean' ? [] : bad('boolean')
      case 'date': return typeof value === 'string' && realDate(value) ? [] : bad('YYYY-MM-DD')
      case 'month': return typeof value === 'string' && realDate(value) && value.endsWith('-01') ? [] : bad('YYYY-MM-01')
      case 'hhmm': return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? [] : bad('HH:MM')
      case 'timestamp':
        return typeof value === 'string' && /(Z|[+-]\d{2}(:?\d{2})?)$/.test(value) && !Number.isNaN(Date.parse(value))
          ? []
          : bad('timestamp with offset')
    }
  }
  if ('nullable' in spec) return value === null ? [] : shapeErrors(value, spec.nullable, path)
  if ('optional' in spec) return value === undefined ? [] : shapeErrors(value, spec.optional, path)
  if ('oneOf' in spec) {
    return spec.oneOf.includes(value as string) ? [] : [`${path}: expected one of ${show(spec.oneOf)}, got ${show(value)}`]
  }
  if ('array' in spec) {
    if (!Array.isArray(value)) return [`${path}: expected array, got ${show(value)}`]
    return value.flatMap((v, i) => shapeErrors(v, spec.array, `${path}[${i}]`))
  }
  if ('record' in spec) {
    if (!isPlainObject(value)) return [`${path}: expected an object map, got ${show(value)}`]
    return Object.entries(value).flatMap(([k, v]) => shapeErrors(v, spec.record, `${path}.${k}`))
  }
  if (!isPlainObject(value)) return [`${path}: expected object, got ${show(value)}`]
  const errors: string[] = []
  for (const [key, s] of Object.entries(spec.object)) {
    const optionalKey = typeof s === 'object' && 'optional' in s
    if (!(key in value) && !optionalKey) errors.push(`${path}.${key}: missing`)
    else errors.push(...shapeErrors(value[key], s, `${path}.${key}`))
  }
  return errors
}

/** Assert `value` matches `spec`, listing every mismatch at once when it doesn't. */
export function expectShape(value: unknown, spec: Spec): void {
  expect(shapeErrors(value, spec)).toEqual([])
}

// ─── The declared types, as specs ─────────────────────────────────────────────

export const AuthUserSpec = obj<AuthUser>({
  id: 'int',
  email: nullable('string'),
  name: nullable('string'),
  role: oneOf('admin', 'member', 'user'),
  username: nullable('string'),
  totp_enabled: 'boolean',
  permissions: nullable(arrayOf('string')),
})

export const EnrollInfoSpec = obj<EnrollInfo>({
  otpauth_uri: 'string',
  secret: 'string',
  email: nullable('string'),
  label: 'string',
})

export const EnrollLinkSpec = obj<EnrollLink>({
  token: 'string',
  path: 'string',
  expires_at: 'timestamp',
})

export const ManagedUserSpec = obj<ManagedUser>({
  id: 'int',
  email: nullable('string'),
  name: nullable('string'),
  username: nullable('string'),
  staff_id: nullable('int'),
  preset_id: nullable('int'),
  preset_name: nullable('string'),
  role: oneOf('admin', 'member', 'user'),
  is_active: 'boolean',
  totp_enabled: 'boolean',
  enroll_expires_at: nullable('timestamp'),
  enroll_link_active: 'boolean',
  permissions: nullable(arrayOf('string')),
  own_permissions: nullable(arrayOf('string')),
  last_login_at: nullable('timestamp'),
  created_at: 'timestamp',
})

export const AccessPresetSpec = obj<AccessPreset>({
  id: 'int',
  name: 'string',
  pages: arrayOf('string'),
  created_at: 'timestamp',
  updated_at: 'timestamp',
})

export const AuditLogSpec = obj<AuditLog>({
  id: 'int',
  user_id: nullable('int'),
  user_email: nullable('string'),
  action: 'string',
  method: nullable('string'),
  path: nullable('string'),
  entity_type: nullable('string'),
  entity_id: nullable('int'),
  entity_label: optional(nullable('string')),
  details: nullable({ record: 'unknown' }),
  status_code: nullable('int'),
  ip: nullable('string'),
  user_agent: nullable('string'),
  created_at: 'timestamp',
})

export const AuditPageSpec = obj<AuditPage>({
  rows: arrayOf(AuditLogSpec),
  total: 'int',
  limit: 'int',
  offset: 'int',
})

export const DepartmentSpec = obj<Department>({
  id: 'int',
  name: 'string',
  sort_order: 'int',
  staff_count: 'int',
  created_at: 'timestamp',
  updated_at: 'timestamp',
})

export const StaffMemberSpec = obj<StaffMember>({
  id: 'int',
  name: 'string',
  departments: arrayOf({ object: { id: 'int', name: 'string' } }),
  attendance_user_id: nullable('string'),
  status: oneOf('active', 'inactive', 'leave'),
  expected_login: nullable('hhmm'),
  expected_logout: nullable('hhmm'),
  sort_order: 'int',
  created_at: 'timestamp',
  updated_at: 'timestamp',
})

export const StaffAttendanceRowSpec = obj<StaffAttendanceRow>({
  id: nullable('int'),
  source: oneOf('fetched', 'manual'),
  edited: 'boolean',
  staff_id: 'int',
  staff_name: 'string',
  work_date: 'date',
  login_at: nullable('hhmm'),
  logout_at: nullable('hhmm'),
  break_min: 'int',
  status: 'string',
  note: 'string',
})

export const StaffAttendancePageSpec = obj<StaffAttendancePage>({
  timezone: 'string',
  from: 'date',
  to: 'date',
  fetched: 'boolean',
  rows: arrayOf(StaffAttendanceRowSpec),
})

export const StaffLeaveSpec = obj<StaffLeave>({
  id: 'int',
  staff_id: 'int',
  staff_name: 'string',
  department_id: nullable('int'),
  department_name: nullable('string'),
  leave_date: 'date',
  sick_leave: 'string',
  break_leave: 'string',
  half_day: 'string',
  late_login: 'string',
  aob: 'string',
  expected_return: nullable('date'),
  actual_return: nullable('date'),
  sort_order: 'int',
  created_at: 'timestamp',
  updated_at: 'timestamp',
})

export const StaffSalarySpec = obj<StaffSalary>({
  id: 'int',
  staff_id: 'int',
  staff_name: 'string',
  department_id: nullable('int'),
  department_name: nullable('string'),
  month: 'month',
  status: 'string',
  amount: nullable('number'),
  note: 'string',
  sort_order: 'int',
  created_at: 'timestamp',
  updated_at: 'timestamp',
})

export const StaffSalaryHoldSpec = obj<StaffSalaryHold>({
  id: 'int',
  staff_id: 'int',
  staff_name: 'string',
  month: 'month',
  reason: 'string',
  status: oneOf('On Hold', 'Disbursed'),
  sort_order: 'int',
  created_at: 'timestamp',
  updated_at: 'timestamp',
})

export const AttendanceStaffSpec = obj<AttendanceStaff>({
  user_id: 'string',
  username: nullable('string'),
  staff_name: nullable('string'),
  first_seen: 'timestamp',
  last_seen: 'timestamp',
})

export const AttendanceDaySpec = obj<AttendanceDay>({
  user_id: 'string',
  staff_name: nullable('string'),
  username: nullable('string'),
  work_date: 'date',
  login_at: nullable('timestamp'),
  login_stated: nullable('string'),
  logout_at: nullable('timestamp'),
  logout_stated: nullable('string'),
  present: 'boolean',
  still_in: 'boolean',
  completed: 'boolean',
  status: 'string',
  status_set: 'boolean',
  edited: 'boolean',
  bot_seen: 'boolean',
  staff_id: nullable('int'),
  hours: nullable('number'),
  net_hours: nullable('number'),
  break_min: 'int',
  break_count: 'int',
  break_detail: 'string',
  over_break_min: 'int',
  break_actual_min: 'int',
  late_return_count: 'int',
  late_return_min: 'int',
  out_till_eod_count: 'int',
  on_break: 'boolean',
  expected_login: nullable('hhmm'),
  expected_logout: nullable('hhmm'),
  late_min: nullable('int'),
  early_min: nullable('int'),
})

export const AttendanceRosterSpec = obj<AttendanceRoster>({
  timezone: 'string',
  breakAllowanceMin: 'int',
  date: 'date',
  rows: arrayOf(AttendanceDaySpec),
})

export const AttendanceOnBreakSpec = obj<AttendanceOnBreak>({
  user_id: 'string',
  staff_name: nullable('string'),
  username: nullable('string'),
  work_date: 'date',
  taken_at: 'timestamp',
  duration_min: 'int',
  urgent: 'boolean',
  raw: nullable('string'),
  out_for_min: 'int',
  late_min: 'int',
})

export const AttendanceBreakRecordSpec = obj<AttendanceBreakRecord>({
  id: 'string',
  taken_at: 'timestamp',
  returned_at: nullable('timestamp'),
  duration_min: 'int',
  actual_min: 'int',
  late_min: 'int',
  out_till_eod: 'boolean',
  still_out: 'boolean',
  eod_at: 'timestamp',
  urgent: 'boolean',
  raw: nullable('string'),
})

export const AttendanceBreaksSpec = obj<AttendanceBreaks>({
  userId: 'string',
  date: 'date',
  timezone: 'string',
  allowanceMin: 'int',
  graceMin: 'int',
  eodCutoff: 'hhmm',
  totalMin: 'int',
  overMin: 'int',
  actualMin: 'int',
  lateMin: 'int',
  overridden: 'boolean',
  breaks: arrayOf(AttendanceBreakRecordSpec),
})

export const ReviewDepartmentSpec = obj<ReviewDepartment>({
  id: 'int',
  name: 'string',
  performance: 'string',
  percentage: nullable('number'),
  sort_order: 'int',
  created_at: 'timestamp',
  updated_at: 'timestamp',
})

export const ReviewEntrySpec = obj<ReviewEntry>({
  id: 'int',
  kind: oneOf('performance', 'behaviour'),
  department_id: nullable('int'),
  staff_id: nullable('int'),
  person_name: 'string',
  department_note: 'string',
  rating: 'string',
  percentage: nullable('number'),
  notes: 'string',
  month: nullable('month'),
  sort_order: 'int',
  created_at: 'timestamp',
  updated_at: 'timestamp',
})

export const TopPerformerStateSpec = obj<TopPerformerState>({
  month: 'month',
  settings: { object: { additional: arrayOf('string'), min_performance: 'int' } },
  ticks: recordOf(arrayOf('string')),
})

export const AnnualReviewSheetSpec = obj<AnnualReviewSheet>({
  span: oneOf('half', 'year'),
  period_end: 'month',
  months: oneOf(6, 12),
  overrides: recordOf(recordOf('string')),
  extra_rows: arrayOf({ object: { key: 'string', name: 'string' } }),
  settings: { object: { min_months: optional('int') } },
  updated_at: nullable('timestamp'),
  reset_to: nullable('timestamp'),
  restored_from: optional('timestamp'),
})

// ─── Error helpers ────────────────────────────────────────────────────────────

/** The message a call was rejected with; fails the test if it resolved. */
export async function rejectionOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return (e as Error).message
  }
  throw new Error('expected the call to be rejected, but it resolved')
}

/** The HTTP status of the most recent request the api client made. */
export const lastStatus = (server: { calls: { status: number }[] }): number =>
  server.calls[server.calls.length - 1]?.status ?? 0
