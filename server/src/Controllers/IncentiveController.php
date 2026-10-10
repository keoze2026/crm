<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Database;
use App\Http;

/**
 * Monthly Incentives — one row per person per incentive, for a month:
 *
 *   GET    /incentives?month=YYYY-MM   the month's rows, in sheet order
 *   POST   /incentives                 {month, staff_ids, amount, status?}: one row for EACH
 *                                      person in staff_ids, all with the same amount —
 *                                      answers the rows created
 *   PUT    /incentives/{id}            change any of staff_id, amount, status
 *   DELETE /incentives/{id}
 *   POST   /incentives/copy            {from, to}: give `to` the people and amounts `from`
 *                                      has, every one Pending — answers `to`'s rows
 *
 * Amounts keep their cents. STATUS is exactly one of STATUSES; anything else is refused.
 */
final class IncentiveController
{
    private const SELECT =
        'SELECT i.id, i.staff_id, s.name AS staff_name, to_char(i.month, \'YYYY-MM-DD\') AS month,
                i.amount, i.status, i.sort_order, i.created_at, i.updated_at
           FROM incentives i
           JOIN staff s ON s.id = i.staff_id';

    /** The only states an incentive may be in, stored as the wording shown. */
    private const STATUSES = ['Pending', 'Cancelled', 'Fulfilled'];

    /** The largest amount NUMERIC(12,2) holds. */
    private const MAX_AMOUNT = 9999999999.99;

    public function index(): void
    {
        $month = $this->month(Http::query('month'));
        if ($month === null) {
            Http::error('month must be YYYY-MM', 422);
        }
        Http::json($this->forMonth($month));
    }

