<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

final class BuyerApiTest extends ApiTestCase
{
    use SeedsCallData;

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('call_records', 'buyers', 'campaigns');
    }

    private function byCode(array $rows): array
    {
        return array_column($rows, null, 'code');
    }

    public function testIndexListsBuyersWithZeroTotalsWhenTheyHaveNoRecords(): void
    {
        self::seedBuyer('RTG 04', 12.5, 'Rtg');

        $r = $this->get('/buyers');
        $this->assertStatus(200, $r);
        $this->assertCount(1, $r['json']);
        $b = $r['json'][0];
        $this->assertSame('RTG 04', $b['code']);
        $this->assertSame('Rtg', $b['name']);
        $this->assertSame('active', $b['status']);
        $this->assertEquals(12.5, $b['rate']);
        $this->assertEquals(0, $b['counted']);
        $this->assertEquals(0, $b['revenue']);
        $this->assertEquals(0, $b['records']);
        $this->assertEquals(0, $b['record_days']);
        $this->assertNull($b['last_activity']);
    }

    public function testIndexAggregatesWeekdayRecordsAndIgnoresWeekends(): void
    {
        $id = self::seedBuyer('RTG 04', 10.0);
        // 2026-05-04 Mon, 2026-05-05 Tue (two rows), 2026-05-02 Sat, 2026-05-03 Sun.
        self::seedBuyerRecord($id, '2026-05-04', 20, 10.0, 30, 10);
        self::seedBuyerRecord($id, '2026-05-05', 5, 10.0, 8, 2);
        self::seedBuyerRecord($id, '2026-05-05', 3, 10.0, 4, 1);
        self::seedBuyerRecord($id, '2026-05-02', 100, 10.0, 100, 100);
        self::seedBuyerRecord($id, '2026-05-03', 100, 10.0, 100, 100);

        $b = $this->get('/buyers')['json'][0];
        $this->assertEquals(28, $b['counted']);
        $this->assertEquals(280, $b['revenue']);
        $this->assertEquals(42, $b['answered']);
        $this->assertEquals(13, $b['missed']);
        $this->assertEquals(3, $b['records']);
        $this->assertEquals(2, $b['record_days']);
        $this->assertSame('2026-05-05', $b['last_activity']);
    }

    public function testIndexRevenueUsesTheBuyersCurrentRate(): void
    {
        $id = self::seedBuyer('RTG 04', 7.0);
        self::seedBuyerRecord($id, '2026-05-04', 10, 3.0);

        $b = $this->get('/buyers')['json'][0];
        $this->assertEquals(70, $b['revenue']);
    }

    public function testIndexDateRangeScopesTotalsButKeepsEveryBuyer(): void
    {
        $a = self::seedBuyer('AAA', 1.0);
        $b = self::seedBuyer('BBB', 1.0);
        self::seedBuyerRecord($a, '2026-05-04', 10, 1.0);
        self::seedBuyerRecord($a, '2026-05-11', 7, 1.0);
        self::seedBuyerRecord($b, '2026-04-01', 50, 1.0);

        $rows = $this->byCode($this->get('/buyers?from=2026-05-05&to=2026-05-31')['json']);
        $this->assertCount(2, $rows);
        $this->assertEquals(7, $rows['AAA']['counted']);
        $this->assertSame('2026-05-11', $rows['AAA']['last_activity']);
        $this->assertEquals(0, $rows['BBB']['counted']);
        $this->assertEquals(0, $rows['BBB']['records']);
    }

    public function testIndexSearchMatchesCodeOrNameCaseInsensitively(): void
    {
        self::seedBuyer('RTG 04', 1.0, 'Alpha');
        self::seedBuyer('XYZ', 1.0, 'Rtg Partner');
        self::seedBuyer('OTHER', 1.0, 'Nope');

        $codes = array_column($this->get('/buyers?search=rtg')['json'], 'code');
        sort($codes);
        $this->assertSame(['RTG 04', 'XYZ'], $codes);
    }

    public function testIndexOrdersByCountedDescending(): void
    {
        $low  = self::seedBuyer('LOW', 1.0);
        $high = self::seedBuyer('HIGH', 1.0);
        self::seedBuyerRecord($low, '2026-05-04', 1, 1.0);
        self::seedBuyerRecord($high, '2026-05-04', 9, 1.0);

        $this->assertSame(['HIGH', 'LOW'], array_column($this->get('/buyers')['json'], 'code'));
    }

    public function testStoreCreatesBuyerWithDefaults(): void
    {
        $r = $this->post('/buyers', ['code' => '  NEW 1  ']);
        $this->assertStatus(201, $r);
        $this->assertSame('NEW 1', $r['json']['code']);
        $this->assertSame('active', $r['json']['status']);
        $this->assertEquals(0.0, $r['json']['rate']);
        $this->assertNull($r['json']['name']);

        $this->assertSame('NEW 1', self::dbValue('SELECT code FROM buyers WHERE id = ?', [$r['json']['id']]));
    }

    public function testStorePersistsAllFields(): void
    {
        $r = $this->post('/buyers', [
            'code' => 'FULL', 'name' => 'Full Buyer', 'status' => 'inactive', 'notes' => 'n', 'rate' => '15.25',
        ]);
        $this->assertStatus(201, $r);
        $this->assertSame('Full Buyer', $r['json']['name']);
        $this->assertSame('inactive', $r['json']['status']);
        $this->assertSame('n', $r['json']['notes']);
        $this->assertEquals(15.25, $r['json']['rate']);
    }

    public function testStoreRequiresCode(): void
    {
        $this->assertStatus(422, $this->post('/buyers', ['name' => 'x']));
        $r = $this->post('/buyers', ['code' => '   ']);
        $this->assertStatus(422, $r);
        $this->assertSame('Buyer code is required', $r['json']['error']);
        $this->assertSame(0, (int) self::dbValue('SELECT COUNT(*) FROM buyers'));
    }

    public function testStoreRejectsDuplicateCode(): void
    {
        self::seedBuyer('DUP');
        $r = $this->post('/buyers', ['code' => 'DUP']);
        $this->assertStatus(409, $r);
        $this->assertSame('A buyer with that code already exists', $r['json']['error']);
    }

    public function testUpdateChangesFieldsAndRestampsRecordRates(): void
    {
        $id  = self::seedBuyer('OLD', 5.0, 'Old');
        $rec = self::seedBuyerRecord($id, '2026-05-04', 10, 5.0);

        $r = $this->put("/buyers/{$id}", ['code' => 'NEWCODE', 'name' => 'New', 'rate' => 8, 'status' => 'inactive']);
        $this->assertStatus(200, $r);
        $this->assertSame('NEWCODE', $r['json']['code']);
        $this->assertSame('New', $r['json']['name']);
        $this->assertSame('inactive', $r['json']['status']);
        $this->assertEquals(8.0, $r['json']['rate']);

        $row = self::db()->query("SELECT rate, total_bill FROM call_records WHERE id = {$rec['id']}")->fetch();
        $this->assertEquals(8, $row['rate']);
        $this->assertEquals(80, $row['total_bill']);
    }

    public function testUpdateWithoutRateLeavesRecordsAndRateUntouched(): void
    {
        $id  = self::seedBuyer('KEEP', 5.0, 'Keep');
        $rec = self::seedBuyerRecord($id, '2026-05-04', 10, 4.0);

        $r = $this->put("/buyers/{$id}", ['name' => 'Keep', 'notes' => 'hello']);
        $this->assertStatus(200, $r);
        $this->assertEquals(5.0, $r['json']['rate']);
        $this->assertSame('KEEP', $r['json']['code']);
        $this->assertSame('hello', $r['json']['notes']);
        $this->assertEquals(4, self::dbValue('SELECT rate FROM call_records WHERE id = ?', [$rec['id']]));
    }

    public function testUpdateUnknownBuyerIs404(): void
    {
        $r = $this->put('/buyers/999', ['name' => 'x']);
        $this->assertStatus(404, $r);
        $this->assertSame('Buyer not found', $r['json']['error']);
    }

    public function testUpdateToAnExistingCodeIsAConflict(): void
    {
        self::seedBuyer('TAKEN');
        $id = self::seedBuyer('MINE');

        $r = $this->put("/buyers/{$id}", ['code' => 'TAKEN', 'name' => 'Mine']);
        $this->assertStatus(409, $r);
        $this->assertSame('MINE', self::dbValue('SELECT code FROM buyers WHERE id = ?', [$id]));
    }

    public function testDestroyRemovesBuyerAndCascadesItsRecords(): void
    {
        $id    = self::seedBuyer('GONE', 1.0);
        $other = self::seedBuyer('STAYS', 1.0);
        self::seedBuyerRecord($id, '2026-05-04', 1, 1.0);
        self::seedBuyerRecord($other, '2026-05-04', 1, 1.0);

        $r = $this->delete("/buyers/{$id}");
        $this->assertStatus(200, $r);
        $this->assertSame(['deleted' => true], $r['json']);
        $this->assertSame(1, (int) self::dbValue('SELECT COUNT(*) FROM buyers'));
        $this->assertSame(1, (int) self::dbValue('SELECT COUNT(*) FROM call_records'));
    }

    public function testDestroyUnknownBuyerReportsNothingDeleted(): void
    {
        $r = $this->delete('/buyers/12345');
        $this->assertStatus(200, $r);
        $this->assertSame(['deleted' => false], $r['json']);
    }
}
