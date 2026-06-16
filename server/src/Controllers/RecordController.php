<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Database;
use App\Http;
use App\RecordFilter;
use PDO;

final class RecordController
{
    private const SELECT = "
        SELECT r.id, r.record_date, r.record_type,
               r.buyer_id, b.code AS buyer_code,
               r.campaign_id, c.code AS campaign_code, r.source,
               r.answered, r.missed, r.counted, r.rate, r.total_bill
        FROM call_records r
        LEFT JOIN buyers b    ON b.id = r.buyer_id
        LEFT JOIN campaigns c ON c.id = r.campaign_id
    ";

    public function index(): void
    {
        [$where, $params] = RecordFilter::build();

        // Sorting (whitelisted).
        $sortMap = [
            'record_date' => 'r.record_date',
            'total_bill'  => 'r.total_bill',
            'counted'     => 'r.counted',
            'answered'    => 'r.answered',
            'missed'      => 'r.missed',
        ];
        $sort = $sortMap[Http::query('sort', 'total_bill')] ?? 'r.total_bill';
        $dir = strtolower((string) Http::query('dir', 'desc')) === 'asc' ? 'ASC' : 'DESC';

        $page = max(1, (int) Http::query('page', '1'));
        $perPage = min(9999, max(1, (int) Http::query('per_page', '35')));
        $offset = ($page - 1) * $perPage;

        $pdo = Database::connection();

        $countStmt = $pdo->prepare("SELECT COUNT(*) FROM call_records r
            LEFT JOIN buyers b ON b.id = r.buyer_id
            LEFT JOIN campaigns c ON c.id = r.campaign_id {$where}");
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $stmt = $pdo->prepare(self::SELECT . " {$where} ORDER BY {$sort} {$dir}, r.id DESC LIMIT {$perPage} OFFSET {$offset}");
        $stmt->execute($params);

        Http::json([
            'data' => $this->cast($stmt->fetchAll()),
            'meta' => [
                'page' => $page,
                'per_page' => $perPage,
                'total' => $total,
                'pages' => (int) ceil($total / $perPage),
            ],
        ]);
    }

    public function store(): void
    {
        $body = Http::body();
        $type = $body['record_type'] ?? null;
        if (!in_array($type, ['buyer', 'campaign'], true)) {
            Http::error('record_type must be "buyer" or "campaign"', 422);
        }
        $date = $body['record_date'] ?? null;
        if (!$date) {
            Http::error('record_date is required', 422);
        }

        $pdo = Database::connection();
        $buyerId = $campaignId = $source = null;

        if ($type === 'buyer') {
            $buyerId = $this->resolveId($pdo, 'buyers', $body['buyer_id'] ?? null, $body['buyer_code'] ?? null);
            if (!$buyerId) {
                Http::error('A buyer is required for buyer records', 422);
            }
        } else {
            $campaignId = $this->resolveId($pdo, 'campaigns', $body['campaign_id'] ?? null, $body['campaign_code'] ?? null);
            if (!$campaignId) {
                Http::error('A campaign is required for campaign records', 422);
            }
            $source = $body['source'] ?? null;
        }

        $stmt = $pdo->prepare(
            'INSERT INTO call_records
                (record_date, record_type, buyer_id, campaign_id, source, answered, missed, counted, rate)
             VALUES (:d, :t, :bid, :cid, :src, :a, :m, :c, :r) RETURNING id'
        );
        $stmt->execute([
            ':d' => $date, ':t' => $type, ':bid' => $buyerId, ':cid' => $campaignId, ':src' => $source,
            ':a' => (int) ($body['answered'] ?? 0),
            ':m' => (int) ($body['missed'] ?? 0),
            ':c' => (int) ($body['counted'] ?? 0),
            ':r' => (float) ($body['rate'] ?? 0),
        ]);
        $this->respondOne($pdo, (int) $stmt->fetchColumn(), 201);
    }

    public function update(array $params): void
    {
        $body = Http::body();
        $pdo = Database::connection();
        $id = (int) $params['id'];

        $stmt = $pdo->prepare(
            'UPDATE call_records SET
                record_date = COALESCE(:d, record_date),
                source      = COALESCE(:src, source),
                answered    = COALESCE(:a, answered),
                missed      = COALESCE(:m, missed),
                counted     = COALESCE(:c, counted),
                rate        = COALESCE(:r, rate),
                updated_at  = now()
             WHERE id = :id'
        );
        $stmt->execute([
            ':id'  => $id,
            ':d'   => $body['record_date'] ?? null,
            ':src' => $body['source'] ?? null,
            ':a'   => isset($body['answered']) ? (int) $body['answered'] : null,
            ':m'   => isset($body['missed'])   ? (int) $body['missed']   : null,
            ':c'   => isset($body['counted'])  ? (int) $body['counted']  : null,
            ':r'   => isset($body['rate'])     ? (float) $body['rate']    : null,
        ]);
        if ($stmt->rowCount() === 0) {
            Http::error('Record not found', 404);
        }
        $this->respondOne($pdo, $id);
    }

    public function destroy(array $params): void
    {
        $stmt = Database::connection()->prepare('DELETE FROM call_records WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }

    public function export(): void
    {
        [$where, $params] = RecordFilter::build();
        $stmt = Database::connection()->prepare(self::SELECT . " {$where} ORDER BY r.total_bill DESC, r.id DESC");
        $stmt->execute($params);

        $rows = (function () use ($stmt) {
            while ($r = $stmt->fetch()) {
                yield [
                    $r['record_date'],
                    $r['record_type'],
                    $r['buyer_code'] ?? '',
                    $r['campaign_code'] ?? '',
                    $r['answered'],
                    $r['missed'],
                    $r['counted'],
                    number_format((float) $r['rate'], 2, '.', ''),
                    number_format((float) $r['total_bill'], 2, '.', ''),
                ];
            }
        })();

        Http::csv(
            'call-records.csv',
            ['Date', 'Type', 'Buyer', 'Campaign', 'Answered', 'Missed', 'Counted', 'Rate', 'Total Bill'],
            $rows
        );
    }

    /** Resolve an entity id from an explicit id, or find-or-create by code. */
    private function resolveId(PDO $pdo, string $table, mixed $id, mixed $code): ?int
    {
        if ($id) {
            return (int) $id;
        }
        $code = trim((string) ($code ?? ''));
        if ($code === '') {
            return null;
        }
        $find = $pdo->prepare("SELECT id FROM {$table} WHERE code = :code");
        $find->execute([':code' => $code]);
        if ($existing = $find->fetchColumn()) {
            return (int) $existing;
        }
        $ins = $pdo->prepare("INSERT INTO {$table} (code) VALUES (:code) RETURNING id");
        $ins->execute([':code' => $code]);
        return (int) $ins->fetchColumn();
    }

    private function respondOne(PDO $pdo, int $id, int $status = 200): void
    {
        $stmt = $pdo->prepare(self::SELECT . ' WHERE r.id = :id');
        $stmt->execute([':id' => $id]);
        Http::json($this->cast([$stmt->fetch()])[0], $status);
    }

    private function cast(array $rows): array
    {
        foreach ($rows as &$r) {
            if (!$r) {
                continue;
            }
            $r['answered']   = (int) $r['answered'];
            $r['missed']     = (int) $r['missed'];
            $r['counted']    = (int) $r['counted'];
            $r['rate']       = (float) $r['rate'];
            $r['total_bill'] = round((float) $r['total_bill']);
            $r['buyer_id']   = $r['buyer_id'] !== null ? (int) $r['buyer_id'] : null;
            $r['campaign_id'] = $r['campaign_id'] !== null ? (int) $r['campaign_id'] : null;
        }
        return $rows;
    }
}