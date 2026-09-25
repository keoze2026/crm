<?php

declare(strict_types=1);

namespace Tests\Integration;

use Tests\ApiTestCase;

/**
 * What a change to the catalogue does to call records that already exist and to the ones
 * keyed in afterwards: buyer / source rate changes, per-record overrides, renames and deletes,
 * followed through the records list, the analytics endpoints and the vendor ledger.
 */
final class CallFlowRateChangeIntegrationTest extends ApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('call_records', 'buyers', 'campaigns', 'destinations', 'portal_expenses', 'vendors', 'vendor_payments');
    }

    private function create(string $path, array $body): array
    {
        $r = $this->post($path, $body);
        $this->assertStatus(201, $r);
        return $r['json'];
    }

    private function buyerRecord(int $buyerId, string $date, int $counted, array $extra = []): array
    {
        return $this->create('/records', ['record_type' => 'buyer', 'record_date' => $date, 'buyer_id' => $buyerId, 'counted' => $counted] + $extra);
    }

    private function campaignRecord(int $campaignId, string $source, string $date, int $counted, array $extra = []): array
    {
        return $this->create('/records', ['record_type' => 'campaign', 'record_date' => $date, 'campaign_id' => $campaignId, 'source' => $source, 'counted' => $counted] + $extra);
    }

    private function summary(string $from, string $to): array
    {
        return $this->get("/analytics/summary?from={$from}&to={$to}")['json'];
    }

    /** @return array<int, float> total_bill by record id */
    private function bills(string $query = ''): array
    {
        $rows = $this->get('/records?per_page=500' . $query)['json']['data'];
        return array_column($rows, 'total_bill', 'id');
    }

    public function testBuyerRateChangeRestampsPastAndPresentRecordsAndNewRecordsInheritIt(): void
    {
        $buyer = $this->create('/buyers', ['code' => 'RTG 04', 'name' => 'RTG 04', 'rate' => 30]);
        $july  = $this->buyerRecord($buyer['id'], '2026-07-31', 3);
        $aug   = $this->buyerRecord($buyer['id'], '2026-08-03', 10);
        $this->assertEquals(90, $this->summary('2026-07-01', '2026-07-31')['revenue']);
        $this->assertEquals(300, $this->summary('2026-08-01', '2026-08-31')['revenue']);

        $r = $this->put("/buyers/{$buyer['id']}", ['code' => 'RTG 04', 'name' => 'RTG 04', 'rate' => 40]);
        $this->assertStatus(200, $r);
        $this->assertEquals(40, $r['json']['rate']);

        // Both months are re-priced, not just the open one.
        $this->assertEquals([$july['id'] => 120, $aug['id'] => 400], $this->bills());
        $this->assertEquals(120, $this->summary('2026-07-01', '2026-07-31')['revenue']);
        $this->assertEquals(400, $this->summary('2026-08-01', '2026-08-31')['revenue']);
        $this->assertEquals(400, $this->get('/analytics/top-buyers?from=2026-08-01&to=2026-08-31')['json'][0]['revenue']);

        // A new record bills at the new rate even when the form sends a stale one.
        $new = $this->buyerRecord($buyer['id'], '2026-08-04', 2, ['rate' => 30]);
        $this->assertEquals(40, $new['rate']);
        $this->assertEquals(80, $new['total_bill']);

        // A per-record override touches that record only …
        $r = $this->put("/records/{$new['id']}", ['rate' => 35]);
        $this->assertEquals(70, $r['json']['total_bill']);
        $this->assertEquals(40, array_column($this->get('/buyers')['json'], 'rate', 'code')['RTG 04']);
        $this->assertEquals(470, $this->get('/analytics/complete-report?from=2026-08-01&to=2026-08-31')['json']['revenue']);

        // … and the next buyer-level rate change folds it back in.
        $this->put("/buyers/{$buyer['id']}", ['code' => 'RTG 04', 'name' => 'RTG 04', 'rate' => 50]);
        $this->assertEquals([$july['id'] => 150, $aug['id'] => 500, $new['id'] => 100], $this->bills());
        $this->assertEquals(600, $this->summary('2026-08-01', '2026-08-31')['revenue']);
    }

    public function testEditingABuyerWithoutARateLeavesEveryRecordPriced(): void
    {
        $buyer = $this->create('/buyers', ['code' => 'BLU 01', 'rate' => 25]);
        $rec   = $this->buyerRecord($buyer['id'], '2026-08-03', 4);

        $this->assertStatus(200, $this->put("/buyers/{$buyer['id']}", ['code' => 'BLU 01', 'name' => 'Blue', 'status' => 'inactive']));
        $this->assertEquals([$rec['id'] => 100], $this->bills());
        $this->assertEquals(100, $this->summary('2026-08-01', '2026-08-31')['revenue']);
    }

    public function testSourceRateChangeRestampsItsRecordsInEveryCampaignAndTheVendorLedger(): void
    {
        $c03 = $this->create('/campaigns', ['code' => 'C-03']);
        $c07 = $this->create('/campaigns', ['code' => 'C-07']);
        $ads = $this->create('/destinations', ['name' => 'AdsTerra', 'rate' => 12, 'campaign_id' => $c03['id']]);
        $this->create('/destinations', ['name' => 'PropAds', 'rate' => 8, 'campaign_id' => $c03['id']]);

        $a1 = $this->campaignRecord($c03['id'], 'AdsTerra', '2026-08-03', 5);
        $a2 = $this->campaignRecord($c07['id'], 'AdsTerra', '2026-08-04', 5, ['rate' => 15]);
        $p1 = $this->campaignRecord($c03['id'], 'PropAds', '2026-08-04', 4);
        $this->assertEquals([60, 75, 32], [$a1['total_bill'], $a2['total_bill'], $p1['total_bill']]);
        // The override billed that record only; the source keeps its rate.
        $this->assertEquals(12, array_column($this->get('/destinations')['json'], 'rate', 'name')['AdsTerra']);
        $this->assertEquals(167, $this->summary('2026-08-01', '2026-08-31')['cost']);

        $r = $this->put("/destinations/{$ads['id']}", ['rate' => 10]);
        $this->assertStatus(200, $r);

        $this->assertEquals([$a1['id'] => 50, $a2['id'] => 50, $p1['id'] => 32], $this->bills());
        $this->assertEquals(132, $this->summary('2026-08-01', '2026-08-31')['cost']);
        $this->assertEquals(
            ['C-03' => 82, 'C-07' => 50],
            array_column($this->get('/analytics/top-campaigns?from=2026-08-01&to=2026-08-31')['json'], 'cost', 'code')
        );
        $this->assertEquals(
            ['AdsTerra' => 100, 'PropAds' => 32],
            array_column($this->get('/analytics/top-sources?from=2026-08-01&to=2026-08-31')['json'], 'cost', 'source')
        );
        $ledger = $this->get('/vendor-payments?vendor=AdsTerra&from=2026-08-01&to=2026-08-31')['json'];
        $this->assertEquals([50, 50], array_column($ledger['rows'], 'payments'));
        $this->assertEquals([10, 10], array_column($ledger['rows'], 'price'));

        $panel = array_column($this->get("/campaigns/{$c03['id']}/sources")['json'], null, 'name');
        $this->assertEquals(['rate' => 10, 'counted' => 5, 'cost' => 50], array_intersect_key($panel['AdsTerra'], ['rate' => 0, 'counted' => 0, 'cost' => 0]));

        // New records inherit the new rate; a record-level edit does not move the source's rate.
        $a3 = $this->campaignRecord($c07['id'], 'AdsTerra', '2026-08-05', 1);
        $this->assertEquals(10, $a3['rate']);
        $this->assertEquals(80, $this->put("/records/{$p1['id']}", ['rate' => 20])['json']['total_bill']);
        $this->assertEquals(8, array_column($this->get('/destinations')['json'], 'rate', 'name')['PropAds']);
        $this->assertEquals(50 + 50 + 10 + 80, $this->get('/analytics/complete-report?from=2026-08-01&to=2026-08-31')['json']['cost']);
    }

    public function testMovingARecordToAnotherMonthMovesItsMoneyBetweenPeriods(): void
    {
        $buyer = $this->create('/buyers', ['code' => 'RTG 04', 'rate' => 30]);
        $camp  = $this->create('/campaigns', ['code' => 'C-03']);
        $rev   = $this->buyerRecord($buyer['id'], '2026-08-31', 10);
        $cost  = $this->campaignRecord($camp['id'], 'AdsTerra', '2026-08-31', 5, ['rate' => 12]);

        $this->assertEquals(300 - 60, $this->summary('2026-08-01', '2026-08-31')['margin']);
        $this->assertEquals(0, $this->summary('2026-09-01', '2026-09-30')['margin']);

        $this->put("/records/{$rev['id']}", ['record_date' => '2026-09-01']);
        $this->put("/records/{$cost['id']}", ['record_date' => '2026-09-02']);

        $aug = $this->summary('2026-08-01', '2026-08-31');
        $sep = $this->summary('2026-09-01', '2026-09-30');
        $this->assertEquals([0, 0], [$aug['revenue'], $aug['cost']]);
        $this->assertEquals([300, 60, 240], [$sep['revenue'], $sep['cost'], $sep['margin']]);
        $this->assertEquals(
            [['period' => '2026-09', 'revenue' => 300, 'cost' => 60]],
            array_map(static fn ($r) => array_intersect_key($r, ['period' => 0, 'revenue' => 0, 'cost' => 0]),
                $this->get('/analytics/trends?granularity=month')['json'])
        );
        $this->assertSame(['2026-09-02'], array_column($this->get('/vendor-payments?vendor=AdsTerra')['json']['rows'], 'entry_date'));
    }

    public function testRenamingABuyerOrCampaignCarriesItsRecordsIntoEveryReport(): void
    {
        $buyer = $this->create('/buyers', ['code' => 'RTG 04', 'name' => 'RTG 04', 'rate' => 30]);
        $camp  = $this->create('/campaigns', ['code' => 'C-03']);
        $other = $this->create('/campaigns', ['code' => 'C-07']);
        $this->buyerRecord($buyer['id'], '2026-08-03', 10);
        $this->campaignRecord($camp['id'], 'AdsTerra', '2026-08-03', 5, ['rate' => 12]);

        $this->assertStatus(200, $this->put("/buyers/{$buyer['id']}", ['code' => 'RTG 05', 'name' => 'RTG 05']));
        $r = $this->put("/campaigns/{$camp['id']}", ['code' => 'c 9', 'name' => null, 'notes' => null]);
        $this->assertStatus(200, $r);
        $this->assertSame('C-09', $r['json']['code']);

        $range = 'from=2026-08-01&to=2026-08-31';
        $this->assertSame(['RTG 05'], array_column($this->get("/analytics/top-buyers?{$range}")['json'], 'code'));
        $this->assertSame(['C-09'], array_column($this->get("/analytics/top-campaigns?{$range}")['json'], 'code'));
        $cr = $this->get("/analytics/complete-report?{$range}")['json'];
        $this->assertSame(['RTG 05'], array_column($cr['buyers'], 'code'));
        $this->assertSame(['C-09'], array_column($cr['campaigns'], 'camp'));
        $this->assertStringContainsString("\"RTG 05\",0,0,10,300.00", $this->get("/analytics/report?{$range}")['body']);
        $export = $this->get("/records/export?{$range}")['body'];
        $this->assertStringContainsString(',buyer,"RTG 05",', $export);
        $this->assertStringContainsString(',campaign,,C-09,', $export);
        $this->assertSame(1, $this->get("/records?{$range}&search=RTG%2005")['json']['meta']['total']);
        $this->assertSame(0, $this->get("/records?{$range}&search=RTG%2004")['json']['meta']['total']);

        // A code that standardises onto a taken one is refused and moves nothing.
        $this->assertStatus(409, $this->put("/campaigns/{$other['id']}", ['code' => 'C09']));
        $this->assertSame(['C-09'], array_column($this->get("/analytics/top-campaigns?{$range}")['json'], 'code'));

        // The old codes are free again: keying one in creates a fresh, unpriced entity.
        $fresh = $this->create('/records', ['record_type' => 'buyer', 'record_date' => '2026-08-04', 'buyer_code' => 'RTG 04', 'counted' => 2]);
        $this->assertNotSame($buyer['id'], $fresh['buyer_id']);
        $this->assertEquals(0, $fresh['total_bill']);
        $this->assertEquals(300, $this->summary('2026-08-01', '2026-08-31')['revenue']);
        $this->assertSame(2, $this->summary('2026-08-01', '2026-08-31')['active_buyers']);
    }

    public function testDeletingABuyerOrCampaignRemovesItsRecordsFromEveryReport(): void
    {
        $keep  = $this->create('/buyers', ['code' => 'KEEP', 'rate' => 10]);
        $drop  = $this->create('/buyers', ['code' => 'DROP', 'rate' => 20]);
        $c03   = $this->create('/campaigns', ['code' => 'C-03']);
        $c07   = $this->create('/campaigns', ['code' => 'C-07']);
        $this->create('/destinations', ['name' => 'Solo', 'rate' => 4, 'campaign_id' => $c03['id']]);
        $this->create('/destinations', ['name' => 'PropAds', 'rate' => 8, 'campaign_id' => $c07['id']]);
        $this->buyerRecord($keep['id'], '2026-08-03', 5);
        $this->buyerRecord($drop['id'], '2026-08-03', 5);
        $this->campaignRecord($c03['id'], 'Solo', '2026-08-03', 10);
        $this->campaignRecord($c07['id'], 'PropAds', '2026-08-03', 2);
        $this->assertStatus(201, $this->post('/vendor-payments', ['vendor' => 'Solo', 'entry_date' => '2026-08-03', 'amount_paid' => 30]));

        $range  = 'from=2026-08-01&to=2026-08-31';
        $before = $this->get("/analytics/summary?{$range}")['json'];
        $this->assertEquals([150, 56], [$before['revenue'], $before['cost']]);

        $this->assertSame(['deleted' => true], $this->delete("/buyers/{$drop['id']}")['json']);
        $this->assertSame(['deleted' => true], $this->delete("/campaigns/{$c03['id']}")['json']);

        $after = $this->get("/analytics/summary?{$range}")['json'];
        $this->assertEquals([50, 16, 34], [$after['revenue'], $after['cost'], $after['margin']]);
        $this->assertSame([1, 1], [$after['active_buyers'], $after['active_campaigns']]);
        $this->assertSame(2, $this->get("/records?{$range}")['json']['meta']['total']);
        $this->assertSame(['KEEP'], array_column($this->get("/analytics/top-buyers?{$range}")['json'], 'code'));
        $this->assertSame(['PropAds'], array_column($this->get("/analytics/top-sources?{$range}")['json'], 'source'));
        $cr = $this->get("/analytics/complete-report?{$range}")['json'];
        $this->assertEquals([50, 16, 34], [$cr['revenue'], $cr['cost'], $cr['profit']]);
        $this->assertSame(['PropAds'], array_column($this->get('/destinations')['json'], 'name'));

        // The vendor ledger is standalone: the money paid survives, the charges went with the records.
        $ledger = $this->get("/vendor-payments?vendor=Solo&{$range}")['json'];
        $this->assertEquals([['entry_date' => '2026-08-03', 'payments' => 0, 'amount_paid' => 30]],
            array_map(static fn ($r) => array_intersect_key($r, ['entry_date' => 0, 'payments' => 0, 'amount_paid' => 0]), $ledger['rows']));
    }

    /**
     * A source is one global catalogue row (its name is unique and a rate change re-prices
     * it in every campaign), but it is linked to the first campaign that used it. Deleting
     * that campaign deletes the source outright, so another campaign still running it loses
     * its rate and the next record keyed in without a rate bills at $0.
     */
    public function testDeletingACampaignKeepsTheRateOfASourceOtherCampaignsStillUse(): void
    {
        $c03 = $this->create('/campaigns', ['code' => 'C-03']);
        $c07 = $this->create('/campaigns', ['code' => 'C-07']);
        $this->create('/destinations', ['name' => 'AdsTerra', 'rate' => 12, 'campaign_id' => $c03['id']]);
        $this->campaignRecord($c03['id'], 'AdsTerra', '2026-08-03', 5);
        $shared = $this->campaignRecord($c07['id'], 'AdsTerra', '2026-08-03', 5);
        $this->assertEquals(12, $shared['rate']);

        $this->assertSame(['deleted' => true], $this->delete("/campaigns/{$c03['id']}")['json']);

        $next = $this->campaignRecord($c07['id'], 'AdsTerra', '2026-08-04', 5);
        $this->assertEquals(12, $next['rate'], 'C-07 still runs AdsTerra, so its rate must survive C-03 being deleted');
        $this->assertContains('AdsTerra', array_column($this->get('/destinations')['json'], 'name'));
    }
}
