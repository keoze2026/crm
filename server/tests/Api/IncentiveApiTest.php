<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

final class IncentiveApiTest extends ApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('incentives', 'staff');
    }

    private static function staff(string $name): int
    {
        return (int) self::insert('staff', ['name' => $name])['id'];
    }

    public function testIndexRequiresAValidMonth(): void
    {
        $this->assertStatus(422, $this->get('/incentives'));
        $this->assertStatus(422, $this->get('/incentives?month=2026-13'));
        $r = $this->get('/incentives?month=2026-09');
        $this->assertStatus(200, $r);
        $this->assertSame([], $r['json']);
    }

    public function testStoreMakesOneRowPerPersonWithTheSameAmount(): void
    {
        $amy = self::staff('Amy');
        $ben = self::staff('Ben');

        $r = $this->post('/incentives', ['month' => '2026-09', 'amount' => '200.50', 'staff_ids' => [$amy, $ben, $amy]]);
        $this->assertStatus(201, $r);
        $this->assertSame(['Amy', 'Ben'], array_column($r['json'], 'staff_name'));
        $this->assertSame([200.5, 200.5], array_column($r['json'], 'amount'));
        $this->assertSame(['Pending', 'Pending'], array_column($r['json'], 'status'));
        $this->assertSame('2026-09-01', $r['json'][0]['month']);

        // A single staff_id works too, and a person may hold a second row.
        $this->post('/incentives', ['month' => '2026-09', 'amount' => 50, 'staff_id' => $amy, 'status' => 'Fulfilled']);
        $this->post('/incentives', ['month' => '2026-10', 'amount' => 1, 'staff_ids' => [$ben]]);

        $list = $this->get('/incentives?month=2026-09')['json'];
        $this->assertSame(['Amy', 'Ben', 'Amy'], array_column($list, 'staff_name'));
        $this->assertSame(['Pending', 'Pending', 'Fulfilled'], array_column($list, 'status'));
    }

    public function testStoreValidatesStaffAmountMonthAndStatus(): void
    {
        $amy = self::staff('Amy');
        $this->assertStatus(422, $this->post('/incentives', ['month' => '2026-09', 'amount' => 10]));
        $this->assertStatus(422, $this->post('/incentives', ['month' => '2026-09', 'amount' => 10, 'staff_ids' => [404]]));
        $this->assertStatus(422, $this->post('/incentives', ['month' => '2026-09', 'staff_ids' => [$amy]]));
        $this->assertStatus(422, $this->post('/incentives', ['month' => '2026-09', 'amount' => -1, 'staff_ids' => [$amy]]));
        $this->assertStatus(422, $this->post('/incentives', ['month' => 'Sep', 'amount' => 10, 'staff_ids' => [$amy]]));
        $this->assertStatus(422, $this->post('/incentives', ['month' => '2026-09', 'amount' => 10, 'staff_ids' => [$amy], 'status' => 'pending']));
        $this->assertSame([], $this->get('/incentives?month=2026-09')['json']);
    }

    public function testUpdateChangesOnlyWhatIsSent(): void
    {
        $amy = self::staff('Amy');
        $ben = self::staff('Ben');
        $id  = $this->post('/incentives', ['month' => '2026-09', 'amount' => 200, 'staff_ids' => [$amy]])['json'][0]['id'];

        $r = $this->put("/incentives/{$id}", ['status' => 'Fulfilled']);
        $this->assertStatus(200, $r);
        $this->assertSame('Fulfilled', $r['json']['status']);
        $this->assertEquals(200, $r['json']['amount']);

        $r = $this->put("/incentives/{$id}", ['staff_id' => $ben, 'amount' => 75.25]);
        $this->assertSame('Ben', $r['json']['staff_name']);
        $this->assertSame(75.25, $r['json']['amount']);
        $this->assertSame('Fulfilled', $r['json']['status']);

        $this->assertStatus(422, $this->put("/incentives/{$id}", ['amount' => '']));
        $this->assertStatus(422, $this->put("/incentives/{$id}", ['staff_id' => 999]));
        $this->assertStatus(422, $this->put("/incentives/{$id}", ['status' => 'Paid']));
        $this->assertStatus(404, $this->put('/incentives/999', ['amount' => 1]));
    }

    public function testDeleteAndRosterRemovalCascade(): void
    {
        $amy = self::staff('Amy');
        $ben = self::staff('Ben');
        $rows = $this->post('/incentives', ['month' => '2026-09', 'amount' => 10, 'staff_ids' => [$amy, $ben]])['json'];

        $this->delete("/staff/{$amy}");
        $this->assertSame(['Ben'], array_column($this->get('/incentives?month=2026-09')['json'], 'staff_name'));

        $this->assertSame(['deleted' => true], $this->delete("/incentives/{$rows[1]['id']}")['json']);
        $this->assertSame(['deleted' => false], $this->delete("/incentives/{$rows[1]['id']}")['json']);
    }

    public function testCopyBringsPeopleAndAmountsAsPendingAndAppendsInOrder(): void
    {
        $amy = self::staff('Amy');
        $ben = self::staff('Ben');
        $this->post('/incentives', ['month' => '2026-08', 'amount' => 200, 'staff_ids' => [$amy], 'status' => 'Fulfilled']);
        $this->post('/incentives', ['month' => '2026-08', 'amount' => 50.25, 'staff_ids' => [$ben], 'status' => 'Cancelled']);
        $this->post('/incentives', ['month' => '2026-09', 'amount' => 5, 'staff_ids' => [$ben]]);

        $r = $this->post('/incentives/copy', ['from' => '2026-08', 'to' => '2026-09']);
        $this->assertStatus(201, $r);
        $this->assertSame(['Ben', 'Amy', 'Ben'], array_column($r['json'], 'staff_name'));
        $this->assertEquals([5, 200, 50.25], array_column($r['json'], 'amount'));
        $this->assertSame(['Pending', 'Pending', 'Pending'], array_column($r['json'], 'status'));
        // The source month is untouched.
        $this->assertSame(['Fulfilled', 'Cancelled'], array_column($this->get('/incentives?month=2026-08')['json'], 'status'));

        $this->assertStatus(422, $this->post('/incentives/copy', ['from' => '2026-08', 'to' => '2026-08']));
        $this->assertStatus(422, $this->post('/incentives/copy', ['from' => '2026-08']));
    }
}
