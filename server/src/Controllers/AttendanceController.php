<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Database;
use App\Http;

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
     * A day the bot recorded can be corrected on the Staff page's attendance sheet. That
     * correction is a `staff_attendance` row and, where one exists, it REPLACES the day —
     * login, logout, break and status all come from it. These expressions are how this page
     * reads the same figures, so the two never disagree.
     *
     * Every query that reads a time or a break uses them with OVERRIDE_JOIN.
     */
    private const BREAK_MIN =
        "CASE WHEN o.id IS NOT NULL THEN COALESCE(o.break_min, 0) ELSE COALESCE(b.break_min, 0) END";

    /**
     * The override stores org-local clock times; `work_date + time AT TIME ZONE` lifts one
     * back to the timestamptz the rest of this controller works in.
     */
    private const LOGIN_AT =
        "CASE WHEN o.id IS NOT NULL
              THEN CASE WHEN o.login_at IS NULL THEN NULL
                        ELSE (d.work_date + o.login_at) AT TIME ZONE 'America/New_York' END
              ELSE d.login_at END";

    private const LOGOUT_AT =
        "CASE WHEN o.id IS NOT NULL
              THEN CASE WHEN o.logout_at IS NULL THEN NULL
                        ELSE (d.work_date + o.logout_at) AT TIME ZONE 'America/New_York' END
              ELSE d.logout_at END";

    /**
     * Reaches the override from the bot's side: day -> the staff member who checks in with
     * that account -> their row for the same date. LEFT JOINs throughout, so a day with no
     * staff member or no correction still comes back with the bot's own values.
     */
    private const OVERRIDE_JOIN =
        'LEFT JOIN staff so ON so.attendance_user_id = d.user_id::text
         LEFT JOIN staff_attendance o ON o.staff_id = so.id AND o.work_date = d.work_date';

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
     * is judged by the corrected figures rather than the bot's original ones.
     */
    private static function lateMin(): string
    {
        $login = self::LOGIN_AT;
        $tz    = self::TZ;
        return "CASE WHEN so.expected_login IS NULL OR ({$login}) IS NULL THEN NULL
                     ELSE GREATEST(0, ROUND(EXTRACT(EPOCH FROM
                          (({$login}) AT TIME ZONE '{$tz}')::time - so.expected_login) / 60.0))::int
                END";
    }

    private static function earlyMin(): string
    {
        $logout = self::LOGOUT_AT;
        $tz     = self::TZ;
        return "CASE WHEN so.expected_logout IS NULL OR ({$logout}) IS NULL THEN NULL
                     ELSE GREATEST(0, ROUND(EXTRACT(EPOCH FROM
                          so.expected_logout - (({$logout}) AT TIME ZONE '{$tz}')::time) / 60.0))::int
                END";
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
                    ({$login} IS NOT NULL) AS present,
                    ({$login} IS NOT NULL AND {$logout} IS NULL) AS still_in,
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
             FROM attendance_days d
             LEFT JOIN (" . self::breakDaySubquery() . ") b ON b.user_id = d.user_id AND b.work_date = d.work_date
             " . self::OVERRIDE_JOIN . "
             WHERE d.work_date = :date
             ORDER BY {$login} NULLS LAST"
        );
        $stmt->execute([':date' => $date, ':allow' => self::BREAK_ALLOW]);
        Http::json([
            'timezone'          => self::TZ,
            'breakAllowanceMin' => self::BREAK_ALLOW,
            'date'              => $date,
            'rows'              => array_map([$this, 'castDay'], $stmt->fetchAll()),
        ]);
    }

    public function live(): void
    {
        $login  = self::LOGIN_AT;
        $logout = self::LOGOUT_AT;
        $stmt   = Database::connection()->prepare(
            "SELECT d.user_id::text, d.staff_name, d.username,
                    {$login} AS login_at, d.login_stated,
                    " . self::scheduleColumns() . "
             FROM attendance_days d
             " . self::OVERRIDE_JOIN . "
             WHERE d.work_date = (now() AT TIME ZONE :tz)::date
               AND {$login} IS NOT NULL AND {$logout} IS NULL
             ORDER BY {$login}"
        );
        $stmt->execute([':tz' => self::TZ]);
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
        if ($userId) { $where[] = 'd.user_id = :uid'; $params[':uid'] = $userId; }

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
                    " . self::scheduleColumns() . "
             FROM attendance_days d
             LEFT JOIN (" . self::breakDaySubquery() . ") b ON b.user_id = d.user_id AND b.work_date = d.work_date
             " . self::OVERRIDE_JOIN . "
             WHERE " . implode(' AND ', $where) . "
             ORDER BY d.work_date DESC, d.staff_name"
        );
        $stmt->execute($params);
        Http::json([
            'timezone'          => self::TZ,
            'breakAllowanceMin' => self::BREAK_ALLOW,
            'rows'              => array_map([$this, 'castDay'], $stmt->fetchAll()),
        ]);
    }

    public function summary(): void
    {
        $from = Http::query('from', date('Y-m-01'));
        $to   = Http::query('to',   date('Y-m-d'));
        $login  = self::LOGIN_AT;
        $logout = self::LOGOUT_AT;
        $stmt   = Database::connection()->prepare(
            "SELECT d.user_id::text, d.staff_name,
                    COUNT(*) FILTER (WHERE {$login} IS NOT NULL) AS days_present,
                    COUNT(*) FILTER (WHERE {$login} IS NOT NULL AND {$logout} IS NOT NULL) AS days_complete,
                    ROUND(SUM(EXTRACT(EPOCH FROM ({$logout} - {$login})) / 3600.0)
                          FILTER (WHERE {$logout} IS NOT NULL), 2) AS total_hours,
                    MIN(d.work_date)::text AS first_day, MAX(d.work_date)::text AS last_day
             FROM attendance_days d
             " . self::OVERRIDE_JOIN . "
             WHERE d.work_date BETWEEN :from AND :to
             GROUP BY d.user_id, d.staff_name ORDER BY d.staff_name"
        );
        $stmt->execute([':from' => $from, ':to' => $to]);
        Http::json($stmt->fetchAll());
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

        $sql = match($type) {
            'missing_logout' => "SELECT d.user_id::text, d.staff_name, d.work_date::text,
                                        {$login} AS login_at
                                   FROM attendance_days d {$join}
                                  WHERE {$login} IS NOT NULL AND {$logout} IS NULL
                                    AND d.work_date < (now() AT TIME ZONE '{$tz}')::date
                                    AND d.work_date BETWEEN :from AND :to
                                  ORDER BY d.work_date DESC",
            'over_break'     => "SELECT d.user_id::text, d.staff_name, d.work_date::text,
                                        {$break} AS break_min,
                                        {$break} - {$allow} AS over_min
                                   FROM attendance_days d
                              LEFT JOIN (
                                        SELECT user_id, work_date, SUM(duration_min) AS break_min
                                          FROM attendance_breaks GROUP BY user_id, work_date
                                   ) b ON b.user_id = d.user_id AND b.work_date = d.work_date
                                   {$join}
                                  WHERE d.work_date BETWEEN :from AND :to
                                    AND {$break} > {$allow}
                                  ORDER BY over_min DESC",
            // Late is measured against the person's own expected login from the Staff page.
            // Anyone with no schedule set keeps the flat 9:00 this report has always used,
            // so it never silently empties out as schedules are filled in one by one.
            'late'           => "SELECT d.user_id::text, d.staff_name, d.work_date::text,
                                        ({$login} AT TIME ZONE '{$tz}')::time::text AS local_login,
                                        to_char(COALESCE(so.expected_login, TIME '09:00'), 'HH24:MI') AS expected_login,
                                        GREATEST(0, ROUND(EXTRACT(EPOCH FROM
                                            (({$login}) AT TIME ZONE '{$tz}')::time
                                            - COALESCE(so.expected_login, TIME '09:00')) / 60.0))::int AS late_min
                                   FROM attendance_days d {$join}
                                  WHERE {$login} IS NOT NULL
                                    AND ({$login} AT TIME ZONE '{$tz}')::time
                                        > COALESCE(so.expected_login, TIME '09:00')
                                    AND d.work_date BETWEEN :from AND :to
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