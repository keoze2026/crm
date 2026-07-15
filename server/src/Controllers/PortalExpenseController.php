<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Database;
use App\Http;

/**
 * Monthly portal (provider) expenses — the CRUD behind the Portal Expenses page.
 *
 * A row is one provider's expenses for one month. `month` is normalised to the first
 * day of the month (YYYY-MM-01) both on read (query) and write, so "?month=2026-03"
 * and "?month=2026-03-17" both resolve to the March bucket.
 */
final class PortalExpenseController
{
    public function index(): void
    {
        $month = $this->normaliseMonth(Http::query('month'));

        $sql = 'SELECT id, to_char(month, \'YYYY-MM-DD\') AS month, name,
                       voice_minutes, rejected_calls, rent_values, payout_expenses, total_amount,
                       sort_order, created_at, updated_at
                  FROM portal_expenses';
        $params = [];
        if ($month !== null) {
            $sql .= ' WHERE month = :month';
            $params[':month'] = $month;
        }
        $sql .= ' ORDER BY sort_order ASC, id ASC';

        $stmt = Database::connection()->prepare($sql);
        $stmt->execute($params);
        Http::json($this->cast($stmt->fetchAll()));
    }

    public function store(): void
    {
        $body  = Http::body();
        $month = $this->normaliseMonth($body['month'] ?? null);
        $name  = trim((string) ($body['name'] ?? ''));
        if ($month === null) {
            Http::error('A valid month is required', 422);
        }
        if ($name === '') {
            Http::error('Name is required', 422);
        }

        // Default the sort_order to the end of the month's list when none supplied.
        $sortOrder = isset($body['sort_order'])
            ? (int) $body['sort_order']
            : $this->nextSortOrder($month);

        $stmt = Database::connection()->prepare(
            'INSERT INTO portal_expenses
                (month, name, voice_minutes, rejected_calls, rent_values, payout_expenses, total_amount, sort_order)
             VALUES (:month, :name, :vm, :rc, :rv, :payout, :total, :sort)
             RETURNING id, to_char(month, \'YYYY-MM-DD\') AS month, name,
                       voice_minutes, rejected_calls, rent_values, payout_expenses, total_amount,
                       sort_order, created_at, updated_at'
        );
        $stmt->execute([
            ':month' => $month,
            ':name'  => $name,
            ':vm'     => $this->money($body['voice_minutes']   ?? 0),
            ':rc'     => $this->money($body['rejected_calls']  ?? 0),
            ':rv'     => $this->money($body['rent_values']     ?? 0),
            ':payout' => $this->money($body['payout_expenses'] ?? 0),
            ':total'  => $this->money($body['total_amount']    ?? 0),
            ':sort'   => $sortOrder,
        ]);
        Http::json($this->cast([$stmt->fetch()])[0], 201);
    }

    public function update(array $params): void
    {
        $body = Http::body();

        $stmt = Database::connection()->prepare(
            'UPDATE portal_expenses SET
                name           = COALESCE(:name, name),
                voice_minutes   = COALESCE(:vm, voice_minutes),
                rejected_calls  = COALESCE(:rc, rejected_calls),
                rent_values     = COALESCE(:rv, rent_values),
                payout_expenses = COALESCE(:payout, payout_expenses),
                total_amount    = COALESCE(:total, total_amount),
                sort_order      = COALESCE(:sort, sort_order),
                updated_at     = now()
             WHERE id = :id
             RETURNING id, to_char(month, \'YYYY-MM-DD\') AS month, name,
                       voice_minutes, rejected_calls, rent_values, payout_expenses, total_amount,
                       sort_order, created_at, updated_at'
        );
        $stmt->execute([
            ':id'    => (int) $params['id'],
            ':name'  => isset($body['name']) ? trim((string) $body['name']) : null,
            ':vm'     => isset($body['voice_minutes'])   ? $this->money($body['voice_minutes'])   : null,
            ':rc'     => isset($body['rejected_calls'])  ? $this->money($body['rejected_calls'])  : null,
            ':rv'     => isset($body['rent_values'])     ? $this->money($body['rent_values'])     : null,
            ':payout' => isset($body['payout_expenses']) ? $this->money($body['payout_expenses']) : null,
            ':total'  => isset($body['total_amount'])    ? $this->money($body['total_amount'])    : null,
            ':sort'   => isset($body['sort_order'])      ? (int) $body['sort_order'] : null,
        ]);
        $row = $stmt->fetch();
        if (!$row) {
            Http::error('Expense row not found', 404);
        }
        Http::json($this->cast([$row])[0]);
    }

    public function destroy(array $params): void
    {
        $stmt = Database::connection()->prepare('DELETE FROM portal_expenses WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }

    /** Coerce a numeric input to a non-negative float (empty/invalid -> 0). */
    private function money(mixed $value): float
    {
        $n = is_numeric($value) ? (float) $value : 0.0;
        return $n < 0 ? 0.0 : $n;
    }

    /**
     * Normalise a "YYYY-MM" or "YYYY-MM-DD" string to the first day of that month
     * as "YYYY-MM-01". Returns null for anything that isn't a valid month.
     */
    private function normaliseMonth(mixed $value): ?string
    {
        if (!is_string($value) || $value === '') {
            return null;
        }
        if (preg_match('/^(\d{4})-(\d{2})(?:-\d{2})?$/', $value, $m)) {
            $year  = (int) $m[1];
            $month = (int) $m[2];
            if ($month >= 1 && $month <= 12 && $year >= 1970 && $year <= 9999) {
                return sprintf('%04d-%02d-01', $year, $month);
            }
        }
        return null;
    }

    private function nextSortOrder(string $month): int
    {
        $stmt = Database::connection()->prepare(
            'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM portal_expenses WHERE month = :month'
        );
        $stmt->execute([':month' => $month]);
        return (int) $stmt->fetchColumn();
    }

    private function cast(array $rows): array
    {
        foreach ($rows as &$r) {
            if (!$r) {
                continue;
            }
            $r['id']             = (int) $r['id'];
            $r['voice_minutes']   = (float) $r['voice_minutes'];
            $r['rejected_calls']  = (float) $r['rejected_calls'];
            $r['rent_values']     = (float) $r['rent_values'];
            $r['payout_expenses'] = (float) $r['payout_expenses'];
            $r['total_amount']    = (float) $r['total_amount'];
            $r['sort_order']     = (int) $r['sort_order'];
        }
        return $rows;
    }
}
