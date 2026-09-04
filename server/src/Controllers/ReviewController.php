<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Database;
use App\Http;

/**
 * Reviews — the CRUD behind the Review page's three tabs.
 *
 * EVERY tab is month-wise, and the month is the month being REVIEWED, not the month the
 * review was written in: a review keyed in during September is about August. `month` on a
 * row is therefore always the first of the month it judges.
 *
 *   /review-departments — the Department tab: each department with the rating and % it
 *                         scored THAT MONTH. The department names themselves live in
 *                         `departments` (shared with the Staff page, which is where people
 *                         are put into them); the month's score lives in
 *                         `department_reviews`, so a department can be scored differently
 *                         month to month without duplicating the catalogue.
 *   /review-entries     — the Performance and Behaviour tabs, told apart by `kind`, both
 *                         scoped by `?month=YYYY-MM`.
 *
 * A row keeps `person_name` as text AND `staff_id` as a live link: the name is what was
 * written on the day and must survive a rename or a removal from the roster, while the
 * link is what ties the row to the Staff page's departments.
 *
 * Sr. No. is positional in the UI and never stored. Ratings are stored as the wording the
 * dropdowns show, so the client can restyle the vocabulary without a migration.
 */
final class ReviewController
{
    private const KINDS = ['performance', 'behaviour'];

