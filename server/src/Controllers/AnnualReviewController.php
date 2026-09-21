<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Auth\Auth;
use App\Database;
use App\Http;

/**
 * Annual Reviews — the hand-written layer over the Review page's half-yearly and yearly
 * roll-ups.
 *
 * The roll-up itself is not here and is never stored: the client accumulates a period from
 * the monthly review rows, the attendance and leaves sheets and the saved Top Performer
 * ticks (client/src/lib/annualReview.ts), so the six- and twelve-month figures always agree
 * with the months they are made of. Correct a rating on the Performance tab and the yearly
 * standing moves with it.
 *
 * What this endpoint keeps is only what a manager put on top of that accumulation — the
 * cells typed in over a computed one, rows added for somebody the period produced no review
 * for, and the coverage rule that decides who may be named:
 *
 *   GET    /annual-reviews?span=half|year&month=YYYY-MM   the period's stored state
 *   PUT    /annual-reviews?span=…&month=…                 replace it (the sheet autosaves)
 *   POST   /annual-reviews/reset?span=…&month=…           go back to the newest save that
 *                                                         is more than 24 hours old
 *
 * A period is named by its span and the month it ENDS on, which is the month the page's
 * selector is showing: ('year', 2026-09) is the twelve months to September 2026.
 *
 * Every PUT appends the new state to `annual_review_versions`, which is what makes Reset
 * possible: it restores the most recent version older than 24 hours, so a day's worth of
 * edits can be dropped in one action while the sheet everyone agreed on yesterday stands.
 * The restore is appended too, so a reset is itself undoable by the next day.
 */
final class AnnualReviewController
{
    private const SPANS = ['half' => 6, 'year' => 12];

    /** How far back Reset reaches: the newest save OLDER than this. */
    private const RESET_AGE = '24 hours';

    /** Versions kept per period — many days of editing, and a bounded table. */
    private const HISTORY_KEPT = 200;

    /** Caps. A sheet is a page of a report, not a data store. */
    private const MAX_ROWS    = 400;
    private const MAX_CELL    = 2000;

    public function show(): void
    {
        [$span, $end] = $this->period();
        Http::json($this->state($span, $end));
    }

