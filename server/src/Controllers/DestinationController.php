<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Database;
use App\Http;

final class DestinationController
{
    public function index(): void
    {
        $search = Http::query('search');
        $sql = 'SELECT id, name, status, rate, created_at FROM destinations';

        $params = [];
        if ($search) {
            $sql .= ' WHERE name ILIKE :s';
            $params[':s'] = "%{$search}%";
        }
        $sql .= ' ORDER BY name ASC';
        $stmt = Database::connection()->prepare($sql);
        $stmt->execute($params);
        Http::json($this->cast($stmt->fetchAll()));
    }

    public function store(): void
    {
        $body = Http::body();
        $name = trim((string) ($body['name'] ?? ''));
        if ($name === '') {
            Http::error('Destination name is required', 422);
        }
        $stmt = Database::connection()->prepare(
            'INSERT INTO destinations (name, status, rate) VALUES (:name, :status, :rate) RETURNING *'
        );
        try {
            $stmt->execute([
                ':name'   => $name,
                ':status' => $body['status'] ?? 'active',
                ':rate'   => isset($body['rate']) ? (float) $body['rate'] : 0,
            ]);
        } catch (\PDOException) {
            Http::error('A destination with that name already exists', 409);
        }
        Http::json($this->cast([$stmt->fetch()])[0], 201);
    }

    public function update(array $params): void
    {
        $body = Http::body();
        $rate = isset($body['rate']) ? (float) $body['rate'] : null;
        $pdo  = Database::connection();

        $stmt = $pdo->prepare(
            'UPDATE destinations SET
                name   = COALESCE(:name, name),
                status = COALESCE(:status, status),
                rate   = COALESCE(:rate, rate)
             WHERE id = :id RETURNING *'
        );
        $stmt->execute([
            ':id'     => (int) $params['id'],
            ':name'   => $body['name']   ?? null,
            ':status' => $body['status'] ?? null,
            ':rate'   => $rate,
        ]);
        $row = $stmt->fetch();
        if (!$row) {
            Http::error('Destination not found', 404);
        }

        // When a source's rate changes, re-stamp its cost records so the campaign
        // cost (SUM of total_bill) reflects the new rate.
        if ($rate !== null) {
            $re = $pdo->prepare(
                "UPDATE call_records SET rate = :r, updated_at = now()
                 WHERE record_type = 'campaign' AND source = :name"
            );
            $re->execute([':r' => $rate, ':name' => $row['name']]);
        }

        Http::json($this->cast([$row])[0]);
    }

    private function cast(array $rows): array
    {
        foreach ($rows as &$r) {
            if ($r && array_key_exists('rate', $r)) {
                $r['rate'] = (float) $r['rate'];
            }
        }
        return $rows;
    }

    public function destroy(array $params): void
    {
        $stmt = Database::connection()->prepare('DELETE FROM destinations WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }
}