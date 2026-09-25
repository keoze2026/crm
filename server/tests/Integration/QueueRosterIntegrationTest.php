<?php

declare(strict_types=1);

namespace Tests\Integration;

use Tests\ApiTestCase;

/**
 * The staff roster and the queue-code catalogue feeding both Queues boards: renames and
 * deletions on either side propagate to every row on both sheets, chip and row order stay
 * put across unrelated edits, and the same person's reviews survive their removal.
 */
final class QueueRosterIntegrationTest extends ApiTestCase
{
    /** @var array<string,int> */
    private array $staff = [];
    /** @var array<string,int> */
    private array $codes = [];

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables(
            'queue_assignment_codes', 'queue_assignments', 'queue_codes',
            'review_entries', 'department_reviews', 'staff_departments', 'departments', 'staff'
        );
    }

    private function seedRosterAndCatalogue(): void
    {
        $r = $this->post('/staff', ['names' => "Alice, Bob\nCara"]);
        $this->assertStatus(201, $r);
        $again = $this->post('/staff', ['names' => ['alice', 'Dan']]);
        $this->assertStatus(201, $again);
        $this->assertSame(['Dan'], array_column($again['json']['created'], 'name'));
        $this->assertSame(['Alice'], array_column($again['json']['existing'], 'name'));
        $this->staff = array_column($this->get('/staff')['json'], 'id', 'name');
        $this->assertSame(['Alice', 'Bob', 'Cara', 'Dan'], array_keys($this->staff));

        $c = $this->post('/queue-codes', ['codes' => 'BHS, Q04; Q07 ZZ9']);
        $this->assertStatus(201, $c);
        $this->codes = array_column($c['json']['created'], 'id', 'code');
        $this->assertSame(['BHS', 'Q04', 'Q07', 'ZZ9'], array_keys($this->codes));
    }

    private function row(string $board, string $person, array $codes): int
    {
        $r = $this->post('/queues', [
            'board' => $board, 'person_id' => $this->staff[$person],
            'code_ids' => array_map(fn ($c) => $this->codes[$c], $codes),
        ]);
        $this->assertStatus(201, $r);
        return $r['json']['id'];
    }

    /** @return array<string, string[]> person name => chip codes, in sheet order */
    private function board(string $board): array
    {
        $out = [];
        foreach ($this->get("/queues?board={$board}")['json'] as $row) {
            $out[$row['name']] = array_column($row['codes'], 'code');
        }
        return $out;
    }

    /** @return array<string,int> */
    private function usage(): array
    {
        return array_column($this->get('/queue-codes')['json'], 'usage_count', 'code');
    }

    public function testRosterAndCatalogueEditsPropagateToBothBoards(): void
    {
        $this->seedRosterAndCatalogue();
        $aliceFwd = $this->row('forwarding', 'Alice', ['Q07', 'BHS']);
        $this->row('forwarding', 'Bob', ['Q04']);
        $caraFwd = $this->row('forwarding', 'Cara', []);
        $this->row('camp_flow', 'Alice', ['ZZ9', 'Q04']);
        $danCamp = $this->row('camp_flow', 'Dan', ['BHS', 'Q07', 'Q04']);

        $this->assertSame(['Alice' => ['Q07', 'BHS'], 'Bob' => ['Q04'], 'Cara' => []], $this->board('forwarding'));
        $this->assertSame(['Alice' => ['ZZ9', 'Q04'], 'Dan' => ['BHS', 'Q07', 'Q04']], $this->board('camp_flow'));
        $this->assertSame(['BHS' => 2, 'Q04' => 3, 'Q07' => 2, 'ZZ9' => 1], $this->usage());

        // Renaming a person on the Staff page renames them on both sheets.
        $this->assertStatus(200, $this->put("/staff/{$this->staff['Alice']}", ['name' => 'Alicia']));
        $this->assertSame(['Alicia', 'Bob', 'Cara'], array_keys($this->board('forwarding')));
        $this->assertSame(['Alicia', 'Dan'], array_keys($this->board('camp_flow')));
        $this->assertStatus(409, $this->put("/staff/{$this->staff['Alice']}", ['name' => ' bob ']));
        $this->assertSame(['Alicia', 'Bob', 'Cara'], array_keys($this->board('forwarding')));

        // Renaming a queue renames every chip without moving it.
        $this->assertStatus(200, $this->put("/queue-codes/{$this->codes['Q04']}", ['code' => 'Q4X']));
        $this->assertSame(['Alicia' => ['Q07', 'BHS'], 'Bob' => ['Q4X'], 'Cara' => []], $this->board('forwarding'));
        $this->assertSame(['Alicia' => ['ZZ9', 'Q4X'], 'Dan' => ['BHS', 'Q07', 'Q4X']], $this->board('camp_flow'));
        $this->assertStatus(409, $this->put("/queue-codes/{$this->codes['ZZ9']}", ['code' => 'bhs']));

        // Deleting a queue drops its chip everywhere; the remaining chips keep their order.
        $this->assertSame(['deleted' => true], $this->delete("/queue-codes/{$this->codes['Q07']}")['json']);
        $this->assertSame(['Alicia' => ['BHS'], 'Bob' => ['Q4X'], 'Cara' => []], $this->board('forwarding'));
        $this->assertSame(['Alicia' => ['ZZ9', 'Q4X'], 'Dan' => ['BHS', 'Q4X']], $this->board('camp_flow'));
        $this->assertSame(['BHS' => 2, 'Q4X' => 3, 'ZZ9' => 1], $this->usage());

        // Removing a person from the roster removes their row on both sheets and nothing else.
        $this->assertSame(['deleted' => true], $this->delete("/staff/{$this->staff['Bob']}")['json']);
        $this->assertSame(['Alicia' => ['BHS'], 'Cara' => []], $this->board('forwarding'));
        $this->assertSame(['BHS' => 2, 'Q4X' => 2, 'ZZ9' => 1], $this->usage());

        // A new row goes to the end of its own sheet, after the gap Bob left.
        $danFwd = $this->row('forwarding', 'Dan', ['Q04']);
        $this->assertSame(['Alicia', 'Cara', 'Dan'], array_keys($this->board('forwarding')));
        $this->assertSame([0, 2, 3], array_column($this->get('/queues?board=forwarding')['json'], 'sort_order'));

        // Dragging chips on one sheet leaves the other sheet's copy of the person alone.
        $this->put("/queues/{$danCamp}", ['code_ids' => [$this->codes['Q04'], $this->codes['BHS'], $this->codes['ZZ9']]]);
        $this->assertSame(['Alicia' => ['ZZ9', 'Q4X'], 'Dan' => ['Q4X', 'BHS', 'ZZ9']], $this->board('camp_flow'));
        $this->assertSame(['Q4X'], $this->board('forwarding')['Dan']);

        // Re-pointing a row: refused onto someone already on the sheet or no longer on the roster.
        $this->assertStatus(409, $this->put("/queues/{$caraFwd}", ['person_id' => $this->staff['Dan']]));
        $this->assertStatus(422, $this->put("/queues/{$caraFwd}", ['person_id' => $this->staff['Bob']]));
        $this->assertStatus(422, $this->put("/queues/{$danFwd}", ['person_id' => 999999]));
    }

    public function testRowOrderIsStableAcrossRenamesAndChipEdits(): void
    {
        $this->seedRosterAndCatalogue();
        $ids = [];
        foreach (['Dan', 'Alice', 'Cara', 'Bob'] as $i => $name) {
            $r = $this->post('/queues', ['board' => 'forwarding', 'person_id' => $this->staff[$name], 'sort_order' => 10 - $i * 2, 'code_ids' => [$this->codes['BHS']]]);
            $ids[$name] = $r['json']['id'];
        }
        $expected = ['Bob', 'Cara', 'Alice', 'Dan'];
        $this->assertSame($expected, array_keys($this->board('forwarding')));

        $this->put("/staff/{$this->staff['Cara']}", ['name' => 'Aaron']);
        $this->put("/queue-codes/{$this->codes['BHS']}", ['code' => 'AAA']);
        $this->put("/queues/{$ids['Alice']}", ['code_ids' => [$this->codes['ZZ9'], $this->codes['BHS']]]);
        $this->post('/queues', ['board' => 'forwarding', 'person_id' => $this->staff['Dan'], 'code_ids' => [$this->codes['Q04']]]);

        $this->assertSame(['Bob', 'Aaron', 'Alice', 'Dan'], array_keys($this->board('forwarding')));
        $this->assertSame(['ZZ9', 'AAA'], $this->board('forwarding')['Alice']);
        // Re-posting for Dan updated his row in place: same id, same slot, new chips.
        $rows = $this->get('/queues?board=forwarding')['json'];
        $this->assertSame([$ids['Bob'], $ids['Cara'], $ids['Alice'], $ids['Dan']], array_column($rows, 'id'));
        $this->assertSame(['Q04'], array_column($rows[3]['codes'], 'code'));
        // The staff list itself is alphabetical, independent of the sheet order.
        $this->assertSame(['Aaron', 'Alice', 'Bob', 'Dan'], array_column($this->get('/staff')['json'], 'name'));
    }

    public function testStaffLifecycleAcrossQueuesDepartmentsAndReviews(): void
    {
        $sales = $this->post('/departments', ['name' => 'Sales']);
        $this->assertStatus(201, $sales);
        $deptId = $sales['json']['id'];
        $created = $this->post('/staff', ['names' => 'Eve, Finn', 'department_ids' => [$deptId]]);
        $this->assertStatus(201, $created);
        $staff = array_column($created['json']['created'], 'id', 'name');
        $this->assertSame(2, array_column($this->get('/departments')['json'], 'staff_count', 'name')['Sales']);
        $code = $this->post('/queue-codes', ['code' => 'BHS'])['json']['created'][0]['id'];
        $this->post('/queues', ['board' => 'forwarding', 'person_id' => $staff['Eve'], 'code_ids' => [$code]]);
        $this->post('/queues', ['board' => 'camp_flow', 'person_id' => $staff['Eve'], 'code_ids' => [$code]]);

        $review = $this->post('/review-entries', ['kind' => 'performance', 'person_name' => 'eve', 'department_id' => $deptId,
            'rating' => 'Good', 'percentage' => 85, 'month' => '2026-08']);
        $this->assertStatus(201, $review);
        $this->assertSame($staff['Eve'], $review['json']['staff_id']);

        // Rename: the sheets follow the roster, the review keeps what was written.
        $this->put("/staff/{$staff['Eve']}", ['name' => 'Evelyn']);
        $this->assertSame(['Evelyn'], array_column($this->get('/queues?board=forwarding')['json'], 'name'));
        $this->assertSame(['Evelyn'], array_column($this->get('/queues?board=camp_flow')['json'], 'name'));
        $entries = $this->get('/review-entries?kind=performance&month=2026-08')['json'];
        $this->assertSame([['eve', $staff['Eve']]], array_map(static fn ($e) => [$e['person_name'], $e['staff_id']], $entries));

        // Removal: both sheet rows and the department link go; the review stays, unlinked.
        $this->assertSame(['deleted' => true], $this->delete("/staff/{$staff['Eve']}")['json']);
        $this->assertSame([], $this->get('/queues?board=forwarding')['json']);
        $this->assertSame([], $this->get('/queues?board=camp_flow')['json']);
        $this->assertSame(0, array_column($this->get('/queue-codes')['json'], 'usage_count', 'code')['BHS']);
        $this->assertSame(1, array_column($this->get('/departments')['json'], 'staff_count', 'name')['Sales']);
        $entries = $this->get('/review-entries?kind=performance&month=2026-08')['json'];
        $this->assertCount(1, $entries);
        $this->assertSame('eve', $entries[0]['person_name']);
        $this->assertNull($entries[0]['staff_id']);
        $this->assertSame($deptId, $entries[0]['department_id']);

        // A new hire with the same name is a new person: old reviews do not attach to them.
        $again = $this->post('/staff', ['name' => 'Eve'])['json']['created'][0]['id'];
        $this->assertNotSame($staff['Eve'], $again);
        $this->assertNull($this->get('/review-entries?kind=performance&month=2026-08')['json'][0]['staff_id']);
    }
}
