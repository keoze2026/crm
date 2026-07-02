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

        // Answered/Missed/Counted are now keyed in directly on the Monthly Sheet and
        // stored on the buyer, so they come straight off the row (independent of call
        // records). The call_records join only feeds the records count / last activity;
        // the date range still scopes those.
        $join = 'LEFT JOIN call_records r ON r.buyer_id = b.id';
        if ($from) { $join .= ' AND r.record_date >= :from'; $params[':from'] = $from; }
        if ($to)   { $join .= ' AND r.record_date <= :to';   $params[':to']   = $to; }

        // Revenue is the buyer's definite rate * its stored counted calls.
        $sql = "
            SELECT b.id, b.code, b.name, b.status, b.notes, b.rate, b.created_at,
                   b.rate * b.counted                        AS revenue,
                   b.counted                                 AS counted,
                   b.answered                                AS answered,
                   b.missed                                  AS missed,
                   COUNT(r.id)                               AS records,
                   MAX(r.record_date)                        AS last_activity
            FROM buyers b
            $join
        ";
        if ($search) {
            $sql .= " WHERE b.code ILIKE :s OR b.name ILIKE :s";
            $params[':s'] = "%{$search}%";
        }
        $sql .= " GROUP BY b.id ORDER BY revenue DESC";

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
            'INSERT INTO buyers (code, name, status, notes, rate, answered, missed, counted)
             VALUES (:code, :name, :status, :notes, :rate, :answered, :missed, :counted) RETURNING *'
        );
        try {
            $stmt->execute([
                ':code'     => $code,
                ':name'     => $body['name']   ?? null,
                ':status'   => $body['status'] ?? 'active',
                ':notes'    => $body['notes']  ?? null,
                ':rate'     => isset($body['rate']) ? (float) $body['rate'] : 0,
                ':answered' => (int) ($body['answered'] ?? 0),
                ':missed'   => (int) ($body['missed']   ?? 0),
                ':counted'  => (int) ($body['counted']  ?? 0),
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
                notes = :notes,
                rate = COALESCE(:rate, rate),
                answered = COALESCE(:answered, answered),
                missed = COALESCE(:missed, missed),
                counted = COALESCE(:counted, counted)
             WHERE id = :id RETURNING *'
        );
        $stmt->execute([
            ':id'       => $id,
            ':code'     => $body['code']   ?? null,
            ':name'     => $body['name']   ?? null,
            ':status'   => $body['status'] ?? null,
            ':notes'    => $body['notes']  ?? null,
            ':rate'     => $rate,
            ':answered' => isset($body['answered']) ? (int) $body['answered'] : null,
            ':missed'   => isset($body['missed'])   ? (int) $body['missed']   : null,
            ':counted'  => isset($body['counted'])  ? (int) $body['counted']  : null,
        ]);
        $row = $stmt->fetch();
        if (!$row) {
            Http::error('Buyer not found', 404);
        }

        // Keep the definite rate in sync across this buyer's call records so the
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
            foreach (['revenue', 'counted', 'answered', 'missed', 'records', 'rate'] as $k) {
                if (array_key_exists($k, $r)) {
                    $r[$k] = (float) $r[$k];
                }
            }
        }
        return $rows;
    }
}
