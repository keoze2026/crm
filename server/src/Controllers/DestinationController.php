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
        $sql = 'SELECT id, name, status, created_at FROM destinations';
        
        $params = [];
        if ($search) {
            $sql .= ' WHERE name ILIKE :s';
            $params[':s'] = "%{$search}%";
        }
        $sql .= ' ORDER BY name ASC';
        $stmt = Database::connection()->prepare($sql);
        $stmt->execute($params);
        Http::json($stmt->fetchAll());
    }

    public function store(): void
    {
        $body = Http::body();
        $name = trim((string) ($body['name'] ?? ''));
        if ($name === '') {
            Http::error('Destination name is required', 422);
        }
        $stmt = Database::connection()->prepare(
            'INSERT INTO destinations (name, status) VALUES (:name, :status) RETURNING *'
        );
        try {
            $stmt->execute([
                ':name'   => $name,
                ':status' => $body['status'] ?? 'active',
            ]);
        } catch (\PDOException) {
            Http::error('A destination with that name already exists', 409);
        }
        Http::json($stmt->fetch(), 201);
    }

    public function update(array $params): void
    {
        $body = Http::body();
        $stmt = Database::connection()->prepare(
            'UPDATE destinations SET
                name   = COALESCE(:name, name),
                status = COALESCE(:status, status)
             WHERE id = :id RETURNING *'
        );
        $stmt->execute([
            ':id'     => (int) $params['id'],
            ':name'   => $body['name']   ?? null,
            ':status' => $body['status'] ?? null,
        ]);
        $row = $stmt->fetch();
        $row ? Http::json($row) : Http::error('Destination not found', 404);
    }

    public function destroy(array $params): void
    {
        $stmt = Database::connection()->prepare('DELETE FROM destinations WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }
}