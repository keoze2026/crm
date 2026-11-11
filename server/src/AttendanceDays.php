<?php

declare(strict_types=1);

namespace App;

/**
 * The check-in bot's days, with a shift that ran past midnight STITCHED BACK TOGETHER.
 *
 * The bot files every message under the calendar date it was sent in the org timezone, and
 * keeps one row per person per date (earliest login, latest logout). For a team that works
 * overnight that splits each shift in half and parks the two halves on different rows:
 *
 *     work_date    login_at         logout_at
 *     Nov 11       Nov 11 12:00     Nov 11 05:00   <- the logout of the NOV 10 shift
 *     Nov 12       Nov 12 12:00     Nov 12 05:00   <- the logout of the NOV 11 shift
 *     Nov 13       (none)           Nov 13 05:00   <- the logout of the NOV 12 shift
 *
 * Read literally, every one of those rows says the person logged out seven hours BEFORE
 * they logged in: `logout_at - login_at` is -7h, so the hours column, the net hours, the
 * month's total and every report built off them are wrong by a full day per night worked.
 *
 * So the day is rebuilt around the SHIFT instead of the calendar:
 *
 *   - a row's login is its own;
 *   - a row's logout is its own when that falls AFTER the login — an ordinary day — and
 *     otherwise the NEXT row's logout, which is the one that actually closed this shift;
 *   - a next-day logout only qualifies when it is itself a leftover (that row has no login
 *     of its own, or its logout also precedes its login) and lands within MAX_SHIFT_HOURS
 *     of the login, so a normal day's logout is never taken off it;
 *   - a row that is nothing BUT a leftover logout — no login of its own, its logout claimed
 *     by the day before — stops being a day at all, instead of showing up as an absence
 *     with a stray logout on it.
 *
 * The two halves of that rule are exact mirrors, so a logout is adopted by the previous day
 * if and only if it is dropped from its own, and it can never be counted twice or lost.
 *
 * Nothing here writes: the bot's tables are read exactly as they are, so this fixes the
 * history already recorded as well as tonight's shift, and needs no migration. The other
 * half of the stitch — a logout keyed in by hand that reads earlier than the login — is
 * resolved where the correction is applied, in AttendanceController.
 */
final class AttendanceDays
{
    /**
     * The longest a shift may run before a logout is read as belonging to some other day.
     *
     * It is what stops the stitch reaching too far: a day worker who forgot to log out on
     * Monday does not quietly adopt Tuesday evening's logout and bank 33 hours. Generous
     * enough for a long night (a 12:00 login closing at 05:00 is 17h) and far short of the
     * 24 that would let a whole day slip through.
     */
    public const MAX_SHIFT_HOURS = 18;

    /**
     * The stitched table expression, for `FROM AttendanceDays::source() . " d"`.
     *
     * Column-for-column what `attendance_days` offers, plus `stitched` — true when the
     * logout on the row was adopted from the following day, which is what a page needs to
     * show the logout as a next-day time rather than an impossible one.
     */
    public static function source(): string
    {
        $span = self::MAX_SHIFT_HOURS;
        return "(
            SELECT a.user_id,
                   a.staff_name,
                   a.username,
                   a.work_date,
                   a.login_at,
                   a.login_stated,
                   CASE WHEN " . self::ownLogout('a') . " THEN a.logout_at
                        WHEN a.login_at IS NULL          THEN a.logout_at
                        ELSE nx.logout_at END                                  AS logout_at,
                   CASE WHEN " . self::ownLogout('a') . " THEN a.logout_stated
                        WHEN a.login_at IS NULL          THEN a.logout_stated
                        ELSE nx.logout_stated END                              AS logout_stated,
                   (NOT " . self::ownLogout('a') . " AND a.login_at IS NOT NULL
                        AND nx.logout_at IS NOT NULL)                          AS stitched
              FROM attendance_days a
              -- The logout that closed THIS shift, when the row's own one did not.
              LEFT JOIN LATERAL (
                        SELECT n.logout_at, n.logout_stated
                          FROM attendance_days n
                         WHERE a.login_at IS NOT NULL
                           AND NOT " . self::ownLogout('a') . "
                           AND n.user_id   = a.user_id
                           AND n.work_date = a.work_date + 1
                           AND n.logout_at IS NOT NULL
                           -- Only a leftover: never a day's own completed logout.
                           AND (n.login_at IS NULL OR n.logout_at < n.login_at)
                           AND n.logout_at >  a.login_at
                           AND n.logout_at <= a.login_at + INTERVAL '{$span} hours'
                   ) nx ON TRUE
             -- A row that is only the tail of the previous shift is not a day of its own.
             WHERE NOT EXISTS (
                       SELECT 1
                         FROM attendance_days p
                        WHERE a.login_at  IS NULL
                          AND a.logout_at IS NOT NULL
                          AND p.user_id   = a.user_id
                          AND p.work_date = a.work_date - 1
                          AND p.login_at  IS NOT NULL
                          AND NOT " . self::ownLogout('p') . "
                          AND a.logout_at >  p.login_at
                          AND a.logout_at <= p.login_at + INTERVAL '{$span} hours'
                   )
        )";
    }

    /**
     * SQL: the logout on row `$t` is that row's OWN — it closes the shift the row's login
     * opened, rather than the one before it. A row with no login has nothing to compare
     * against and is not decided here.
     */
    private static function ownLogout(string $t): string
    {
        return "({$t}.logout_at IS NOT NULL AND {$t}.login_at IS NOT NULL AND {$t}.logout_at > {$t}.login_at)";
    }
}
