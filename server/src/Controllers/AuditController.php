<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Database;
use App\Http;

/**
 * Audit-log viewer + management for the admin "System Logs" page. Admin-only (enforced by the
 * router middleware on the /audit-logs prefix).
 */
final class AuditController
{
    /** GET /audit-logs — filtered, paginated audit rows (newest first). */
    public function index(): void
    {
        [$clause, $params] = $this->filters();
        $limit  = min(max((int) (Http::query('limit', '50')), 1), 500);
        $offset = max((int) (Http::query('offset', '0')), 0);

        $pdo = Database::connection();

        $countStmt = $pdo->prepare("SELECT count(*) FROM audit_log {$clause}");
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $sql = "SELECT id, user_id, user_email, action, method, path, entity_type, entity_id,
                       details, status_code, ip, user_agent, created_at
                FROM audit_log {$clause}
                ORDER BY created_at DESC, id DESC
                LIMIT :limit OFFSET :offset";
        $stmt = $pdo->prepare($sql);
        foreach ($params as $k => $v) {
            $stmt->bindValue($k, $v);
        }
        $stmt->bindValue(':limit', $limit, \PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, \PDO::PARAM_INT);
        $stmt->execute();

        $rows = array_map([$this, 'cast'], $stmt->fetchAll());
        Http::json(['rows' => $rows, 'total' => $total, 'limit' => $limit, 'offset' => $offset]);
    }

    /** GET /audit-logs/actions — distinct action values, for the filter dropdown. */
    public function actions(): void
    {
        $stmt = Database::connection()->query('SELECT DISTINCT action FROM audit_log ORDER BY action');
        Http::json($stmt->fetchAll(\PDO::FETCH_COLUMN));
    }

    /** GET /audit-logs/export — download the filtered logs as CSV. */
    public function export(): void
    {
        [$clause, $params] = $this->filters();
        $stmt = Database::connection()->prepare(
            "SELECT created_at, user_email, action, method, path, entity_type, entity_id,
                    status_code, ip, details
             FROM audit_log {$clause}
             ORDER BY created_at DESC, id DESC
             LIMIT 50000"
        );
        $stmt->execute($params);

        $header = ['Time', 'User', 'Action', 'Method', 'Path', 'Entity', 'Entity ID', 'Status', 'IP', 'Details'];
        $rows = (function () use ($stmt) {
            while ($r = $stmt->fetch()) {
                yield [
                    $r['created_at'], $r['user_email'], $r['action'], $r['method'], $r['path'],
                    $r['entity_type'], $r['entity_id'], $r['status_code'], $r['ip'], $r['details'],
                ];
            }
        })();

        Http::csv('system-logs-' . date('Y-m-d') . '.csv', $header, $rows);
    }

    /** DELETE /audit-logs/{id} — delete a single log entry. */
    public function destroy(array $params): void
    {
        $stmt = Database::connection()->prepare('DELETE FROM audit_log WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }

    /** DELETE /audit-logs — delete every log matching the current filters (all if none). */
    public function clear(): void
    {
        [$clause, $params] = $this->filters();
        $stmt = Database::connection()->prepare("DELETE FROM audit_log {$clause}");
        $stmt->execute($params);
        Http::json(['deleted' => $stmt->rowCount()]);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    /**
     * Build the shared WHERE clause + bound params from the query string.
     *
     * @return array{0:string, 1:array<string,mixed>}
     */
    private function filters(): array
    {
        $where  = [];
        $params = [];

        if ($v = Http::query('user_id'))     { $where[] = 'user_id = :uid';        $params[':uid']   = (int) $v; }
        if ($v = Http::query('action'))      { $where[] = 'action = :action';      $params[':action'] = $v; }
        if ($v = Http::query('entity_type')) { $where[] = 'entity_type = :etype';  $params[':etype'] = $v; }
        if ($v = Http::query('from'))        { $where[] = 'created_at >= :from';   $params[':from']  = $v; }
        if ($v = Http::query('to'))          { $where[] = 'created_at < (:to::date + 1)'; $params[':to'] = $v; }
        if ($v = Http::query('q')) {
            $where[] = '(user_email ILIKE :q OR action ILIKE :q OR path ILIKE :q)';
            $params[':q'] = "%{$v}%";
        }

        return [$where ? ('WHERE ' . implode(' AND ', $where)) : '', $params];
    }

    private function cast(array $r): array
    {
        $r['id']          = (int) $r['id'];
        $r['user_id']     = $r['user_id'] !== null ? (int) $r['user_id'] : null;
        $r['entity_id']   = $r['entity_id'] !== null ? (int) $r['entity_id'] : null;
        $r['status_code'] = $r['status_code'] !== null ? (int) $r['status_code'] : null;
        $r['details']     = $r['details'] !== null ? json_decode((string) $r['details'], true) : null;
        return $r;
    }
}