    public function save(): void
    {
        [$span, $end] = $this->period();
        $body = Http::body();

        $sheet = [
            'overrides'  => $this->overrides($body['overrides'] ?? null),
            'extra_rows' => $this->extraRows($body['extra_rows'] ?? null),
            'settings'   => $this->settings($body['settings'] ?? null, $span),
        ];

        $pdo = Database::connection();
        $pdo->beginTransaction();
        try {
            $this->write($span, $end, $sheet);
            $this->appendVersion($span, $end, $sheet);
            $this->prune($span, $end);
            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        Http::json($this->state($span, $end));
    }

    /**
     * Put the period back to the newest state saved more than 24 hours ago.
     *
     * A period with no such version has nothing to go back TO — today's edits are all there
     * is — so it is refused rather than silently wiping the sheet; the button that calls
     * this is disabled in the same case and says why.
     */
    public function reset(): void
    {
        [$span, $end] = $this->period();

        $pdo  = Database::connection();
        $stmt = $pdo->prepare($this->resetCandidateSql('overrides, extra_rows, settings, saved_at'));
        $stmt->execute([':span' => $span, ':end' => $end]);
        $row = $stmt->fetch();
        if (!$row) {
            Http::error('There is no saved version of this sheet older than 24 hours to go back to', 409);
        }

        // Decoded and re-validated rather than copied through: a version written by an older
        // build must land in this build's shape, and the sheet is what the page renders.
        $sheet = [
            'overrides'  => $this->overrides(json_decode((string) $row['overrides'], true)),
            'extra_rows' => $this->extraRows(json_decode((string) $row['extra_rows'], true)),
            'settings'   => $this->settings(json_decode((string) $row['settings'], true), $span),
        ];

        $pdo->beginTransaction();
        try {
            $this->write($span, $end, $sheet);
            // The restore is a save of its own, so tomorrow's Reset can undo today's reset.
            $this->appendVersion($span, $end, $sheet);
            $this->prune($span, $end);
            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        Http::json($this->state($span, $end) + ['restored_from' => $row['saved_at']]);
    }

    // ─── Internals ─────────────────────────────────────────────────────────────

    /** Reset's one question, in SQL: the newest save of this period older than RESET_AGE. */
    private function resetCandidateSql(string $select): string
    {
        return "SELECT {$select}
                  FROM annual_review_versions
                 WHERE span = :span
                   AND period_end = :end
                   AND saved_at < now() - INTERVAL '" . self::RESET_AGE . "'
              ORDER BY saved_at DESC
                 LIMIT 1";
    }

    /**
     * The period's stored state, plus what Reset would reach for — the page shows that
     * timestamp on the button, and disables it when there is nothing that old.
     */
    private function state(string $span, string $end): array
    {
        $pdo  = Database::connection();
        $stmt = $pdo->prepare(
            'SELECT overrides, extra_rows, settings, updated_at
               FROM annual_review_sheets WHERE span = :span AND period_end = :end'
        );
        $stmt->execute([':span' => $span, ':end' => $end]);
        $row = $stmt->fetch();

        $stmt = $pdo->prepare($this->resetCandidateSql('saved_at'));
        $stmt->execute([':span' => $span, ':end' => $end]);
        $resetTo = $stmt->fetchColumn();

        return [
            'span'       => $span,
            'period_end' => $end,
            'months'     => self::SPANS[$span],
            // Empty defaults rather than null, so the client has one shape to render.
            'overrides'  => (object) $this->decodeMap($row['overrides'] ?? null),
            'extra_rows' => $this->decodeList($row['extra_rows'] ?? null),
            'settings'   => (object) $this->decodeMap($row['settings'] ?? null),
            'updated_at' => $row['updated_at'] ?? null,
            // The save Reset would restore, or null when nothing here is a day old yet.
            'reset_to'   => $resetTo === false ? null : $resetTo,
        ];
    }

    private function decodeList(mixed $json): array
    {
        $decoded = $json === null ? null : json_decode((string) $json, true);
        return is_array($decoded) ? array_values($decoded) : [];
    }

    private function decodeMap(mixed $json): array
    {
        $decoded = $json === null ? null : json_decode((string) $json, true);
        return is_array($decoded) ? $decoded : [];
    }

    private function write(string $span, string $end, array $sheet): void
    {
        $stmt = Database::connection()->prepare(
            'INSERT INTO annual_review_sheets (span, period_end, overrides, extra_rows, settings, updated_at)
             VALUES (:span, :end, :overrides, :extra, :settings, now())
             ON CONFLICT (span, period_end) DO UPDATE SET
                overrides  = EXCLUDED.overrides,
                extra_rows = EXCLUDED.extra_rows,
                settings   = EXCLUDED.settings,
                updated_at = now()'
        );
        $stmt->execute($this->bind($span, $end, $sheet));
    }

    private function appendVersion(string $span, string $end, array $sheet): void
    {
        $stmt = Database::connection()->prepare(
            'INSERT INTO annual_review_versions (span, period_end, overrides, extra_rows, settings, saved_by)
             VALUES (:span, :end, :overrides, :extra, :settings, :by)'
        );
        $stmt->execute($this->bind($span, $end, $sheet) + [':by' => Auth::user()['id'] ?? null]);
    }

    /** @return array<string, string> */
    private function bind(string $span, string $end, array $sheet): array
    {
        return [
            ':span'      => $span,
            ':end'       => $end,
            // JSON_FORCE_OBJECT would also turn the nested cell maps into objects, which is
            // what we want here: an empty map must be {} and not [], or JSONB stores a list.
            ':overrides' => json_encode($sheet['overrides'], JSON_FORCE_OBJECT),
            ':extra'     => json_encode($sheet['extra_rows']),
            ':settings'  => json_encode($sheet['settings'], JSON_FORCE_OBJECT),
        ];
    }

    /** Keep the newest HISTORY_KEPT saves of this period; the rest is older than Reset needs. */
    private function prune(string $span, string $end): void
    {
        $stmt = Database::connection()->prepare(
            'DELETE FROM annual_review_versions
              WHERE span = :span AND period_end = :end AND id NOT IN (
                    SELECT id FROM annual_review_versions
                     WHERE span = :span2 AND period_end = :end2
                  ORDER BY saved_at DESC LIMIT ' . self::HISTORY_KEPT . ')'
        );
        $stmt->execute([':span' => $span, ':end' => $end, ':span2' => $span, ':end2' => $end]);
    }

    // ─── Validation ────────────────────────────────────────────────────────────

    /**
     * The typed-in cells: row key → column id → text. A blank is not stored — clearing a
     * cell is how a manager hands it back to the accumulation, so an empty string would
     * mean "overridden to blank" and pin the computed value out of sight forever.
     *
     * @return array<string, array<string, string>>
     */
    private function overrides(mixed $value): array
    {
        if ($value === null) {
            return [];
        }
        if (!is_array($value)) {
            Http::error('overrides must be a map of row key to column values', 422);
        }
        if (\count($value) > self::MAX_ROWS) {
            Http::error('A sheet may hold at most ' . self::MAX_ROWS . ' rows', 422);
        }
        $out = [];
        foreach ($value as $rowKey => $cells) {
            if (!is_string($rowKey) || trim($rowKey) === '' || !is_array($cells)) {
                Http::error('overrides must be a map of row key to column values', 422);
            }
            $clean = [];
            foreach ($cells as $colId => $cell) {
                if (!is_string($colId) || trim($colId) === '') {
                    Http::error('Every override needs a column id', 422);
                }
                if (is_bool($cell) || is_array($cell)) {
                    Http::error('An override cell must be text or a number', 422);
                }
                $text = mb_substr(trim((string) $cell), 0, self::MAX_CELL);
                if ($text !== '') {
                    $clean[mb_substr(trim($colId), 0, 64)] = $text;
                }
            }
            if ($clean !== []) {
                $out[mb_substr(trim($rowKey), 0, 64)] = $clean;
            }
        }
        return $out;
    }

    /**
     * Rows added by hand — somebody the period's reviews produced no row for, or a line the
     * report wants that is not a person at all. Everything in such a row is an override.
     *
     * @return array<int, array{key:string,name:string}>
     */
    private function extraRows(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }
        if (\count($value) > self::MAX_ROWS) {
            Http::error('A sheet may hold at most ' . self::MAX_ROWS . ' rows', 422);
        }
        $out  = [];
        $seen = [];
        foreach ($value as $row) {
            if (!is_array($row) || !is_string($row['key'] ?? null) || trim($row['key']) === '') {
                Http::error('Every added row needs a key', 422);
            }
            $key = mb_substr(trim($row['key']), 0, 64);
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $out[] = ['key' => $key, 'name' => mb_substr(trim((string) ($row['name'] ?? '')), 0, 120)];
        }
        return $out;
    }

    /**
     * The period's one rule: how many of its months a person must have been reviewed in
     * before the roll-up will name them its top or lowest performer. It stops a single good
     * month in twelve from winning the year. Absent means the client's own default — half
     * the period's months, rounded up.
     *
     * @return array{min_months?:int}
     */
    private function settings(mixed $value, string $span): array
    {
        if (!is_array($value)) {
            return [];
        }
        $min = $value['min_months'] ?? null;
        if ($min === null || $min === '') {
            return [];
        }
        if (!is_numeric($min) || (int) $min < 0 || (int) $min > self::SPANS[$span]) {
            Http::error('settings.min_months must be a whole number from 0 to ' . self::SPANS[$span], 422);
        }
        return ['min_months' => (int) $min];
    }

    /**
     * The period a request is about: its span, and the first of the month it ends on.
     *
     * @return array{0:string,1:string}
     */
    private function period(): array
    {
        $span = strtolower(trim((string) (Http::query('span') ?? '')));
        if (!isset(self::SPANS[$span])) {
            Http::error('span must be half (6 months) or year (12 months)', 422);
        }
        $month = Http::query('month');
        if (is_string($month) && preg_match('/^(\d{4})-(\d{2})(?:-\d{2})?$/', $month, $m)) {
            $year = (int) $m[1];
            $mm   = (int) $m[2];
            if ($mm >= 1 && $mm <= 12 && $year >= 1970 && $year <= 9999) {
                return [$span, sprintf('%04d-%02d-01', $year, $mm)];
            }
        }
        Http::error('month must be YYYY-MM — the month the period ends on', 422);
    }
}
