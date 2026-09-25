<?php

declare(strict_types=1);

namespace Tests\Integration;

use Tests\ApiTestCase;

/**
 * A whole month of call flow keyed in through the API — catalogue set-up, record entry with
 * rate lookup and find-or-create, edits and a delete — then every read surface (records list,
 * CSV export, summary, trends, rankings, buyer report, complete report, buyer/campaign pages,
 * vendor tabs) checked against one hand-computed expectation.
 */
final class CallFlowMonthIntegrationTest extends ApiTestCase
{
    private const AUG = 'from=2026-08-01&to=2026-08-31';

    /** @var array<string,int> */
    private array $buyers = [];
    /** @var array<string,int> */
    private array $campaigns = [];
    /** @var array<string,int> record ids by label */
    private array $records = [];

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('call_records', 'buyers', 'campaigns', 'destinations', 'portal_expenses', 'vendors', 'vendor_payments');
    }

    /** Catalogue + records + edits, asserting each write as it goes. */
    private function keyInTheMonth(): void
    {
        foreach (['RTG 04' => 30, 'BLU 01' => 25] as $code => $rate) {
            $r = $this->post('/buyers', ['code' => $code, 'name' => $code, 'rate' => $rate]);
            $this->assertStatus(201, $r);
            $this->buyers[$code] = (int) $r['json']['id'];
        }
        foreach (['c03' => 'C-03', 'C 7' => 'C-07'] as $typed => $canonical) {
            $r = $this->post('/campaigns', ['code' => $typed]);
            $this->assertStatus(201, $r);
            $this->assertSame($canonical, $r['json']['code']);
            $this->campaigns[$canonical] = (int) $r['json']['id'];
        }
        $this->assertStatus(201, $this->post('/destinations', ['name' => 'AdsTerra', 'rate' => 12, 'campaign_id' => $this->campaigns['C-03']]));
        $this->assertStatus(201, $this->post('/destinations', ['name' => 'PropAds', 'rate' => 8, 'campaign_id' => $this->campaigns['C-07']]));

        // Buyer side. b2 is entered by code, b4 creates a brand-new buyer seeded with its rate.
        $this->records['b1'] = $this->record(['record_type' => 'buyer', 'record_date' => '2026-08-03', 'buyer_id' => $this->buyers['RTG 04'], 'answered' => 20, 'missed' => 5, 'counted' => 10], 30.0, 300);
        $this->records['b2'] = $this->record(['record_type' => 'buyer', 'record_date' => '2026-08-04', 'buyer_code' => 'RTG 04', 'answered' => 15, 'missed' => 3, 'counted' => 8], 30.0, 240);
        $this->records['b3'] = $this->record(['record_type' => 'buyer', 'record_date' => '2026-08-04', 'buyer_id' => $this->buyers['BLU 01'], 'answered' => 12, 'missed' => 4, 'counted' => 6, 'rate' => 99], 25.0, 150);
        $this->records['b4'] = $this->record(['record_type' => 'buyer', 'record_date' => '2026-08-08', 'buyer_code' => 'ZEN 09', 'answered' => 7, 'missed' => 1, 'counted' => 5, 'rate' => 20], 20.0, 100);
        $this->records['b5'] = $this->record(['record_type' => 'buyer', 'record_date' => '2026-08-10', 'buyer_id' => $this->buyers['BLU 01'], 'answered' => 5, 'missed' => 2, 'counted' => 4], 25.0, 100);
        $this->records['b6'] = $this->record(['record_type' => 'buyer', 'record_date' => '2026-07-31', 'buyer_id' => $this->buyers['RTG 04'], 'answered' => 4, 'missed' => 0, 'counted' => 3], 30.0, 90);

        // Cost side. c1 finds C-03 from a spaced variant, c3 seeds a new source, c4 creates C-11.
        $this->records['c1'] = $this->record(['record_type' => 'campaign', 'record_date' => '2026-08-03', 'campaign_code' => 'C 03', 'source' => 'AdsTerra', 'answered' => 18, 'missed' => 2, 'counted' => 9], 12.0, 108);
        $this->records['c2'] = $this->record(['record_type' => 'campaign', 'record_date' => '2026-08-04', 'campaign_id' => $this->campaigns['C-07'], 'source' => 'PropAds', 'answered' => 10, 'missed' => 1, 'counted' => 7], 8.0, 56);
        $this->records['c3'] = $this->record(['record_type' => 'campaign', 'record_date' => '2026-08-05', 'campaign_code' => 'c-3', 'source' => 'NewSrc', 'rate' => 5, 'answered' => 6, 'missed' => 0, 'counted' => 4], 5.0, 20);
        $this->records['c4'] = $this->record(['record_type' => 'campaign', 'record_date' => '2026-08-10', 'campaign_code' => 'C-11', 'source' => 'AdsTerra', 'answered' => 2, 'missed' => 0, 'counted' => 2], 12.0, 24);
        $this->records['c5'] = $this->record(['record_type' => 'campaign', 'record_date' => '2026-09-01', 'campaign_id' => $this->campaigns['C-07'], 'source' => 'PropAds', 'answered' => 5, 'missed' => 0, 'counted' => 5], 8.0, 40);

        // Find-or-create really did reuse / create the right catalogue rows.
        $this->assertCount(3, $this->get('/buyers')['json']);
        $codes = array_column($this->get('/campaigns')['json'], 'code');
        sort($codes);
        $this->assertSame(['C-03', 'C-07', 'C-11'], $codes);
        $this->campaigns['C-11'] = (int) self::db()->query("SELECT id FROM campaigns WHERE code = 'C-11'")->fetchColumn();
        $newSrc = $this->get('/destinations?search=NewSrc')['json'];
        $this->assertCount(1, $newSrc);
        $this->assertEquals(5, $newSrc[0]['rate']);
        $this->assertSame($this->campaigns['C-03'], $newSrc[0]['campaign_id']);

        // Edits and a delete.
        $r = $this->put("/records/{$this->records['b2']}", ['counted' => 9, 'answered' => 16]);
        $this->assertStatus(200, $r);
        $this->assertEquals(270, $r['json']['total_bill']);
        $r = $this->put("/records/{$this->records['c4']}", ['counted' => 3]);
        $this->assertStatus(200, $r);
        $this->assertEquals(36, $r['json']['total_bill']);
        $this->assertSame(['deleted' => true], $this->delete("/records/{$this->records['b5']}")['json']);
        $this->assertSame(['deleted' => false], $this->delete("/records/{$this->records['b5']}")['json']);
    }

    private function record(array $body, float $rate, float $bill): int
    {
        $r = $this->post('/records', $body);
        $this->assertStatus(201, $r);
        $this->assertEquals($rate, $r['json']['rate'], 'rate for ' . json_encode($body));
        $this->assertEquals($bill, $r['json']['total_bill']);
        return (int) $r['json']['id'];
    }

    /** @return array<int, array<string,string>> CSV body as associative rows */
    private static function csv(string $body): array
    {
        $lines  = array_values(array_filter(preg_split('/\r?\n/', trim($body)), static fn ($l) => $l !== ''));
        $header = str_getcsv(array_shift($lines), ',', '"', '');
        return array_map(static fn ($l) => array_combine($header, str_getcsv($l, ',', '"', '')), $lines);
    }

    public function testRecordsListFiltersAndExportAgreeWithTheHandComputedMonth(): void
    {
        $this->keyInTheMonth();

        $list = $this->get('/records?' . self::AUG . '&per_page=100');
        $this->assertStatus(200, $list);
        $this->assertSame(8, $list['json']['meta']['total']);
        $this->assertEquals(820 + 220, array_sum(array_column($list['json']['data'], 'total_bill')));
        $this->assertNotContains($this->records['b5'], array_column($list['json']['data'], 'id'));

        $buyerRows = $this->get('/records?' . self::AUG . '&type=buyer&per_page=100')['json'];
        $this->assertSame(4, $buyerRows['meta']['total']);
        $this->assertEquals(820, array_sum(array_column($buyerRows['data'], 'total_bill')));
        $this->assertEquals(30, array_sum(array_column($buyerRows['data'], 'counted')));

        $rtg = $this->get('/records?' . self::AUG . '&buyer_id=' . $this->buyers['RTG 04'])['json'];
        $this->assertSame([$this->records['b1'], $this->records['b2']], array_column($rtg['data'], 'id'));

        $c03 = $this->get('/records?' . self::AUG . '&campaign_id=' . $this->campaigns['C-03'])['json'];
        $this->assertEqualsCanonicalizing([$this->records['c1'], $this->records['c3']], array_column($c03['data'], 'id'));

        $adsterra = $this->get('/records?' . self::AUG . '&search=adster')['json'];
        $this->assertEqualsCanonicalizing([$this->records['c1'], $this->records['c4']], array_column($adsterra['data'], 'id'));
        $this->assertEquals(144, array_sum(array_column($adsterra['data'], 'total_bill')));

        // Paging walks the same set.
        $seen = [];
        for ($page = 1; $page <= 3; $page++) {
            $p = $this->get('/records?' . self::AUG . "&per_page=3&page={$page}&sort=record_date&dir=asc")['json'];
            $this->assertSame(3, $p['meta']['pages']);
            $seen = [...$seen, ...array_column($p['data'], 'id')];
        }
        $this->assertEqualsCanonicalizing(array_column($list['json']['data'], 'id'), $seen);

        $export = $this->get('/records/export?' . self::AUG);
        $this->assertStatus(200, $export);
        $rows = self::csv($export['body']);
        $this->assertCount(8, $rows);
        $byType = ['buyer' => 0.0, 'campaign' => 0.0];
        foreach ($rows as $row) {
            $byType[$row['Type']] += (float) $row['Total Bill'];
        }
        $this->assertEquals(['buyer' => 820.0, 'campaign' => 220.0], $byType);
        $this->assertSame('270.00', array_values(array_filter($rows, static fn ($r) => $r['Date'] === '2026-08-04' && $r['Buyer'] === 'RTG 04'))[0]['Total Bill']);

        $exportFiltered = self::csv($this->get('/records/export?' . self::AUG . '&type=campaign&campaign_id=' . $this->campaigns['C-11'])['body']);
        $this->assertSame([['Date' => '2026-08-10', 'Type' => 'campaign', 'Buyer' => '', 'Campaign' => 'C-11', 'Answered' => '2',
            'Missed' => '0', 'Replacement' => '0', 'Counted' => '3', 'Rate' => '12.00', 'Total Bill' => '36.00']], $exportFiltered);
    }

    public function testDashboardEndpointsAllReportTheSameMonth(): void
    {
        $this->keyInTheMonth();

        $s = $this->get('/analytics/summary?' . self::AUG);
        $this->assertStatus(200, $s);
        $s = $s['json'];
        $this->assertEquals(820, $s['revenue']);
        $this->assertEquals(220, $s['cost']);
        $this->assertEquals(0, $s['portal_expenses']);
        $this->assertEquals(600, $s['margin']);
        $this->assertEquals(73.2, $s['margin_pct']);
        $this->assertSame(30, $s['counted']);
        $this->assertSame(55, $s['answered']);
        $this->assertSame(13, $s['missed']);
        $this->assertEquals(80.9, $s['answer_rate']);
        $this->assertSame(4, $s['buyer_records']);
        $this->assertSame(4, $s['campaign_records']);
        $this->assertSame(3, $s['active_buyers']);
        $this->assertSame(3, $s['active_campaigns']);
        // July held only b6 (90 revenue, no cost).
        $this->assertEquals(round((820 - 90) / 90 * 100, 1), $s['deltas']['revenue']);
        $this->assertNull($s['deltas']['cost']);

        foreach (['day', 'week', '4day', 'month', 'year'] as $g) {
            $t = $this->get('/analytics/trends?' . self::AUG . "&granularity={$g}")['json'];
            $this->assertEquals(820, array_sum(array_column($t, 'revenue')), "revenue by {$g}");
            $this->assertEquals(220, array_sum(array_column($t, 'cost')), "cost by {$g}");
            $this->assertEquals(600, array_sum(array_column($t, 'margin')), "margin by {$g}");
            $this->assertEquals(30, array_sum(array_column($t, 'counted')), "counted by {$g}");
            $this->assertEquals(55, array_sum(array_column($t, 'answered')), "answered by {$g}");
        }
        $days = $this->get('/analytics/trends?' . self::AUG)['json'];
        $this->assertSame(['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-08', '2026-08-10'], array_column($days, 'period'));
        $this->assertEquals(270 + 150 - 56, $days[1]['margin']);

        $top = $this->get('/analytics/top-buyers?' . self::AUG)['json'];
        $this->assertSame(['RTG 04', 'BLU 01', 'ZEN 09'], array_column($top, 'code'));
        $this->assertEquals([570, 150, 100], array_column($top, 'revenue'));
        $this->assertEquals(820, array_sum(array_column($top, 'revenue')));
        $this->assertEquals([19, 6, 5], array_column($top, 'counted'));
        $byAnswered = $this->get('/analytics/top-buyers?' . self::AUG . '&metric=answered&limit=1')['json'];
        $this->assertSame(['RTG 04'], array_column($byAnswered, 'code'));
        $this->assertEquals(36, $byAnswered[0]['answered']);

        $camps = $this->get('/analytics/top-campaigns?' . self::AUG)['json'];
        $this->assertSame(['C-03', 'C-07', 'C-11'], array_column($camps, 'code'));
        $this->assertEquals([128, 56, 36], array_column($camps, 'cost'));
        $this->assertEquals(220, array_sum(array_column($camps, 'cost')));

        $sources = $this->get('/analytics/top-sources?' . self::AUG)['json'];
        $this->assertSame(['AdsTerra', 'PropAds', 'NewSrc'], array_column($sources, 'source'));
        $this->assertEquals([144, 56, 20], array_column($sources, 'cost'));
        $this->assertEquals([12, 7, 4], array_column($sources, 'counted'));

        $report = self::csv($this->get('/analytics/report?' . self::AUG)['body']);
        $this->assertSame([
            ['Buyer' => 'RTG 04', 'Answered' => '36', 'Missed' => '8', 'Counted' => '19', 'Revenue' => '570.00'],
            ['Buyer' => 'BLU 01', 'Answered' => '12', 'Missed' => '4', 'Counted' => '6', 'Revenue' => '150.00'],
            ['Buyer' => 'ZEN 09', 'Answered' => '7', 'Missed' => '1', 'Counted' => '5', 'Revenue' => '100.00'],
        ], $report);

        $cr = $this->get('/analytics/complete-report?' . self::AUG)['json'];
        $this->assertSame('2026-08-03', $cr['from']);
        $this->assertSame('2026-08-10', $cr['to']);
        $this->assertEquals(820, $cr['revenue']);
        $this->assertEquals(220, $cr['cost']);
        $this->assertEquals(600, $cr['profit']);
        $this->assertEquals($s['margin'], $cr['profit']);
        $this->assertSame(3, $cr['buyer_totals']['destinations']);
        $this->assertEquals(30, $cr['buyer_totals']['counted']);
        $this->assertEquals(820, $cr['buyer_totals']['total_bill']);
        $this->assertEquals(55, $cr['buyer_totals']['answered']);
        $this->assertCount(4, $cr['campaigns']);
        $this->assertSame(3, $cr['campaign_totals']['camps']);
        $this->assertSame(3, $cr['campaign_totals']['destinations']);
        $this->assertEquals(23, $cr['campaign_totals']['counted']);
        $this->assertEquals(220, $cr['campaign_totals']['total_bill']);
        // Replacement is auto-filled per record as max(0, answered − counted): 9 + 3 + 2 + 0.
        $this->assertEquals(14, $cr['campaign_totals']['replacement']);
        // The cost rows re-add to top-campaigns' per-campaign totals.
        $perCamp = [];
        foreach ($cr['campaigns'] as $row) {
            $perCamp[$row['camp']] = ($perCamp[$row['camp']] ?? 0) + $row['total_bill'];
        }
        $this->assertEquals(array_combine(array_column($camps, 'code'), array_column($camps, 'cost')), $perCamp);
    }

    public function testBuyerCampaignAndVendorPagesReflectTheSameEntries(): void
    {
        $this->keyInTheMonth();

        // The Buyers page skips weekends by design: ZEN 09's only record is on a Saturday.
        $buyers = $this->get('/buyers?' . self::AUG)['json'];
        $byCode = array_column($buyers, null, 'code');
        $this->assertEquals(19, $byCode['RTG 04']['counted']);
        $this->assertEquals(570, $byCode['RTG 04']['revenue']);
        $this->assertEquals(2, $byCode['RTG 04']['record_days']);
        $this->assertEquals(6, $byCode['BLU 01']['counted']);
        $this->assertEquals(0, $byCode['ZEN 09']['counted']);
        $this->assertEquals(20, $byCode['ZEN 09']['rate']);
        $analytics = $this->get('/analytics/summary?' . self::AUG)['json'];
        $this->assertEquals($analytics['counted'] - 5, array_sum(array_column($buyers, 'counted')));

        // A campaign's source panel counts only that campaign's use of the source.
        $sources = $this->get("/campaigns/{$this->campaigns['C-03']}/sources")['json'];
        $this->assertEquals([
            ['destination_id' => $sources[0]['destination_id'], 'name' => 'AdsTerra', 'rate' => 12, 'counted' => 9, 'cost' => 108],
            ['destination_id' => $sources[1]['destination_id'], 'name' => 'NewSrc', 'rate' => 5, 'counted' => 4, 'cost' => 20],
        ], $sources);

        $campaigns = array_column($this->get('/campaigns?' . self::AUG)['json'], null, 'code');
        $this->assertEquals(2, $campaigns['C-03']['records']);
        $this->assertEquals(2, $campaigns['C-03']['sources']);
        $this->assertSame('2026-08-10', $campaigns['C-11']['last_activity']);

        // Every source used on the cost side becomes a vendor tab, and each tab's ledger
        // charges exactly what top-sources reports for it.
        $tabs = $this->get('/vendors')['json'];
        $this->assertSame(['AdsTerra', 'NewSrc', 'PropAds'], array_column($tabs, 'name'));
        $top = array_column($this->get('/analytics/top-sources?' . self::AUG)['json'], 'cost', 'source');
        foreach ($tabs as $tab) {
            $ledger = $this->get('/vendor-payments?vendor=' . rawurlencode($tab['name']) . '&' . self::AUG)['json'];
            $this->assertEquals($top[$tab['name']], array_sum(array_column($ledger['rows'], 'payments')), $tab['name']);
        }
    }
}
