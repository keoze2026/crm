<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

final class TopPerformerApiTest extends ApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('top_performer_ticks', 'top_performer_months', 'staff', 'users', 'sessions', 'audit_log');
    }

    private static function staff(string $name): int
    {
        return (int) self::insert('staff', ['name' => $name])['id'];
    }

    private static function defaults(): array
    {
        return ['additional' => ['goals'], 'min_performance' => 80];
    }

    public function testShowRequiresAValidMonth(): void
    {
        $this->assertStatus(422, $this->get('/top-performer'));
        $this->assertStatus(422, $this->get('/top-performer?month=2026-00'));
        $this->assertStatus(422, $this->get('/top-performer?month=1969-12'));
        $this->assertStatus(422, $this->get('/top-performer?month=Aug-2026'));
    }

    public function testAnUntouchedMonthAnswersWithDefaultsAndAnEmptyTickMap(): void
    {
        $r = $this->get('/top-performer?month=2026-08-19');
        $this->assertStatus(200, $r);
        $this->assertSame('2026-08-01', $r['json']['month']);
        $this->assertSame(self::defaults(), $r['json']['settings']);
        $this->assertSame([], $r['json']['ticks']);
        $this->assertStringContainsString('"ticks":{}', $r['body']);
    }

    public function testSaveReplacesTheMonthAndShowReadsItBack(): void
    {
        $alice = self::staff('Alice');
        $bob   = self::staff('Bob');

        $r = $this->put('/top-performer?month=2026-08', [
            'settings' => ['additional' => ['learning', 'feedback', 'learning'], 'min_performance' => '75'],
            'ticks'    => [
                (string) $bob   => ['written', 'behaviour', 'written'],
                (string) $alice => ['punctuality'],
            ],
        ]);
        $this->assertStatus(200, $r);
        $expected = [
            'month'    => '2026-08-01',
            'settings' => ['additional' => ['learning', 'feedback'], 'min_performance' => 75],
            'ticks'    => [
                (string) $alice => ['punctuality'],
                (string) $bob   => ['behaviour', 'written'],
            ],
        ];
        $this->assertSame($expected, $r['json']);
        $this->assertSame($expected, $this->get('/top-performer?month=2026-08')['json']);
    }

    public function testSaveTicksExactlyTheSetSent(): void
    {
        $alice = self::staff('Alice');
        $bob   = self::staff('Bob');
        $this->put('/top-performer?month=2026-08', ['ticks' => [$alice => ['login'], $bob => ['goals']]]);

        $r = $this->put('/top-performer?month=2026-08', ['ticks' => [$bob => ['documentation'], $alice => []]]);
        $this->assertSame([(string) $bob => ['documentation']], $r['json']['ticks']);
        $this->assertSame(1, (int) self::db()->query('SELECT count(*) FROM top_performer_ticks')->fetchColumn());
    }

    public function testSaveWithoutABodyRestoresDefaultsAndClearsTicks(): void
    {
        $alice = self::staff('Alice');
        $this->put('/top-performer?month=2026-08', [
            'settings' => ['additional' => [], 'min_performance' => 50],
            'ticks'    => [$alice => ['login']],
        ]);

        $r = $this->put('/top-performer?month=2026-08', []);
        $this->assertStatus(200, $r);
        $this->assertSame(self::defaults(), $r['json']['settings']);
        $this->assertSame([], $r['json']['ticks']);
    }

    public function testAnEmptyAdditionalListIsKept(): void
    {
        $r = $this->put('/top-performer?month=2026-08', ['settings' => ['additional' => []]]);
        $this->assertSame(['additional' => [], 'min_performance' => 80], $r['json']['settings']);
    }

    public function testMonthsAreIndependent(): void
    {
        $alice = self::staff('Alice');
        $this->put('/top-performer?month=2026-08', ['ticks' => [$alice => ['login']], 'settings' => ['min_performance' => 90]]);
        $this->put('/top-performer?month=2026-09', ['ticks' => [$alice => ['goals']]]);

        $aug = $this->get('/top-performer?month=2026-08')['json'];
        $this->assertSame([(string) $alice => ['login']], $aug['ticks']);
        $this->assertSame(90, $aug['settings']['min_performance']);
        $this->assertSame([(string) $alice => ['goals']], $this->get('/top-performer?month=2026-09')['json']['ticks']);
    }

    public function testSaveValidatesSettings(): void
    {
        $this->assertStatus(422, $this->put('/top-performer?month=2026-08', ['settings' => ['additional' => ['behaviour']]]));
        $this->assertStatus(422, $this->put('/top-performer?month=2026-08', ['settings' => ['additional' => [7]]]));
        $this->assertStatus(422, $this->put('/top-performer?month=2026-08', ['settings' => ['min_performance' => 101]]));
        $this->assertStatus(422, $this->put('/top-performer?month=2026-08', ['settings' => ['min_performance' => -1]]));
        $this->assertStatus(422, $this->put('/top-performer?month=2026-08', ['settings' => ['min_performance' => 'high']]));
        $this->assertStatus(200, $this->put('/top-performer?month=2026-08', ['settings' => ['min_performance' => 0]]));
        $this->assertStatus(200, $this->put('/top-performer?month=2026-08', ['settings' => ['min_performance' => 100]]));
    }

    public function testSaveValidatesTicks(): void
    {
        $alice = self::staff('Alice');
        $this->assertStatus(422, $this->put('/top-performer?month=2026-08', ['ticks' => 'all']));
        $this->assertStatus(422, $this->put('/top-performer?month=2026-08', ['ticks' => ['abc' => ['login']]]));
        $this->assertStatus(422, $this->put('/top-performer?month=2026-08', ['ticks' => [$alice => 'login']]));
        $this->assertStatus(422, $this->put('/top-performer?month=2026-08', ['ticks' => [$alice => ['sleeping']]]));
        $this->assertStatus(422, $this->put('/top-performer', ['ticks' => []]));
        $this->assertSame(0, (int) self::db()->query('SELECT count(*) FROM top_performer_months')->fetchColumn());
    }

    public function testATickForSomeoneOffTheRosterIsRefusedAndNothingIsWritten(): void
    {
        $alice = self::staff('Alice');
        $this->put('/top-performer?month=2026-08', ['ticks' => [$alice => ['login']], 'settings' => ['min_performance' => 60]]);

        $r = $this->put('/top-performer?month=2026-08', ['ticks' => [$alice => ['goals'], 9999 => ['login']], 'settings' => ['min_performance' => 10]]);
        $this->assertStatus(422, $r);

        $state = $this->get('/top-performer?month=2026-08')['json'];
        $this->assertSame([(string) $alice => ['login']], $state['ticks']);
        $this->assertSame(60, $state['settings']['min_performance']);
    }

    public function testRemovingSomeoneFromTheRosterDropsTheirTicks(): void
    {
        $alice = self::staff('Alice');
        $this->put('/top-performer?month=2026-08', ['ticks' => [$alice => ['login']]]);
        self::db()->exec("DELETE FROM staff WHERE id = {$alice}");
        $this->assertSame([], $this->get('/top-performer?month=2026-08')['json']['ticks']);
    }

    public function testConfirmedByIsNullWithAuthOff(): void
    {
        $alice = self::staff('Alice');
        $this->put('/top-performer?month=2026-08', ['ticks' => [$alice => ['login']]]);
        $this->assertNull(self::db()->query('SELECT confirmed_by FROM top_performer_ticks')->fetchColumn());
    }

    public function testConfirmedByRecordsTheSignedInUserWithAuthOn(): void
    {
        $alice   = self::staff('Alice');
        $manager = self::createEnrolledUser('manager', 'admin');
        $this->loginAs($manager);

        $r = $this->put('/top-performer?month=2026-08', ['ticks' => [$alice => ['login', 'goals']]], true);
        $this->assertStatus(200, $r);
        $by = self::db()->query('SELECT DISTINCT confirmed_by FROM top_performer_ticks')->fetchAll(\PDO::FETCH_COLUMN);
        $this->assertSame([(int) $manager['id']], array_map('intval', $by));
    }

    public function testWithAuthOnTheEndpointNeedsASession(): void
    {
        $this->assertStatus(401, $this->get('/top-performer?month=2026-08', true));
    }

    // ─── Range ──────────────────────────────────────────────────────────────────

    public function testRangeListsEveryMonthOldestFirstWithDefaultsForUntouchedOnes(): void
    {
        $alice = self::staff('Alice');
        $this->put('/top-performer?month=2026-02', [
            'settings' => ['additional' => ['innovation'], 'min_performance' => 70],
            'ticks'    => [$alice => ['login']],
        ]);

        $r = $this->get('/top-performer/range?from=2026-03&to=2025-12');
        $this->assertStatus(200, $r);
        $this->assertSame(['2025-12-01', '2026-01-01', '2026-02-01', '2026-03-01'], array_column($r['json'], 'month'));
        $this->assertSame(self::defaults(), $r['json'][0]['settings']);
        $this->assertSame([], $r['json'][0]['ticks']);
        $this->assertSame(['additional' => ['innovation'], 'min_performance' => 70], $r['json'][2]['settings']);
        $this->assertSame([(string) $alice => ['login']], $r['json'][2]['ticks']);
        $this->assertStringContainsString('"ticks":{}', $r['body']);
    }

    public function testRangeOfOneMonth(): void
    {
        $r = $this->get('/top-performer/range?from=2026-08&to=2026-08-31');
        $this->assertStatus(200, $r);
        $this->assertSame(['2026-08-01'], array_column($r['json'], 'month'));
    }

    public function testRangeIsCappedAtTwentyFourMonths(): void
    {
        $r = $this->get('/top-performer/range?from=2024-09&to=2026-08');
        $this->assertStatus(200, $r);
        $this->assertCount(24, $r['json']);
        $this->assertStatus(422, $this->get('/top-performer/range?from=2024-08&to=2026-08'));
    }

    public function testRangeRequiresBothEnds(): void
    {
        $this->assertStatus(422, $this->get('/top-performer/range?from=2026-01'));
        $this->assertStatus(422, $this->get('/top-performer/range?to=2026-01'));
        $this->assertStatus(422, $this->get('/top-performer/range?from=2026-01&to=2026-13'));
    }
}
