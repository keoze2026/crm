<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

final class AnnualReviewApiTest extends ApiTestCase
{
    private const YEAR = '/annual-reviews?span=year&month=2026-09';

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('annual_review_versions', 'annual_review_sheets', 'users', 'sessions', 'audit_log');
    }

    /** A version saved $hoursAgo hours ago, written straight into the history. */
    private static function oldVersion(float $hoursAgo, array $overrides, string $span = 'year', string $end = '2026-09-01', array $extra = [], array $settings = []): void
    {
        $stmt = self::db()->prepare(
            "INSERT INTO annual_review_versions (span, period_end, overrides, extra_rows, settings, saved_at)
             VALUES (:span, :end, :o, :x, :s, now() - make_interval(secs => :secs))"
        );
        $stmt->execute([
            ':span' => $span,
            ':end'  => $end,
            ':o'    => json_encode($overrides, JSON_FORCE_OBJECT),
            ':x'    => json_encode($extra),
            ':s'    => json_encode($settings, JSON_FORCE_OBJECT),
            ':secs' => $hoursAgo * 3600,
        ]);
    }

    private static function versionCount(string $span = 'year', string $end = '2026-09-01'): int
    {
        $stmt = self::db()->prepare('SELECT count(*) FROM annual_review_versions WHERE span = :s AND period_end = :e');
        $stmt->execute([':s' => $span, ':e' => $end]);
        return (int) $stmt->fetchColumn();
    }

    // ─── Period ─────────────────────────────────────────────────────────────────

    public function testPeriodIsValidated(): void
    {
        $this->assertStatus(422, $this->get('/annual-reviews?month=2026-09'));
        $this->assertStatus(422, $this->get('/annual-reviews?span=quarter&month=2026-09'));
        $this->assertStatus(422, $this->get('/annual-reviews?span=year'));
        $this->assertStatus(422, $this->get('/annual-reviews?span=year&month=2026-13'));
        $this->assertStatus(422, $this->put('/annual-reviews?span=half', []));
        $this->assertStatus(422, $this->post('/annual-reviews/reset?span=decade&month=2026-09'));
    }

    public function testAnUntouchedPeriodAnswersWithEmptyDefaults(): void
    {
        $r = $this->get('/annual-reviews?span=HALF&month=2026-09-30');
        $this->assertStatus(200, $r);
        $this->assertSame([
            'span'       => 'half',
            'period_end' => '2026-09-01',
            'months'     => 6,
            'overrides'  => [],
            'extra_rows' => [],
            'settings'   => [],
            'updated_at' => null,
            'reset_to'   => null,
        ], $r['json']);
        $this->assertStringContainsString('"overrides":{}', $r['body']);
        $this->assertStringContainsString('"settings":{}', $r['body']);
        $this->assertStringContainsString('"extra_rows":[]', $r['body']);
    }

    public function testYearSpanCoversTwelveMonths(): void
    {
        $this->assertSame(12, $this->get(self::YEAR)['json']['months']);
    }

    // ─── Save ───────────────────────────────────────────────────────────────────

    public function testSaveStoresTypedOverCellsAndShowReadsThemBack(): void
    {
        $r = $this->put(self::YEAR, [
            'overrides'  => [
                's:12' => ['rating' => ' Excellent ', 'score' => 91.5, 'blank' => '   '],
                's:13' => ['rating' => ''],
                'x:abc' => ['name' => 'Night shift'],
            ],
            'extra_rows' => [
                ['key' => ' x:abc ', 'name' => ' Night shift '],
                ['key' => 'x:abc', 'name' => 'Duplicate'],
                ['key' => 'x:def'],
            ],
            'settings'   => ['min_months' => '4'],
        ]);
        $this->assertStatus(200, $r);
        $expected = [
            's:12'  => ['rating' => 'Excellent', 'score' => '91.5'],
            'x:abc' => ['name' => 'Night shift'],
        ];
        $this->assertEquals($expected, $r['json']['overrides'], 'JSONB keeps map keys in its own order');
        $this->assertSame([['key' => 'x:abc', 'name' => 'Night shift'], ['key' => 'x:def', 'name' => '']], $r['json']['extra_rows']);
        $this->assertSame(['min_months' => 4], $r['json']['settings']);
        $this->assertNotNull($r['json']['updated_at']);
        $this->assertNull($r['json']['reset_to']);

        $shown = $this->get(self::YEAR)['json'];
        $this->assertEquals($expected, $shown['overrides']);
        $this->assertSame(['min_months' => 4], $shown['settings']);
    }

    public function testSaveReplacesTheWholeSheet(): void
    {
        $this->put(self::YEAR, ['overrides' => ['s:1' => ['rating' => 'Good']], 'settings' => ['min_months' => 3]]);
        $r = $this->put(self::YEAR, ['overrides' => ['s:2' => ['rating' => 'Poor']]]);
        $this->assertSame(['s:2' => ['rating' => 'Poor']], $r['json']['overrides']);
        $this->assertSame([], $r['json']['settings']);
        $this->assertSame(1, (int) self::db()->query('SELECT count(*) FROM annual_review_sheets')->fetchColumn());
    }

    public function testClearingEveryCellStoresAnEmptyObjectNotAList(): void
    {
        $this->put(self::YEAR, ['overrides' => ['s:1' => ['rating' => 'Good']]]);
        $r = $this->put(self::YEAR, ['overrides' => ['s:1' => ['rating' => '']]]);
        $this->assertStringContainsString('"overrides":{}', $r['body']);
        $this->assertSame('object', self::db()->query('SELECT jsonb_typeof(overrides) FROM annual_review_sheets')->fetchColumn());
        $this->assertSame('object', self::db()->query('SELECT jsonb_typeof(settings) FROM annual_review_sheets')->fetchColumn());
    }

    public function testPeriodsAreKeptApart(): void
    {
        $this->put(self::YEAR, ['overrides' => ['s:1' => ['rating' => 'Year']]]);
        $this->put('/annual-reviews?span=half&month=2026-09', ['overrides' => ['s:1' => ['rating' => 'Half']]]);
        $this->put('/annual-reviews?span=year&month=2026-08', ['overrides' => ['s:1' => ['rating' => 'August']]]);

        $this->assertSame('Year', $this->get(self::YEAR)['json']['overrides']['s:1']['rating']);
        $this->assertSame('Half', $this->get('/annual-reviews?span=half&month=2026-09')['json']['overrides']['s:1']['rating']);
        $this->assertSame('August', $this->get('/annual-reviews?span=year&month=2026-08')['json']['overrides']['s:1']['rating']);
    }

    public function testSaveCapsKeyAndCellLengths(): void
    {
        $longKey = 's:' . str_repeat('k', 100);
        $r = $this->put(self::YEAR, [
            'overrides'  => [$longKey => [str_repeat('c', 100) => str_repeat('v', 2500)]],
            'extra_rows' => [['key' => str_repeat('x', 100), 'name' => str_repeat('n', 200)]],
        ]);
        $this->assertStatus(200, $r);
        $rowKey = array_key_first($r['json']['overrides']);
        $this->assertSame(64, mb_strlen($rowKey));
        $colKey = array_key_first($r['json']['overrides'][$rowKey]);
        $this->assertSame(64, mb_strlen($colKey));
        $this->assertSame(2000, mb_strlen($r['json']['overrides'][$rowKey][$colKey]));
        $this->assertSame(64, mb_strlen($r['json']['extra_rows'][0]['key']));
        $this->assertSame(120, mb_strlen($r['json']['extra_rows'][0]['name']));
    }

    public function testSaveValidatesOverrides(): void
    {
        $this->assertStatus(422, $this->put(self::YEAR, ['overrides' => 'text']));
        $this->assertStatus(422, $this->put(self::YEAR, ['overrides' => ['s:1' => 'Good']]));
        $this->assertStatus(422, $this->put(self::YEAR, ['overrides' => [' ' => ['rating' => 'Good']]]));
        $this->assertStatus(422, $this->put(self::YEAR, ['overrides' => ['s:1' => ['Good']]]));
        $this->assertStatus(422, $this->put(self::YEAR, ['overrides' => ['s:1' => ['rating' => true]]]));
        $this->assertStatus(422, $this->put(self::YEAR, ['overrides' => ['s:1' => ['rating' => ['nested']]]]));

        $tooMany = [];
        for ($i = 0; $i <= 400; $i++) {
            $tooMany["s:{$i}"] = ['rating' => 'x'];
        }
        $this->assertStatus(422, $this->put(self::YEAR, ['overrides' => $tooMany]));
        $this->assertSame(0, self::versionCount());
    }

    public function testSaveValidatesExtraRows(): void
    {
        $this->assertStatus(422, $this->put(self::YEAR, ['extra_rows' => [['name' => 'No key']]]));
        $this->assertStatus(422, $this->put(self::YEAR, ['extra_rows' => [['key' => '  ']]]));
        $this->assertStatus(422, $this->put(self::YEAR, ['extra_rows' => ['x:1']]));
        $this->assertStatus(422, $this->put(self::YEAR, ['extra_rows' => array_fill(0, 401, ['key' => 'x'])]));
        // Not a list at all is read as "no added rows".
        $this->assertSame([], $this->put(self::YEAR, ['extra_rows' => 'none'])['json']['extra_rows']);
    }

    public function testSaveValidatesMinMonthsAgainstTheSpan(): void
    {
        $this->assertStatus(422, $this->put('/annual-reviews?span=half&month=2026-09', ['settings' => ['min_months' => 7]]));
        $this->assertStatus(422, $this->put(self::YEAR, ['settings' => ['min_months' => 13]]));
        $this->assertStatus(422, $this->put(self::YEAR, ['settings' => ['min_months' => -1]]));
        $this->assertStatus(422, $this->put(self::YEAR, ['settings' => ['min_months' => 'most']]));

        $this->assertSame(['min_months' => 6], $this->put('/annual-reviews?span=half&month=2026-09', ['settings' => ['min_months' => 6]])['json']['settings']);
        $this->assertSame(['min_months' => 0], $this->put(self::YEAR, ['settings' => ['min_months' => 0]])['json']['settings']);
        $this->assertSame([], $this->put(self::YEAR, ['settings' => ['min_months' => '']])['json']['settings']);
        $this->assertSame([], $this->put(self::YEAR, ['settings' => 'none'])['json']['settings']);
    }

    // ─── Version history ────────────────────────────────────────────────────────

    public function testEverySaveAppendsAVersion(): void
    {
        $this->put(self::YEAR, ['overrides' => ['s:1' => ['rating' => 'A']]]);
        $this->put(self::YEAR, ['overrides' => ['s:1' => ['rating' => 'B']]]);
        $this->assertSame(2, self::versionCount());

        $latest = self::db()->query('SELECT overrides, saved_by FROM annual_review_versions ORDER BY id DESC LIMIT 1')->fetch();
        $this->assertSame(['s:1' => ['rating' => 'B']], json_decode($latest['overrides'], true));
        $this->assertNull($latest['saved_by']);
    }

    public function testHistoryIsPrunedToTheNewestTwoHundredPerPeriod(): void
    {
        for ($i = 0; $i < 205; $i++) {
            self::oldVersion(48 + $i, ['s:1' => ['rating' => "v{$i}"]]);
        }
        self::oldVersion(48, ['s:1' => ['rating' => 'other']], 'half');

        $this->put(self::YEAR, ['overrides' => ['s:1' => ['rating' => 'new']]]);
        $this->assertSame(200, self::versionCount());
        $this->assertSame(1, self::versionCount('half'));

        $oldest = self::db()->query(
            "SELECT overrides FROM annual_review_versions WHERE span = 'year' ORDER BY saved_at ASC LIMIT 1"
        )->fetchColumn();
        $this->assertSame(['s:1' => ['rating' => 'v198']], json_decode($oldest, true));
    }

    public function testSavedByRecordsTheSignedInUserWithAuthOn(): void
    {
        $manager = self::createEnrolledUser('manager', 'admin');
        $this->loginAs($manager);

        $this->assertStatus(200, $this->put(self::YEAR, ['overrides' => ['s:1' => ['rating' => 'A']]], true));
        $by = self::db()->query('SELECT saved_by FROM annual_review_versions')->fetchColumn();
        $this->assertSame((int) $manager['id'], (int) $by);
    }

    // ─── Reset ──────────────────────────────────────────────────────────────────

    public function testResetIsRefusedWhenNothingIsADayOld(): void
    {
        $this->put(self::YEAR, ['overrides' => ['s:1' => ['rating' => 'today']]]);
        self::oldVersion(23, ['s:1' => ['rating' => 'this morning']]);

        $r = $this->post('/annual-reviews/reset?span=year&month=2026-09');
        $this->assertStatus(409, $r);
        $this->assertSame('today', $this->get(self::YEAR)['json']['overrides']['s:1']['rating']);
    }

    public function testResetToIsTheNewestSaveOlderThanADay(): void
    {
        self::oldVersion(72, ['s:1' => ['rating' => 'three days']]);
        self::oldVersion(30, ['s:1' => ['rating' => 'yesterday']]);
        self::oldVersion(2, ['s:1' => ['rating' => 'recent']]);

        $resetTo = $this->get(self::YEAR)['json']['reset_to'];
        $this->assertNotNull($resetTo);
        $expected = self::db()->query(
            "SELECT saved_at FROM annual_review_versions WHERE overrides->'s:1'->>'rating' = 'yesterday'"
        )->fetchColumn();
        $this->assertSame($expected, $resetTo);
    }

    public function testResetRestoresTheNewestDayOldVersionAndRecordsTheRestore(): void
    {
        self::oldVersion(72, ['s:1' => ['rating' => 'three days']]);
        self::oldVersion(
            30,
            ['s:1' => ['rating' => 'yesterday']],
            'year',
            '2026-09-01',
            [['key' => 'x:1', 'name' => 'Added']],
            ['min_months' => 5]
        );
        $this->put(self::YEAR, ['overrides' => ['s:1' => ['rating' => 'today']], 'settings' => ['min_months' => 2]]);

        $r = $this->post('/annual-reviews/reset?span=year&month=2026-09');
        $this->assertStatus(200, $r);
        $this->assertSame(['s:1' => ['rating' => 'yesterday']], $r['json']['overrides']);
        $this->assertSame([['key' => 'x:1', 'name' => 'Added']], $r['json']['extra_rows']);
        $this->assertSame(['min_months' => 5], $r['json']['settings']);
        $this->assertArrayHasKey('restored_from', $r['json']);
        $this->assertSame($r['json']['reset_to'], $r['json']['restored_from']);

        $this->assertSame(4, self::versionCount());
        $this->assertSame('yesterday', $this->get(self::YEAR)['json']['overrides']['s:1']['rating']);
    }

    public function testResetRevalidatesAnOlderVersionsShape(): void
    {
        self::oldVersion(30, ['s:1' => ['rating' => '  ', 'score' => ' 88 ']], 'half', '2026-09-01', [], ['min_months' => 3]);

        $r = $this->post('/annual-reviews/reset?span=half&month=2026-09');
        $this->assertStatus(200, $r);
        $this->assertSame(['s:1' => ['score' => '88']], $r['json']['overrides']);
        $this->assertSame(['min_months' => 3], $r['json']['settings']);
    }

    public function testResetOnlyLooksAtItsOwnPeriod(): void
    {
        self::oldVersion(30, ['s:1' => ['rating' => 'half']], 'half');
        self::oldVersion(30, ['s:1' => ['rating' => 'august']], 'year', '2026-08-01');
        $this->assertStatus(409, $this->post('/annual-reviews/reset?span=year&month=2026-09'));
        $this->assertNull($this->get(self::YEAR)['json']['reset_to']);
    }
}
