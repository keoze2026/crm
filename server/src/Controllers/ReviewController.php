<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Database;
use App\Http;

/**
 * Reviews — the CRUD behind the Review page's three tabs.
 *
 *   /review-departments — the Department tab: one row per department with its rating and %.
 *                         It is also the catalogue the other two tabs group by.
 *   /review-entries     — the Performance and Behaviour tabs, told apart by `kind`.
 *                         `?kind=performance` returns the performance rows;
 *                         `?kind=behaviour&month=YYYY-MM` scopes behaviour to one month.
 *
 * Sr. No. is positional in the UI and never stored. Ratings are stored as the wording the
 * dropdowns show, so the client can restyle the vocabulary without a migration.
 */
final class ReviewController
{
    private const KINDS = ['performance', 'behaviour'];

    private const DEPARTMENT_SELECT =
        'SELECT id, name, performance, percentage, sort_order, created_at, updated_at
           FROM review_departments';

    private const ENTRY_SELECT =
        'SELECT id, kind, department_id, person_name, department_note, rating, percentage, notes,
                to_char(month, \'YYYY-MM-DD\') AS month, sort_order, created_at, updated_at
           FROM review_entries';

    /** The same column list, for the RETURNING clauses that answer a write. */
    private const ENTRY_RETURNING =
        'RETURNING id, kind, department_id, person_name, department_note, rating, percentage, notes,
                   to_char(month, \'YYYY-MM-DD\') AS month, sort_order, created_at, updated_at';

    // ─── Departments (/review-departments) ─────────────────────────────────────

    public function departments(): void
    {
        $stmt = Database::connection()->query(
            self::DEPARTMENT_SELECT . ' ORDER BY sort_order ASC, id ASC'
        );
        Http::json(array_map([$this, 'castDepartment'], $stmt->fetchAll()));
    }

    public function storeDepartment(): void
    {
        $body = Http::body();
        $name = trim((string) ($body['name'] ?? ''));
        if ($name === '') {
            Http::error('A department name is required', 422);
        }
        if ($this->takenBy('review_departments', $name, 0)) {
            Http::error('That department is already listed', 409);
        }

        $stmt = Database::connection()->prepare(
            'INSERT INTO review_departments (name, performance, percentage, sort_order)
             VALUES (:name, :performance, :percentage, :sort)
             RETURNING id, name, performance, percentage, sort_order, created_at, updated_at'
        );
        $stmt->execute([
            ':name'        => $name,
            ':performance' => $this->text($body['performance'] ?? ''),
            ':percentage'  => $this->percent($body['percentage'] ?? null),
            ':sort'        => isset($body['sort_order'])
                ? (int) $body['sort_order']
                : $this->nextSortOrder('review_departments'),
        ]);
        Http::json($this->castDepartment($stmt->fetch()), 201);
    }

    public function updateDepartment(array $params): void
    {
        $body = Http::body();
        $id   = (int) $params['id'];

        if (isset($body['name'])) {
            $name = trim((string) $body['name']);
            if ($name === '') {
                Http::error('A department name is required', 422);
            }
            if ($this->takenBy('review_departments', $name, $id)) {
                Http::error('That department is already listed', 409);
            }
        }

        $stmt = Database::connection()->prepare(
            'UPDATE review_departments SET
                name        = COALESCE(:name, name),
                performance = COALESCE(:performance, performance),
                percentage  = CASE WHEN :percentage_set THEN :percentage ELSE percentage END,
                sort_order  = COALESCE(:sort, sort_order),
                updated_at  = now()
             WHERE id = :id
             RETURNING id, name, performance, percentage, sort_order, created_at, updated_at'
        );
        $stmt->execute([
            ':id'             => $id,
            ':name'           => isset($body['name']) ? trim((string) $body['name']) : null,
            ':performance'    => isset($body['performance']) ? $this->text($body['performance']) : null,
            // A percentage can legitimately be cleared, so "sent" and "null" are told apart.
            ':percentage_set' => \array_key_exists('percentage', $body) ? 1 : 0,
            ':percentage'     => $this->percent($body['percentage'] ?? null),
            ':sort'           => isset($body['sort_order']) ? (int) $body['sort_order'] : null,
        ]);
        $row = $stmt->fetch();
        if (!$row) {
            Http::error('Department not found', 404);
        }
        Http::json($this->castDepartment($row));
    }

    public function destroyDepartment(array $params): void
    {
        // Entries keep their rows (ON DELETE SET NULL) and reappear under "No department".
        $stmt = Database::connection()->prepare('DELETE FROM review_departments WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }

    // ─── Entries (/review-entries) ─────────────────────────────────────────────

    public function entries(): void
    {
        $kind = $this->kind(Http::query('kind'));
        if ($kind === null) {
            Http::error('kind must be performance or behaviour', 422);
        }

        $sql    = self::ENTRY_SELECT . ' WHERE kind = :kind';
        $params = [':kind' => $kind];

        $month = $this->normaliseMonth(Http::query('month'));
        if ($month !== null) {
            $sql .= ' AND month = :month';
            $params[':month'] = $month;
        }
        $sql .= ' ORDER BY sort_order ASC, id ASC';

        $stmt = Database::connection()->prepare($sql);
        $stmt->execute($params);
        Http::json(array_map([$this, 'castEntry'], $stmt->fetchAll()));
    }

    public function storeEntry(): void
    {
        $body = Http::body();
        $kind = $this->kind($body['kind'] ?? null);
        if ($kind === null) {
            Http::error('kind must be performance or behaviour', 422);
        }
        $name = trim((string) ($body['person_name'] ?? ''));
        if ($name === '') {
            Http::error('A name is required', 422);
        }

        $stmt = Database::connection()->prepare(
            'INSERT INTO review_entries
                (kind, department_id, person_name, department_note, rating, percentage, notes, month, sort_order)
             VALUES (:kind, :department, :name, :note, :rating, :percentage, :notes, :month, :sort) '
             . self::ENTRY_RETURNING
        );
        $stmt->execute([
            ':kind'       => $kind,
            ':department' => $this->departmentId($body['department_id'] ?? null),
            ':name'       => $name,
            ':note'       => $this->text($body['department_note'] ?? ''),
            ':rating'     => $this->text($body['rating'] ?? ''),
            ':notes'      => $this->prose($body['notes'] ?? ''),
            ':percentage' => $kind === 'performance' ? $this->percent($body['percentage'] ?? null) : null,
            ':month'      => $kind === 'behaviour' ? $this->normaliseMonth($body['month'] ?? null) : null,
            ':sort'       => isset($body['sort_order'])
                ? (int) $body['sort_order']
                : $this->nextSortOrder('review_entries', $kind),
        ]);
        Http::json($this->castEntry($stmt->fetch()), 201);
    }

    public function updateEntry(array $params): void
    {
        $body = Http::body();

        $stmt = Database::connection()->prepare(
            'UPDATE review_entries SET
                department_id   = CASE WHEN :department_set THEN :department ELSE department_id END,
                person_name     = COALESCE(:name, person_name),
                department_note = COALESCE(:note, department_note),
                rating          = COALESCE(:rating, rating),
                percentage      = CASE WHEN :percentage_set THEN :percentage ELSE percentage END,
                notes           = COALESCE(:notes, notes),
                month           = CASE WHEN :month_set THEN :month ELSE month END,
                sort_order      = COALESCE(:sort, sort_order),
                updated_at      = now()
             WHERE id = :id '
             . self::ENTRY_RETURNING
        );
        $stmt->execute([
            ':id'             => (int) $params['id'],
            // Each of these three may legitimately be set to NULL, so "sent" is tracked apart.
            ':department_set' => \array_key_exists('department_id', $body) ? 1 : 0,
            ':department'     => $this->departmentId($body['department_id'] ?? null),
            ':name'           => isset($body['person_name']) && trim((string) $body['person_name']) !== ''
                ? trim((string) $body['person_name'])
                : null,
            ':note'           => isset($body['department_note']) ? $this->text($body['department_note']) : null,
            ':rating'         => isset($body['rating']) ? $this->text($body['rating']) : null,
            ':percentage_set' => \array_key_exists('percentage', $body) ? 1 : 0,
            ':percentage'     => $this->percent($body['percentage'] ?? null),
            ':notes'          => \array_key_exists('notes', $body) ? $this->prose($body['notes']) : null,
            ':month_set'      => \array_key_exists('month', $body) ? 1 : 0,
            ':month'          => $this->normaliseMonth($body['month'] ?? null),
            ':sort'           => isset($body['sort_order']) ? (int) $body['sort_order'] : null,
        ]);
        $row = $stmt->fetch();
        if (!$row) {
            Http::error('Review row not found', 404);
        }
        Http::json($this->castEntry($row));
    }

    public function destroyEntry(array $params): void
    {
        $stmt = Database::connection()->prepare('DELETE FROM review_entries WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }

    // ─── Internals ─────────────────────────────────────────────────────────────

    private function kind(mixed $value): ?string
    {
        $kind = is_string($value) ? strtolower(trim($value)) : '';
        return \in_array($kind, self::KINDS, true) ? $kind : null;
    }

    /** A department id that exists, or null (unassigned / "No department"). */
    private function departmentId(mixed $value): ?int
    {
        $id = (int) $value;
        if ($id <= 0) {
            return null;
        }
        $stmt = Database::connection()->prepare('SELECT 1 FROM review_departments WHERE id = :id');
        $stmt->execute([':id' => $id]);
        return $stmt->fetchColumn() ? $id : null;
    }

    /** A trimmed single-line label, capped so a stray paste can't fill the column. */
    private function text(mixed $value): string
    {
        return mb_substr(trim((string) $value), 0, 120);
    }

    /** A free-text note: line breaks kept, length capped at a sane paragraph. */
    private function prose(mixed $value): string
    {
        return mb_substr(trim((string) $value), 0, 2000);
    }

    /** A 0-100 percentage, or null when the cell is left blank. */
    private function percent(mixed $value): ?float
    {
        if ($value === null || $value === '' || !is_numeric($value)) {
            return null;
        }
        return max(0.0, min(100.0, (float) $value));
    }

    /** Normalise "YYYY-MM" or "YYYY-MM-DD" to the first of that month; null if invalid. */
    private function normaliseMonth(mixed $value): ?string
    {
        if (!\is_string($value) || $value === '') {
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

    /** True when another row already carries this name, ignoring case. */
    private function takenBy(string $table, string $name, int $id): bool
    {
        $stmt = Database::connection()->prepare(
            "SELECT 1 FROM {$table} WHERE lower(btrim(name)) = lower(btrim(:name)) AND id <> :id"
        );
        $stmt->execute([':name' => $name, ':id' => $id]);
        return (bool) $stmt->fetchColumn();
    }

    private function nextSortOrder(string $table, ?string $kind = null): int
    {
        $sql = "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM {$table}";
        $db  = Database::connection();
        if ($kind === null) {
            return (int) $db->query($sql)->fetchColumn();
        }
        $stmt = $db->prepare($sql . ' WHERE kind = :kind');
        $stmt->execute([':kind' => $kind]);
        return (int) $stmt->fetchColumn();
    }

    private function castDepartment(array $row): array
    {
        $row['id']         = (int) $row['id'];
        $row['percentage'] = $row['percentage'] === null ? null : (float) $row['percentage'];
        $row['sort_order'] = (int) $row['sort_order'];
        return $row;
    }

    private function castEntry(array $row): array
    {
        $row['id']            = (int) $row['id'];
        $row['department_id'] = $row['department_id'] === null ? null : (int) $row['department_id'];
        $row['percentage']    = $row['percentage'] === null ? null : (float) $row['percentage'];
        $row['sort_order']    = (int) $row['sort_order'];
        return $row;
    }
}
