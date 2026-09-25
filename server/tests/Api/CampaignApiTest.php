<?php

declare(strict_types=1);

namespace Tests\Api;

use PHPUnit\Framework\Attributes\DataProvider;
use Tests\ApiTestCase;

final class CampaignApiTest extends ApiTestCase
{
    use SeedsCallData;

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('call_records', 'campaigns', 'destinations', 'buyers');
    }

    public static function codeVariants(): array
    {
        return [
            'lowercase run-together' => ['c03', 'C-03'],
            'single digit'           => ['c-3', 'C-03'],
            'spaces anywhere'        => ['C 0 3', 'C-03'],
            'letter O as zero'       => ['Co3', 'C-03'],
            'multi-letter prefix'    => ['co-05', 'CO-05'],
            'underscore separator'   => ['ab_7', 'AB-07'],
            'three digits kept'      => ['c-123', 'C-123'],
            'non-pattern unchanged'  => ['  GOOGLE ', 'GOOGLE'],
        ];
    }

    #[DataProvider('codeVariants')]
    public function testStoreStandardizesTheCampaignCode(string $input, string $expected): void
    {
        $r = $this->post('/campaigns', ['code' => $input]);
        $this->assertStatus(201, $r);
        $this->assertSame($expected, $r['json']['code']);
        $this->assertSame($expected, self::dbValue('SELECT code FROM campaigns'));
    }

    public function testStoreDefaultsAndPersistsSheetMetrics(): void
    {
        $r = $this->post('/campaigns', [
            'code' => 'C-01', 'name' => 'One', 'notes' => 'nn',
            'answered' => 40, 'missed' => '6', 'counted' => 30, 'cost' => '123.45',
        ]);
        $this->assertStatus(201, $r);
        $c = $r['json'];
        $this->assertSame('active', $c['status']);
        $this->assertSame('One', $c['name']);
        $this->assertSame('nn', $c['notes']);
        $this->assertEquals(40, $c['answered']);
        $this->assertEquals(6, $c['missed']);
        $this->assertEquals(30, $c['counted']);
        $this->assertEquals(123.45, $c['cost']);

        $bare = $this->post('/campaigns', ['code' => 'C-02'])['json'];
        $this->assertEquals(0, $bare['cost']);
        $this->assertEquals(0, $bare['counted']);
    }

    public function testStoreRequiresCode(): void
    {
        $r = $this->post('/campaigns', ['code' => '   ']);
        $this->assertStatus(422, $r);
        $this->assertSame('Campaign code is required', $r['json']['error']);
        $this->assertStatus(422, $this->post('/campaigns', []));
    }

    public function testStoreRejectsACodeThatStandardizesToAnExistingOne(): void
    {
        self::seedCampaign('C-03');
        $r = $this->post('/campaigns', ['code' => 'c3']);
        $this->assertStatus(409, $r);
        $this->assertSame('A campaign with that code already exists', $r['json']['error']);
    }

    public function testIndexReturnsStoredMetricsAndRangeScopedActivity(): void
    {
        $id = self::seedCampaign('C-03', ['answered' => 9, 'missed' => 1, 'counted' => 8, 'cost' => '99.50']);
        self::seedCampaign('C-04');
        self::seedCampaignRecord($id, 'DXTST', '2026-05-04', 5, 2.0);
        self::seedCampaignRecord($id, 'DXTST', '2026-05-05', 5, 2.0);
        self::seedCampaignRecord($id, 'PDSO', '2026-05-20', 5, 2.0);

        $rows = array_column($this->get('/campaigns')['json'], null, 'code');
        $this->assertSame(['C-03', 'C-04'], array_keys($rows));
        $this->assertEquals(99.5, $rows['C-03']['cost']);
        $this->assertEquals(8, $rows['C-03']['counted']);
        $this->assertEquals(9, $rows['C-03']['answered']);
        $this->assertEquals(1, $rows['C-03']['missed']);
        $this->assertEquals(3, $rows['C-03']['records']);
        $this->assertEquals(2, $rows['C-03']['sources']);
        $this->assertSame('2026-05-20', $rows['C-03']['last_activity']);
        $this->assertEquals(0, $rows['C-04']['records']);

        $scoped = array_column($this->get('/campaigns?from=2026-05-05&to=2026-05-10')['json'], null, 'code');
        $this->assertCount(2, $scoped);
        $this->assertEquals(1, $scoped['C-03']['records']);
        $this->assertEquals(1, $scoped['C-03']['sources']);
        $this->assertSame('2026-05-05', $scoped['C-03']['last_activity']);
        // The keyed-in sheet metrics are not range-scoped.
        $this->assertEquals(99.5, $scoped['C-03']['cost']);
    }

    public function testIndexSearchMatchesCodeOrName(): void
    {
        self::seedCampaign('C-03', ['name' => 'Medicare']);
        self::seedCampaign('C-04', ['name' => 'Auto']);
        self::seedCampaign('MEDI-9');

        $codes = array_column($this->get('/campaigns?search=medi')['json'], 'code');
        sort($codes);
        $this->assertSame(['C-03', 'MEDI-9'], $codes);
    }

    public function testIndexOrdersByCostDescending(): void
    {
        self::seedCampaign('C-01', ['cost' => '5']);
        self::seedCampaign('C-02', ['cost' => '50']);
        self::seedCampaign('C-03', ['cost' => '20']);
        $this->assertSame(['C-02', 'C-03', 'C-01'], array_column($this->get('/campaigns')['json'], 'code'));
    }

    public function testSourcesListsLinkedDestinationsWithCampaignVolume(): void
    {
        $id    = self::seedCampaign('C-03');
        $other = self::seedCampaign('C-09');
        self::seedDestination('DXTST', 4.0, $id);
        self::seedDestination('PDSO', 5.0, $id);
        self::seedDestination('IDLE', 1.5, $id);
        self::seedDestination('ELSEWHERE', 9.0, $other);
        self::seedCampaignRecord($id, 'DXTST', '2026-05-04', 10, 4.0);
        self::seedCampaignRecord($id, 'DXTST', '2026-05-05', 5, 4.0);
        self::seedCampaignRecord($id, 'PDSO', '2026-05-04', 20, 5.0);
        // Same source name on another campaign must not leak in.
        self::seedCampaignRecord($other, 'DXTST', '2026-05-04', 100, 4.0);

        $r = $this->get("/campaigns/{$id}/sources");
        $this->assertStatus(200, $r);
        $this->assertSame(['PDSO', 'DXTST', 'IDLE'], array_column($r['json'], 'name'));
        $this->assertEquals(100, $r['json'][0]['cost']);
        $this->assertEquals(20, $r['json'][0]['counted']);
        $this->assertEquals(5, $r['json'][0]['rate']);
        $this->assertEquals(60, $r['json'][1]['cost']);
        $this->assertEquals(15, $r['json'][1]['counted']);
        $this->assertEquals(0, $r['json'][2]['cost']);
        $this->assertEquals(1.5, $r['json'][2]['rate']);
        $this->assertIsInt($r['json'][0]['destination_id']);
    }

    public function testSourcesForCampaignWithoutDestinationsIsEmpty(): void
    {
        $id = self::seedCampaign('C-03');
        $r  = $this->get("/campaigns/{$id}/sources");
        $this->assertStatus(200, $r);
        $this->assertSame([], $r['json']);
    }

    public function testUpdateOnlyTouchesSuppliedMetricsAndStandardizesCode(): void
    {
        $id = self::seedCampaign('C-03', ['answered' => 9, 'missed' => 1, 'counted' => 8, 'cost' => '99.50']);

        $r = $this->put("/campaigns/{$id}", ['code' => 'c 7', 'name' => 'Seven', 'counted' => 12, 'status' => 'paused']);
        $this->assertStatus(200, $r);
        $this->assertSame('C-07', $r['json']['code']);
        $this->assertSame('Seven', $r['json']['name']);
        $this->assertSame('paused', $r['json']['status']);
        $this->assertEquals(12, $r['json']['counted']);
        $this->assertEquals(9, $r['json']['answered']);
        $this->assertEquals(1, $r['json']['missed']);
        $this->assertEquals(99.5, $r['json']['cost']);
    }

    public function testUpdateRejectsCodeCollision(): void
    {
        self::seedCampaign('C-03');
        $id = self::seedCampaign('C-04');
        $r  = $this->put("/campaigns/{$id}", ['code' => 'C3']);
        $this->assertStatus(409, $r);
        $this->assertSame('C-04', self::dbValue('SELECT code FROM campaigns WHERE id = ?', [$id]));
    }

    public function testUpdateUnknownCampaignIs404(): void
    {
        $r = $this->put('/campaigns/4242', ['name' => 'x']);
        $this->assertStatus(404, $r);
        $this->assertSame('Campaign not found', $r['json']['error']);
    }

    public function testDestroyRemovesCampaignItsSourcesAndRecords(): void
    {
        $id   = self::seedCampaign('C-03');
        $keep = self::seedCampaign('C-04');
        self::seedDestination('DXTST', 1.0, $id);
        self::seedDestination('KEEPME', 1.0, $keep);
        self::seedCampaignRecord($id, 'DXTST', '2026-05-04', 1, 1.0);
        self::seedCampaignRecord($keep, 'KEEPME', '2026-05-04', 1, 1.0);

        $r = $this->delete("/campaigns/{$id}");
        $this->assertStatus(200, $r);
        $this->assertSame(['deleted' => true], $r['json']);
        $this->assertSame(['KEEPME'], self::db()->query('SELECT name FROM destinations')->fetchAll(\PDO::FETCH_COLUMN));
        $this->assertSame(1, (int) self::dbValue('SELECT COUNT(*) FROM call_records'));
        $this->assertSame(1, (int) self::dbValue('SELECT COUNT(*) FROM campaigns'));
    }

    public function testDestroyUnknownCampaignReportsNothingDeleted(): void
    {
        $this->assertSame(['deleted' => false], $this->delete('/campaigns/999')['json']);
    }
}
