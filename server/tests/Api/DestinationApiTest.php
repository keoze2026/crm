<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

final class DestinationApiTest extends ApiTestCase
{
    use SeedsCallData;

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('call_records', 'destinations', 'campaigns', 'buyers');
    }

    public function testIndexListsDestinationsAlphabetically(): void
    {
        $cid = self::seedCampaign('C-03');
        self::seedDestination('ZETA', 2.5, $cid);
        self::seedDestination('ALPHA', 1.0);

        $r = $this->get('/destinations');
        $this->assertStatus(200, $r);
        $this->assertSame(['ALPHA', 'ZETA'], array_column($r['json'], 'name'));
        $this->assertNull($r['json'][0]['campaign_id']);
        $this->assertSame($cid, $r['json'][1]['campaign_id']);
        $this->assertEquals(2.5, $r['json'][1]['rate']);
        $this->assertSame('active', $r['json'][1]['status']);
    }

    public function testIndexFiltersBySearchAndCampaign(): void
    {
        $a = self::seedCampaign('C-01');
        $b = self::seedCampaign('C-02');
        self::seedDestination('DXTST', 1.0, $a);
        self::seedDestination('dx-other', 1.0, $b);
        self::seedDestination('PDSO', 1.0, $a);

        $this->assertSame(['dx-other', 'DXTST'], array_column($this->get('/destinations?search=DX')['json'], 'name'));
        $this->assertSame(['DXTST', 'PDSO'], array_column($this->get("/destinations?campaign_id={$a}")['json'], 'name'));
        $this->assertSame(['DXTST'], array_column($this->get("/destinations?campaign_id={$a}&search=dx")['json'], 'name'));
    }

    public function testStoreCreatesDestination(): void
    {
        $cid = self::seedCampaign('C-03');
        $r   = $this->post('/destinations', ['name' => '  DXTST ', 'rate' => '4.5', 'campaign_id' => (string) $cid]);
        $this->assertStatus(201, $r);
        $this->assertSame('DXTST', $r['json']['name']);
        $this->assertEquals(4.5, $r['json']['rate']);
        $this->assertSame($cid, $r['json']['campaign_id']);
        $this->assertSame('active', $r['json']['status']);

        $bare = $this->post('/destinations', ['name' => 'BARE']);
        $this->assertStatus(201, $bare);
        $this->assertEquals(0, $bare['json']['rate']);
        $this->assertNull($bare['json']['campaign_id']);
    }

    public function testStoreRequiresName(): void
    {
        $r = $this->post('/destinations', ['name' => ' ']);
        $this->assertStatus(422, $r);
        $this->assertSame('Destination name is required', $r['json']['error']);
    }

    public function testStoreRejectsDuplicateName(): void
    {
        self::seedDestination('DXTST');
        $r = $this->post('/destinations', ['name' => 'DXTST']);
        $this->assertStatus(409, $r);
        $this->assertSame('A destination with that name already exists', $r['json']['error']);
    }

    public function testUpdateRateRestampsOnlyCampaignRecordsForThatSource(): void
    {
        $cid   = self::seedCampaign('C-03');
        $bid   = self::seedBuyer('DXTST', 3.0);
        $id    = self::seedDestination('DXTST', 4.0, $cid);
        $match = self::seedCampaignRecord($cid, 'DXTST', '2026-05-04', 10, 4.0);
        $other = self::seedCampaignRecord($cid, 'PDSO', '2026-05-04', 10, 4.0);
        $buyer = self::seedBuyerRecord($bid, '2026-05-04', 10, 3.0);

        $r = $this->put("/destinations/{$id}", ['rate' => 6]);
        $this->assertStatus(200, $r);
        $this->assertEquals(6, $r['json']['rate']);
        $this->assertSame('DXTST', $r['json']['name']);

        $this->assertEquals(60, self::dbValue('SELECT total_bill FROM call_records WHERE id = ?', [$match['id']]));
        $this->assertEquals(4, self::dbValue('SELECT rate FROM call_records WHERE id = ?', [$other['id']]));
        $this->assertEquals(3, self::dbValue('SELECT rate FROM call_records WHERE id = ?', [$buyer['id']]));
    }

    public function testUpdateWithoutRateKeepsRecordsAndOtherFields(): void
    {
        $cid = self::seedCampaign('C-03');
        $id  = self::seedDestination('DXTST', 4.0, $cid);
        $rec = self::seedCampaignRecord($cid, 'DXTST', '2026-05-04', 10, 2.0);

        $r = $this->put("/destinations/{$id}", ['status' => 'inactive']);
        $this->assertStatus(200, $r);
        $this->assertSame('inactive', $r['json']['status']);
        $this->assertSame('DXTST', $r['json']['name']);
        $this->assertEquals(4, $r['json']['rate']);
        $this->assertEquals(2, self::dbValue('SELECT rate FROM call_records WHERE id = ?', [$rec['id']]));
    }

    public function testUpdateUnknownDestinationIs404(): void
    {
        $r = $this->put('/destinations/777', ['rate' => 1]);
        $this->assertStatus(404, $r);
        $this->assertSame('Destination not found', $r['json']['error']);
    }

    public function testUpdateToAnExistingNameIsAConflict(): void
    {
        self::seedDestination('TAKEN');
        $id = self::seedDestination('MINE');

        $r = $this->put("/destinations/{$id}", ['name' => 'TAKEN']);
        $this->assertStatus(409, $r);
        $this->assertSame('MINE', self::dbValue('SELECT name FROM destinations WHERE id = ?', [$id]));
    }

    public function testDestroyDeletesDestination(): void
    {
        $id = self::seedDestination('GONE');
        $this->assertSame(['deleted' => true], $this->delete("/destinations/{$id}")['json']);
        $this->assertSame(0, (int) self::dbValue('SELECT COUNT(*) FROM destinations'));
        $this->assertSame(['deleted' => false], $this->delete("/destinations/{$id}")['json']);
    }
}
