import { sql } from './harness'

// Seeders for the check-in bot's own tables (attendance_staff / attendance_days /
// attendance_breaks), which the API only ever reads. Timestamps are passed as Postgres
// literals with an explicit offset, e.g. '2026-08-03 09:07:00-04' — 9:07 AM in New York.

export const BOT_TABLES = ['attendance_staff', 'attendance_days', 'attendance_breaks'] as const

export function seedBotStaff(userId: number, staffName: string, username: string | null = null): void {
  sql('INSERT INTO attendance_staff (user_id, username, staff_name) VALUES (?, ?, ?)', [userId, username, staffName])
}

export function seedBotDay(
  userId: number, date: string, login: string | null, logout: string | null, staffName: string | null = null,
): void {
  sql(
    `INSERT INTO attendance_days (user_id, staff_name, work_date, login_at, logout_at, login_stated, logout_stated)
     VALUES (?, ?, ?::date, ?::timestamptz, ?::timestamptz, ?, ?)`,
    [userId, staffName, date, login, logout, login ? 'in' : null, logout ? 'out' : null],
  )
}

export function seedBotBreak(
  userId: number, date: string, takenAt: string, returnedAt: string | null, durationMin: number, raw: string | null = null,
): void {
  sql(
    `INSERT INTO attendance_breaks (user_id, work_date, taken_at, returned_at, duration_min, raw)
     VALUES (?, ?::date, ?::timestamptz, ?::timestamptz, ?, ?)`,
    [userId, date, takenAt, returnedAt, durationMin, raw],
  )
}
