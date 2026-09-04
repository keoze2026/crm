<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Database;
use App\Http;

/**
 * Staff Management — the roster every other sheet picks its names from.
 *
 *   /staff             the people: name, status (active / inactive / leave) and the
 *                      departments they belong to — a person may belong to several
 *   /departments       the department catalogue, shared with the Review page's bands
 *   /staff-attendance  attendance, fetched and hand-keyed merged into one list. Fetched
 *                      days come from the bot's `attendance_days` and are READ-ONLY:
 *                      only rows this app owns (`staff_attendance`) carry an id, and only
 *                      those can be written or deleted
 *   /staff-leaves      the leaves sheet
 *   /staff-salaries    the salary sheet, one row per person per month
 *
 * Sr. No. is positional everywhere and never stored, exactly as on the Queues and Review
 * sheets. Statuses ("Received", "Approved") are stored as the wording the sheet shows.
 */
final class StaffController
{
    private const TZ = 'America/New_York';

    /**
     * A staff row as every /staff response shapes it: their departments as a JSON array,
     * plus `assignment_id` so the Queues page can jump from a name straight to its record.
     *
     * `attendance_user_id` is read-only — it is resolved from the name, never picked — and
     * is here so the attendance sheet knows whose days arrive fetched.
     */
    private const STAFF_SELECT =
        'SELECT s.id, s.name, s.sort_order, s.status, s.attendance_user_id,
                qa.id AS assignment_id, s.created_at, s.updated_at,
                COALESCE(
                    json_agg(json_build_object(\'id\', d.id, \'name\', d.name)
                             ORDER BY d.sort_order, d.id)
                    FILTER (WHERE d.id IS NOT NULL),
                    \'[]\'
                ) AS departments
           FROM staff s
      LEFT JOIN staff_departments sd ON sd.staff_id = s.id
      LEFT JOIN departments d ON d.id = sd.department_id
      LEFT JOIN queue_assignments qa ON qa.person_id = s.id';

    // ─── Staff (/staff) ────────────────────────────────────────────────────────

    public function index(): void
    {
        $stmt = Database::connection()->query(
            self::STAFF_SELECT . ' GROUP BY s.id, qa.id ORDER BY s.sort_order ASC, lower(btrim(s.name)) ASC'
        );
        Http::json(array_map([$this, 'castStaff'], $stmt->fetchAll()));
    }

    /**
     * Add one person or a pasted list of them, answering with the rows created AND the
     * ones already on the roster — the same {created, existing} contract the Queues
     * catalogue has always used, so a duplicate is reported rather than thrown.
     */
    public function store(): void
    {
        $body  = Http::body();
        $names = $this->names($body);
        if ($names === []) {
            Http::error('A name is required', 422);
        }

        $db       = Database::connection();
        $insert   = $db->prepare('INSERT INTO staff (name) VALUES (:name) ON CONFLICT DO NOTHING RETURNING id');
        $lookup   = $db->prepare('SELECT id FROM staff WHERE lower(btrim(name)) = lower(btrim(:name))');
        $created  = [];
        $existing = [];

        foreach ($names as $name) {
            $insert->execute([':name' => $name]);
            $id = $insert->fetchColumn();
            if ($id !== false && $id !== null) {
                $created[] = (int) $id;
                continue;
            }
            $lookup->execute([':name' => $name]);
            $id = $lookup->fetchColumn();
            if ($id !== false && $id !== null) {
                $existing[] = (int) $id;
            }
        }

        // Adding from inside a department band files the new people under that band.
        $departmentIds = $this->ids($body['department_ids'] ?? []);
        foreach ($created as $staffId) {
            $this->linkAttendance($staffId);
        }
        if ($departmentIds !== []) {
            foreach ([...$created, ...$existing] as $staffId) {
                $this->addDepartments($staffId, $departmentIds);
            }
        }

        Http::json([
            'created'  => $this->staffByIds($created),
            'existing' => $this->staffByIds($existing),
        ], $created === [] ? 200 : 201);
    }

    public function update(array $params): void
    {
        $id   = (int) $params['id'];
        $body = Http::body();

        if (isset($body['name'])) {
            $name = trim((string) $body['name']);
            if ($name === '') {
                Http::error('A name is required', 422);
            }
            $taken = Database::connection()->prepare(
                'SELECT 1 FROM staff WHERE lower(btrim(name)) = lower(btrim(:name)) AND id <> :id'
            );
            $taken->execute([':name' => $name, ':id' => $id]);
            if ($taken->fetchColumn()) {
                Http::error('Another staff member is already called that', 409);
            }
        }

        $stmt = Database::connection()->prepare(
            'UPDATE staff SET
                name       = COALESCE(:name, name),
                sort_order = COALESCE(:sort, sort_order),
                status     = COALESCE(:status, status),
                updated_at = now()
             WHERE id = :id'
        );
        $stmt->execute([
            ':id'     => $id,
            ':name'   => isset($body['name']) ? trim((string) $body['name']) : null,
            ':sort'   => isset($body['sort_order']) ? (int) $body['sort_order'] : null,
            ':status' => isset($body['status']) ? $this->status($body['status']) : null,
        ]);

        // The check-in account follows the name, since the name is the only thing the two
        // systems share — so a rename re-resolves it rather than leaving a stale link.
        if (isset($body['name'])) {
            $this->linkAttendance($id);
        }

        // Departments arrive as the complete set the row should end up with.
        if (\array_key_exists('department_ids', $body)) {
            $this->writeDepartments($id, $this->ids($body['department_ids']));
        }

        $rows = $this->staffByIds([$id]);
        if ($rows === []) {
            Http::error('Staff member not found', 404);
        }
        Http::json($rows[0]);
    }

    public function destroy(array $params): void
    {
        // ON DELETE CASCADE takes their Queues record, departments, attendance, leaves and
        // salary rows. Reviews keep the name they were written with (staff_id is SET NULL).
        $stmt = Database::connection()->prepare('DELETE FROM staff WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }

    // ─── Departments (/departments) ────────────────────────────────────────────

    public function departments(): void
    {
        $stmt = Database::connection()->query(
            'SELECT d.id, d.name, d.sort_order, d.created_at, d.updated_at,
                    COUNT(sd.staff_id) AS staff_count
               FROM departments d
          LEFT JOIN staff_departments sd ON sd.department_id = d.id
              GROUP BY d.id
              ORDER BY d.sort_order ASC, d.id ASC'
        );
        Http::json(array_map(static function (array $r): array {
            $r['id']          = (int) $r['id'];
            $r['sort_order']  = (int) $r['sort_order'];
            $r['staff_count'] = (int) $r['staff_count'];
            return $r;
        }, $stmt->fetchAll()));
    }

    public function storeDepartment(): void
    {
        $name = trim((string) (Http::body()['name'] ?? ''));
        if ($name === '') {
            Http::error('A department name is required', 422);
        }
        $stmt = Database::connection()->prepare(
            'INSERT INTO departments (name, sort_order)
             VALUES (:name, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM departments))
             ON CONFLICT DO NOTHING
             RETURNING id, name, sort_order, created_at, updated_at'
        );
        $stmt->execute([':name' => $name]);
        $row = $stmt->fetch();
        if (!$row) {
            Http::error('That department is already listed', 409);
        }
        $row['id']          = (int) $row['id'];
        $row['sort_order']  = (int) $row['sort_order'];
        $row['staff_count'] = 0;
        Http::json($row, 201);
    }

    public function updateDepartment(array $params): void
    {
        $name = trim((string) (Http::body()['name'] ?? ''));
        if ($name === '') {
            Http::error('A department name is required', 422);
        }
        $id    = (int) $params['id'];
        $taken = Database::connection()->prepare(
            'SELECT 1 FROM departments WHERE lower(btrim(name)) = lower(btrim(:name)) AND id <> :id'
        );
        $taken->execute([':name' => $name, ':id' => $id]);
        if ($taken->fetchColumn()) {
            Http::error('Another department is already called that', 409);
        }

        $stmt = Database::connection()->prepare(
            'UPDATE departments SET name = :name, updated_at = now() WHERE id = :id
             RETURNING id, name, sort_order, created_at, updated_at'
        );
        $stmt->execute([':name' => $name, ':id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            Http::error('Department not found', 404);
        }
        $row['id']         = (int) $row['id'];
        $row['sort_order'] = (int) $row['sort_order'];
        Http::json($row);
    }

    public function destroyDepartment(array $params): void
    {
        // Staff keep their rows and lose the band; reviews written under it resurface
        // under "No department" (review_entries.department_id is ON DELETE SET NULL).
        $stmt = Database::connection()->prepare('DELETE FROM departments WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }

    // ─── Attendance (/staff-attendance) ────────────────────────────────────────

    /**
     * Every attendance day in the range for every staff member, fetched and hand-keyed
     * together. A fetched row has `source: "fetched"` and NO id — that is what the page
     * uses to lock it: there is nothing to address a write to.
     */
    public function attendance(): void
    {
        $from    = $this->normaliseDay(Http::query('from')) ?? date('Y-m-01');
        $to      = $this->normaliseDay(Http::query('to')) ?? date('Y-m-d');
        $staffId = (int) (Http::query('staff_id') ?? 0);

        // Prepares are not emulated, so each half of the UNION needs its own placeholders —
        // a named parameter may appear only once in the statement.
        $params = [':from_m' => $from, ':to_m' => $to];
        $whereM = $staffId > 0 ? ' AND s.id = :staff_m' : '';
        $whereF = $staffId > 0 ? ' AND s.id = :staff_f' : '';
        if ($staffId > 0) {
            $params[':staff_m'] = $staffId;
        }

        $manual =
            "SELECT m.id, 'manual' AS source, s.id AS staff_id, s.name AS staff_name,
                    m.work_date::text AS work_date,
                    to_char(m.login_at, 'HH24:MI')  AS login_at,
                    to_char(m.logout_at, 'HH24:MI') AS logout_at,
                    m.break_min, m.status, m.note,
                    ROUND(EXTRACT(EPOCH FROM (m.logout_at - m.login_at)) / 3600.0 - m.break_min / 60.0, 2) AS net_hours,
                    ROUND(EXTRACT(EPOCH FROM (m.logout_at - m.login_at)) / 3600.0, 2) AS hours
               FROM staff_attendance m
               JOIN staff s ON s.id = m.staff_id
              WHERE m.work_date BETWEEN :from_m AND :to_m{$whereM}";

        $sql = $manual;
        if ($this->attendanceAvailable()) {
            $tz = self::TZ;
            $params[':from_f'] = $from;
            $params[':to_f']   = $to;
            if ($staffId > 0) {
                $params[':staff_f'] = $staffId;
            }
            // Fetched days, reduced to the same shape: local clock times, one row per day.
            // A hand-keyed row for a day the bot also recorded is ignored — the fetched one
            // wins, which is what "if it was fetched it should not be edited" means.
            $sql .= "
             UNION ALL
            SELECT NULL::bigint AS id, 'fetched' AS source, s.id AS staff_id, s.name AS staff_name,
                   d.work_date::text AS work_date,
                   to_char(d.login_at  AT TIME ZONE '{$tz}', 'HH24:MI') AS login_at,
                   to_char(d.logout_at AT TIME ZONE '{$tz}', 'HH24:MI') AS logout_at,
                   COALESCE(b.break_min, 0)::int AS break_min,
                   CASE WHEN d.login_at IS NULL THEN 'absent'
                        WHEN d.logout_at IS NULL THEN 'still in'
                        ELSE 'present' END AS status,
                   '' AS note,
                   ROUND(EXTRACT(EPOCH FROM (d.logout_at - d.login_at)) / 3600.0 - COALESCE(b.break_min, 0) / 60.0, 2) AS net_hours,
                   ROUND(EXTRACT(EPOCH FROM (d.logout_at - d.login_at)) / 3600.0, 2) AS hours
              FROM attendance_days d
              JOIN staff s ON s.attendance_user_id = d.user_id::text
         LEFT JOIN (
                   SELECT user_id, work_date, SUM(duration_min)::int AS break_min
                     FROM attendance_breaks GROUP BY user_id, work_date
              ) b ON b.user_id = d.user_id AND b.work_date = d.work_date
             WHERE d.work_date BETWEEN :from_f AND :to_f{$whereF}";
        }

        $stmt = Database::connection()->prepare(
            "SELECT * FROM ({$sql}) rows ORDER BY work_date DESC, lower(btrim(staff_name)) ASC"
        );
        $stmt->execute($params);

        $rows = array_map([$this, 'castAttendance'], $stmt->fetchAll());

        // A fetched day always beats a hand-keyed one for the same person and date.
        $seen = [];
        $out  = [];
        foreach ($rows as $row) {
            $key = $row['staff_id'] . '|' . $row['work_date'];
            if ($row['source'] === 'fetched') {
                $seen[$key] = true;
            }
        }
        foreach ($rows as $row) {
            $key = $row['staff_id'] . '|' . $row['work_date'];
            if ($row['source'] === 'manual' && isset($seen[$key])) {
                continue;
            }
            $out[] = $row;
        }

        Http::json([
            'timezone' => self::TZ,
            'from'     => $from,
            'to'       => $to,
            'fetched'  => $this->attendanceAvailable(),
            'rows'     => $out,
        ]);
    }

    public function storeAttendance(): void
    {
        $body    = Http::body();
        $staffId = (int) ($body['staff_id'] ?? 0);
        $date    = $this->normaliseDay($body['work_date'] ?? null);
        if ($staffId <= 0 || !$this->staffExists($staffId)) {
            Http::error('Pick a staff member', 422);
        }
        if ($date === null) {
            Http::error('A date is required', 422);
        }
        if ($this->fetchedDayExists($staffId, $date)) {
            Http::error('That day was fetched from the attendance system and cannot be keyed in', 409);
        }

        // Re-keying a day updates it, so the sheet can never hold two rows for one day.
        $stmt = Database::connection()->prepare(
            'INSERT INTO staff_attendance (staff_id, work_date, login_at, logout_at, break_min, status, note)
             VALUES (:staff, :date, :login, :logout, :break, :status, :note)
             ON CONFLICT (staff_id, work_date) DO UPDATE SET
                login_at   = EXCLUDED.login_at,
                logout_at  = EXCLUDED.logout_at,
                break_min  = EXCLUDED.break_min,
                status     = EXCLUDED.status,
                note       = EXCLUDED.note,
                updated_at = now()
             RETURNING id'
        );
        $stmt->execute([
            ':staff'  => $staffId,
            ':date'   => $date,
            ':login'  => $this->clock($body['login_at'] ?? null),
            ':logout' => $this->clock($body['logout_at'] ?? null),
            ':break'  => max(0, (int) ($body['break_min'] ?? 0)),
            ':status' => $this->text($body['status'] ?? 'present'),
            ':note'   => $this->text($body['note'] ?? ''),
        ]);
        Http::json($this->manualAttendance((int) $stmt->fetchColumn()), 201);
    }

    public function updateAttendance(array $params): void
    {
        $body = Http::body();
        $stmt = Database::connection()->prepare(
            'UPDATE staff_attendance SET
                login_at   = CASE WHEN :login_set  THEN :login  ELSE login_at  END,
                logout_at  = CASE WHEN :logout_set THEN :logout ELSE logout_at END,
                break_min  = COALESCE(:break, break_min),
                status     = COALESCE(:status, status),
                note       = COALESCE(:note, note),
                updated_at = now()
             WHERE id = :id RETURNING id'
        );
        $stmt->execute([
            ':id'         => (int) $params['id'],
            // Both times may legitimately be cleared, so "sent" is tracked apart from null.
            ':login_set'  => \array_key_exists('login_at', $body) ? 1 : 0,
            ':login'      => $this->clock($body['login_at'] ?? null),
            ':logout_set' => \array_key_exists('logout_at', $body) ? 1 : 0,
            ':logout'     => $this->clock($body['logout_at'] ?? null),
            ':break'      => isset($body['break_min']) ? max(0, (int) $body['break_min']) : null,
            ':status'     => isset($body['status']) ? $this->text($body['status']) : null,
            ':note'       => isset($body['note']) ? $this->text($body['note']) : null,
        ]);
        $id = $stmt->fetchColumn();
        if ($id === false || $id === null) {
            Http::error('Attendance row not found', 404);
        }
        Http::json($this->manualAttendance((int) $id));
    }

    public function destroyAttendance(array $params): void
    {
        $stmt = Database::connection()->prepare('DELETE FROM staff_attendance WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }

    // ─── Leaves (/staff-leaves) ────────────────────────────────────────────────

    public function leaves(): void
    {
        $from = $this->normaliseDay(Http::query('from')) ?? date('Y-m-01');
        $to   = $this->normaliseDay(Http::query('to')) ?? date('Y-m-t');
        $stmt = Database::connection()->prepare(self::LEAVE_SELECT . '
              WHERE l.leave_date BETWEEN :from AND :to
              ORDER BY l.leave_date ASC, l.sort_order ASC, l.id ASC');
        $stmt->execute([':from' => $from, ':to' => $to]);
        Http::json(array_map([$this, 'castLeave'], $stmt->fetchAll()));
    }

    public function storeLeave(): void
    {
        $body    = Http::body();
        $staffId = (int) ($body['staff_id'] ?? 0);
        $date    = $this->normaliseDay($body['leave_date'] ?? null);
        if ($staffId <= 0 || !$this->staffExists($staffId)) {
            Http::error('Pick a staff member', 422);
        }
        if ($date === null) {
            Http::error('A date is required', 422);
        }

        $stmt = Database::connection()->prepare(
            'INSERT INTO staff_leaves
                (staff_id, department_id, leave_date, sick_leave, break_leave, half_day, late_login, aob, sort_order)
             VALUES (:staff, :department, :date, :sick, :break, :half, :late, :aob,
                     (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM staff_leaves))
             RETURNING id'
        );
        $stmt->execute([
            ':staff'      => $staffId,
            ':department' => $this->departmentId($body['department_id'] ?? null),
            ':date'       => $date,
            ':sick'       => $this->text($body['sick_leave'] ?? ''),
            ':break'      => $this->text($body['break_leave'] ?? ''),
            ':half'       => $this->text($body['half_day'] ?? ''),
            ':late'       => $this->text($body['late_login'] ?? ''),
            ':aob'        => $this->text($body['aob'] ?? ''),
        ]);
        Http::json($this->leaveById((int) $stmt->fetchColumn()), 201);
    }

    public function updateLeave(array $params): void
    {
        $body = Http::body();
        if (isset($body['staff_id']) && !$this->staffExists((int) $body['staff_id'])) {
            Http::error('Pick a staff member', 422);
        }
        $stmt = Database::connection()->prepare(
            'UPDATE staff_leaves SET
                staff_id      = COALESCE(:staff, staff_id),
                department_id = CASE WHEN :department_set THEN :department ELSE department_id END,
                leave_date    = COALESCE(:date, leave_date),
                sick_leave    = COALESCE(:sick, sick_leave),
                break_leave   = COALESCE(:break, break_leave),
                half_day      = COALESCE(:half, half_day),
                late_login    = COALESCE(:late, late_login),
                aob           = COALESCE(:aob, aob),
                updated_at    = now()
             WHERE id = :id RETURNING id'
        );
        $stmt->execute([
            ':id'             => (int) $params['id'],
            ':staff'          => isset($body['staff_id']) ? (int) $body['staff_id'] : null,
            ':department_set' => \array_key_exists('department_id', $body) ? 1 : 0,
            ':department'     => $this->departmentId($body['department_id'] ?? null),
            ':date'           => $this->normaliseDay($body['leave_date'] ?? null),
            ':sick'           => isset($body['sick_leave']) ? $this->text($body['sick_leave']) : null,
            ':break'          => isset($body['break_leave']) ? $this->text($body['break_leave']) : null,
            ':half'           => isset($body['half_day']) ? $this->text($body['half_day']) : null,
            ':late'           => isset($body['late_login']) ? $this->text($body['late_login']) : null,
            ':aob'            => isset($body['aob']) ? $this->text($body['aob']) : null,
        ]);
        $id = $stmt->fetchColumn();
        if ($id === false || $id === null) {
            Http::error('Leave row not found', 404);
        }
        Http::json($this->leaveById((int) $id));
    }

    public function destroyLeave(array $params): void
    {
        $stmt = Database::connection()->prepare('DELETE FROM staff_leaves WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }

    // ─── Salaries (/staff-salaries) ────────────────────────────────────────────

    public function salaries(): void
    {
        $month = $this->normaliseMonth(Http::query('month'));
        if ($month === null) {
            Http::error('month must be YYYY-MM', 422);
        }
        $stmt = Database::connection()->prepare(self::SALARY_SELECT . '
              WHERE p.month = :month
              ORDER BY p.sort_order ASC, p.id ASC');
        $stmt->execute([':month' => $month]);
        Http::json(array_map([$this, 'castSalary'], $stmt->fetchAll()));
    }

    public function storeSalary(): void
    {
        $body    = Http::body();
        $staffId = (int) ($body['staff_id'] ?? 0);
        $month   = $this->normaliseMonth($body['month'] ?? null);
        if ($staffId <= 0 || !$this->staffExists($staffId)) {
            Http::error('Pick a staff member', 422);
        }
        if ($month === null) {
            Http::error('month must be YYYY-MM', 422);
        }

        // One row per person per month: re-adding updates rather than duplicating.
        $stmt = Database::connection()->prepare(
            'INSERT INTO staff_salaries (staff_id, department_id, month, status, amount, note, sort_order)
             VALUES (:staff, :department, :month, :status, :amount, :note,
                     (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM staff_salaries))
             ON CONFLICT (staff_id, month) DO UPDATE SET
                department_id = EXCLUDED.department_id,
                status        = EXCLUDED.status,
                amount        = EXCLUDED.amount,
                note          = EXCLUDED.note,
                updated_at    = now()
             RETURNING id'
        );
        $stmt->execute([
            ':staff'      => $staffId,
            ':department' => $this->departmentId($body['department_id'] ?? null),
            ':month'      => $month,
            ':status'     => $this->text($body['status'] ?? ''),
            ':amount'     => $this->money($body['amount'] ?? null),
            ':note'       => $this->text($body['note'] ?? ''),
        ]);
        Http::json($this->salaryById((int) $stmt->fetchColumn()), 201);
    }

    public function updateSalary(array $params): void
    {
        $body = Http::body();
        $stmt = Database::connection()->prepare(
            'UPDATE staff_salaries SET
                department_id = CASE WHEN :department_set THEN :department ELSE department_id END,
                status        = COALESCE(:status, status),
                amount        = CASE WHEN :amount_set THEN :amount ELSE amount END,
                note          = COALESCE(:note, note),
                updated_at    = now()
             WHERE id = :id RETURNING id'
        );
        $stmt->execute([
            ':id'             => (int) $params['id'],
            ':department_set' => \array_key_exists('department_id', $body) ? 1 : 0,
            ':department'     => $this->departmentId($body['department_id'] ?? null),
            ':status'         => isset($body['status']) ? $this->text($body['status']) : null,
            ':amount_set'     => \array_key_exists('amount', $body) ? 1 : 0,
            ':amount'         => $this->money($body['amount'] ?? null),
            ':note'           => isset($body['note']) ? $this->text($body['note']) : null,
        ]);
        $id = $stmt->fetchColumn();
        if ($id === false || $id === null) {
            Http::error('Salary row not found', 404);
        }
        Http::json($this->salaryById((int) $id));
    }

    public function destroySalary(array $params): void
    {
        $stmt = Database::connection()->prepare('DELETE FROM staff_salaries WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }

    // ─── Internals ─────────────────────────────────────────────────────────────

    private const LEAVE_SELECT =
        'SELECT l.id, l.staff_id, s.name AS staff_name, l.department_id, d.name AS department_name,
                l.leave_date::text AS leave_date, l.sick_leave, l.break_leave, l.half_day,
                l.late_login, l.aob, l.sort_order, l.created_at, l.updated_at
           FROM staff_leaves l
           JOIN staff s ON s.id = l.staff_id
      LEFT JOIN departments d ON d.id = l.department_id';

    private const SALARY_SELECT =
        'SELECT p.id, p.staff_id, s.name AS staff_name, p.department_id, d.name AS department_name,
                to_char(p.month, \'YYYY-MM-DD\') AS month, p.status, p.amount, p.note,
                p.sort_order, p.created_at, p.updated_at
           FROM staff_salaries p
           JOIN staff s ON s.id = p.staff_id
      LEFT JOIN departments d ON d.id = p.department_id';

    /** The names to add: a scalar or a list, split on commas/newlines, blanks dropped. */
    private function names(array $body): array
    {
        $raw = $body['names'] ?? $body['name'] ?? null;
        $raw = \is_array($raw) ? $raw : [$raw];

        $out = [];
        foreach ($raw as $entry) {
            if (!\is_string($entry) && !is_numeric($entry)) {
                continue;
            }
            foreach (preg_split('/[,;\n]+/', (string) $entry) ?: [] as $part) {
                $part = trim($part);
                if ($part === '') {
                    continue;
                }
                $key = mb_strtolower($part);
                if (!isset($out[$key])) {
                    $out[$key] = $part;
                }
            }
        }
        return array_values($out);
    }

    /** @return int[] positive integers, de-duplicated */
    private function ids(mixed $raw): array
    {
        if (!\is_array($raw)) {
            return [];
        }
        $ids = [];
        foreach ($raw as $id) {
            $id = (int) $id;
            if ($id > 0) {
                $ids[$id] = $id;
            }
        }
        return array_values($ids);
    }

    /** @param int[] $departmentIds  the complete set the staff row should end up with */
    private function writeDepartments(int $staffId, array $departmentIds): void
    {
        $db = Database::connection();
        $db->beginTransaction();
        try {
            $del = $db->prepare('DELETE FROM staff_departments WHERE staff_id = :staff');
            $del->execute([':staff' => $staffId]);
            $this->insertDepartments($db, $staffId, $departmentIds);
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }
    }

    /** @param int[] $departmentIds  added to whatever the staff row already has */
    private function addDepartments(int $staffId, array $departmentIds): void
    {
        $this->insertDepartments(Database::connection(), $staffId, $departmentIds);
    }

    /** @param int[] $departmentIds */
    private function insertDepartments(\PDO $db, int $staffId, array $departmentIds): void
    {
        if ($departmentIds === []) {
            return;
        }
        // SELECT … FROM departments, so a stale tab can't write a dangling link.
        $ins = $db->prepare(
            'INSERT INTO staff_departments (staff_id, department_id)
             SELECT :staff, id FROM departments WHERE id = :department
             ON CONFLICT DO NOTHING'
        );
        foreach ($departmentIds as $departmentId) {
            $ins->execute([':staff' => $staffId, ':department' => $departmentId]);
        }
    }

    /**
     * @param int[] $ids
     * @return array<int, array<string, mixed>>
     */
    private function staffByIds(array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $list = implode(',', array_map(static fn ($id): string => (string) (int) $id, $ids));
        $stmt = Database::connection()->query(
            self::STAFF_SELECT . " WHERE s.id IN ({$list}) GROUP BY s.id, qa.id"
            . ' ORDER BY s.sort_order ASC, lower(btrim(s.name)) ASC'
        );
        return array_map([$this, 'castStaff'], $stmt->fetchAll());
    }

    private function manualAttendance(int $id): array
    {
        $stmt = Database::connection()->prepare(
            "SELECT m.id, 'manual' AS source, s.id AS staff_id, s.name AS staff_name,
                    m.work_date::text AS work_date,
                    to_char(m.login_at, 'HH24:MI')  AS login_at,
                    to_char(m.logout_at, 'HH24:MI') AS logout_at,
                    m.break_min, m.status, m.note,
                    ROUND(EXTRACT(EPOCH FROM (m.logout_at - m.login_at)) / 3600.0 - m.break_min / 60.0, 2) AS net_hours,
                    ROUND(EXTRACT(EPOCH FROM (m.logout_at - m.login_at)) / 3600.0, 2) AS hours
               FROM staff_attendance m
               JOIN staff s ON s.id = m.staff_id
              WHERE m.id = :id"
        );
        $stmt->execute([':id' => $id]);
        return $this->castAttendance($stmt->fetch() ?: []);
    }

    private function leaveById(int $id): array
    {
        $stmt = Database::connection()->prepare(self::LEAVE_SELECT . ' WHERE l.id = :id');
        $stmt->execute([':id' => $id]);
        return $this->castLeave($stmt->fetch() ?: []);
    }

    private function salaryById(int $id): array
    {
        $stmt = Database::connection()->prepare(self::SALARY_SELECT . ' WHERE p.id = :id');
        $stmt->execute([':id' => $id]);
        return $this->castSalary($stmt->fetch() ?: []);
    }

    /** True when the attendance bot's tables are present in this database. */
    private function attendanceAvailable(): bool
    {
        static $available = null;
        if ($available === null) {
            $stmt = Database::connection()->query(
                "SELECT to_regclass('public.attendance_days') IS NOT NULL
                    AND to_regclass('public.attendance_breaks') IS NOT NULL"
            );
            $available = (bool) $stmt->fetchColumn();
        }
        return $available;
    }

    /** True when the bot already recorded this person's day — so it may not be keyed in. */
    private function fetchedDayExists(int $staffId, string $date): bool
    {
        if (!$this->attendanceAvailable()) {
            return false;
        }
        $stmt = Database::connection()->prepare(
            'SELECT 1
               FROM attendance_days d
               JOIN staff s ON s.attendance_user_id = d.user_id::text
              WHERE s.id = :staff AND d.work_date = :date'
        );
        $stmt->execute([':staff' => $staffId, ':date' => $date]);
        return (bool) $stmt->fetchColumn();
    }

    private function staffExists(int $id): bool
    {
        $stmt = Database::connection()->prepare('SELECT 1 FROM staff WHERE id = :id');
        $stmt->execute([':id' => $id]);
        return (bool) $stmt->fetchColumn();
    }

    /** A department id that exists, or null (unfiled). */
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
     * Point a staff row at the check-in account that carries the same name — matched on the
     * bot's display name, its username, or the raw account id, in that order of preference.
     *
     * The name is the only thing the two systems share, so it is the only thing the link can
     * be made from; there is nothing to pick in the UI. An account another staff row already
     * holds is skipped, and no match clears the link, which is what makes their days
     * hand-keyed instead of fetched.
     */
    private function linkAttendance(int $id): void
    {
        if (!$this->attendanceAvailable()) {
            return;
        }
        // Positional placeholders: the name is compared four times, and a named parameter
        // may appear only once when prepares aren't emulated.
        $stmt = Database::connection()->prepare(
            'UPDATE staff s
                SET attendance_user_id = (
                        SELECT a.user_id::text
                          FROM attendance_staff a
                         WHERE (lower(btrim(a.staff_name)) = lower(btrim(s.name))
                             OR lower(btrim(a.username))   = lower(btrim(s.name))
                             OR a.user_id::text            = btrim(s.name))
                           AND NOT EXISTS (
                               SELECT 1 FROM staff x
                                WHERE x.attendance_user_id = a.user_id::text AND x.id <> s.id
                           )
                         ORDER BY (lower(btrim(a.staff_name)) = lower(btrim(s.name))) DESC,
                                  a.user_id
                         LIMIT 1
                    ),
                    updated_at = now()
              WHERE s.id = ?'
        );
        $stmt->execute([$id]);
    }

    /** active / inactive / leave — anything else is treated as active. */
    private function status(mixed $value): string
    {
        $status = is_string($value) ? strtolower(trim($value)) : '';
        return \in_array($status, ['active', 'inactive', 'leave'], true) ? $status : 'active';
    }

    /** A trimmed single-line cell, capped so a stray paste can't fill the column. */
    private function text(mixed $value): string
    {
        return mb_substr(trim((string) $value), 0, 200);
    }

    /** "HH:MM" (or "HH:MM:SS") as keyed in, or null for a blank cell. */
    private function clock(mixed $value): ?string
    {
        if (!\is_string($value) || !preg_match('/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/', trim($value), $m)) {
            return null;
        }
        $h = (int) $m[1];
        $i = (int) $m[2];
        if ($h > 23 || $i > 59) {
            return null;
        }
        return sprintf('%02d:%02d:%02d', $h, $i, (int) ($m[3] ?? 0));
    }

    /** A money amount, or null when the cell is left blank. */
    private function money(mixed $value): ?float
    {
        if ($value === null || $value === '' || !is_numeric($value)) {
            return null;
        }
        return round((float) $value, 2);
    }

    /** Normalise a "YYYY-MM-DD" day; null for anything that isn't a real date. */
    private function normaliseDay(mixed $value): ?string
    {
        if (!\is_string($value) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m)) {
            return null;
        }
        return checkdate((int) $m[2], (int) $m[3], (int) $m[1]) ? $value : null;
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

    private function castStaff(array $row): array
    {
        $row['id']            = (int) $row['id'];
        $row['sort_order']    = (int) $row['sort_order'];
        $row['assignment_id'] = $row['assignment_id'] === null ? null : (int) $row['assignment_id'];
        // `departments` arrives as JSON text from json_agg.
        $departments = \is_string($row['departments']) ? json_decode($row['departments'], true) : $row['departments'];
        $row['departments'] = array_map(
            static fn (array $d): array => ['id' => (int) $d['id'], 'name' => (string) $d['name']],
            \is_array($departments) ? $departments : []
        );
        return $row;
    }

    private function castAttendance(array $row): array
    {
        if ($row === []) {
            return $row;
        }
        $row['id']        = $row['id'] === null ? null : (int) $row['id'];
        $row['staff_id']  = (int) $row['staff_id'];
        $row['break_min'] = (int) $row['break_min'];
        $row['hours']     = $row['hours'] === null ? null : (float) $row['hours'];
        $row['net_hours'] = $row['net_hours'] === null ? null : (float) $row['net_hours'];
        return $row;
    }

    private function castLeave(array $row): array
    {
        if ($row === []) {
            return $row;
        }
        $row['id']            = (int) $row['id'];
        $row['staff_id']      = (int) $row['staff_id'];
        $row['department_id'] = $row['department_id'] === null ? null : (int) $row['department_id'];
        $row['sort_order']    = (int) $row['sort_order'];
        return $row;
    }

    private function castSalary(array $row): array
    {
        if ($row === []) {
            return $row;
        }
        $row['id']            = (int) $row['id'];
        $row['staff_id']      = (int) $row['staff_id'];
        $row['department_id'] = $row['department_id'] === null ? null : (int) $row['department_id'];
        $row['amount']        = $row['amount'] === null ? null : (float) $row['amount'];
        $row['sort_order']    = (int) $row['sort_order'];
        return $row;
    }
}
