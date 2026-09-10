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
                    GREATEST({$break} - :allow, 0) AS over_break_min,
                    ROUND(EXTRACT(EPOCH FROM ({$logout} - {$login})) / 3600.0 - {$break} / 60.0, 2) AS net_hours,
                    " . self::scheduleColumns() . "
             FROM attendance_days d
             LEFT JOIN (
                 SELECT user_id, work_date,
                        SUM(duration_min) AS break_min,
                        COUNT(*) AS break_count,
                        STRING_AGG(duration_min::text, ', ' ORDER BY taken_at) AS break_detail
                 FROM attendance_breaks GROUP BY user_id, work_date
             ) b ON b.user_id = d.user_id AND b.work_date = d.work_date
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
                    GREATEST({$break} - :allow, 0) AS over_break_min,
                    ROUND(EXTRACT(EPOCH FROM ({$logout} - {$login})) / 3600.0 - {$break} / 60.0, 2) AS net_hours,
                    ({$logout} IS NOT NULL) AS completed,
                    " . self::scheduleColumns() . "
             FROM attendance_days d
             LEFT JOIN (
                 SELECT user_id, work_date,
                        SUM(duration_min) AS break_min,
                        COUNT(*) AS break_count,
                        STRING_AGG(duration_min::text, ', ' ORDER BY taken_at) AS break_detail
                 FROM attendance_breaks GROUP BY user_id, work_date
             ) b ON b.user_id = d.user_id AND b.work_date = d.work_date
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
        $totStmt = Database::connection()->prepare(
            "SELECT COALESCE(SUM(duration_min), 0) FROM attendance_breaks WHERE user_id = :uid AND work_date = :date"
        );
        $totStmt->execute([':uid' => $userId, ':date' => $date]);
        $totalMin = (int) $totStmt->fetchColumn();

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
        $stmt = Database::connection()->prepare(
            "SELECT taken_at, duration_min, urgent, raw FROM attendance_breaks WHERE user_id = :uid AND work_date = :date ORDER BY taken_at"
        );
        $stmt->execute([':uid' => $userId, ':date' => $date]);
        $breaks = $stmt->fetchAll();
        foreach ($breaks as &$b) { $b['urgent'] = (bool)$b['urgent']; $b['duration_min'] = (int)$b['duration_min']; }
        Http::json(['userId' => $userId, 'date' => $date, 'allowanceMin' => self::BREAK_ALLOW, 'totalMin' => $totalMin, 'overMin' => max(0, $totalMin - self::BREAK_ALLOW), 'overridden' => $overridden, 'breaks' => $breaks]);
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