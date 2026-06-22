<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Database;
use App\Http;

final class AttendanceController
{
    private const TZ          = 'America/New_York';
    private const BREAK_ALLOW = 60;

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
        $date = Http::query('date', (new \DateTime('now', new \DateTimeZone(self::TZ)))->format('Y-m-d'));
        $stmt = Database::connection()->prepare(
            "SELECT d.user_id::text, d.staff_name, d.username, d.work_date::text,
                    d.login_at, d.login_stated, d.logout_at, d.logout_stated,
                    (d.login_at IS NOT NULL) AS present,
                    (d.login_at IS NOT NULL AND d.logout_at IS NULL) AS still_in,
                    ROUND(EXTRACT(EPOCH FROM (d.logout_at - d.login_at)) / 3600.0, 2) AS hours,
                    COALESCE(b.break_min, 0) AS break_min,
                    COALESCE(b.break_count, 0) AS break_count,
                    COALESCE(b.break_detail, '') AS break_detail,
                    GREATEST(COALESCE(b.break_min, 0) - :allow, 0) AS over_break_min,
                    ROUND(EXTRACT(EPOCH FROM (d.logout_at - d.login_at)) / 3600.0 - COALESCE(b.break_min, 0) / 60.0, 2) AS net_hours
             FROM attendance_days d
             LEFT JOIN (
                 SELECT user_id, work_date,
                        SUM(duration_min) AS break_min,
                        COUNT(*) AS break_count,
                        STRING_AGG(duration_min::text, ', ' ORDER BY taken_at) AS break_detail
                 FROM attendance_breaks GROUP BY user_id, work_date
             ) b ON b.user_id = d.user_id AND b.work_date = d.work_date
             WHERE d.work_date = :date
             ORDER BY d.login_at NULLS LAST"
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
        $stmt = Database::connection()->prepare(
            "SELECT user_id::text, staff_name, username, login_at, login_stated
             FROM attendance_days
             WHERE work_date = (now() AT TIME ZONE :tz)::date
               AND login_at IS NOT NULL AND logout_at IS NULL
             ORDER BY login_at"
        );
        $stmt->execute([':tz' => self::TZ]);
        Http::json($stmt->fetchAll());
    }

    public function days(): void
    {
        $from   = Http::query('from', date('Y-m-d'));
        $to     = Http::query('to',   date('Y-m-d'));
        $userId = Http::query('user_id');
        $where  = ['d.work_date BETWEEN :from AND :to'];
        $params = [':from' => $from, ':to' => $to, ':allow' => self::BREAK_ALLOW];
        if ($userId) { $where[] = 'd.user_id = :uid'; $params[':uid'] = $userId; }

        $stmt = Database::connection()->prepare(
            "SELECT d.user_id::text, d.staff_name, d.username, d.work_date::text,
                    d.login_at, d.login_stated, d.logout_at, d.logout_stated,
                    ROUND(EXTRACT(EPOCH FROM (d.logout_at - d.login_at)) / 3600.0, 2) AS hours,
                    COALESCE(b.break_min, 0) AS break_min,
                    COALESCE(b.break_count, 0) AS break_count,
                    COALESCE(b.break_detail, '') AS break_detail,
                    GREATEST(COALESCE(b.break_min, 0) - :allow, 0) AS over_break_min,
                    ROUND(EXTRACT(EPOCH FROM (d.logout_at - d.login_at)) / 3600.0 - COALESCE(b.break_min, 0) / 60.0, 2) AS net_hours,
                    (d.logout_at IS NOT NULL) AS completed
             FROM attendance_days d
             LEFT JOIN (
                 SELECT user_id, work_date,
                        SUM(duration_min) AS break_min,
                        COUNT(*) AS break_count,
                        STRING_AGG(duration_min::text, ', ' ORDER BY taken_at) AS break_detail
                 FROM attendance_breaks GROUP BY user_id, work_date
             ) b ON b.user_id = d.user_id AND b.work_date = d.work_date
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
        $stmt = Database::connection()->prepare(
            "SELECT user_id::text, staff_name,
                    COUNT(*) FILTER (WHERE login_at IS NOT NULL) AS days_present,
                    COUNT(*) FILTER (WHERE login_at IS NOT NULL AND logout_at IS NOT NULL) AS days_complete,
                    ROUND(SUM(EXTRACT(EPOCH FROM (logout_at - login_at)) / 3600.0) FILTER (WHERE logout_at IS NOT NULL), 2) AS total_hours,
                    MIN(work_date)::text AS first_day, MAX(work_date)::text AS last_day
             FROM attendance_days WHERE work_date BETWEEN :from AND :to
             GROUP BY user_id, staff_name ORDER BY staff_name"
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
        $stmt = Database::connection()->prepare(
            "SELECT taken_at, duration_min, urgent, raw FROM attendance_breaks WHERE user_id = :uid AND work_date = :date ORDER BY taken_at"
        );
        $stmt->execute([':uid' => $userId, ':date' => $date]);
        $breaks = $stmt->fetchAll();
        foreach ($breaks as &$b) { $b['urgent'] = (bool)$b['urgent']; $b['duration_min'] = (int)$b['duration_min']; }
        Http::json(['userId' => $userId, 'date' => $date, 'allowanceMin' => self::BREAK_ALLOW, 'totalMin' => $totalMin, 'overMin' => max(0, $totalMin - self::BREAK_ALLOW), 'breaks' => $breaks]);
    }

    public function exceptions(): void
    {
        $type   = Http::query('type', 'missing_logout');
        $from   = Http::query('from', date('Y-m-01'));
        $to     = Http::query('to',   date('Y-m-d'));
        $tz     = self::TZ;
        $params = [':from' => $from, ':to' => $to];
        $sql = match($type) {
            'missing_logout' => "SELECT user_id::text, staff_name, work_date::text, login_at FROM attendance_days WHERE login_at IS NOT NULL AND logout_at IS NULL AND work_date < (now() AT TIME ZONE '{$tz}')::date AND work_date BETWEEN :from AND :to ORDER BY work_date DESC",
            'over_break'     => "SELECT user_id::text, staff_name, work_date::text, SUM(duration_min) AS break_min, SUM(duration_min) - 60 AS over_min FROM attendance_breaks WHERE work_date BETWEEN :from AND :to GROUP BY user_id, staff_name, work_date HAVING SUM(duration_min) > 60 ORDER BY over_min DESC",
            'late'           => "SELECT user_id::text, staff_name, work_date::text, (login_at AT TIME ZONE '{$tz}')::time::text AS local_login FROM attendance_days WHERE login_at IS NOT NULL AND (login_at AT TIME ZONE '{$tz}')::time > TIME '09:00' AND work_date BETWEEN :from AND :to ORDER BY work_date DESC",
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
        return $r;
    }
}