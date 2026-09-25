<?php

declare(strict_types=1);

namespace Tests\Api;

/**
 * Arrange helpers shared by the Staff and Attendance API tests: roster rows, departments and
 * the check-in bot's stand-in tables. Every clock time is given in the org's zone
 * (America/New_York), which is what both controllers read the bot's timestamps in.
 */
trait StaffFixtures
{
    private const ORG_TZ = 'America/New_York';

    private static function resetStaffTables(): void
    {
        self::resetTables(
            'staff_salary_holds',
            'staff_salaries',
            'staff_leaves',
            'staff_attendance',
            'staff_departments',
            'departments',
            'staff',
            'attendance_breaks',
            'attendance_days',
            'attendance_staff'
        );
    }

    private static function staffRow(string $name, array $extra = []): array
    {
        return self::insert('staff', ['name' => $name] + $extra);
    }

    private static function departmentRow(string $name, int $sort = 0): array
    {
        return self::insert('departments', ['name' => $name, 'sort_order' => $sort]);
    }

    private static function botAccount(int $userId, ?string $staffName, ?string $username = null): array
    {
        return self::insert('attendance_staff', [
            'user_id'    => $userId,
            'staff_name' => $staffName,
            'username'   => $username,
        ]);
    }

    /** A bot day; login/logout are org-local "HH:MM" on $date (or a full "Y-m-d H:i" string). */
    private static function botDay(int $userId, string $date, ?string $login, ?string $logout, ?string $name = null): array
    {
        return self::insert('attendance_days', [
            'user_id'    => $userId,
            'staff_name' => $name,
            'work_date'  => $date,
            'login_at'   => self::local($date, $login),
            'logout_at'  => self::local($date, $logout),
        ]);
    }

    private static function botBreak(
        int $userId,
        string $date,
        string $taken,
        ?string $returned,
        int $durationMin,
        ?string $name = null,
        bool $urgent = false
    ): array {
        return self::insert('attendance_breaks', [
            'user_id'      => $userId,
            'work_date'    => $date,
            'staff_name'   => $name,
            'taken_at'     => self::local($date, $taken),
            'returned_at'  => self::local($date, $returned),
            'duration_min' => $durationMin,
            'urgent'       => $urgent,
            'raw'          => "taking {$durationMin}",
        ]);
    }

    /** "HH:MM" on $date, or an explicit "Y-m-d H:i", as a timestamptz literal in the org zone. */
    private static function local(string $date, ?string $time): ?string
    {
        if ($time === null) {
            return null;
        }
        $stamp = str_contains($time, '-') ? $time : "{$date} {$time}";
        return (new \DateTimeImmutable($stamp, new \DateTimeZone(self::ORG_TZ)))->format(\DATE_ATOM);
    }

    private static function orgToday(): string
    {
        return (new \DateTimeImmutable('now', new \DateTimeZone(self::ORG_TZ)))->format('Y-m-d');
    }

    /** A timestamp from the API, rendered as org-local "Y-m-d H:i". */
    private static function asLocal(?string $stamp): ?string
    {
        if ($stamp === null) {
            return null;
        }
        return (new \DateTimeImmutable($stamp))->setTimezone(new \DateTimeZone(self::ORG_TZ))->format('Y-m-d H:i');
    }
}
