<?php

declare(strict_types=1);

namespace App\Controllers;

use App\AttendanceDays;
use App\Database;
use App\Http;
use App\Leaves;

final class AttendanceController
{
    private const TZ          = 'America/New_York';
    private const BREAK_ALLOW = 60;

    /**
     * The check-in bot's own break rules, mirrored from its .env (BREAK_GRACE_MIN and
     * BREAK_EOD_CUTOFF). The bot stores no break length, lateness or "Out till EOD" — it
     * derives them from taken_at / returned_at with these two — so they must match the bot's
     * values or this page will disagree with its log and its Excel export.
     */
    private const BREAK_GRACE      = 10;
    private const BREAK_EOD_CUTOFF = '07:00';

    /**
     * EVERY attendance day there is, from both sides of the CRM, as one table — the `d`
     * every query on this page reads instead of `attendance_days`.
     *
     * A day can exist in two places: the check-in bot's own record, and a `staff_attendance`
     * row keyed in on the attendance sheet. Where both exist the keyed-in row REPLACES the
     * bot's day — login, logout, break and status all come from it — and where only the
     * keyed-in row exists, the day is still a day: somebody the bot marked absent (by having
     * no record of them at all) and who was then set to Half day shows up here as a half
     * day, in this page's figures and in every report built off them. Deleting the row puts
     * the bot's record back, or removes the day again; the bot's own tables are never written.
     *
     * Identity: `user_id` is the bot's account where there is one and a stable "staff-12"
     * stand-in where there isn't, so two people who have never used the bot can't collapse
     * into one row. `bot_user_id` is the real account, and the only thing break rows join on.
     *
     * Both halves read a SHIFT rather than a calendar date, so a night that ran past midnight
     * is one day with one set of hours: the bot's own split rows are stitched by
     * App\AttendanceDays, and a correction whose logout reads earlier than its login is the
     * following morning — see keyedLogout().
     */
    private static function daysSource(): string
    {
        $bot    = AttendanceDays::source();
        $login  = self::keyedLogin();
        $logout = self::keyedLogout();
        return "(
        SELECT COALESCE(d.user_id::text, 'staff-' || so.id::text) AS user_id,
               d.user_id::text                                    AS bot_user_id,
               so.id                                              AS staff_id,
               d.work_date,
               COALESCE(NULLIF(btrim(so.name), ''), d.staff_name) AS staff_name,
               d.username,
               CASE WHEN o.id IS NOT NULL
                    THEN CASE WHEN o.login_at IS NULL THEN NULL ELSE {$login} END
                    ELSE d.login_at END                           AS login_at,
               CASE WHEN o.id IS NOT NULL
                    THEN CASE WHEN o.logout_at IS NULL THEN NULL ELSE {$logout} END
                    ELSE d.logout_at END                          AS logout_at,
               d.login_stated,
               d.logout_stated,
               NULLIF(btrim(o.status), '')                        AS set_status,
               (o.id IS NOT NULL)                                 AS edited,
               TRUE                                               AS bot_seen,
               -- A correction's blank break (NULL) falls back to the bot's total, via BREAK_MIN.
               o.break_min                                        AS set_break_min
          FROM {$bot} d
          LEFT JOIN staff so ON so.attendance_user_id = d.user_id::text
          LEFT JOIN staff_attendance o ON o.staff_id = so.id AND o.work_date = d.work_date
        UNION ALL
        SELECT COALESCE(NULLIF(btrim(s.attendance_user_id), ''), 'staff-' || s.id::text),
               NULLIF(btrim(s.attendance_user_id), ''),
               s.id,
               o.work_date,
               s.name,
               NULL,
               CASE WHEN o.login_at IS NULL THEN NULL ELSE {$login} END,
               CASE WHEN o.logout_at IS NULL THEN NULL ELSE {$logout} END,
               NULL,
               NULL,
               NULLIF(btrim(o.status), ''),
               TRUE,
               FALSE,
               COALESCE(o.break_min, 0)
          FROM staff_attendance o
          JOIN staff s ON s.id = o.staff_id
         WHERE NOT EXISTS (
                   SELECT 1
                     FROM {$bot} d2
                    WHERE NULLIF(btrim(s.attendance_user_id), '') IS NOT NULL
                      AND d2.user_id::text = btrim(s.attendance_user_id)
                      AND d2.work_date = o.work_date)
    ) d";
    }

    /** A correction's login, as an instant: its clock time on its own work date. */
    private static function keyedLogin(): string
    {
        return "((o.work_date + o.login_at) AT TIME ZONE '" . self::TZ . "')";
    }

    /**
     * A correction's logout, as an instant — THE FOLLOWING MORNING when it reads earlier on
     * the clock than the login.
     *
     * Both cells hold a bare clock time against one work date, so an overnight shift can only
     * be keyed in as "in 12:00, out 05:00". Read on the work date alone that is minus seven
     * hours; read as the next day it is the seventeen actually worked, which is how the sheet
     * has always shown it (netHours() in client/src/lib/staff.ts) and now how it is counted.
     *
     * The day is added to the LOCAL timestamp before the zone is applied, so the clock time
     * is what carries over: a shift closing at 05:00 closes at 05:00 on both sides of a DST
     * switch, and the hours come out as the 7 or 9 the night really was.
     */
    private static function keyedLogout(): string
    {
        return "((o.work_date + o.logout_at
                  + CASE WHEN o.login_at IS NOT NULL AND o.logout_at < o.login_at
                         THEN INTERVAL '1 day' ELSE INTERVAL '0' END) AT TIME ZONE '" . self::TZ . "')";
    }

    /**
     * The break total: the keyed-in one where a correction gives one, the bot's otherwise —
     * a correction that leaves the break blank still reads the bot's breaks.
     */
    private const BREAK_MIN =
        "CASE WHEN d.set_break_min IS NOT NULL THEN d.set_break_min ELSE COALESCE(b.break_min, 0) END";

    /** Both times are already resolved by daysSource() — these two name them for the queries. */
    private const LOGIN_AT  = 'd.login_at';
    private const LOGOUT_AT = 'd.logout_at';

    /**
     * The status the day carries: the one set by hand, or — where none is — the one the
     * clock times imply, in the same words the attendance sheet uses. It is what makes a
     * corrected day readable here: "half day" is not something the bot has a word for. A day
     * with no login that the Leaves sheet covers reads "leave", not "absent".
     */
    private static function status(): string
    {
        return "COALESCE(d.set_status,
                  CASE WHEN d.login_at IS NULL
                       THEN CASE WHEN " . Leaves::covers('d.staff_id', 'd.work_date') . " THEN 'leave' ELSE 'absent' END
                       WHEN d.logout_at IS NULL THEN 'still in'
                       ELSE 'present' END)";
    }

    /**
     * Whether the person was on leave that day — on the Leaves sheet, or with the day's
     * status set to "leave" by hand. A leave day is never judged: no late login, no early
     * logout, no missing logout, and an empty day reads "leave" rather than "absent". A
     * stray login on one (a message the bot took for a check-in) is still shown, just not
     * marked.
     */
    private static function onLeave(): string
    {
        return "(lower(COALESCE(d.set_status, '')) = 'leave' OR " . Leaves::covers('d.staff_id', 'd.work_date') . ')';
    }

    /**
     * Whether the day counts as a day at work. A status set by hand decides it — that is the
     * point of setting one — and only where none is set does it fall back to "did they log in".
     */
    private const PRESENT =
        "CASE WHEN d.set_status IS NOT NULL
              THEN d.set_status IN ('present', 'half day', 'still in')
              ELSE d.login_at IS NOT NULL END";

    /** The staff member behind the day, for their schedule. Every query joins it. */
    private const OVERRIDE_JOIN = 'LEFT JOIN staff so ON so.id = d.staff_id';

    /** The bot's breaks for that day, by the account that took them. */
    private const BREAK_JOIN_ON = 'b.user_id::text = d.bot_user_id AND b.work_date = d.work_date';

    /**
     * The hours the staff member is expected to keep, kept on the Staff page. The same
     * `so` the override is reached through carries them, so no extra join is needed.
     *
     * NULL means no schedule has been agreed for that person, and every mark below then
     * comes back NULL — nobody is called late against an expectation nobody set.
     */
    private const EXPECTED_LOGIN  = "to_char(so.expected_login, 'HH24:MI')";
    private const EXPECTED_LOGOUT = "to_char(so.expected_logout, 'HH24:MI')";

    /**
     * Minutes past the expected login, and minutes short of the expected logout — 0 when
     * the day is on time, NULL when there is nothing to compare it against.
     *
     * Both are measured against the EFFECTIVE times, so a day corrected on the Staff page
     * is judged by the corrected figures rather than the bot's original ones. A leave day
     * is not judged at all.
     *
     * Both read the clock the short way round (clockGap), which is what lets a schedule
     * that crosses midnight be judged at all: an 05:00 logout against an expected 21:00 is
     * sixteen hours LATE out, not sixteen hours early, and an expected 05:00 finish is met
     * at 05:00 rather than counted as a whole day short.
     */
    private static function lateMin(): string
    {
        $login = self::LOGIN_AT;
        $tz    = self::TZ;
        $clock = "((({$login}) AT TIME ZONE '{$tz}')::time)";
        return "CASE WHEN so.expected_login IS NULL OR ({$login}) IS NULL OR " . self::onLeave() . " THEN NULL
                     ELSE " . self::clockGap('so.expected_login', $clock) . "
                END";
    }

    private static function earlyMin(): string
    {
        $logout = self::LOGOUT_AT;
        $tz     = self::TZ;
        $clock  = "((({$logout}) AT TIME ZONE '{$tz}')::time)";
        return "CASE WHEN so.expected_logout IS NULL OR ({$logout}) IS NULL OR " . self::onLeave() . " THEN NULL
                     ELSE " . self::clockGap($clock, 'so.expected_logout') . "
                END";
    }

    /**
     * Minutes forward from clock time `$from` to clock time `$to`, THE SHORT WAY ROUND the
     * 24-hour face: 0 when `$to` is at or behind `$from`.
     *
     * Two bare clock times carry no day, so their difference is ambiguous by 24 hours, and
     * subtracting them outright gets an overnight shift exactly a day wrong in one direction
     * or the other. Anything more than twelve hours forward is read as the shorter distance
     * backwards instead — which is to say, not late and not early — so the same expression
     * judges a 09:00-to-18:00 desk and a 21:00-to-05:00 night desk without being told which
     * it is looking at.
     */
    private static function clockGap(string $from, string $to): string
    {
        $fwd = "(((ROUND(EXTRACT(EPOCH FROM (({$to}) - ({$from}))) / 60.0)::int % 1440) + 1440) % 1440)";
        return "CASE WHEN {$fwd} > 720 THEN 0 ELSE {$fwd} END";
    }

    /** The four schedule columns every day-shaped response carries, as a SELECT fragment. */
    private static function scheduleColumns(): string
    {
        return self::EXPECTED_LOGIN . ' AS expected_login, '
             . self::EXPECTED_LOGOUT . ' AS expected_logout, '
             . self::lateMin() . ' AS late_min, '
             . self::earlyMin() . ' AS early_min';
    }

    /**
     * The measured side of a break, joined onto `attendance_breaks {$b}`.
     *
     * `e.eod_at` is the furthest a break can run: the first cutoff AFTER it started, not the
     * cutoff on its calendar date, so a break opened at 11:30pm runs to the 7am that follows.
     * `a.actual_min` is how long they were really away — to the return, or while nobody has
     * returned, to now but never past that cutoff. Postgres does the zone maths, so DST nights
     * come out 7 or 9 hours exactly as the bot's do.
     */
    private static function breakMeasureJoins(string $b): string
    {
        $tz      = self::TZ;
        $cut     = self::BREAK_EOD_CUTOFF;
        $sameDay = "((({$b}.taken_at AT TIME ZONE '{$tz}')::date + TIME '{$cut}') AT TIME ZONE '{$tz}')";
        return "CROSS JOIN LATERAL (
                    SELECT CASE WHEN {$sameDay} > {$b}.taken_at THEN {$sameDay}
                                ELSE (((({$b}.taken_at AT TIME ZONE '{$tz}')::date + 1) + TIME '{$cut}') AT TIME ZONE '{$tz}')
                           END AS eod_at
                ) e
                CROSS JOIN LATERAL (
                    SELECT GREATEST(0, (EXTRACT(EPOCH FROM
                               (COALESCE({$b}.returned_at, LEAST(now(), e.eod_at)) - {$b}.taken_at)) / 60)::int) AS actual_min
                ) a";
    }

    /** Minutes back past the stated length plus the grace — 0 for a break returned from in time. */
    private static function lateReturnMin(string $b): string
    {
        return "GREATEST(0, a.actual_min - {$b}.duration_min - " . self::BREAK_GRACE . ')';
    }

    /**
     * One row per bot day with its breaks totalled, for `LEFT JOIN (...) b`. Beside the stated
     * minutes the allowance is judged on, it carries what the returns show: minutes actually
     * away, how many breaks came back late and by how much past the grace, how many were never
     * returned from once the cutoff passed, and whether one is running right now.
     */
    private static function breakDaySubquery(): string
    {
        $late = self::lateReturnMin('br');
        return "SELECT br.user_id, br.work_date,
                       SUM(br.duration_min) AS break_min,
                       COUNT(*) AS break_count,
                       STRING_AGG(br.duration_min::text, ', ' ORDER BY br.taken_at) AS break_detail,
                       SUM(a.actual_min) AS break_actual_min,
                       COUNT(*) FILTER (WHERE {$late} > 0) AS late_return_count,
                       SUM({$late}) AS late_return_min,
                       COUNT(*) FILTER (WHERE br.returned_at IS NULL AND now() >= e.eod_at) AS out_till_eod_count,
                       BOOL_OR(br.returned_at IS NULL AND now() < e.eod_at) AS on_break
                  FROM attendance_breaks br
                  " . self::breakMeasureJoins('br') . "
                 GROUP BY br.user_id, br.work_date";
    }

    public function staff(): void
    {
        $stmt = Database::connection()->prepare(
            "SELECT user_id::text, username, staff_name, first_seen, last_seen
             FROM attendance_staff ORDER BY staff_name NULLS LAST"
        );
        $stmt->execute();
        Http::json($stmt->fetchAll());
    }

    public function roster(): void
    {
        $date   = Http::query('date', (new \DateTime('now', new \DateTimeZone(self::TZ)))->format('Y-m-d'));
        $break  = self::BREAK_MIN;
        $login  = self::LOGIN_AT;
        $logout = self::LOGOUT_AT;
        $stmt   = Database::connection()->prepare(
            "SELECT d.user_id::text, d.staff_name, d.username, d.work_date::text,
                    {$login} AS login_at, d.login_stated,
                    {$logout} AS logout_at, d.logout_stated,
                    " . self::PRESENT . " AS present,
                    ({$login} IS NOT NULL AND {$logout} IS NULL) AS still_in,
                    " . self::status() . " AS status,
                    (d.set_status IS NOT NULL) AS status_set,
                    " . self::onLeave() . " AS on_leave,
                    d.edited, d.bot_seen, d.staff_id,
                    ROUND(EXTRACT(EPOCH FROM ({$logout} - {$login})) / 3600.0, 2) AS hours,
                    {$break} AS break_min,
                    COALESCE(b.break_count, 0) AS break_count,
                    COALESCE(b.break_detail, '') AS break_detail,
                    COALESCE(b.break_actual_min, 0) AS break_actual_min,
                    COALESCE(b.late_return_count, 0) AS late_return_count,
                    COALESCE(b.late_return_min, 0) AS late_return_min,
                    COALESCE(b.out_till_eod_count, 0) AS out_till_eod_count,
                    COALESCE(b.on_break, false) AS on_break,
                    GREATEST({$break} - :allow, 0) AS over_break_min,
                    ROUND(EXTRACT(EPOCH FROM ({$logout} - {$login})) / 3600.0 - {$break} / 60.0, 2) AS net_hours,
                    " . self::scheduleColumns() . "
             FROM " . self::daysSource() . "
             LEFT JOIN (" . self::breakDaySubquery() . ") b ON " . self::BREAK_JOIN_ON . "
             " . self::OVERRIDE_JOIN . "
             WHERE d.work_date = :date
             ORDER BY {$login} NULLS LAST, d.staff_name"
        );
        $stmt->execute([':date' => $date, ':allow' => self::BREAK_ALLOW]);
        Http::json([
            'timezone'          => self::TZ,
            'breakAllowanceMin' => self::BREAK_ALLOW,
            'date'              => $date,
            'rows'              => array_map([$this, 'castDay'], $stmt->fetchAll()),
            // Who is on leave, row or no row — so nobody on leave is listed as absent.
            'leave_days'        => Leaves::days($date, $date),
        ]);
    }

    /**
     * Who is at work right now: logged in, not logged out, and recently enough that the
     * shift could still be running.
     *
     * Measured from the LOGIN rather than from today's date, because at 2am a night shift
     * belongs to yesterday — filtering on the calendar day emptied the board of exactly the
     * people who were still at their desks. The same span the stitch allows a shift bounds
     * it, so a logout nobody ever posted drops off instead of standing here for weeks.
     */
    public function live(): void
    {
        $login  = self::LOGIN_AT;
        $logout = self::LOGOUT_AT;
        $span   = AttendanceDays::MAX_SHIFT_HOURS;
        $stmt   = Database::connection()->prepare(
            "SELECT d.user_id::text, d.staff_name, d.username,
                    {$login} AS login_at, d.login_stated,
                    " . self::scheduleColumns() . "
             FROM " . self::daysSource() . "
             " . self::OVERRIDE_JOIN . "
             WHERE {$login} IS NOT NULL AND {$logout} IS NULL
               AND {$login} > now() - INTERVAL '{$span} hours'
             ORDER BY {$login}"
        );
        $stmt->execute();
        Http::json(array_map([$this, 'castSchedule'], $stmt->fetchAll()));
    }

    /**
     * Who is out on a break right now: a break nobody has come back from whose end-of-day
     * cutoff hasn't passed. Once it has, the bot calls it `Out till EOD` rather than live, so it
     * drops off here and turns up in the late-return exceptions instead.
     *
     * No break's cutoff is more than a day after it started, so the two-day bound only keeps
     * old abandoned breaks out of the scan — it never hides a live one.
     */
    public function onBreak(): void
    {
        $late = self::lateReturnMin('br');
        $stmt = Database::connection()->prepare(
            "SELECT br.user_id::text, COALESCE(s.staff_name, br.staff_name) AS staff_name, s.username,
                    br.work_date::text, br.taken_at, br.duration_min, br.urgent, br.raw,
                    a.actual_min AS out_for_min,
                    {$late} AS late_min
               FROM attendance_breaks br
               LEFT JOIN attendance_staff s ON s.user_id = br.user_id
               " . self::breakMeasureJoins('br') . "
              WHERE br.returned_at IS NULL
                AND br.taken_at > now() - INTERVAL '2 days'
                AND now() < e.eod_at
              ORDER BY br.taken_at"
        );
        $stmt->execute();
        Http::json(array_map(static function (array $r): array {
            $r['duration_min'] = (int) $r['duration_min'];
            $r['out_for_min']  = (int) $r['out_for_min'];
            $r['late_min']     = (int) $r['late_min'];
            $r['urgent']       = (bool) $r['urgent'];
            return $r;
        }, $stmt->fetchAll()));
    }

    public function days(): void
    {
        $from   = Http::query('from', date('Y-m-d'));
        $to     = Http::query('to',   date('Y-m-d'));
        $userId = Http::query('user_id');
        $where  = ['d.work_date BETWEEN :from AND :to'];
        $params = [':from' => $from, ':to' => $to, ':allow' => self::BREAK_ALLOW];
        if ($userId) { $where[] = 'd.user_id = :uid'; $params[':uid'] = (string) $userId; }

        $break  = self::BREAK_MIN;
        $login  = self::LOGIN_AT;
        $logout = self::LOGOUT_AT;
        $stmt   = Database::connection()->prepare(
            "SELECT d.user_id::text, d.staff_name, d.username, d.work_date::text,
                    {$login} AS login_at, d.login_stated,
                    {$logout} AS logout_at, d.logout_stated,
                    ROUND(EXTRACT(EPOCH FROM ({$logout} - {$login})) / 3600.0, 2) AS hours,
                    {$break} AS break_min,
                    COALESCE(b.break_count, 0) AS break_count,
                    COALESCE(b.break_detail, '') AS break_detail,
                    COALESCE(b.break_actual_min, 0) AS break_actual_min,
                    COALESCE(b.late_return_count, 0) AS late_return_count,
                    COALESCE(b.late_return_min, 0) AS late_return_min,
                    COALESCE(b.out_till_eod_count, 0) AS out_till_eod_count,
                    COALESCE(b.on_break, false) AS on_break,
                    GREATEST({$break} - :allow, 0) AS over_break_min,
                    ROUND(EXTRACT(EPOCH FROM ({$logout} - {$login})) / 3600.0 - {$break} / 60.0, 2) AS net_hours,
                    ({$logout} IS NOT NULL) AS completed,
                    " . self::PRESENT . " AS present,
                    " . self::status() . " AS status,
                    (d.set_status IS NOT NULL) AS status_set,
                    " . self::onLeave() . " AS on_leave,
                    d.edited, d.bot_seen, d.staff_id,
                    " . self::scheduleColumns() . "
             FROM " . self::daysSource() . "
             LEFT JOIN (" . self::breakDaySubquery() . ") b ON " . self::BREAK_JOIN_ON . "
             " . self::OVERRIDE_JOIN . "
             WHERE " . implode(' AND ', $where) . "
             ORDER BY d.work_date DESC, d.staff_name"
        );
        $stmt->execute($params);
        $leaveDays = Leaves::days($from, $to);
        if ($userId) {
            $leaveDays = array_values(array_filter($leaveDays, static fn (array $l): bool => $l['user_id'] === (string) $userId));
        }
        Http::json([
            'timezone'          => self::TZ,
            'breakAllowanceMin' => self::BREAK_ALLOW,
            'rows'              => array_map([$this, 'castDay'], $stmt->fetchAll()),
            // A leave day with no row at all is not a missed day — the summary's attendance
            // rate leaves these out of what each person was expected to attend.
            'leave_days'        => $leaveDays,
        ]);
    }

    public function summary(): void
    {
        $from = Http::query('from', date('Y-m-01'));
        $to   = Http::query('to',   date('Y-m-d'));
        $login  = self::LOGIN_AT;
        $logout = self::LOGOUT_AT;
        $stmt   = Database::connection()->prepare(
            "SELECT d.user_id, d.staff_name,
                    COUNT(*) FILTER (WHERE " . self::PRESENT . ") AS days_present,
                    COUNT(*) FILTER (WHERE {$login} IS NOT NULL AND {$logout} IS NOT NULL) AS days_complete,
                    ROUND(SUM(EXTRACT(EPOCH FROM ({$logout} - {$login})) / 3600.0)
                          FILTER (WHERE {$logout} IS NOT NULL), 2) AS total_hours,
                    MIN(d.work_date)::text AS first_day, MAX(d.work_date)::text AS last_day
             FROM " . self::daysSource() . "
             " . self::OVERRIDE_JOIN . "
             WHERE d.work_date BETWEEN :from AND :to
             GROUP BY d.user_id, d.staff_name ORDER BY d.staff_name"
        );
        $stmt->execute([':from' => $from, ':to' => $to]);
        // ROUND() comes back as a numeric string (NULL with no completed day); the client
        // declares a number.
        Http::json(array_map(static function (array $r): array {
            $r['total_hours'] = (float) ($r['total_hours'] ?? 0);
            return $r;
        }, $stmt->fetchAll()));
    }

    public function breaks(): void
    {
        $userId = Http::query('user_id');
        $date   = Http::query('date', date('Y-m-d'));
        if (!$userId) Http::error('user_id is required', 422);

        // Each break as the bot recorded it, with what its return shows: minutes actually away,
        // minutes late past the grace, and which of the three states it is in — returned,
        // still out, or Out till EOD.
        $late = self::lateReturnMin('br');
        $stmt = Database::connection()->prepare(
            "SELECT br.id::text AS id, br.taken_at, br.returned_at, br.duration_min, a.actual_min,
                    {$late} AS late_min,
                    (br.returned_at IS NULL AND now() >= e.eod_at) AS out_till_eod,
                    (br.returned_at IS NULL AND now() <  e.eod_at) AS still_out,
                    e.eod_at, br.urgent, br.raw
               FROM attendance_breaks br
               " . self::breakMeasureJoins('br') . "
              WHERE br.user_id = :uid AND br.work_date = :date
              ORDER BY br.taken_at"
        );
        $stmt->execute([':uid' => $userId, ':date' => $date]);
        $breaks = array_map(static function (array $b): array {
            $b['duration_min'] = (int) $b['duration_min'];
            $b['actual_min']   = (int) $b['actual_min'];
            $b['late_min']     = (int) $b['late_min'];
            $b['out_till_eod'] = (bool) $b['out_till_eod'];
            $b['still_out']    = (bool) $b['still_out'];
            $b['urgent']       = (bool) $b['urgent'];
            return $b;
        }, $stmt->fetchAll());
        $totalMin = array_sum(array_column($breaks, 'duration_min'));

        // A correction keyed in on the Staff page replaces the total. The individual breaks
        // below are still the bot's own list — the override is a day total, not a re-timing
        // of each break — so `overridden` says which of the two the total came from.
        $ovrStmt = Database::connection()->prepare(
            'SELECT o.break_min
               FROM staff_attendance o
               JOIN staff s ON s.id = o.staff_id
              WHERE s.attendance_user_id = :uid AND o.work_date = :date AND o.break_min IS NOT NULL'
        );
        $ovrStmt->execute([':uid' => $userId, ':date' => $date]);
        $override = $ovrStmt->fetchColumn();
        $overridden = $override !== false && $override !== null;
        if ($overridden) {
            $totalMin = (int) $override;
        }
        Http::json([
            'userId'       => $userId,
            'date'         => $date,
            'timezone'     => self::TZ,
            'allowanceMin' => self::BREAK_ALLOW,
            'graceMin'     => self::BREAK_GRACE,
            'eodCutoff'    => self::BREAK_EOD_CUTOFF,
            'totalMin'     => $totalMin,
            'overMin'      => max(0, $totalMin - self::BREAK_ALLOW),
            'actualMin'    => array_sum(array_column($breaks, 'actual_min')),
            'lateMin'      => array_sum(array_column($breaks, 'late_min')),
            'overridden'   => $overridden,
            'breaks'       => $breaks,
        ]);
    }

    public function exceptions(): void
    {
        $type   = Http::query('type', 'missing_logout');
        $from   = Http::query('from', date('Y-m-01'));
        $to     = Http::query('to',   date('Y-m-d'));
        $tz     = self::TZ;
        $params = [':from' => $from, ':to' => $to];
        // Every one of these is driven off attendance_days with the override joined, never
        // off the bot's rows alone — so a correction decides the exception, including one
        // that clears it (a break brought back under the allowance, a logout filled in).
        $break  = self::BREAK_MIN;
        $login  = self::LOGIN_AT;
        $logout = self::LOGOUT_AT;
        $join   = self::OVERRIDE_JOIN;
        $allow  = self::BREAK_ALLOW;
        // The login as a clock time, and how far past the expected one it is — needed twice
        // over in the 'late' report, as the figure and as the test for being in it at all.
        $clock  = "((({$login}) AT TIME ZONE '{$tz}')::time)";
        $late   = self::clockGap('so.expected_login', $clock);

        $sql = match($type) {
            'missing_logout' => "SELECT d.user_id, d.staff_name, d.work_date::text,
                                        {$login} AS login_at
                                   FROM " . self::daysSource() . " {$join}
                                  WHERE {$login} IS NOT NULL AND {$logout} IS NULL
                                    AND d.work_date < (now() AT TIME ZONE '{$tz}')::date
                                    AND d.work_date BETWEEN :from AND :to
                                    AND NOT " . self::onLeave() . "
                                  ORDER BY d.work_date DESC",
            'over_break'     => "SELECT d.user_id, d.staff_name, d.work_date::text,
                                        {$break} AS break_min,
                                        {$break} - {$allow} AS over_min
                                   FROM " . self::daysSource() . "
                              LEFT JOIN (
                                        SELECT user_id, work_date, SUM(duration_min) AS break_min
                                          FROM attendance_breaks GROUP BY user_id, work_date
                                   ) b ON " . self::BREAK_JOIN_ON . "
                                   {$join}
                                  WHERE d.work_date BETWEEN :from AND :to
                                    AND {$break} > {$allow}
                                  ORDER BY over_min DESC",
            // Late is measured against the person's own expected login from the Staff page,
            // and against nothing at all where none is set: this report used to fall back to
            // a flat 9:00, which booked a night desk signing on at 16:52 as seven hours and
            // fifty-two minutes late and a 10:30 start arriving at 10:08, early, as an hour
            // and eight late. An empty report says "nobody's hours are set"; the old one said
            // something false about everybody. Nobody is late on a day they were on leave,
            // and the clock is read the short way round, so a night desk expected at 21:00
            // and in at 21:20 is twenty minutes late rather than twenty-three hours and forty.
            'late'           => "SELECT d.user_id, d.staff_name, d.work_date::text,
                                        {$clock}::text AS local_login,
                                        to_char(so.expected_login, 'HH24:MI') AS expected_login,
                                        {$late} AS late_min
                                   FROM " . self::daysSource() . " {$join}
                                  WHERE {$login} IS NOT NULL
                                    AND so.expected_login IS NOT NULL
                                    AND {$late} > 0
                                    AND d.work_date BETWEEN :from AND :to
                                    AND NOT " . self::onLeave() . "
                                  ORDER BY d.work_date DESC",
            // Per break, from the returns: back later than stated + grace, still out past it, or
            // never back once the cutoff passed. A break correction on the Staff page changes the
            // day's total, not when anyone came back, so it doesn't clear these.
            'late_return'    => "SELECT br.user_id::text, br.staff_name, br.work_date::text,
                                        br.taken_at, br.returned_at, br.duration_min, br.urgent,
                                        a.actual_min, " . self::lateReturnMin('br') . " AS late_min,
                                        (br.returned_at IS NULL AND now() >= e.eod_at) AS out_till_eod
                                   FROM attendance_breaks br
                                   " . self::breakMeasureJoins('br') . "
                                  WHERE br.work_date BETWEEN :from AND :to
                                    AND " . self::lateReturnMin('br') . " > 0
                                  ORDER BY late_min DESC",
            default          => null,
        };
        if (!$sql) Http::error('Invalid type', 422);
        $stmt = Database::connection()->prepare($sql);
        $stmt->execute($params);
        Http::json(['type' => $type, 'from' => $from, 'to' => $to, 'rows' => $stmt->fetchAll()]);
    }

    private function castDay(array $r): array
    {
        $r['hours']          = $r['hours']         !== null ? (float)$r['hours']         : null;
        $r['net_hours']      = $r['net_hours']      !== null ? (float)$r['net_hours']      : null;
        $r['break_min']      = (int)$r['break_min'];
        $r['break_count']    = (int)($r['break_count'] ?? 0);
        $r['break_detail']   = $r['break_detail'] ?? '';
        $r['over_break_min'] = (int)$r['over_break_min'];
        $r['break_actual_min']   = (int)($r['break_actual_min'] ?? 0);
        $r['late_return_count']  = (int)($r['late_return_count'] ?? 0);
        $r['late_return_min']    = (int)($r['late_return_min'] ?? 0);
        $r['out_till_eod_count'] = (int)($r['out_till_eod_count'] ?? 0);
        $r['on_break']           = (bool)($r['on_break'] ?? false);
        $r['present']        = (bool)($r['present']   ?? false);
        $r['still_in']       = (bool)($r['still_in']  ?? false);
        $r['completed']      = (bool)($r['completed']  ?? false);
        $r['status']         = $r['status'] ?? '';
        $r['status_set']     = (bool)($r['status_set'] ?? false);
        $r['on_leave']       = (bool)($r['on_leave']   ?? false);
        $r['edited']         = (bool)($r['edited']     ?? false);
        $r['bot_seen']       = (bool)($r['bot_seen']   ?? true);
        $r['staff_id']       = isset($r['staff_id']) ? (int)$r['staff_id'] : null;
        return $this->castSchedule($r);
    }

    /**
     * The schedule marks, kept as numbers rather than the strings PDO hands back. NULL
     * survives as null throughout: no schedule set means nothing to say, which is not the
     * same as "0 minutes late".
     */
    private function castSchedule(array $r): array
    {
        $r['late_min']  = isset($r['late_min'])  ? (int)$r['late_min']  : null;
        $r['early_min'] = isset($r['early_min']) ? (int)$r['early_min'] : null;
        return $r;
    }
}