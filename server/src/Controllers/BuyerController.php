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
        $sql = "
            SELECT b.id, b.code, b.name, b.status, b.notes, b.created_at,
                   COALESCE(SUM(r.total_bill), 0)            AS revenue,
                   COALESCE(SUM(r.counted), 0)               AS counted,
                   COALESCE(SUM(r.answered), 0)              AS answered,
                   COALESCE(SUM(r.missed), 0)                AS missed,
                   COUNT(r.id)                               AS records,
                   MAX(r.record_date)                        AS last_activity
            FROM buyers b
            LEFT JOIN call_records r ON r.buyer_id = b.id
        ";
        $params = [];
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
            'INSERT INTO buyers (code, name, status, notes)
             VALUES (:code, :name, :status, :notes) RETURNING *'
        );
        try {
            $stmt->execute([
                ':code'   => $code,
                ':name'   => $body['name']   ?? null,
                ':status' => $body['status'] ?? 'active',
                ':notes'  => $body['notes']  ?? null,
            ]);
        } catch (\PDOException $e) {
            Http::error('A buyer with that code already exists', 409);
        }
        Http::json($stmt->fetch(), 201);
    }

    public function update(array $params): void
    {
        $body = Http::body();
        $stmt = Database::connection()->prepare(
            'UPDATE buyers SET
                code = COALESCE(:code, code),
                name = :name,
                status = COALESCE(:status, status),
                notes = :notes
             WHERE id = :id RETURNING *'
        );
        $stmt->execute([
            ':id'     => (int) $params['id'],
            ':code'   => $body['code']   ?? null,
            ':name'   => $body['name']   ?? null,
            ':status' => $body['status'] ?? null,
            ':notes'  => $body['notes']  ?? null,
        ]);
        $row = $stmt->fetch();
        $row ? Http::json($row) : Http::error('Buyer not found', 404);
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
            foreach (['revenue', 'counted', 'answered', 'missed', 'records'] as $k) {
                $r[$k] = (float) $r[$k];
            }
        }
        return $rows;
    }
}
