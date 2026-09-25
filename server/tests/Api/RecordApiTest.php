<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

final class RecordApiTest extends ApiTestCase
{
    use SeedsCallData;

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('call_records', 'buyers', 'campaigns', 'destinations');
    }

    private function ids(array $res): array
    {
        return array_column($res['json']['data'], 'id');
    }

    // ── store ────────────────────────────────────────────────────────────────

    public function testStoreBuyerRecordBillsAtTheBuyersRate(): void
    {
        $bid = self::seedBuyer('RTG 04', 12.5);
        $r = $this->post('/records', [
            'record_type' => 'buyer', 'record_date' => '2026-05-04', 'buyer_id' => $bid,
            'answered' => 30, 'missed' => '5', 'replacement' => 2, 'counted' => 20, 'rate' => 99,
        ]);
        $this->assertStatus(201, $r);
        $rec = $r['json'];
        $this->assertSame('2026-05-04', $rec['record_date']);
        $this->assertSame('buyer', $rec['record_type']);
        $this->assertSame($bid, $rec['buyer_id']);
        $this->assertSame('RTG 04', $rec['buyer_code']);
        $this->assertNull($rec['campaign_id']);
        $this->assertSame(30, $rec['answered']);
        $this->assertSame(5, $rec['missed']);
        $this->assertSame(2, $rec['replacement']);
        $this->assertSame(20, $rec['counted']);
        $this->assertEquals(12.5, $rec['rate']);
        $this->assertEquals(250, $rec['total_bill']);
        $this->assertEquals(12.5, self::dbValue('SELECT rate FROM buyers WHERE id = ?', [$bid]));
    }

    public function testStoreBuyerRecordByNewCodeCreatesBuyerSeededWithTheRate(): void
    {
        $r = $this->post('/records', [
            'record_type' => 'buyer', 'record_date' => '2026-05-04', 'buyer_code' => ' NEWB ',
            'counted' => 4, 'rate' => 7.5,
        ]);
        $this->assertStatus(201, $r);
        $this->assertSame('NEWB', $r['json']['buyer_code']);
        $this->assertEquals(7.5, $r['json']['rate']);
        $this->assertEquals(30, $r['json']['total_bill']);
        $this->assertEquals(7.5, self::dbValue("SELECT rate FROM buyers WHERE code = 'NEWB'"));

        // A second record for the same code reuses the buyer and its now-definite rate.
        $again = $this->post('/records', [
            'record_type' => 'buyer', 'record_date' => '2026-05-05', 'buyer_code' => 'NEWB', 'counted' => 2, 'rate' => 1,
        ]);
        $this->assertSame($r['json']['buyer_id'], $again['json']['buyer_id']);
        $this->assertEquals(7.5, $again['json']['rate']);
        $this->assertSame(1, (int) self::dbValue('SELECT COUNT(*) FROM buyers'));
    }

    public function testStoreCampaignRecordStandardizesCodeAndSeedsANewSource(): void
    {
        $existing = self::seedCampaign('C-03');
        $r = $this->post('/records', [
            'record_type' => 'campaign', 'record_date' => '2026-05-04', 'campaign_code' => 'c3',
            'source' => 'DXTST', 'counted' => 10, 'answered' => 12, 'rate' => 4.25,
        ]);
        $this->assertStatus(201, $r);
        $this->assertSame($existing, $r['json']['campaign_id']);
        $this->assertSame('C-03', $r['json']['campaign_code']);
        $this->assertSame('DXTST', $r['json']['source']);
        $this->assertNull($r['json']['buyer_id']);
        $this->assertEquals(4.25, $r['json']['rate']);
        $this->assertEquals(42.5, $r['json']['total_bill']); // never rounded off

        $dest = self::db()->query("SELECT rate, campaign_id FROM destinations WHERE name = 'DXTST'")->fetch();
        $this->assertEquals(4.25, $dest['rate']);
        $this->assertSame($existing, $dest['campaign_id']);
        $this->assertEquals(42.5, self::dbValue('SELECT total_bill FROM call_records WHERE id = ?', [$r['json']['id']]));
    }

    public function testStoreCampaignRecordByUnknownCodeCreatesTheCampaign(): void
    {
        $r = $this->post('/records', [
            'record_type' => 'campaign', 'record_date' => '2026-05-04', 'campaign_code' => 'c 9', 'source' => 'X',
        ]);
        $this->assertStatus(201, $r);
        $this->assertSame('C-09', $r['json']['campaign_code']);
        $this->assertSame(['C-09'], self::db()->query('SELECT code FROM campaigns')->fetchAll(\PDO::FETCH_COLUMN));
    }

    public function testStoreCampaignRecordWithoutRateInheritsTheSourceRate(): void
    {
        $cid = self::seedCampaign('C-03');
        self::seedDestination('DXTST', 3.5, $cid);

        $known = $this->post('/records', [
            'record_type' => 'campaign', 'record_date' => '2026-05-04', 'campaign_id' => $cid,
            'source' => 'DXTST', 'counted' => 2,
        ]);
        $this->assertEquals(3.5, $known['json']['rate']);
        $this->assertEquals(7, $known['json']['total_bill']);

        $unknown = $this->post('/records', [
            'record_type' => 'campaign', 'record_date' => '2026-05-04', 'campaign_id' => $cid,
            'source' => 'NOPE', 'counted' => 2,
        ]);
        $this->assertEquals(0, $unknown['json']['rate']);
        $this->assertSame(0, (int) self::dbValue("SELECT COUNT(*) FROM destinations WHERE name = 'NOPE'"));
    }

    public function testStoreCampaignRecordRateOverrideKeepsExistingSourceRateButLinksCampaign(): void
    {
        $cid = self::seedCampaign('C-03');
        self::seedDestination('DXTST', 3.5, null);

        $r = $this->post('/records', [
            'record_type' => 'campaign', 'record_date' => '2026-05-04', 'campaign_id' => $cid,
            'source' => 'DXTST', 'counted' => 2, 'rate' => 9,
        ]);
        $this->assertEquals(9, $r['json']['rate']);
        $dest = self::db()->query("SELECT rate, campaign_id FROM destinations WHERE name = 'DXTST'")->fetch();
        $this->assertEquals(3.5, $dest['rate']);
        $this->assertSame($cid, $dest['campaign_id']);
    }

    public function testStoreValidatesTypeDateAndOwner(): void
    {
        $bad = $this->post('/records', ['record_type' => 'other', 'record_date' => '2026-05-04']);
        $this->assertStatus(422, $bad);
        $this->assertSame('record_type must be "buyer" or "campaign"', $bad['json']['error']);

        $noDate = $this->post('/records', ['record_type' => 'buyer', 'buyer_code' => 'X']);
        $this->assertStatus(422, $noDate);
        $this->assertSame('record_date is required', $noDate['json']['error']);

        $noBuyer = $this->post('/records', ['record_type' => 'buyer', 'record_date' => '2026-05-04', 'buyer_code' => '  ']);
        $this->assertStatus(422, $noBuyer);
        $this->assertSame('A buyer is required for buyer records', $noBuyer['json']['error']);

        $noCamp = $this->post('/records', ['record_type' => 'campaign', 'record_date' => '2026-05-04']);
        $this->assertStatus(422, $noCamp);
        $this->assertSame('A campaign is required for campaign records', $noCamp['json']['error']);

        $this->assertSame(0, (int) self::dbValue('SELECT COUNT(*) FROM call_records'));
        $this->assertSame(0, (int) self::dbValue('SELECT COUNT(*) FROM buyers'));
    }

    // ── update / destroy ─────────────────────────────────────────────────────

    public function testUpdateChangesOnlySuppliedFields(): void
    {
        $cid = self::seedCampaign('C-03');
        $rec = self::seedCampaignRecord($cid, 'DXTST', '2026-05-04', 10, 4.0, 12, 3, 1);

        $r = $this->put("/records/{$rec['id']}", ['counted' => 11, 'rate' => 5, 'record_date' => '2026-05-06']);
        $this->assertStatus(200, $r);
        $this->assertSame('2026-05-06', $r['json']['record_date']);
        $this->assertSame(11, $r['json']['counted']);
        $this->assertEquals(5, $r['json']['rate']);
        $this->assertEquals(55, $r['json']['total_bill']);
        $this->assertSame(12, $r['json']['answered']);
        $this->assertSame(3, $r['json']['missed']);
        $this->assertSame(1, $r['json']['replacement']);
        $this->assertSame('DXTST', $r['json']['source']);
        $this->assertSame('C-03', $r['json']['campaign_code']);
    }

    public function testUpdateUnknownRecordIs404(): void
    {
        $r = $this->put('/records/999', ['counted' => 1]);
        $this->assertStatus(404, $r);
        $this->assertSame('Record not found', $r['json']['error']);
    }

    public function testDestroyDeletesRecord(): void
    {
        $bid = self::seedBuyer('B');
        $rec = self::seedBuyerRecord($bid, '2026-05-04', 1, 1.0);
        $this->assertSame(['deleted' => true], $this->delete("/records/{$rec['id']}")['json']);
        $this->assertSame(0, (int) self::dbValue('SELECT COUNT(*) FROM call_records'));
        $this->assertSame(['deleted' => false], $this->delete("/records/{$rec['id']}")['json']);
    }

    // ── index ────────────────────────────────────────────────────────────────

    public function testIndexPaginatesSortedByTotalBillDescending(): void
    {
        $bid = self::seedBuyer('B');
        $ids = [];
        foreach ([3, 1, 5, 2, 4] as $counted) {
            $ids[$counted] = self::seedBuyerRecord($bid, '2026-05-04', $counted, 10.0)['id'];
        }

        $p1 = $this->get('/records?per_page=2');
        $this->assertStatus(200, $p1);
        $this->assertSame([$ids[5], $ids[4]], $this->ids($p1));
        $this->assertSame(['page' => 1, 'per_page' => 2, 'total' => 5, 'pages' => 3], $p1['json']['meta']);

        $p3 = $this->get('/records?per_page=2&page=3');
        $this->assertSame([$ids[1]], $this->ids($p3));

        $all = $this->get('/records');
        $this->assertSame(35, $all['json']['meta']['per_page']);
        $this->assertCount(5, $all['json']['data']);
    }

    public function testIndexClampsPagingParameters(): void
    {
        $bid = self::seedBuyer('B');
        self::seedBuyerRecord($bid, '2026-05-04', 1, 1.0);

        $meta = $this->get('/records?page=0&per_page=0')['json']['meta'];
        $this->assertSame(1, $meta['page']);
        $this->assertSame(1, $meta['per_page']);
        $this->assertSame(9999, $this->get('/records?per_page=50000')['json']['meta']['per_page']);
    }

    public function testIndexSortsByWhitelistedColumnsAndFallsBackForOthers(): void
    {
        $bid = self::seedBuyer('B');
        $a = self::seedBuyerRecord($bid, '2026-05-06', 1, 1.0)['id'];
        $b = self::seedBuyerRecord($bid, '2026-05-04', 9, 1.0)['id'];
        $c = self::seedBuyerRecord($bid, '2026-05-05', 5, 1.0)['id'];

        $this->assertSame([$b, $c, $a], $this->ids($this->get('/records?sort=record_date&dir=asc')));
        $this->assertSame([$a, $c, $b], $this->ids($this->get('/records?sort=record_date&dir=DESC')));
        $this->assertSame([$b, $c, $a], $this->ids($this->get('/records?sort=id;DROP&dir=sideways')));
    }

    public function testIndexAppliesEveryFilter(): void
    {
        $b1 = self::seedBuyer('RTG 04');
        $b2 = self::seedBuyer('ACME');
        $c1 = self::seedCampaign('C-03');
        $r1 = self::seedBuyerRecord($b1, '2026-05-04', 1, 1.0)['id'];
        $r2 = self::seedBuyerRecord($b2, '2026-05-10', 2, 1.0)['id'];
        $r3 = self::seedCampaignRecord($c1, 'DXTST', '2026-05-06', 3, 1.0)['id'];
        $r4 = self::seedCampaignRecord($c1, 'PDSO', '2026-04-30', 4, 1.0)['id'];

        $sorted = fn (string $q) => (function () use ($q) {
            $ids = $this->ids($this->get('/records?' . $q));
            sort($ids);
            return $ids;
        })();

        $this->assertSame([$r1, $r3], $sorted('from=2026-05-01&to=2026-05-06'));
        $this->assertSame([$r3, $r4], $sorted('type=campaign'));
        $this->assertSame([$r1, $r2, $r3, $r4], $sorted('type=bogus'));
        $this->assertSame([$r2], $sorted("buyer_id={$b2}"));
        $this->assertSame([$r3, $r4], $sorted("campaign_id={$c1}"));
        $this->assertSame([$r1], $sorted('search=rtg'));
        $this->assertSame([$r3, $r4], $sorted('search=c-03'));
        $this->assertSame([$r4], $sorted('search=pds'));
        $this->assertSame([$r3], $sorted('type=campaign&from=2026-05-01'));

        $this->assertSame(2, $this->get('/records?type=campaign')['json']['meta']['total']);
    }

    // ── export ───────────────────────────────────────────────────────────────

    public function testExportStreamsFilteredCsv(): void
    {
        $b1 = self::seedBuyer('RTG 04');
        $c1 = self::seedCampaign('C-03');
        self::seedBuyerRecord($b1, '2026-05-04', 3, 12.5, 5, 2, 1);
        self::seedCampaignRecord($c1, 'DXTST', '2026-05-05', 10, 4.0, 11, 0, 0);
        self::seedCampaignRecord($c1, 'DXTST', '2026-06-05', 99, 4.0);

        $r = $this->get('/records/export?to=2026-05-31');
        $this->assertStatus(200, $r);
        $headers = implode("\n", $r['headers']);
        $this->assertStringContainsString('Content-Type: text/csv', $headers);
        $this->assertStringContainsString('filename="lead-records.csv"', $headers);

        $lines = array_values(array_filter(preg_split('/\R/', $r['body'])));
        $this->assertSame([
            'Date,Type,Buyer,Campaign,Answered,Missed,Replacement,Counted,Rate,"Total Bill"',
            '2026-05-05,campaign,,C-03,11,0,0,10,4.00,40.00',
            '2026-05-04,buyer,"RTG 04",,5,2,1,3,12.50,37.50',
        ], $lines);
    }

    public function testExportWithNoMatchesIsHeaderOnly(): void
    {
        $r = $this->get('/records/export?type=buyer');
        $this->assertStatus(200, $r);
        $this->assertCount(1, array_filter(preg_split('/\R/', $r['body'])));
    }
}
