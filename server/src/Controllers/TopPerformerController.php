<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Auth\Auth;
use App\Database;
use App\Http;
use PDOException;

/**
 * Top Performer — the shared state behind the Review page's Top Performer tab.
 *
 * The tab judges twelve criteria for a month. Four are read from data the CRM already holds
 * (reviews, attendance, leaves) and are never stored here; the other eight are confirmed by
 * a manager per person, and it is THOSE confirmations — plus the month's settings (which
 * optional criteria apply, the performance % target) — that this endpoint keeps, so every
 * manager sees the same ticks from any browser.
 *
 *   GET /top-performer?month=YYYY-MM   the month's settings and ticks
 *   PUT /top-performer?month=YYYY-MM   replace them (the whole month's state, in one go —
 *                                      the tab autosaves after every change)
 *   GET /top-performer/range?from=&to= every month in the window, for the Annual Reviews
 *                                      tab — a twelve-month roll-up scores twelve months
 *                                      against the same ticks a manager gave each one, and
 *                                      asking for them one at a time would be twelve
 *                                      round-trips before the first figure appeared.
 *
 * `month` is the month being judged, the first of that month, exactly as review rows are
 * dated. A month nobody has touched answers with the defaults and no ticks.
 */
final class TopPerformerController
{
    /** The client's criterion ids (client/src/lib/incentive.ts); anything else is refused. */
    private const CRITERIA = [
        'behaviour', 'punctuality', 'documentation', 'login', 'participation', 'professional', 'written',
        'learning', 'goals', 'collaboration', 'innovation', 'feedback',
    ];
    /** The "if applicable" criteria — the only ones a month can switch on or off. */
    private const ADDITIONAL = ['learning', 'goals', 'collaboration', 'innovation', 'feedback'];

    private const DEFAULT_ADDITIONAL = ['goals'];
    private const DEFAULT_MIN_PERFORMANCE = 80;

    /** The longest window /range will answer — twice the longest roll-up the page offers. */
    private const MAX_RANGE_MONTHS = 24;

    public function show(): void
    {
        $month = $this->requireMonth(Http::query('month'));
        Http::json($this->state($month));
    }

    /**
     * Every month from `from` to `to` inclusive, oldest first — one entry per month whether
     * or not anybody has touched it, so the caller can score a period without checking
     * which months exist. Months nobody has touched carry the defaults, exactly as show()
     * answers them.
     */
    public function range(): void
    {
        $from = $this->requireMonth(Http::query('from'));
        $to   = $this->requireMonth(Http::query('to'));
        if ($from > $to) {
            [$from, $to] = [$to, $from];
        }

        // The months first, so an over-long window is refused before anything is read.
        $months = [];
        for ($cursor = $from; $cursor <= $to; $cursor = date('Y-m-01', strtotime($cursor . ' +1 month'))) {
            if (\count($months) >= self::MAX_RANGE_MONTHS) {
                Http::error('A range may cover at most ' . self::MAX_RANGE_MONTHS . ' months', 422);
            }
            $months[] = $cursor;
        }

        // Two queries for the whole window rather than two per month.
        $pdo  = Database::connection();
        $stmt = $pdo->prepare(
            'SELECT to_char(month, \'YYYY-MM-DD\') AS month, additional, min_performance
               FROM top_performer_months WHERE month BETWEEN :from AND :to'
        );
        $stmt->execute([':from' => $from, ':to' => $to]);
        $settings = [];
        foreach ($stmt->fetchAll() as $row) {
            $settings[$row['month']] = $this->readSettings($row);
        }

        $stmt = $pdo->prepare(
            'SELECT to_char(month, \'YYYY-MM-DD\') AS month, staff_id, criterion
               FROM top_performer_ticks WHERE month BETWEEN :from AND :to
           ORDER BY month, staff_id, criterion'
        );
        $stmt->execute([':from' => $from, ':to' => $to]);
        $ticks = [];
        foreach ($stmt->fetchAll() as $row) {
            $ticks[$row['month']][(string) $row['staff_id']][] = $row['criterion'];
        }

        Http::json(array_map(fn (string $month): array => [
            'month'    => $month,
            'settings' => $settings[$month] ?? $this->defaultSettings(),
            'ticks'    => (object) ($ticks[$month] ?? []),
        ], $months));
    }