    /**
     * Every department, with the score it holds for one month — LEFT JOIN, so a department
     * that has not been scored yet still appears (with a blank rating) rather than
     * vanishing from the sheet.
     */
    private const DEPARTMENT_SELECT =
        'SELECT d.id, d.name, d.sort_order, d.created_at, d.updated_at,
                COALESCE(r.performance, \'\') AS performance, r.percentage
           FROM departments d
      LEFT JOIN department_reviews r ON r.department_id = d.id AND r.month = :month';

    private const ENTRY_SELECT =
        'SELECT id, kind, department_id, staff_id, person_name, department_note, rating, percentage, notes,
                to_char(month, \'YYYY-MM-DD\') AS month, sort_order, created_at, updated_at
           FROM review_entries';

    /** The same column list, for the RETURNING clauses that answer a write. */
    private const ENTRY_RETURNING =
        'RETURNING id, kind, department_id, staff_id, person_name, department_note, rating, percentage, notes,
                   to_char(month, \'YYYY-MM-DD\') AS month, sort_order, created_at, updated_at';

    // ─── Departments (/review-departments) ─────────────────────────────────────

    public function departments(): void
    {
        $month = $this->requireMonth(Http::query('month'));
        $stmt  = Database::connection()->prepare(
            self::DEPARTMENT_SELECT . ' ORDER BY d.sort_order ASC, d.id ASC'
        );
        $stmt->execute([':month' => $month]);
        Http::json(array_map([$this, 'castDepartment'], $stmt->fetchAll()));
    }

    public function storeDepartment(): void
    {
        $body  = Http::body();
        $month = $this->requireMonth($body['month'] ?? null);
        $name  = trim((string) ($body['name'] ?? ''));
        if ($name === '') {
            Http::error('A department name is required', 422);
        }
        if ($this->takenBy('departments', $name, 0)) {
            Http::error('That department is already listed', 409);
        }

        $stmt = Database::connection()->prepare(
            'INSERT INTO departments (name, sort_order) VALUES (:name, :sort) RETURNING id'
        );
        $stmt->execute([
            ':name' => $name,
            ':sort' => isset($body['sort_order'])
                ? (int) $body['sort_order']
                : $this->nextSortOrder('departments'),
        ]);
        $id = (int) $stmt->fetchColumn();

        if (\array_key_exists('performance', $body) || \array_key_exists('percentage', $body)) {
            $this->writeDepartmentScore($id, $month, $body);
        }
        Http::json($this->department($id, $month), 201);
    }

    public function updateDepartment(array $params): void
    {
        $body  = Http::body();
        $id    = (int) $params['id'];
        $month = $this->requireMonth($body['month'] ?? null);

        if (isset($body['name'])) {
            $name = trim((string) $body['name']);
            if ($name === '') {
                Http::error('A department name is required', 422);
            }
            if ($this->takenBy('departments', $name, $id)) {
                Http::error('That department is already listed', 409);
            }
        }

        $stmt = Database::connection()->prepare(
            'UPDATE departments SET
                name       = COALESCE(:name, name),
                sort_order = COALESCE(:sort, sort_order),
                updated_at = now()
             WHERE id = :id RETURNING id'
        );
        $stmt->execute([
            ':id'   => $id,
            ':name' => isset($body['name']) ? trim((string) $body['name']) : null,
            ':sort' => isset($body['sort_order']) ? (int) $body['sort_order'] : null,
        ]);
        if ($stmt->fetchColumn() === false) {
            Http::error('Department not found', 404);
        }

        // The rating and % belong to the month, not the department, so they are only
        // touched when the request actually carries them.
        if (\array_key_exists('performance', $body) || \array_key_exists('percentage', $body)) {
            $this->writeDepartmentScore($id, $month, $body);
        }
        Http::json($this->department($id, $month));
    }

    public function destroyDepartment(array $params): void
    {
        // Entries keep their rows (ON DELETE SET NULL) and reappear under "No department";
        // the department's monthly scores go with it (ON DELETE CASCADE).
        $stmt = Database::connection()->prepare('DELETE FROM departments WHERE id = :id');
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

        // Both kinds are month-wise now: a request without a month would mix every month's
        // rows into one sheet, so it is only honoured as "give me everything" when the
        // caller deliberately omits it.
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
                (kind, department_id, staff_id, person_name, department_note, rating, percentage, notes, month, sort_order)
             VALUES (:kind, :department, :staff, :name, :note, :rating, :percentage, :notes, :month, :sort) '
             . self::ENTRY_RETURNING
        );
        $stmt->execute([
            ':kind'       => $kind,
            ':department' => $this->departmentId($body['department_id'] ?? null),
            ':staff'      => $this->staffId($body['staff_id'] ?? null, $name),
            ':name'       => $name,
            ':note'       => $this->text($body['department_note'] ?? ''),
            ':rating'     => $this->text($body['rating'] ?? ''),
            ':notes'      => $this->prose($body['notes'] ?? ''),
            ':percentage' => $kind === 'performance' ? $this->percent($body['percentage'] ?? null) : null,
            // The month a row is ABOUT — required on both kinds now.
            ':month'      => $this->requireMonth($body['month'] ?? null),
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
                staff_id        = CASE WHEN :staff_set THEN :staff ELSE staff_id END,
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
            // Picking a different person re-points the link as well as the stored name.
            ':staff_set'      => \array_key_exists('staff_id', $body) || isset($body['person_name']) ? 1 : 0,
            ':staff'          => $this->staffId(
                $body['staff_id'] ?? null,
                isset($body['person_name']) ? trim((string) $body['person_name']) : '',
            ),
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
        $stmt = Database::connection()->prepare('SELECT 1 FROM departments WHERE id = :id');
        $stmt->execute([':id' => $id]);
        return $stmt->fetchColumn() ? $id : null;
    }

    /**
     * The staff member a row points at: the id when one is sent, otherwise whoever on the
     * roster carries that name. Null when neither matches — the row still keeps its
     * `person_name`, so nothing is lost, it just isn't linked.
     */
    private function staffId(mixed $value, string $name): ?int
    {
        $id = (int) $value;
        if ($id > 0) {
            $stmt = Database::connection()->prepare('SELECT id FROM staff WHERE id = :id');
            $stmt->execute([':id' => $id]);
            $found = $stmt->fetchColumn();
            if ($found !== false && $found !== null) {
                return (int) $found;
            }
        }
        if (trim($name) === '') {
            return null;
        }
        $stmt = Database::connection()->prepare(
            'SELECT id FROM staff WHERE lower(btrim(name)) = lower(btrim(:name))'
        );
        $stmt->execute([':name' => $name]);
        $found = $stmt->fetchColumn();
        return $found === false || $found === null ? null : (int) $found;
    }

    /** One department with its score for a month, as departments() shapes it. */
    private function department(int $id, string $month): array
    {
        $stmt = Database::connection()->prepare(self::DEPARTMENT_SELECT . ' WHERE d.id = :id');
        $stmt->execute([':month' => $month, ':id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            Http::error('Department not found', 404);
        }
        return $this->castDepartment($row);
    }

    /** Upsert a department's rating and % for one month. */
    private function writeDepartmentScore(int $id, string $month, array $body): void
    {
        $stmt = Database::connection()->prepare(
            'INSERT INTO department_reviews (department_id, month, performance, percentage)
             VALUES (:department, :month, :performance, :percentage)
             ON CONFLICT (department_id, month) DO UPDATE SET
                performance = EXCLUDED.performance,
                percentage  = EXCLUDED.percentage,
                updated_at  = now()'
        );
        $stmt->execute([
            ':department'  => $id,
            ':month'       => $month,
            ':performance' => $this->text($body['performance'] ?? ''),
            ':percentage'  => $this->percent($body['percentage'] ?? null),
        ]);
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

    /** The month a request is about — 422 rather than silently filing the row elsewhere. */
    private function requireMonth(mixed $value): string
    {
        $month = $this->normaliseMonth($value);
        if ($month === null) {
            Http::error('month must be YYYY-MM — a review always belongs to the month it is about', 422);
        }
        return $month;
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
        $row['staff_id']      = $row['staff_id'] === null ? null : (int) $row['staff_id'];
        $row['percentage']    = $row['percentage'] === null ? null : (float) $row['percentage'];
        $row['sort_order']    = (int) $row['sort_order'];
        return $row;
    }
}
