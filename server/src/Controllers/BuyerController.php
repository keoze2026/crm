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
        $code = isset($body['code']) ? trim((string) $body['code']) : null;
        if ($code === '') {
            Http::error('Buyer code is required', 422);
        }
        $pdo = Database::connection();

        $current = $pdo->prepare('SELECT rate FROM buyers WHERE id = :id');
        $current->execute([':id' => $id]);
        $oldRate = $current->fetchColumn();
        if ($oldRate === false) {
            Http::error('Buyer not found', 404);
        }

        // A code names one buyer whatever its case: "test" and "TEST" are the same
        // destination. Renaming onto another buyer's code is refused (409) unless the
        // caller asks to merge, which moves that buyer's records onto this one — each
        // record keeps its own date, volumes and rate, so no record or amount is lost —
        // and only then drops the emptied buyer (deleting it first would cascade them away).
        $twins = [];
        if ($code !== null) {
            $find = $pdo->prepare('SELECT id FROM buyers WHERE LOWER(code) = LOWER(:code) AND id <> :id');
            $find->execute([':code' => $code, ':id' => $id]);
            $twins = array_map('intval', $find->fetchAll(PDO::FETCH_COLUMN));
            if ($twins && empty($body['merge'])) {
                Http::error('A buyer with that code already exists', 409, ['merge' => true]);
            }
        }

        $pdo->beginTransaction();
        try {
            if ($twins) {
                $in = implode(',', $twins);
                $pdo->exec("UPDATE call_records SET buyer_id = {$id}, updated_at = now() WHERE buyer_id IN ({$in})");
                $pdo->exec("DELETE FROM buyers WHERE id IN ({$in})");
            }

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
                ':code'   => $code,
                ':name'   => $body['name']   ?? null,
                ':status' => $body['status'] ?? null,
                ':notes'  => $body['notes']  ?? null,
                ':rate'   => $rate,
            ]);
            $row = $stmt->fetch();

            // Keep the definite rate in sync across this buyer's Lead records so the
            // stored total_bill (counted * rate) stays exactly rate * counted. Only an
            // actual rate change re-prices them: the Monthly Sheet resends the rate with
            // a rename, which must not overwrite per-record rates (or a merged buyer's).
            if ($rate !== null && $rate !== (float) $oldRate) {
                $re = $pdo->prepare('UPDATE call_records SET rate = :r, updated_at = now() WHERE buyer_id = :id');
                $re->execute([':r' => $rate, ':id' => $id]);
            }
            $pdo->commit();
        } catch (\PDOException $e) {
            $pdo->rollBack();
            if ($e->getCode() !== '23505') {
                throw $e;
            }
            Http::error('A buyer with that code already exists', 409);
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
