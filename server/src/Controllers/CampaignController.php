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
        $from   = Http::query('from');
        $to     = Http::query('to');

        // Date filter goes in the LEFT JOIN's ON clause (not WHERE) so campaigns
        // with no records in the range still appear, just with zeroed totals.
        $joinConds = ['r.campaign_id = c.id'];
        $params = [];
        if ($from) { $joinConds[] = 'r.record_date >= :from'; $params[':from'] = $from; }
        if ($to)   { $joinConds[] = 'r.record_date <= :to';   $params[':to']   = $to; }
        $joinOn = implode(' AND ', $joinConds);

        // Answered/Missed/Counted and the Total Bill (`cost`) are now keyed in directly
        // on the Monthly Sheet and stored on the campaign, so they come straight off the
        // row (independent of call records). The join only feeds the records/sources
        // counts + last activity; the date range still scopes those.
        $sql = "
            SELECT c.id, c.code, c.name, c.status, c.notes, c.created_at,
                   c.cost                                    AS cost,
                   c.counted                                 AS counted,
                   c.answered                                AS answered,
                   c.missed                                  AS missed,
                   COUNT(r.id)                               AS records,
                   COUNT(DISTINCT r.source)                  AS sources,
                   MAX(r.record_date)                        AS last_activity
            FROM campaigns c
            LEFT JOIN call_records r ON {$joinOn}
        ";
        if ($search) {
            $sql .= " WHERE c.code ILIKE :s OR c.name ILIKE :s";
            $params[':s'] = "%{$search}%";
        }
        $sql .= " GROUP BY c.id ORDER BY cost DESC";

        $stmt = Database::connection()->prepare($sql);
        $stmt->execute($params);
        Http::json($this->cast($stmt->fetchAll()));
    }

    /**
     * The sources (destinations) used by a campaign, each with its current definite
     * rate and volume. Powers the "Edit source rates" panel on the Campaigns tab, so
     * a campaign with varying rates (e.g. C-03 = 48/48/47/46/46) can be tuned per source.
     */
    public function sources(array $params): void
    {
        // Sources come from the destinations linked to this campaign, so the rates are
        // always listed and editable even when the campaign has no call records yet.
        $sql = "
            SELECT d.id AS destination_id,
                   d.name                         AS name,
                   d.rate                         AS rate,
                   COALESCE(SUM(r.counted), 0)    AS counted,
                   COALESCE(SUM(r.total_bill), 0) AS cost
            FROM destinations d
            LEFT JOIN call_records r
                   ON r.record_type = 'campaign'
                  AND r.campaign_id = d.campaign_id
                  AND r.source = d.name
            WHERE d.campaign_id = :id
            GROUP BY d.id, d.name, d.rate
            ORDER BY cost DESC, d.name
        ";
        $stmt = Database::connection()->prepare($sql);
        $stmt->execute([':id' => (int) $params['id']]);

        $rows = $stmt->fetchAll();
        foreach ($rows as &$row) {
            $row['destination_id'] = $row['destination_id'] !== null ? (int) $row['destination_id'] : null;
            $row['rate']    = (float) $row['rate'];
            $row['counted'] = (float) $row['counted'];
            $row['cost']    = (float) $row['cost'];
        }
        Http::json($rows);
    }

    public function store(): void
    {
        $body = Http::body();
        $code = trim((string) ($body['code'] ?? ''));
        if ($code === '') {
            Http::error('Campaign code is required', 422);
        }
        $stmt = Database::connection()->prepare(
            'INSERT INTO campaigns (code, name, status, notes, answered, missed, counted, cost)
             VALUES (:code, :name, :status, :notes, :answered, :missed, :counted, :cost) RETURNING *'
        );
        try {
            $stmt->execute([
                ':code'     => $code,
                ':name'     => $body['name']   ?? null,
                ':status'   => $body['status'] ?? 'active',
                ':notes'    => $body['notes']  ?? null,
                ':answered' => (int) ($body['answered'] ?? 0),
                ':missed'   => (int) ($body['missed']   ?? 0),
                ':counted'  => (int) ($body['counted']  ?? 0),
                ':cost'     => isset($body['cost']) ? (float) $body['cost'] : 0,
            ]);
        } catch (\PDOException $e) {
            Http::error('A campaign with that code already exists', 409);
        }
        Http::json($this->cast([$stmt->fetch()])[0], 201);
    }

    public function update(array $params): void
    {
        $body = Http::body();
        $stmt = Database::connection()->prepare(
            'UPDATE campaigns SET
                code = COALESCE(:code, code),
                name = :name,
                status = COALESCE(:status, status),
                notes = :notes,
                answered = COALESCE(:answered, answered),
                missed = COALESCE(:missed, missed),
                counted = COALESCE(:counted, counted),
                cost = COALESCE(:cost, cost)
             WHERE id = :id RETURNING *'
        );
        $stmt->execute([
            ':id'       => (int) $params['id'],
            ':code'     => $body['code']   ?? null,
            ':name'     => $body['name']   ?? null,
            ':status'   => $body['status'] ?? null,
            ':notes'    => $body['notes']  ?? null,
            ':answered' => isset($body['answered']) ? (int) $body['answered'] : null,
            ':missed'   => isset($body['missed'])   ? (int) $body['missed']   : null,
            ':counted'  => isset($body['counted'])  ? (int) $body['counted']  : null,
            ':cost'     => isset($body['cost'])     ? (float) $body['cost']   : null,
        ]);
        $row = $stmt->fetch();
        $row ? Http::json($this->cast([$row])[0]) : Http::error('Campaign not found', 404);
    }

    public function destroy(array $params): void
    {
        $id  = (int) $params['id'];
        $pdo = Database::connection();
        // Remove this campaign's sources too (no FK cascade on the link column).
        $pdo->prepare('DELETE FROM destinations WHERE campaign_id = :id')->execute([':id' => $id]);
        $stmt = $pdo->prepare('DELETE FROM campaigns WHERE id = :id');
        $stmt->execute([':id' => $id]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }

    private function cast(array $rows): array
    {
        foreach ($rows as &$r) {
            if (!$r) {
                continue;
            }
            foreach (['cost', 'counted', 'answered', 'missed', 'records', 'sources'] as $k) {
                if (array_key_exists($k, $r)) {
                    $r[$k] = (float) $r[$k];
                }
            }
        }
        return $rows;
    }
}
