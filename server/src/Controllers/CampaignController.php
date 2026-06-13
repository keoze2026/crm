<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Database;
use App\Http;

final class CampaignController
{
    public function index(): void
    {
        $search = Http::query('search');
        $sql = "
            SELECT c.id, c.code, c.name, c.status, c.notes, c.created_at,
                   COALESCE(SUM(r.total_bill), 0)            AS cost,
                   COALESCE(SUM(r.counted), 0)               AS counted,
                   COALESCE(SUM(r.answered), 0)              AS answered,
                   COALESCE(SUM(r.missed), 0)                AS missed,
                   COUNT(r.id)                               AS records,
                   COUNT(DISTINCT r.source)                  AS sources,
                   MAX(r.record_date)                        AS last_activity
            FROM campaigns c
            LEFT JOIN call_records r ON r.campaign_id = c.id
        ";
        $params = [];
        if ($search) {
            $sql .= " WHERE c.code ILIKE :s OR c.name ILIKE :s";
            $params[':s'] = "%{$search}%";
        }
        $sql .= " GROUP BY c.id ORDER BY cost DESC";

        $stmt = Database::connection()->prepare($sql);
        $stmt->execute($params);
        Http::json($this->cast($stmt->fetchAll()));
    }

    public function store(): void
    {
        $body = Http::body();
        $code = trim((string) ($body['code'] ?? ''));
        if ($code === '') {
            Http::error('Campaign code is required', 422);
        }
        $stmt = Database::connection()->prepare(
            'INSERT INTO campaigns (code, name, status, notes)
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
            Http::error('A campaign with that code already exists', 409);
        }
        Http::json($stmt->fetch(), 201);
    }

    public function update(array $params): void
    {
        $body = Http::body();
        $stmt = Database::connection()->prepare(
            'UPDATE campaigns SET
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
        $row ? Http::json($row) : Http::error('Campaign not found', 404);
    }

    public function destroy(array $params): void
    {
        $stmt = Database::connection()->prepare('DELETE FROM campaigns WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }

    private function cast(array $rows): array
    {
        foreach ($rows as &$r) {
            foreach (['cost', 'counted', 'answered', 'missed', 'records', 'sources'] as $k) {
                $r[$k] = (float) $r[$k];
            }
        }
        return $rows;
    }
}
