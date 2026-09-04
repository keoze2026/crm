<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Database;
use App\Http;

/**
 * Queues — the CRUD behind the Queues page.
 *
 * Three resources:
 *   /queue-people — the NAMES catalogue the page picks from
 *   /queue-codes  — the QUEUES catalogue the page ticks
 *   /queues       — one record per person: the person plus the queues they cover
 *
 * A record's TOTAL is never stored (it is how many codes are linked to it) and neither is
 * its Sr. No. (that is its position in the sheet), so the two can't drift from the queues
 * shown beside them. There is no reporting date: `created_at` is the day the record was
 * keyed in, which is what the page's History section groups by, and `?day=YYYY-MM-DD`
 * narrows the list to one such day.
 *
 * Both catalogues take a LIST on create ("BHS, BOP Q04" or "Anna, Camp Team"), so a sheet
 * can be seeded in one call; each answers with the rows it created AND the ones that were
 * already there, letting the page tick everything the user typed and report duplicates
 * without treating them as an error.
 */
final class QueueController
{
    /** A record with its person's name and its queues, as every /queues response shapes it. */
    private const RECORD_SELECT =
        'SELECT a.id, a.person_id, p.name, a.sort_order, a.created_at, a.updated_at,
                COALESCE(
                    json_agg(json_build_object(\'id\', c.id, \'code\', c.code)
                             ORDER BY upper(btrim(c.code)))
                    FILTER (WHERE c.id IS NOT NULL),
                    \'[]\'
                ) AS codes
           FROM queue_assignments a
           JOIN queue_people p ON p.id = a.person_id
      LEFT JOIN queue_assignment_codes ac ON ac.assignment_id = a.id
      LEFT JOIN queue_codes c ON c.id = ac.code_id';

    /** `assignment_id` lets the page jump from a name straight to its record. */
    private const PEOPLE_SELECT =
        'SELECT p.id, p.name, a.id AS assignment_id, p.created_at, p.updated_at
           FROM queue_people p
      LEFT JOIN queue_assignments a ON a.person_id = p.id';

    /** `usage_count` is what the page warns with before deleting a queue. */
    private const CODES_SELECT =
        'SELECT c.id, c.code, COUNT(ac.assignment_id) AS usage_count, c.created_at, c.updated_at
           FROM queue_codes c
      LEFT JOIN queue_assignment_codes ac ON ac.code_id = c.id';

    // ─── Records (/queues) ─────────────────────────────────────────────────────

    public function index(): void
    {
        $sql    = self::RECORD_SELECT;
        $params = [];

        $day = $this->normaliseDay(Http::query('day'));
        if ($day !== null) {
            // Compared in the server's local time, so the filter lines up with the date the
            // History section shows for the same record.
            $sql .= ' WHERE a.created_at::date = :day';
            $params[':day'] = $day;
        }
        $sql .= ' GROUP BY a.id, p.name ORDER BY a.sort_order ASC, a.id ASC';

        $stmt = Database::connection()->prepare($sql);
        $stmt->execute($params);
        Http::json(array_map([$this, 'castRecord'], $stmt->fetchAll()));
    }

    public function store(): void
    {
        $body     = Http::body();
        $personId = (int) ($body['person_id'] ?? 0);
        if ($personId <= 0 || !$this->personExists($personId)) {
            Http::error('Pick a name for this record', 422);
        }

        // One record per person: adding for someone who already has one updates it, so the
        // sheet can never end up with two rows for the same name.
        $existing = $this->recordIdForPerson($personId);
        if ($existing !== null) {
            $this->writeCodes($existing, $this->codeIds($body));
            $this->touch($existing);
            Http::json($this->record($existing));
        }

        $stmt = Database::connection()->prepare(
            'INSERT INTO queue_assignments (person_id, sort_order) VALUES (:person, :sort) RETURNING id'
        );
        $stmt->execute([
            ':person' => $personId,
            ':sort'   => isset($body['sort_order']) ? (int) $body['sort_order'] : $this->nextSortOrder(),
        ]);
        $id = (int) $stmt->fetchColumn();

        $this->writeCodes($id, $this->codeIds($body));
        Http::json($this->record($id), 201);
    }

    public function update(array $params): void
    {
        $id   = (int) $params['id'];
        $body = Http::body();
        if ($this->record($id) === null) {
            Http::error('Record not found', 404);
        }

        // Moving a record to another name is how the page fixes "I picked the wrong
        // person" — refused when that name already holds a record of its own.
        if (isset($body['person_id'])) {
            $personId = (int) $body['person_id'];
            if ($personId <= 0 || !$this->personExists($personId)) {
                Http::error('Pick a name for this record', 422);
            }
            $owner = $this->recordIdForPerson($personId);
            if ($owner !== null && $owner !== $id) {
                Http::error('That name already has a record — edit that one instead', 409);
            }
            $stmt = Database::connection()->prepare(
                'UPDATE queue_assignments SET person_id = :person, updated_at = now() WHERE id = :id'
            );
            $stmt->execute([':person' => $personId, ':id' => $id]);
        }

        if (\array_key_exists('code_ids', $body)) {
            $this->writeCodes($id, $this->codeIds($body));
            $this->touch($id);
        }

        Http::json($this->record($id));
    }

    public function destroy(array $params): void
    {
        $stmt = Database::connection()->prepare('DELETE FROM queue_assignments WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }

    // ─── Names catalogue (/queue-people) ───────────────────────────────────────

    public function people(): void
    {
        $stmt = Database::connection()->query(self::PEOPLE_SELECT . ' ORDER BY lower(btrim(p.name)) ASC');
        Http::json(array_map([$this, 'castPerson'], $stmt->fetchAll()));
    }

    public function storePeople(): void
    {
        // Names may hold spaces, so a pasted list is comma/newline separated only.
        $names = $this->values(Http::body(), '/[,;\n]+/', 'names', 'name');
        if ($names === []) {
            Http::error('A name is required', 422);
        }
        $ids = $this->insertCatalogue('queue_people', 'name', 'lower', $names);
        Http::json([
            'created'  => $this->peopleByIds($ids['created']),
            'existing' => $this->peopleByIds($ids['existing']),
        ], $ids['created'] === [] ? 200 : 201);
    }

    public function updatePerson(array $params): void
    {
        $name = trim((string) (Http::body()['name'] ?? ''));
        if ($name === '') {
            Http::error('A name is required', 422);
        }
        $id = (int) $params['id'];
        if ($this->takenBy('queue_people', 'name', 'lower', $name, $id)) {
            Http::error('Another name in the list is already called that', 409);
        }

        $stmt = Database::connection()->prepare(
            'UPDATE queue_people SET name = :name, updated_at = now() WHERE id = :id'
        );
        $stmt->execute([':name' => $name, ':id' => $id]);
        if ($stmt->rowCount() === 0) {
            Http::error('Name not found', 404);
        }
        Http::json($this->peopleByIds([$id])[0]);
    }

    public function destroyPerson(array $params): void
    {
        // ON DELETE CASCADE takes the person's record (and its queue links) with them.
        $stmt = Database::connection()->prepare('DELETE FROM queue_people WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }

    // ─── Queues catalogue (/queue-codes) ───────────────────────────────────────

    public function codes(): void
    {
        $stmt = Database::connection()->query(
            self::CODES_SELECT . ' GROUP BY c.id ORDER BY upper(btrim(c.code)) ASC'
        );
        Http::json(array_map([$this, 'castCode'], $stmt->fetchAll()));
    }

    public function storeCodes(): void
    {
        // Codes never contain whitespace, so a pasted list may separate them any way it
        // likes — the same split the sheet used back when queues were free text.
        $codes = $this->values(Http::body(), '/[,;\/|\s]+/', 'codes', 'code');
        if ($codes === []) {
            Http::error('A queue code is required', 422);
        }
        $ids = $this->insertCatalogue('queue_codes', 'code', 'upper', $codes);
        Http::json([
            'created'  => $this->codesByIds($ids['created']),
            'existing' => $this->codesByIds($ids['existing']),
        ], $ids['created'] === [] ? 200 : 201);
    }

    public function updateCode(array $params): void
    {
        $code = trim((string) (Http::body()['code'] ?? ''));
        if ($code === '') {
            Http::error('A queue code is required', 422);
        }
        $id = (int) $params['id'];
        if ($this->takenBy('queue_codes', 'code', 'upper', $code, $id)) {
            Http::error('Another queue is already called that', 409);
        }

        $stmt = Database::connection()->prepare(
            'UPDATE queue_codes SET code = :code, updated_at = now() WHERE id = :id'
        );
        $stmt->execute([':code' => $code, ':id' => $id]);
        if ($stmt->rowCount() === 0) {
            Http::error('Queue not found', 404);
        }
        Http::json($this->codesByIds([$id])[0]);
    }

    public function destroyCode(array $params): void
    {
        // ON DELETE CASCADE drops the code from every record that used it.
        $stmt = Database::connection()->prepare('DELETE FROM queue_codes WHERE id = :id');
        $stmt->execute([':id' => (int) $params['id']]);
        Http::json(['deleted' => $stmt->rowCount() > 0]);
    }

    // ─── Internals ─────────────────────────────────────────────────────────────

    /**
     * Insert a list of catalogue values, skipping the ones already there.
     *
     * @param string   $fold    'lower' for names, 'upper' for codes — matches the table's
     *                          case-insensitive unique index
     * @param string[] $values
     * @return array{created: int[], existing: int[]}  ids, hydrated by the caller
     */
    private function insertCatalogue(string $table, string $column, string $fold, array $values): array
    {
        $db     = Database::connection();
        $insert = $db->prepare(
            "INSERT INTO {$table} ({$column}) VALUES (:value) ON CONFLICT DO NOTHING RETURNING id"
        );
        // Run for the values ON CONFLICT skipped, so the caller learns which rows already
        // held them (the page ticks those too rather than reporting an error).
        $lookup = $db->prepare(
            "SELECT id FROM {$table} WHERE {$fold}(btrim({$column})) = {$fold}(btrim(:value))"
        );

        $created  = [];
        $existing = [];
        foreach ($values as $value) {
            $insert->execute([':value' => $value]);
            $id = $insert->fetchColumn();
            if ($id !== false && $id !== null) {
                $created[] = (int) $id;
                continue;
            }
            $lookup->execute([':value' => $value]);
            $id = $lookup->fetchColumn();
            if ($id !== false && $id !== null) {
                $existing[] = (int) $id;
            }
        }
        return ['created' => $created, 'existing' => $existing];
    }

    /**
     * The values to add to a catalogue: a scalar or a list, each entry split on
     * $separator and trimmed, with blanks and in-payload repeats dropped.
     *
     * @return string[]
     */
    private function values(array $body, string $separator, string $listKey, string $oneKey): array
    {
        $raw = $body[$listKey] ?? $body[$oneKey] ?? null;
        $raw = \is_array($raw) ? $raw : [$raw];

        $out = [];
        foreach ($raw as $entry) {
            if (!\is_string($entry) && !is_numeric($entry)) {
                continue;
            }
            foreach (preg_split($separator, (string) $entry) ?: [] as $part) {
                $part = trim($part);
                if ($part === '') {
                    continue;
                }
                $key = mb_strtolower($part);   // case-insensitive de-dupe within the payload
                if (!isset($out[$key])) {
                    $out[$key] = $part;
                }
            }
        }
        return array_values($out);
    }

    /**
     * Replace a record's queue links in one transaction, keeping only ids that really
     * exist in the catalogue (a stale tab can't write a dangling link).
     *
     * @param int[] $codeIds
     */
    private function writeCodes(int $assignmentId, array $codeIds): void
    {
        $db = Database::connection();
        $db->beginTransaction();
        try {
            $del = $db->prepare('DELETE FROM queue_assignment_codes WHERE assignment_id = :id');
            $del->execute([':id' => $assignmentId]);

            if ($codeIds !== []) {
                $ins = $db->prepare(
                    'INSERT INTO queue_assignment_codes (assignment_id, code_id)
                     SELECT :assignment, id FROM queue_codes WHERE id = :code
                     ON CONFLICT DO NOTHING'
                );
                foreach ($codeIds as $codeId) {
                    $ins->execute([':assignment' => $assignmentId, ':code' => $codeId]);
                }
            }
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }
    }

    /**
     * The selected queue ids from a request body — positive integers, de-duplicated.
     *
     * @return int[]
     */
    private function codeIds(array $body): array
    {
        $raw = $body['code_ids'] ?? [];
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

    /** One record in the shape index() returns, or null when it no longer exists. */
    private function record(int $id): ?array
    {
        $stmt = Database::connection()->prepare(
            self::RECORD_SELECT . ' WHERE a.id = :id GROUP BY a.id, p.name'
        );
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        return $row ? $this->castRecord($row) : null;
    }

    /**
     * @param int[] $ids
     * @return array<int, array<string, mixed>>
     */
    private function peopleByIds(array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $stmt = Database::connection()->query(
            self::PEOPLE_SELECT . ' WHERE p.id IN (' . $this->idList($ids) . ')'
            . ' ORDER BY lower(btrim(p.name)) ASC'
        );
        return array_map([$this, 'castPerson'], $stmt->fetchAll());
    }

    /**
     * @param int[] $ids
     * @return array<int, array<string, mixed>>
     */
    private function codesByIds(array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $stmt = Database::connection()->query(
            self::CODES_SELECT . ' WHERE c.id IN (' . $this->idList($ids) . ')'
            . ' GROUP BY c.id ORDER BY upper(btrim(c.code)) ASC'
        );
        return array_map([$this, 'castCode'], $stmt->fetchAll());
    }

    /** A comma-separated integer list for an IN (…) clause — every value cast to int. */
    private function idList(array $ids): string
    {
        return implode(',', array_map(static fn ($id): string => (string) (int) $id, $ids));
    }

    private function castRecord(array $row): array
    {
        $row['id']         = (int) $row['id'];
        $row['person_id']  = (int) $row['person_id'];
        $row['sort_order'] = (int) $row['sort_order'];
        // `codes` arrives as JSON text from json_agg.
        $codes = \is_string($row['codes']) ? json_decode($row['codes'], true) : $row['codes'];
        $row['codes'] = array_map(
            static fn (array $c): array => ['id' => (int) $c['id'], 'code' => (string) $c['code']],
            \is_array($codes) ? $codes : []
        );
        return $row;
    }

    private function castPerson(array $row): array
    {
        $row['id']            = (int) $row['id'];
        $row['assignment_id'] = $row['assignment_id'] === null ? null : (int) $row['assignment_id'];
        return $row;
    }

    private function castCode(array $row): array
    {
        $row['id']          = (int) $row['id'];
        $row['usage_count'] = (int) $row['usage_count'];
        return $row;
    }

    private function touch(int $id): void
    {
        $stmt = Database::connection()->prepare('UPDATE queue_assignments SET updated_at = now() WHERE id = :id');
        $stmt->execute([':id' => $id]);
    }

    private function personExists(int $id): bool
    {
        $stmt = Database::connection()->prepare('SELECT 1 FROM queue_people WHERE id = :id');
        $stmt->execute([':id' => $id]);
        return (bool) $stmt->fetchColumn();
    }

    private function recordIdForPerson(int $personId): ?int
    {
        $stmt = Database::connection()->prepare('SELECT id FROM queue_assignments WHERE person_id = :person');
        $stmt->execute([':person' => $personId]);
        $id = $stmt->fetchColumn();
        return $id === false || $id === null ? null : (int) $id;
    }

    /** True when a row other than $id already holds this value, ignoring case. */
    private function takenBy(string $table, string $column, string $fold, string $value, int $id): bool
    {
        $stmt = Database::connection()->prepare(
            "SELECT 1 FROM {$table}
              WHERE {$fold}(btrim({$column})) = {$fold}(btrim(:value)) AND id <> :id"
        );
        $stmt->execute([':value' => $value, ':id' => $id]);
        return (bool) $stmt->fetchColumn();
    }

    /** Normalise a "YYYY-MM-DD" day filter; null for anything that isn't a valid date. */
    private function normaliseDay(mixed $value): ?string
    {
        if (!\is_string($value) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m)) {
            return null;
        }
        return checkdate((int) $m[2], (int) $m[3], (int) $m[1]) ? $value : null;
    }

    private function nextSortOrder(): int
    {
        $stmt = Database::connection()->query(
            'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM queue_assignments'
        );
        return (int) $stmt->fetchColumn();
    }
}
