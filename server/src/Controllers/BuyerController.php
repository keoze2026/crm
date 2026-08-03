<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Database;
use App\Http;
use PDO;

final class BuyerController
{
    public function index(): void
    {
        $search = Http::query('search');
        $from   = Http::query('from');
        $to     = Http::query('to');
        $params = [];

        // "Total Leads Bought" (counted) always auto-populates from the leads records —
        // the SUM of counted within the selected date range — so it changes as the date
        // range changes. record_days = how many days that buyer has records in the range,
        // used for the Average Leads a Day column (N/A when 0). The range scopes the join.
        //
        // Weekends (Sat/Sun) are NOT working days, so they are excluded entirely: no
        // weekend record contributes to the totals, and weekend dates don't count toward
        // record_days. Postgres EXTRACT(DOW) is 0=Sun .. 6=Sat, so 1..5 = Mon..Fri.
        $join = 'LEFT JOIN call_records r ON r.buyer_id = b.id AND EXTRACT(DOW FROM r.record_date) BETWEEN 1 AND 5';
        if ($from) { $join .= ' AND r.record_date >= :from'; $params[':from'] = $from; }
        if ($to)   { $join .= ' AND r.record_date <= :to';   $params[':to']   = $to; }

        $counted = 'COALESCE(SUM(r.counted), 0)';
        $sql = "
            SELECT b.id, b.code, b.name, b.status, b.notes, b.rate, b.created_at,
                   {$counted}                                AS counted,
                   b.rate * {$counted}                       AS revenue,
                   COALESCE(SUM(r.answered), 0)              AS answered,
                   COALESCE(SUM(r.missed), 0)                AS missed,
                   COUNT(DISTINCT r.record_date)             AS record_days,
                   COUNT(r.id)                               AS records,
                   MAX(r.record_date)                        AS last_activity
            FROM buyers b
            $join
        ";
        if ($search) {
            $sql .= " WHERE b.code ILIKE :s OR b.name ILIKE :s";
            $params[':s'] = "%{$search}%";
        }
        $sql .= " GROUP BY b.id ORDER BY counted DESC";

        $stmt = Database::connection()->prepare($sql);
        $stmt->execute($params);
        Http::json($this->cast($stmt->fetchAll()));
    }

    public function store(): void
    {
        $body = Http::body();
        $code = trim((string) ($body['code'] ?? ''));
        if ($code === '') {
            Http::error('Buyer code is required', 422);
        }
        $stmt = Database::connection()->prepare(
            'INSERT INTO buyers (code, name, status, notes, rate)
             VALUES (:code, :name, :status, :notes, :rate) RETURNING *'
        );
        try {
            $stmt->execute([
                ':code'   => $code,
                ':name'   => $body['name']   ?? null,
                ':status' => $body['status'] ?? 'active',
                ':notes'  => $body['notes']  ?? null,
                ':rate'   => isset($body['rate']) ? (float) $body['rate'] : 0,
            ]);
        } catch (\PDOException $e) {
            Http::error('A buyer with that code already exists', 409);
        }
        Http::json($this->cast([$stmt->fetch()])[0], 201);
    }

    public function update(array $params): void
    {
        $body = Http::body();
        $id   = (int) $params['id'];
        $rate = isset($body['rate']) ? (float) $body['rate'] : null;
        $pdo  = Database::connection();

        $stmt = $pdo->prepare(
            'UPDATE buyers SET
                code = COALESCE(:code, code),
                name = :name,
                status = COALESCE(:status, status),
                notes = COALESCE(:notes, notes),
                rate = COALESCE(:rate, rate)
             WHERE id = :id RETURNING *'
        );
        $stmt->execute([
            ':id'     => $id,
            ':code'   => $body['code']   ?? null,
            ':name'   => $body['name']   ?? null,
            ':status' => $body['status'] ?? null,
            ':notes'  => $body['notes']  ?? null,
            ':rate'   => $rate,
        ]);
        $row = $stmt->fetch();
        if (!$row) {
            Http::error('Buyer not found', 404);
        }

        // Keep the definite rate in sync across this buyer's Lead records so the
        // stored total_bill (counted * rate) stays exactly rate * counted.
        if ($rate !== null) {
            $re = $pdo->prepare('UPDATE call_records SET rate = :r, updated_at = now() WHERE buyer_id = :id');
            $re->execute([':r' => $rate, ':id' => $id]);
        }

        Http::json($this->cast([$row])[0]);
    }

    public function destroy(array $params): void
    {
        $stmt = Database::connection()->prepare('DELETE FROM buyers WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }

    private function cast(array $rows): array
    {
        foreach ($rows as &$r) {
            if (!$r) {
                continue;
            }
            foreach (['revenue', 'counted', 'answered', 'missed', 'record_days', 'records', 'rate'] as $k) {
                if (array_key_exists($k, $r)) {
                    $r[$k] = (float) $r[$k];
                }
            }
        }
        return $rows;
    }
}