    public function store(): void
    {
        $body  = Http::body();
        $month = $this->month($body['month'] ?? null);
        if ($month === null) {
            Http::error('month must be YYYY-MM', 422);
        }
        $staff = $this->staffIds($body['staff_ids'] ?? (isset($body['staff_id']) ? [$body['staff_id']] : []));
        if ($staff === []) {
            Http::error('Pick a staff member', 422);
        }
        $amount = $this->amount($body['amount'] ?? null);
        $status = $this->status($body['status'] ?? self::STATUSES[0]);

        $pdo  = Database::connection();
        $stmt = $pdo->prepare(
            'INSERT INTO incentives (staff_id, month, amount, status, sort_order)
             VALUES (:staff, :month, :amount, :status,
                     (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM incentives WHERE month = :month))
             RETURNING id'
        );
        $ids = [];
        $pdo->beginTransaction();
        try {
            foreach ($staff as $staffId) {
                $stmt->execute([':staff' => $staffId, ':month' => $month, ':amount' => $amount, ':status' => $status]);
                $ids[] = (int) $stmt->fetchColumn();
            }
            $pdo->commit();
        } catch (\PDOException $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
        Http::json(array_map(fn (int $id) => $this->byId($id), $ids), 201);
    }

    public function update(array $params): void
    {
        $body    = Http::body();
        $staffId = null;
        if (\array_key_exists('staff_id', $body)) {
            $staffId = $this->staffIds([$body['staff_id']])[0] ?? null;
            if ($staffId === null) {
                Http::error('Pick a staff member', 422);
            }
        }
        $stmt = Database::connection()->prepare(
            'UPDATE incentives SET
                staff_id   = COALESCE(:staff, staff_id),
                amount     = COALESCE(:amount, amount),
                status     = COALESCE(:status, status),
                updated_at = now()
             WHERE id = :id RETURNING id'
        );
        $stmt->execute([
            ':id'     => (int) $params['id'],
            ':staff'  => $staffId,
            ':amount' => \array_key_exists('amount', $body) ? $this->amount($body['amount']) : null,
            ':status' => \array_key_exists('status', $body) ? $this->status($body['status']) : null,
        ]);
        $id = $stmt->fetchColumn();
        if ($id === false || $id === null) {
            Http::error('Incentive not found', 404);
        }
        Http::json($this->byId((int) $id));
    }

    public function destroy(array $params): void
    {
        $stmt = Database::connection()->prepare('DELETE FROM incentives WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }

    /** Copy one month's people and amounts, in order and all Pending, onto the end of another's. */
    public function copy(): void
    {
        $body = Http::body();
        $from = $this->month($body['from'] ?? null);
        $to   = $this->month($body['to'] ?? null);
        if ($from === null || $to === null) {
            Http::error('from and to must be YYYY-MM', 422);
        }
        if ($from === $to) {
            Http::error('Pick a different month to copy from', 422);
        }
        $stmt = Database::connection()->prepare(
            'INSERT INTO incentives (staff_id, month, amount, status, sort_order)
             SELECT staff_id, CAST(:to AS date), amount, \'Pending\',
                    (SELECT COALESCE(MAX(sort_order), -1) FROM incentives WHERE month = :to)
                    + row_number() OVER (ORDER BY sort_order, id)
               FROM incentives
              WHERE month = :from'
        );
        $stmt->execute([':from' => $from, ':to' => $to]);
        Http::json($this->forMonth($to), 201);
    }

    // ─── Internals ─────────────────────────────────────────────────────────────

    private function forMonth(string $month): array
    {
        $stmt = Database::connection()->prepare(self::SELECT . '
              WHERE i.month = :month
              ORDER BY i.sort_order ASC, i.id ASC');
        $stmt->execute([':month' => $month]);
        return array_map([$this, 'cast'], $stmt->fetchAll());
    }

    private function byId(int $id): array
    {
        $stmt = Database::connection()->prepare(self::SELECT . ' WHERE i.id = :id');
        $stmt->execute([':id' => $id]);
        return $this->cast($stmt->fetch() ?: []);
    }

    /**
     * Roster ids, duplicates dropped. Anyone not on the roster is refused rather than
     * silently left out, so the sheet never shows a row that didn't save.
     *
     * @return array<int, int>
     */
    private function staffIds(mixed $value): array
    {
        if (!\is_array($value)) {
            Http::error('staff_ids must be a list', 422);
        }
        $ids = [];
        foreach ($value as $raw) {
            if (!is_numeric($raw) || (int) $raw <= 0) {
                Http::error('Pick a staff member', 422);
            }
            $ids[(int) $raw] = (int) $raw;
        }
        $ids = array_values($ids);
        if ($ids === []) {
            return [];
        }
        $marks = implode(',', array_fill(0, \count($ids), '?'));
        $stmt  = Database::connection()->prepare("SELECT count(*) FROM staff WHERE id IN ({$marks})");
        $stmt->execute($ids);
        if ((int) $stmt->fetchColumn() !== \count($ids)) {
            Http::error('Pick a staff member', 422);
        }
        return $ids;
    }

    private function amount(mixed $value): float
    {
        if ($value === null || $value === '' || !is_numeric($value)) {
            Http::error('Enter an amount', 422);
        }
        $amount = round((float) $value, 2);
        if ($amount < 0 || $amount > self::MAX_AMOUNT) {
            Http::error('The amount must be between 0 and 9,999,999,999.99', 422);
        }
        return $amount;
    }

    private function status(mixed $value): string
    {
        if (!\is_string($value) || !\in_array($value, self::STATUSES, true)) {
            Http::error('status must be one of: ' . implode(', ', self::STATUSES), 422);
        }
        return $value;
    }

    /** "YYYY-MM" (or a full date) → the first of that month; null for anything else. */
    private function month(mixed $value): ?string
    {
        if (!\is_string($value) || !preg_match('/^(\d{4})-(\d{2})(?:-\d{2})?$/', $value, $m)) {
            return null;
        }
        $year  = (int) $m[1];
        $month = (int) $m[2];
        if ($month < 1 || $month > 12 || $year < 1970 || $year > 9999) {
            return null;
        }
        return sprintf('%04d-%02d-01', $year, $month);
    }

    private function cast(array $row): array
    {
        if ($row === []) {
            return $row;
        }
        $row['id']         = (int) $row['id'];
        $row['staff_id']   = (int) $row['staff_id'];
        $row['amount']     = (float) $row['amount'];
        $row['sort_order'] = (int) $row['sort_order'];
        return $row;
    }
}
