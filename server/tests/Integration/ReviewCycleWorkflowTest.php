<?php

declare(strict_types=1);

namespace Tests\Integration;

use Tests\Api\AuthApiHelpers;
use Tests\ApiTestCase;

/**
 * A manager's review year, as the Review page drives it with auth on: people and departments,
 * the monthly Performance / Behaviour rows, the month's Top Performer ticks, then the six- and
 * twelve-month windows the Annual Reviews tab reads and the cells typed over them. The month
 * a row is ABOUT must line up across every one of those endpoints.
 */
final class ReviewCycleWorkflowTest extends ApiTestCase
{
    use AuthApiHelpers;

    private const HALF = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];

    private array $manager;

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables(
            'review_entries', 'department_reviews', 'staff_departments', 'departments', 'staff',
            'top_performer_ticks', 'top_performer_months', 'annual_review_versions', 'annual_review_sheets',
            'users', 'sessions', 'audit_log'
        );
        // A supervisor, not an admin: the `reviews` page alone must carry the whole cycle.
        $this->manager = self::createEnrolledUser('manager', 'member', ['reviews']);
        $this->loginAs($this->manager);
    }

    /** @return array<string,int> name => staff id */
    private function roster(string ...$names): array
    {
        $r = $this->post('/staff', ['names' => $names], true);
        $this->assertStatus(201, $r);
        return array_column($r['json']['created'], 'id', 'name');
    }

    private function review(string $kind, string $name, string $month, array $extra = []): array
    {
        $r = $this->post('/review-entries', ['kind' => $kind, 'person_name' => $name, 'month' => $month] + $extra, true);
        $this->assertStatus(201, $r);
        return $r['json'];
    }

    private function saveMonth(string $month, array $ticks, ?array $settings = null): array
    {
        $body = ['ticks' => (object) $ticks];
        if ($settings !== null) {
            $body['settings'] = $settings;
        }
        $r = $this->put("/top-performer?month={$month}", $body, true);
        $this->assertStatus(200, $r);
        return $r['json'];
    }

    /** @return array<string, array> the window keyed by YYYY-MM */
    private function range(string $from, string $to): array
    {
        $r = $this->get("/top-performer/range?from={$from}&to={$to}", true);
        $this->assertStatus(200, $r);
        $out = [];
        foreach ($r['json'] as $entry) {
            $out[substr($entry['month'], 0, 7)] = $entry;
        }
        return $out;
    }

    private function sheet(string $span, string $month): array
    {
        $r = $this->get("/annual-reviews?span={$span}&month={$month}", true);
        $this->assertStatus(200, $r);
        return $r['json'];
    }

    public function testAYearOfMonthlyReviewsAndTicksLinesUpInTheAnnualWindows(): void
    {
        $ids = $this->roster('Ann', 'Ben', 'Cal');
        [$ann, $ben, $cal] = [$ids['Ann'], $ids['Ben'], $ids['Cal']];

        $ops = $this->post('/review-departments', ['name' => 'Ops', 'month' => '2026-03', 'performance' => 'Good', 'percentage' => 80], true);
        $this->assertStatus(201, $ops);
        $opsId = $ops['json']['id'];

        // Six months of rows; Cal only joins in August. Names are typed, links resolved.
        foreach (self::HALF as $i => $month) {
            $this->assertSame($ann, $this->review('performance', 'Ann', $month, ['department_id' => $opsId, 'percentage' => 90 - $i])['staff_id']);
            $this->assertSame($ben, $this->review('performance', 'ben', $month, ['department_id' => $opsId, 'percentage' => 60 + $i])['staff_id']);
            $this->review('behaviour', 'Ann', $month, ['rating' => 'Excellent']);
        }
        $this->review('performance', 'Cal', '2026-08', ['percentage' => 99]);
        // An earlier month, inside the year but outside the half.
        $this->review('performance', 'Ann', '2025-09', ['percentage' => 70]);

        // The ticks each month were confirmed with.
        $saved = [];
        foreach (self::HALF as $i => $month) {
            $ticks = [(string) $ann => ['documentation', 'participation'], (string) $ben => ['written']];
            if ($month === '2026-08') {
                $ticks[(string) $cal] = ['behaviour'];
            }
            $settings = $month === '2026-05' ? ['additional' => ['goals', 'learning'], 'min_performance' => 75] : null;
            $saved[$month] = $this->saveMonth($month, $ticks, $settings);
        }
        $this->saveMonth('2025-09', [(string) $ann => ['feedback']], ['additional' => ['feedback'], 'min_performance' => 60]);

        // ── The six-month window equals the months it is made of, one by one ──
        $half = $this->range('2026-03', '2026-08');
        $this->assertSame(self::HALF, array_keys($half));
        foreach (self::HALF as $month) {
            $this->assertEquals($saved[$month], $half[$month], "range and show agree for {$month}");
            $this->assertEquals($this->get("/top-performer?month={$month}", true)['json'], $half[$month]);
        }
        $this->assertSame(['additional' => ['goals', 'learning'], 'min_performance' => 75], $half['2026-05']['settings']);
        $this->assertSame(['additional' => ['goals'], 'min_performance' => 80], $half['2026-04']['settings']);

        // Asking with the ends the other way round is the same window.
        $this->assertEquals($half, $this->range('2026-08', '2026-03'));

        // ── The twelve-month window: every month present, untouched ones on the defaults ──
        $year = $this->range('2025-09', '2026-08');
        $this->assertCount(12, $year);
        $this->assertSame([(string) $ann => ['feedback']], $year['2025-09']['ticks']);
        foreach (['2025-10', '2025-11', '2025-12', '2026-01', '2026-02'] as $month) {
            $this->assertSame([], $year[$month]['ticks'], $month);
            $this->assertSame(['additional' => ['goals'], 'min_performance' => 80], $year[$month]['settings']);
        }
        $this->assertStatus(422, $this->get('/top-performer/range?from=2024-01&to=2026-08', true));

        // Every ticked id and every linked review row points at someone on the roster, and
        // everyone ticked in a month was reviewed that month.
        $rosterIds = array_column($this->get('/staff', true)['json'], 'id');
        foreach ($year as $key => $entry) {
            $reviewed = array_filter(array_column(
                $this->get("/review-entries?kind=performance&month={$key}", true)['json'], 'staff_id'
            ));
            foreach (array_keys($entry['ticks']) as $sid) {
                $this->assertContains((int) $sid, $rosterIds);
                $this->assertContains((int) $sid, $reviewed, "ticked in {$key} but not reviewed then");
            }
        }
        $this->assertSame(
            0,
            self::countRows('SELECT count(*) FROM top_performer_ticks WHERE confirmed_by IS DISTINCT FROM :m', [':m' => $this->manager['id']]),
            'every tick records the manager who confirmed it'
        );

        // ── The Annual Reviews sheets over those windows ──
        $r = $this->put('/annual-reviews?span=half&month=2026-08', [
            'overrides'  => ["s:{$ann}" => ['performance' => '95'], "s:{$ben}" => ['performance' => '   ']],
            'extra_rows' => [['key' => 'x:temp', 'name' => 'Temp cover']],
            'settings'   => ['min_months' => 3],
        ], true);
        $this->assertStatus(200, $r);
        $this->assertSame(["s:{$ann}" => ['performance' => '95']], $r['json']['overrides'], 'a blank cell hands it back to the roll-up');
        $this->assertSame(6, $r['json']['months']);
        $this->assertNull($r['json']['reset_to']);

        $this->assertStatus(200, $this->put('/annual-reviews?span=year&month=2026-08', [
            'overrides' => ["s:{$ben}" => ['standing' => 'Low']],
        ], true));

        // The two windows ending in August are separate sheets.
        $this->assertSame(["s:{$ann}" => ['performance' => '95']], $this->sheet('half', '2026-08')['overrides']);
        $this->assertSame(["s:{$ben}" => ['standing' => 'Low']], $this->sheet('year', '2026-08')['overrides']);
        $this->assertSame(12, $this->sheet('year', '2026-08')['months']);

        // Clearing the typed cell, then Reset: nothing is a day old yet, so there is nothing to go back to.
        $this->assertStatus(200, $this->put('/annual-reviews?span=half&month=2026-08', ['overrides' => [], 'settings' => ['min_months' => 3]], true));
        $this->assertSame([], $this->sheet('half', '2026-08')['overrides']);
        $this->assertStatus(409, $this->post('/annual-reviews/reset?span=half&month=2026-08', [], true));

        // Yesterday's agreed sheet, then Reset brings it back and is itself recorded.
        self::db()->exec("INSERT INTO annual_review_versions (span, period_end, overrides, extra_rows, settings, saved_by, saved_at)
            VALUES ('half', '2026-08-01', '{\"s:{$ann}\": {\"performance\": \"88\"}}', '[]', '{\"min_months\": 4}', NULL, now() - interval '30 hours')");
        $this->assertNotNull($this->sheet('half', '2026-08')['reset_to']);
        $r = $this->post('/annual-reviews/reset?span=half&month=2026-08', [], true);
        $this->assertStatus(200, $r);
        $this->assertSame(["s:{$ann}" => ['performance' => '88']], $r['json']['overrides']);
        $this->assertSame(['min_months' => 4], $r['json']['settings']);
        $this->assertSame([], $r['json']['extra_rows']);
        $this->assertSame(["s:{$ben}" => ['standing' => 'Low']], $this->sheet('year', '2026-08')['overrides'], 'the year sheet is untouched');

        $versions = self::db()->query(
            "SELECT saved_by FROM annual_review_versions WHERE span = 'half' ORDER BY saved_at, id"
        )->fetchAll(\PDO::FETCH_COLUMN);
        $this->assertCount(4, $versions);
        $this->assertSame([null, $this->manager['id'], $this->manager['id'], $this->manager['id']], array_map(
            static fn ($v) => $v === null ? null : (int) $v,
            $versions
        ));

        // ── Ben leaves the company ──
        $this->assertSame(['deleted' => true], $this->delete("/staff/{$ben}", true)['json']);

        $year = $this->range('2025-09', '2026-08');
        foreach ($year as $key => $entry) {
            $this->assertArrayNotHasKey((string) $ben, $entry['ticks'], "Ben's ticks are gone from {$key}");
        }
        $this->assertSame(['documentation', 'participation'], $year['2026-06']['ticks'][(string) $ann]);
        $this->assertSame(['additional' => ['goals', 'learning'], 'min_performance' => 75], $year['2026-05']['settings']);

        // His review rows stay in every month, unlinked but still named; Ann's are untouched.
        foreach (self::HALF as $month) {
            $rows = array_column($this->get("/review-entries?kind=performance&month={$month}", true)['json'], null, 'person_name');
            $this->assertNull($rows['ben']['staff_id']);
            $this->assertSame($ann, $rows['Ann']['staff_id']);
        }
        // What a manager typed stays as typed — the sheet is not rewritten by a roster change.
        $this->assertSame(["s:{$ben}" => ['standing' => 'Low']], $this->sheet('year', '2026-08')['overrides']);

        // ── The trail: every write attributed to the manager, reads never recorded ──
        $counts = [];
        foreach (self::auditRows() as $row) {
            if (str_starts_with($row['action'], 'auth.')) {
                continue;
            }
            $this->assertSame((int) $this->manager['id'], (int) $row['user_id'], $row['action']);
            $key = "{$row['action']} {$row['status_code']}";
            $counts[$key] = ($counts[$key] ?? 0) + 1;
        }
        ksort($counts);
        $this->assertSame([
            'annual-review.create 200'     => 1,
            'annual-review.create 409'     => 1,
            'annual-review.update 200'     => 3,
            'review-department.create 201' => 1,
            'review-entry.create 201'      => 20,
            'staff-member.create 201'      => 1,
            'staff-member.delete 200'      => 1,
            'top-performer.update 200'     => 7,
        ], $counts);
    }

    public function testDepartmentsAreOneCatalogueScoredMonthByMonth(): void
    {
        $ids = $this->roster('Ann');

        $r = $this->post('/review-departments', ['name' => 'Ops', 'month' => '2026-06', 'performance' => 'Good', 'percentage' => 81], true);
        $opsId = $r['json']['id'];
        $this->assertStatus(200, $this->put("/review-departments/{$opsId}", ['month' => '2026-07', 'performance' => 'Poor', 'percentage' => 40], true));

        $june = array_column($this->get('/review-departments?month=2026-06', true)['json'], null, 'name');
        $july = array_column($this->get('/review-departments?month=2026-07', true)['json'], null, 'name');
        $aug  = array_column($this->get('/review-departments?month=2026-08', true)['json'], null, 'name');
        $this->assertEquals(['Good', 81.0], [$june['Ops']['performance'], $june['Ops']['percentage']]);
        $this->assertEquals(['Poor', 40.0], [$july['Ops']['performance'], $july['Ops']['percentage']]);
        $this->assertSame(['', null], [$aug['Ops']['performance'], $aug['Ops']['percentage']], 'an unscored month still lists it');

        // The Staff page (for someone holding that page) renames it; the Review page follows,
        // scores intact, and people filed under it carry the new name.
        $admin = self::createEnrolledUser('hr', 'member', ['staff']);
        $mine  = $this->cookies;
        $this->loginAs($admin);
        $this->assertStatus(200, $this->put("/staff/{$ids['Ann']}", ['department_ids' => [$opsId]], true));
        $this->assertStatus(200, $this->put("/departments/{$opsId}", ['name' => 'Operations'], true));
        $this->assertStatus(403, $this->get('/review-departments?month=2026-06', true));
        $this->cookies = $mine;

        $june = array_column($this->get('/review-departments?month=2026-06', true)['json'], null, 'name');
        $this->assertEquals(['Good', 81.0], [$june['Operations']['performance'], $june['Operations']['percentage']]);
        $ann = array_column($this->get('/staff', true)['json'], null, 'name')['Ann'];
        $this->assertSame([['id' => $opsId, 'name' => 'Operations']], $ann['departments']);

        // The name is taken for both pages at once.
        $this->assertStatus(409, $this->post('/review-departments', ['name' => 'operations', 'month' => '2026-06'], true));
    }

    public function testMovingAReviewToAnotherMonthMovesItBetweenSheetsAndWindows(): void
    {
        $ids   = $this->roster('Ann');
        $entry = $this->review('performance', 'Ann', '2026-06', ['percentage' => 77]);

        $r = $this->put("/review-entries/{$entry['id']}", ['month' => '2026-07-15'], true);
        $this->assertStatus(200, $r);
        $this->assertSame('2026-07-01', $r['json']['month']);
        $this->assertSame([], $this->get('/review-entries?kind=performance&month=2026-06', true)['json']);
        $july = $this->get('/review-entries?kind=performance&month=2026-07', true)['json'];
        $this->assertSame([$entry['id']], array_column($july, 'id'));
        $this->assertSame($ids['Ann'], $july[0]['staff_id']);

        // Ticks, by contrast, belong to the month they were saved under and do not follow.
        $this->saveMonth('2026-06', [(string) $ids['Ann'] => ['written']]);
        $window = $this->range('2026-06', '2026-07');
        $this->assertSame([(string) $ids['Ann'] => ['written']], $window['2026-06']['ticks']);
        $this->assertSame([], $window['2026-07']['ticks']);

        // Saving July's state in full leaves June's alone.
        $this->saveMonth('2026-07', [(string) $ids['Ann'] => ['behaviour']]);
        $window = $this->range('2026-06', '2026-07');
        $this->assertSame([(string) $ids['Ann'] => ['written']], $window['2026-06']['ticks']);
        $this->assertSame([(string) $ids['Ann'] => ['behaviour']], $window['2026-07']['ticks']);
    }
}
