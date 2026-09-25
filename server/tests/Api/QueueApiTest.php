<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

final class QueueApiTest extends ApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('queue_assignment_codes', 'queue_assignments', 'queue_codes', 'staff');
    }

    private static function staff(string $name): int
    {
        return (int) self::insert('staff', ['name' => $name])['id'];
    }

    private static function code(string $code): int
    {
        return (int) self::insert('queue_codes', ['code' => $code])['id'];
    }

    // ─── Queue codes catalogue ─────────────────────────────────────────────────

    public function testCodesListIsAlphabeticalIgnoringCaseWithUsageCounts(): void
    {
        $q04 = self::code('Q04');
        self::code('bhs');
        self::code('NB48');
        $alice = self::staff('Alice');
        $this->post('/queues', ['person_id' => $alice, 'code_ids' => [$q04]]);

        $r = $this->get('/queue-codes');
        $this->assertStatus(200, $r);
        $this->assertSame(['bhs', 'NB48', 'Q04'], array_column($r['json'], 'code'));
        $this->assertSame([0, 0, 1], array_column($r['json'], 'usage_count'));
        $this->assertIsInt($r['json'][0]['id']);
    }

    public function testStoreCodesSplitsAPastedListAndDropsRepeats(): void
    {
        $r = $this->post('/queue-codes', ['codes' => 'BHS, BOP;Q04 / nb48 | bhs']);
        $this->assertStatus(201, $r);
        $this->assertSame(['BHS', 'BOP', 'nb48', 'Q04'], array_column($r['json']['created'], 'code'));
        $this->assertSame([], $r['json']['existing']);
        $this->assertSame(4, (int) self::db()->query('SELECT count(*) FROM queue_codes')->fetchColumn());
    }

    public function testStoreCodesAcceptsASingleCodeAndAList(): void
    {
        $this->assertStatus(201, $this->post('/queue-codes', ['code' => 'Q01']));
        $r = $this->post('/queue-codes', ['codes' => ['Q02', 'Q03 Q04']]);
        $this->assertStatus(201, $r);
        $this->assertSame(['Q02', 'Q03', 'Q04'], array_column($r['json']['created'], 'code'));
    }

    public function testStoreCodesReportsExistingCodesCaseInsensitivelyWithout201(): void
    {
        $id = self::code('Q04');
        $r  = $this->post('/queue-codes', ['codes' => 'q04']);
        $this->assertStatus(200, $r);
        $this->assertSame([], $r['json']['created']);
        $this->assertSame($id, $r['json']['existing'][0]['id']);
        $this->assertSame('Q04', $r['json']['existing'][0]['code']);
    }

    public function testStoreCodesMixesCreatedAndExisting(): void
    {
        self::code('BHS');
        $r = $this->post('/queue-codes', ['codes' => 'BHS, NEW1']);
        $this->assertStatus(201, $r);
        $this->assertSame(['NEW1'], array_column($r['json']['created'], 'code'));
        $this->assertSame(['BHS'], array_column($r['json']['existing'], 'code'));
    }

    public function testStoreCodesRequiresACode(): void
    {
        $this->assertStatus(422, $this->post('/queue-codes', []));
        $this->assertStatus(422, $this->post('/queue-codes', ['codes' => ' , ; ']));
        $this->assertStatus(422, $this->post('/queue-codes', ['codes' => [['nested']]]));
    }

    public function testUpdateCodeRenamesIt(): void
    {
        $id = self::code('Q04');
        $r  = $this->put("/queue-codes/{$id}", ['code' => '  Q05 ']);
        $this->assertStatus(200, $r);
        $this->assertSame(['id' => $id, 'code' => 'Q05'], ['id' => $r['json']['id'], 'code' => $r['json']['code']]);
    }

    public function testUpdateCodeMayChangeOnlyTheCaseOfItsOwnCode(): void
    {
        $id = self::code('q04');
        $r  = $this->put("/queue-codes/{$id}", ['code' => 'Q04']);
        $this->assertStatus(200, $r);
        $this->assertSame('Q04', $r['json']['code']);
    }

    public function testUpdateCodeRefusesBlankAndDuplicateAndUnknown(): void
    {
        $a = self::code('Q04');
        self::code('BHS');
        $this->assertStatus(422, $this->put("/queue-codes/{$a}", ['code' => '  ']));
        $this->assertStatus(409, $this->put("/queue-codes/{$a}", ['code' => 'bhs']));
        $this->assertStatus(404, $this->put('/queue-codes/9999', ['code' => 'ZZZ']));
    }

    public function testDestroyCodeRemovesItFromEveryRecord(): void
    {
        $q04   = self::code('Q04');
        $bhs   = self::code('BHS');
        $alice = self::staff('Alice');
        $rec   = $this->post('/queues', ['person_id' => $alice, 'code_ids' => [$q04, $bhs]])['json'];

        $r = $this->delete("/queue-codes/{$q04}");
        $this->assertStatus(200, $r);
        $this->assertSame(['deleted' => true], $r['json']);

        $list = $this->get('/queues')['json'];
        $this->assertSame($rec['id'], $list[0]['id']);
        $this->assertSame([['id' => $bhs, 'code' => 'BHS']], $list[0]['codes']);

        $this->assertSame(['deleted' => false], $this->delete("/queue-codes/{$q04}")['json']);
    }

    // ─── Records ────────────────────────────────────────────────────────────────

    public function testStoreCreatesARecordWithCodesInTheOrderSent(): void
    {
        $a     = self::code('AAA');
        $b     = self::code('BBB');
        $c     = self::code('CCC');
        $alice = self::staff('Alice');

        $r = $this->post('/queues', ['person_id' => $alice, 'code_ids' => [$c, $a, $b, $c, 0, -3]]);
        $this->assertStatus(201, $r);
        $rec = $r['json'];
        $this->assertSame($alice, $rec['person_id']);
        $this->assertSame('Alice', $rec['name']);
        $this->assertSame('forwarding', $rec['board']);
        $this->assertSame(0, $rec['sort_order']);
        $this->assertSame(['CCC', 'AAA', 'BBB'], array_column($rec['codes'], 'code'));
        $this->assertArrayNotHasKey('total', $rec);
    }

    public function testStoreSkipsUnknownCodeIds(): void
    {
        $a     = self::code('AAA');
        $alice = self::staff('Alice');
        $r     = $this->post('/queues', ['person_id' => $alice, 'code_ids' => [9999, $a]]);
        $this->assertStatus(201, $r);
        $this->assertSame([['id' => $a, 'code' => 'AAA']], $r['json']['codes']);
    }

    public function testStoreWithoutCodesGivesAnEmptyList(): void
    {
        $r = $this->post('/queues', ['person_id' => self::staff('Alice'), 'code_ids' => 'nope']);
        $this->assertStatus(201, $r);
        $this->assertSame([], $r['json']['codes']);
    }

    public function testStoreRequiresAPersonOnTheRoster(): void
    {
        $this->assertStatus(422, $this->post('/queues', []));
        $this->assertStatus(422, $this->post('/queues', ['person_id' => 0]));
        $this->assertStatus(422, $this->post('/queues', ['person_id' => 9999]));
        $this->assertSame(0, (int) self::db()->query('SELECT count(*) FROM queue_assignments')->fetchColumn());
    }

    public function testStoreAppendsSortOrderPerBoardUnlessGiven(): void
    {
        $a = self::staff('A');
        $b = self::staff('B');
        $c = self::staff('C');
        $d = self::staff('D');

        $this->assertSame(0, $this->post('/queues', ['person_id' => $a])['json']['sort_order']);
        $this->assertSame(1, $this->post('/queues', ['person_id' => $b])['json']['sort_order']);
        $this->assertSame(0, $this->post('/queues', ['person_id' => $c, 'board' => 'camp_flow'])['json']['sort_order']);
        $this->assertSame(42, $this->post('/queues', ['person_id' => $d, 'sort_order' => 42])['json']['sort_order']);
    }

    public function testStoreForAPersonAlreadyOnTheBoardUpdatesTheirRecord(): void
    {
        $a     = self::code('AAA');
        $b     = self::code('BBB');
        $alice = self::staff('Alice');
        $first = $this->post('/queues', ['person_id' => $alice, 'code_ids' => [$a]])['json'];

        $r = $this->post('/queues', ['person_id' => $alice, 'code_ids' => [$b, $a]]);
        $this->assertStatus(200, $r);
        $this->assertSame($first['id'], $r['json']['id']);
        $this->assertSame(['BBB', 'AAA'], array_column($r['json']['codes'], 'code'));
        $this->assertCount(1, $this->get('/queues')['json']);
    }

    public function testTheSamePersonMayHoldARowOnEachBoard(): void
    {
        $alice = self::staff('Alice');
        $fwd   = $this->post('/queues', ['person_id' => $alice, 'board' => 'forwarding']);
        $camp  = $this->post('/queues', ['person_id' => $alice, 'board' => 'CAMP_FLOW ']);
        $this->assertStatus(201, $fwd);
        $this->assertStatus(201, $camp);
        $this->assertNotSame($fwd['json']['id'], $camp['json']['id']);
        $this->assertSame('camp_flow', $camp['json']['board']);
    }

    public function testIndexIsScopedToOneBoardAndUnknownBoardsFallBackToForwarding(): void
    {
        $alice = self::staff('Alice');
        $bob   = self::staff('Bob');
        $this->post('/queues', ['person_id' => $alice]);
        $this->post('/queues', ['person_id' => $bob, 'board' => 'camp_flow']);
        $this->post('/queues', ['person_id' => $bob, 'board' => 'mystery']);

        $this->assertSame(['Alice', 'Bob'], array_column($this->get('/queues')['json'], 'name'));
        $this->assertSame(['Alice', 'Bob'], array_column($this->get('/queues?board=nonsense')['json'], 'name'));
        $this->assertSame(['Bob'], array_column($this->get('/queues?board=camp_flow')['json'], 'name'));
    }

    public function testIndexOrdersBySortOrderThenId(): void
    {
        $ids = [];
        foreach (['A' => 5, 'B' => 1, 'C' => 5, 'D' => 0] as $name => $sort) {
            $ids[$name] = $this->post('/queues', ['person_id' => self::staff($name), 'sort_order' => $sort])['json']['id'];
        }
        $this->assertSame(['D', 'B', 'A', 'C'], array_column($this->get('/queues')['json'], 'name'));
    }

    public function testIndexFiltersByTheDayARecordWasKeyedIn(): void
    {
        $alice = self::staff('Alice');
        $bob   = self::staff('Bob');
        self::insert('queue_assignments', ['person_id' => $alice, 'created_at' => '2026-05-03 12:00:00']);
        self::insert('queue_assignments', ['person_id' => $bob, 'created_at' => '2026-05-04 12:00:00']);

        $this->assertSame(['Alice'], array_column($this->get('/queues?day=2026-05-03')['json'], 'name'));
        $this->assertSame([], $this->get('/queues?day=2026-05-05')['json']);
        // An invalid day is ignored rather than refused.
        $this->assertCount(2, $this->get('/queues?day=2026-02-30')['json']);
        $this->assertCount(2, $this->get('/queues?day=yesterday')['json']);
    }

    public function testChipsWithoutAStoredOrderReadAlphabetically(): void
    {
        $alice = self::staff('Alice');
        $rec   = self::insert('queue_assignments', ['person_id' => $alice]);
        foreach (['zeta', 'Alpha', 'mid'] as $code) {
            self::insert('queue_assignment_codes', ['assignment_id' => $rec['id'], 'code_id' => self::code($code)]);
        }
        $this->assertSame(['Alpha', 'mid', 'zeta'], array_column($this->get('/queues')['json'][0]['codes'], 'code'));
    }

    public function testUpdateReordersAndReplacesChips(): void
    {
        $a     = self::code('AAA');
        $b     = self::code('BBB');
        $c     = self::code('CCC');
        $alice = self::staff('Alice');
        $rec   = $this->post('/queues', ['person_id' => $alice, 'code_ids' => [$a, $b]])['json'];

        $r = $this->put("/queues/{$rec['id']}", ['code_ids' => [$c, $b]]);
        $this->assertStatus(200, $r);
        $this->assertSame(['CCC', 'BBB'], array_column($r['json']['codes'], 'code'));

        $r = $this->put("/queues/{$rec['id']}", ['code_ids' => []]);
        $this->assertSame([], $r['json']['codes']);
    }

    public function testUpdateWithoutCodeIdsLeavesChipsAlone(): void
    {
        $a     = self::code('AAA');
        $alice = self::staff('Alice');
        $bob   = self::staff('Bob');
        $rec   = $this->post('/queues', ['person_id' => $alice, 'code_ids' => [$a]])['json'];

        $r = $this->put("/queues/{$rec['id']}", ['person_id' => $bob]);
        $this->assertStatus(200, $r);
        $this->assertSame($bob, $r['json']['person_id']);
        $this->assertSame('Bob', $r['json']['name']);
        $this->assertSame(['AAA'], array_column($r['json']['codes'], 'code'));
    }

    public function testUpdateRefusesAPersonWhoAlreadyHasARowOnThatBoard(): void
    {
        $alice = self::staff('Alice');
        $bob   = self::staff('Bob');
        $recA  = $this->post('/queues', ['person_id' => $alice])['json'];
        $this->post('/queues', ['person_id' => $bob]);

        $this->assertStatus(409, $this->put("/queues/{$recA['id']}", ['person_id' => $bob]));
        // Re-sending its own person is not a conflict.
        $this->assertStatus(200, $this->put("/queues/{$recA['id']}", ['person_id' => $alice]));
    }

    public function testUpdateAllowsAPersonWhoOnlyHasARowOnTheOtherBoard(): void
    {
        $alice = self::staff('Alice');
        $bob   = self::staff('Bob');
        $recA  = $this->post('/queues', ['person_id' => $alice])['json'];
        $this->post('/queues', ['person_id' => $bob, 'board' => 'camp_flow']);

        $r = $this->put("/queues/{$recA['id']}", ['person_id' => $bob]);
        $this->assertStatus(200, $r);
        $this->assertSame('forwarding', $r['json']['board']);
    }

    public function testUpdateValidatesPersonAndExistence(): void
    {
        $rec = $this->post('/queues', ['person_id' => self::staff('Alice')])['json'];
        $this->assertStatus(422, $this->put("/queues/{$rec['id']}", ['person_id' => 9999]));
        $this->assertStatus(422, $this->put("/queues/{$rec['id']}", ['person_id' => 0]));
        $this->assertStatus(404, $this->put('/queues/9999', ['code_ids' => []]));
    }

    public function testDestroyRemovesTheRecordAndItsLinksButNotTheCodes(): void
    {
        $a   = self::code('AAA');
        $rec = $this->post('/queues', ['person_id' => self::staff('Alice'), 'code_ids' => [$a]])['json'];

        $this->assertSame(['deleted' => true], $this->delete("/queues/{$rec['id']}")['json']);
        $this->assertSame([], $this->get('/queues')['json']);
        $this->assertSame(0, (int) self::db()->query('SELECT count(*) FROM queue_assignment_codes')->fetchColumn());
        $this->assertSame(0, $this->get('/queue-codes')['json'][0]['usage_count']);
        $this->assertSame(['deleted' => false], $this->delete("/queues/{$rec['id']}")['json']);
    }

    public function testRemovingAPersonFromTheRosterRemovesTheirRecords(): void
    {
        $alice = self::staff('Alice');
        $this->post('/queues', ['person_id' => $alice]);
        self::db()->exec("DELETE FROM staff WHERE id = {$alice}");
        $this->assertSame([], $this->get('/queues')['json']);
    }
}