    public function save(): void
    {
        $month = $this->requireMonth(Http::query('month'));
        $body  = Http::body();

        $settings = $this->settings($body['settings'] ?? null);
        $ticks    = $this->ticks($body['ticks'] ?? null);

        $pdo = Database::connection();
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare(
                'INSERT INTO top_performer_months (month, additional, min_performance, updated_at)
                 VALUES (:month, :additional, :min, now())
                 ON CONFLICT (month) DO UPDATE
                    SET additional = EXCLUDED.additional, min_performance = EXCLUDED.min_performance, updated_at = now()'
            );
            $stmt->execute([
                ':month'      => $month,
                ':additional' => json_encode($settings['additional']),
                ':min'        => $settings['min_performance'],
            ]);

            // The client sends the month's full set of ticks, so the stored set becomes exactly that.
            $pdo->prepare('DELETE FROM top_performer_ticks WHERE month = :month')->execute([':month' => $month]);
            $insert = $pdo->prepare(
                'INSERT INTO top_performer_ticks (month, staff_id, criterion, confirmed_by)
                 VALUES (:month, :staff, :criterion, :by)
                 ON CONFLICT DO NOTHING'
            );
            $by = Auth::user()['id'] ?? null;
            foreach ($ticks as $staffId => $criteria) {
                foreach ($criteria as $criterion) {
                    $insert->execute([':month' => $month, ':staff' => $staffId, ':criterion' => $criterion, ':by' => $by]);
                }
            }
            $pdo->commit();
        } catch (PDOException $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            // 23503 = foreign key: a tick for someone no longer on the roster.
            if ($e->getCode() === '23503') {
                Http::error('One of the people ticked is no longer on the staff roster', 422);
            }
            throw $e;
        }

        Http::json($this->state($month));
    }

    // ─── Internals ─────────────────────────────────────────────────────────────

    /** @return array{month:string,settings:array{additional:string[],min_performance:int},ticks:array<string,string[]>} */
    private function state(string $month): array
    {
        $pdo  = Database::connection();
        $stmt = $pdo->prepare('SELECT additional, min_performance FROM top_performer_months WHERE month = :month');
        $stmt->execute([':month' => $month]);
        $row = $stmt->fetch();

        $stmt = $pdo->prepare(
            'SELECT staff_id, criterion FROM top_performer_ticks WHERE month = :month ORDER BY staff_id, criterion'
        );
        $stmt->execute([':month' => $month]);
        $ticks = [];
        foreach ($stmt->fetchAll() as $t) {
            $ticks[(string) $t['staff_id']][] = $t['criterion'];
        }

        return [
            'month'    => $month,
            'settings' => $row ? $this->readSettings($row) : $this->defaultSettings(),
            // An object even when empty, so the client never receives a bare [] for a map.
            'ticks'    => (object) $ticks,
        ];
    }

    /** @return array{additional:string[],min_performance:int} */
    private function defaultSettings(): array
    {
        return ['additional' => self::DEFAULT_ADDITIONAL, 'min_performance' => self::DEFAULT_MIN_PERFORMANCE];
    }

    /**
     * A `top_performer_months` row as the API shapes it. Unknown criterion ids are left for
     * the client to drop (fromWire), so a month saved by a newer build still reads.
     *
     * @return array{additional:string[],min_performance:int}
     */
    private function readSettings(array $row): array
    {
        $decoded = json_decode((string) $row['additional'], true);
        return [
            'additional'      => is_array($decoded)
                ? array_values(array_filter($decoded, 'is_string'))
                : self::DEFAULT_ADDITIONAL,
            'min_performance' => (int) $row['min_performance'],
        ];
    }

    /** @return array{additional:string[],min_performance:int} */
    private function settings(mixed $value): array
    {
        if (!is_array($value)) {
            return ['additional' => self::DEFAULT_ADDITIONAL, 'min_performance' => self::DEFAULT_MIN_PERFORMANCE];
        }
        $additional = [];
        foreach (is_array($value['additional'] ?? null) ? $value['additional'] : [] as $id) {
            if (!is_string($id) || !in_array($id, self::ADDITIONAL, true)) {
                Http::error('settings.additional may only list criteria 8–12 by id', 422);
            }
            $additional[$id] = true;
        }
        $min = $value['min_performance'] ?? self::DEFAULT_MIN_PERFORMANCE;
        if (!is_numeric($min) || (int) $min < 0 || (int) $min > 100) {
            Http::error('settings.min_performance must be a whole number from 0 to 100', 422);
        }
        return ['additional' => array_keys($additional), 'min_performance' => (int) $min];
    }

    /** @return array<int,string[]> staff id → criterion ids */
    private function ticks(mixed $value): array
    {
        if ($value === null) {
            return [];
        }
        if (!is_array($value)) {
            Http::error('ticks must be a map of staff id to criterion ids', 422);
        }
        $out = [];
        foreach ($value as $staffId => $criteria) {
            if (!is_numeric($staffId) || (int) $staffId <= 0 || !is_array($criteria)) {
                Http::error('ticks must be a map of staff id to criterion ids', 422);
            }
            $clean = [];
            foreach ($criteria as $criterion) {
                if (!is_string($criterion) || !in_array($criterion, self::CRITERIA, true)) {
                    Http::error("Unknown criterion in ticks", 422);
                }
                $clean[$criterion] = true;
            }
            if ($clean !== []) {
                $out[(int) $staffId] = array_keys($clean);
            }
        }
        return $out;
    }

    private function requireMonth(mixed $value): string
    {
        if (is_string($value) && preg_match('/^(\d{4})-(\d{2})(?:-\d{2})?$/', $value, $m)) {
            $year  = (int) $m[1];
            $month = (int) $m[2];
            if ($month >= 1 && $month <= 12 && $year >= 1970 && $year <= 9999) {
                return sprintf('%04d-%02d-01', $year, $month);
            }
        }
        Http::error('month must be YYYY-MM — the month being judged', 422);
    }
}
