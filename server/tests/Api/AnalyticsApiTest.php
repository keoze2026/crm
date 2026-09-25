<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

/**
 * Fixed dataset (buyers RTG 04 @10, ACME @7.5; campaigns C-03, C-05):
 *
 *   current week 2026-05-04..08
 *     buyer RTG 04 05-04  ans 30 mis 10 rep 2 cnt 20 @10   = 200
 *     buyer RTG 04 05-05  ans 20 mis  5       cnt 15 @10   = 150
 *     buyer ACME   05-06  ans 60 mis 10       cnt 30 @7.5  = 225
 *     camp  C-03 DXTST 05-04 ans 35 mis 5 rep 1 cnt 20 @4  =  80
 *     camp  C-03 PDSO  05-05 ans 20       rep 3 cnt 10 @5  =  50
 *     camp  C-05 DXTST 05-06 ans 25             cnt 25 @2  =  50
 *   previous period 2026-04-29..05-03
 *     buyer RTG 04 04-30  ans 10 mis 10       cnt 10 @10   = 100
 *     camp  C-03 DXTST 04-30 ans 12            cnt 10 @4   =  40
 *   portal expenses: April 20, May 60 + 35
 */
final class AnalyticsApiTest extends ApiTestCase
{
    use SeedsCallData;

    private const WEEK = 'from=2026-05-04&to=2026-05-08';

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('call_records', 'buyers', 'campaigns', 'destinations', 'portal_expenses');
    }

    private function seedDataset(): void
    {
        $rtg  = self::seedBuyer('RTG 04', 10.0);
        $acme = self::seedBuyer('ACME', 7.5);
        $c3   = self::seedCampaign('C-03');
        $c5   = self::seedCampaign('C-05');

        self::seedBuyerRecord($rtg, '2026-05-04', 20, 10.0, 30, 10, 2);
        self::seedBuyerRecord($rtg, '2026-05-05', 15, 10.0, 20, 5);
        self::seedBuyerRecord($acme, '2026-05-06', 30, 7.5, 60, 10);
        self::seedCampaignRecord($c3, 'DXTST', '2026-05-04', 20, 4.0, 35, 5, 1);
        self::seedCampaignRecord($c3, 'PDSO', '2026-05-05', 10, 5.0, 20, 0, 3);
        self::seedCampaignRecord($c5, 'DXTST', '2026-05-06', 25, 2.0, 25);

        self::seedBuyerRecord($rtg, '2026-04-30', 10, 10.0, 10, 10);
        self::seedCampaignRecord($c3, 'DXTST', '2026-04-30', 10, 4.0, 12);

        self::insert('portal_expenses', ['month' => '2026-04-01', 'name' => 'Apr', 'total_amount' => '20']);
        self::insert('portal_expenses', ['month' => '2026-05-01', 'name' => 'May A', 'total_amount' => '60']);
        self::insert('portal_expenses', ['month' => '2026-05-01', 'name' => 'May B', 'total_amount' => '35']);
    }

    // ── summary ──────────────────────────────────────────────────────────────

    public function testSummaryComputesKpisAndDeltasAgainstThePrecedingPeriod(): void
    {
        $this->seedDataset();
        $r = $this->get('/analytics/summary?' . self::WEEK);
        $this->assertStatus(200, $r);
        $s = $r['json'];

        $this->assertEquals(575, $s['revenue']);
        $this->assertEquals(180, $s['cost']);
        $this->assertEquals(0, $s['portal_expenses']);
        $this->assertEquals(395, $s['margin']);
        $this->assertEquals(68.7, $s['margin_pct']);
        $this->assertSame(110, $s['answered']);
        $this->assertSame(25, $s['missed']);
        $this->assertSame(65, $s['counted']);
        $this->assertEquals(81.5, $s['answer_rate']);
        $this->assertSame(3, $s['buyer_records']);
        $this->assertSame(3, $s['campaign_records']);
        $this->assertSame(2, $s['active_buyers']);
        $this->assertSame(2, $s['active_campaigns']);

        // Previous period 2026-04-29..05-03: revenue 100, cost 40, margin 60 (60 %),
        // answered 10, missed 10 (50 %), counted 10, 1 buyer, 1 campaign.
        $this->assertEquals([
            'revenue'          => 475.0,
            'cost'             => 350.0,
            'margin'           => 558.3,
            'counted'          => 550.0,
            'answered'         => 1000.0,
            'active_buyers'    => 100.0,
            'active_campaigns' => 100.0,
        ], $s['deltas']);
        $this->assertEquals(['margin_pct' => 8.7, 'answer_rate' => 31.5], $s['point_deltas']);
    }

    public function testSummaryWithoutAFullRangeHasNoDeltas(): void
    {
        $this->seedDataset();
        $s = $this->get('/analytics/summary?from=2026-05-01')['json'];

        $this->assertEquals(575, $s['revenue']);
        // No `to`: every month starting on/after May 1 is charged.
        $this->assertEquals(95, $s['portal_expenses']);
        $this->assertEquals(300, $s['margin']);
        $this->assertNull($s['deltas']['revenue']);
        $this->assertNull($s['point_deltas']['margin_pct']);
        $this->assertCount(7, $s['deltas']);
    }

    public function testSummaryAllTimeChargesEveryPortalExpense(): void
    {
        $this->seedDataset();
        $s = $this->get('/analytics/summary')['json'];
        $this->assertEquals(675, $s['revenue']);
        $this->assertEquals(220, $s['cost']);
        $this->assertEquals(115, $s['portal_expenses']);
        $this->assertEquals(340, $s['margin']);
        $this->assertEquals(50.4, $s['margin_pct']);
        $this->assertSame(4, $s['buyer_records']);
    }

    public function testSummaryChargesOnlyFullyCoveredMonths(): void
    {
        $this->seedDataset();

        $full = $this->get('/analytics/summary?from=2026-05-01&to=2026-05-31')['json'];
        $this->assertEquals(95, $full['portal_expenses']);
        $this->assertEquals(300, $full['margin']);
        $this->assertEquals(52.2, $full['margin_pct']);

        $partial = $this->get('/analytics/summary?from=2026-05-02&to=2026-05-31')['json'];
        $this->assertEquals(0, $partial['portal_expenses']);
        $this->assertEquals(395, $partial['margin']);

        $both = $this->get('/analytics/summary?from=2026-04-01&to=2026-05-31')['json'];
        $this->assertEquals(115, $both['portal_expenses']);
        $this->assertEquals(675 - 220 - 115, $both['margin']);
    }

    public function testSummaryPercentagesAreZeroWithoutData(): void
    {
        $s = $this->get('/analytics/summary?from=2026-01-01&to=2026-01-31')['json'];
        $this->assertEquals(0, $s['revenue']);
        $this->assertEquals(0, $s['margin_pct']);
        $this->assertEquals(0, $s['answer_rate']);
        // 0 → 0 is "no change", not "new".
        $this->assertEquals(0, $s['deltas']['revenue']);
    }

    public function testSummaryDeltaIsNullWhenPreviousPeriodHadNothing(): void
    {
        $this->seedDataset();
        $s = $this->get('/analytics/summary?from=2026-04-30&to=2026-04-30')['json'];
        $this->assertEquals(100, $s['revenue']);
        $this->assertNull($s['deltas']['revenue']);
        $this->assertEquals(60.0, $s['point_deltas']['margin_pct']);
    }

    // ── trends ───────────────────────────────────────────────────────────────

    public function testTrendsByMonthCarryEachMonthsPortalExpenses(): void
    {
        $this->seedDataset();
        $r = $this->get('/analytics/trends?granularity=month');
        $this->assertStatus(200, $r);
        $this->assertEquals([
            ['period' => '2026-04', 'revenue' => 100, 'cost' => 40, 'portal_expenses' => 20, 'margin' => 40,
             'counted' => 10, 'answered' => 10, 'missed' => 10],
            ['period' => '2026-05', 'revenue' => 575, 'cost' => 180, 'portal_expenses' => 95, 'margin' => 300,
             'counted' => 65, 'answered' => 110, 'missed' => 25],
        ], $r['json']);
    }

    public function testTrendsByYearSumTheYearsPortalExpenses(): void
    {
        $this->seedDataset();
        self::insert('portal_expenses', ['month' => '2025-12-01', 'name' => 'Old', 'total_amount' => '1000']);
        $this->assertEquals([
            ['period' => '2026', 'revenue' => 675, 'cost' => 220, 'portal_expenses' => 115, 'margin' => 340,
             'counted' => 75, 'answered' => 120, 'missed' => 35],
        ], $this->get('/analytics/trends?granularity=year')['json']);
    }

    public function testTrendsByDayAreRangeScopedAndCarryNoPortalExpenses(): void
    {
        $this->seedDataset();
        $rows = $this->get('/analytics/trends?' . self::WEEK)['json'];
        $this->assertSame(['2026-05-04', '2026-05-05', '2026-05-06'], array_column($rows, 'period'));
        $this->assertEquals(['period' => '2026-05-04', 'revenue' => 200, 'cost' => 80, 'portal_expenses' => 0,
            'margin' => 120, 'counted' => 20, 'answered' => 30, 'missed' => 10], $rows[0]);
        $this->assertEquals(225 - 50, $rows[2]['margin']);
        $this->assertSame([0, 0, 0], array_map('intval', array_column($rows, 'portal_expenses')));
    }

    public function testTrendsByWeekBucketOnMonday(): void
    {
        $this->seedDataset();
        $rows = $this->get('/analytics/trends?granularity=week')['json'];
        $this->assertSame(['2026-04-27', '2026-05-04'], array_column($rows, 'period'));
        $this->assertEquals(100, $rows[0]['revenue']);
        $this->assertEquals(575, $rows[1]['revenue']);
        $this->assertEquals(0, $rows[1]['portal_expenses']);
    }

    public function testTrendsByFourDayWindowsAnchoredAt2000(): void
    {
        $this->seedDataset();
        $bucket = static function (string $d): string {
            $anchor = new \DateTimeImmutable('2000-01-01');
            $days   = $anchor->diff(new \DateTimeImmutable($d))->days;
            return $anchor->modify('+' . (intdiv($days, 4) * 4) . ' days')->format('Y-m-d');
        };
        $expected = [];
        foreach (['2026-04-30' => 100, '2026-05-04' => 200, '2026-05-05' => 150, '2026-05-06' => 225] as $d => $rev) {
            $expected[$bucket($d)] = ($expected[$bucket($d)] ?? 0) + $rev;
        }
        ksort($expected);

        $rows = $this->get('/analytics/trends?granularity=4day')['json'];
        $this->assertSame(array_keys($expected), array_column($rows, 'period'));
        $this->assertEquals(array_values($expected), array_column($rows, 'revenue'));
    }

    public function testTrendsUnknownGranularityFallsBackToDay(): void
    {
        $this->seedDataset();
        $rows = $this->get('/analytics/trends?granularity=fortnight')['json'];
        $this->assertSame(['2026-04-30', '2026-05-04', '2026-05-05', '2026-05-06'], array_column($rows, 'period'));
    }

    // ── top-* ────────────────────────────────────────────────────────────────

    public function testTopBuyersRankByRequestedMetric(): void
    {
        $this->seedDataset();

        $rev = $this->get('/analytics/top-buyers?' . self::WEEK)['json'];
        $this->assertSame(['RTG 04', 'ACME'], array_column($rev, 'code'));
        $this->assertEquals(350, $rev[0]['revenue']);
        $this->assertEquals(35, $rev[0]['counted']);
        $this->assertEquals(50, $rev[0]['answered']);
        $this->assertEquals(15, $rev[0]['missed']);
        $this->assertEquals(225, $rev[1]['revenue']);

        $ans = $this->get('/analytics/top-buyers?metric=answered&' . self::WEEK)['json'];
        $this->assertSame(['ACME', 'RTG 04'], array_column($ans, 'code'));

        $all = $this->get('/analytics/top-buyers?metric=counted')['json'];
        $this->assertSame(['RTG 04', 'ACME'], array_column($all, 'code'));
        $this->assertEquals(45, $all[0]['counted']);
        $this->assertEquals(450, $all[0]['revenue']);

        $fallback = $this->get('/analytics/top-buyers?metric=evil;&' . self::WEEK)['json'];
        $this->assertSame(['RTG 04', 'ACME'], array_column($fallback, 'code'));
    }

    public function testTopBuyersLimitIsClamped(): void
    {
        $this->seedDataset();
        $this->assertCount(1, $this->get('/analytics/top-buyers?limit=1')['json']);
        $this->assertCount(1, $this->get('/analytics/top-buyers?limit=0')['json']);
        $this->assertCount(2, $this->get('/analytics/top-buyers?limit=500')['json']);
    }

    public function testTopCampaignsRankByCost(): void
    {
        $this->seedDataset();
        $rows = $this->get('/analytics/top-campaigns?' . self::WEEK)['json'];
        $this->assertSame(['C-03', 'C-05'], array_column($rows, 'code'));
        $this->assertEquals(['cost' => 130, 'counted' => 30, 'answered' => 55, 'missed' => 5],
            array_intersect_key($rows[0], array_flip(['cost', 'counted', 'answered', 'missed'])));
        $this->assertEquals(50, $rows[1]['cost']);

        $all = $this->get('/analytics/top-campaigns?limit=1')['json'];
        $this->assertCount(1, $all);
        $this->assertEquals(170, $all[0]['cost']);
    }

    public function testTopSourcesAggregateAcrossCampaigns(): void
    {
        $this->seedDataset();
        self::seedCampaignRecord(self::seedCampaign('C-09'), null, '2026-05-07', 1, 3.0);

        $rows = $this->get('/analytics/top-sources?' . self::WEEK)['json'];
        $this->assertSame(['DXTST', 'PDSO', '(none)'], array_column($rows, 'source'));
        $this->assertEquals(130, $rows[0]['cost']);
        $this->assertEquals(45, $rows[0]['counted']);
        $this->assertEquals(50, $rows[1]['cost']);
        $this->assertEquals(3, $rows[2]['cost']);
    }

    // ── CSV report ───────────────────────────────────────────────────────────

    public function testReportStreamsBuyerPerformanceCsv(): void
    {
        $this->seedDataset();
        $r = $this->get('/analytics/report?' . self::WEEK);
        $this->assertStatus(200, $r);
        $this->assertStringContainsString('filename="buyer-performance.csv"', implode("\n", $r['headers']));
        $this->assertSame([
            'Buyer,Answered,Missed,Counted,Revenue',
            '"RTG 04",50,15,35,350.00',
            'ACME,60,10,30,225.00',
        ], array_values(array_filter(preg_split('/\R/', $r['body']))));
    }

    // ── complete report ──────────────────────────────────────────────────────

    public function testCompleteReportBuildsBothSidesWithTotalsAndProfit(): void
    {
        $this->seedDataset();
        $r = $this->get('/analytics/complete-report?' . self::WEEK);
        $this->assertStatus(200, $r);
        $j = $r['json'];

        $this->assertSame('2026-05-04', $j['from']);
        $this->assertSame('2026-05-06', $j['to']);

        $this->assertEquals([
            ['code' => 'RTG 04', 'answered' => 50, 'missed' => 15, 'replacement' => 2, 'counted' => 35, 'total_bill' => 350, 'rate' => 10],
            ['code' => 'ACME', 'answered' => 60, 'missed' => 10, 'replacement' => 0, 'counted' => 30, 'total_bill' => 225, 'rate' => 7.5],
        ], $j['buyers']);

        // Replacement auto-fills as max(0, answered − counted) except for PDSO (hand-entered).
        $this->assertEquals([
            ['camp' => 'C-03', 'destination' => 'PDSO', 'answered' => 20, 'missed' => 0, 'replacement' => 3, 'counted' => 10, 'total_bill' => 50, 'rate' => 5],
            ['camp' => 'C-03', 'destination' => 'DXTST', 'answered' => 35, 'missed' => 5, 'replacement' => 15, 'counted' => 20, 'total_bill' => 80, 'rate' => 4],
            ['camp' => 'C-05', 'destination' => 'DXTST', 'answered' => 25, 'missed' => 0, 'replacement' => 0, 'counted' => 25, 'total_bill' => 50, 'rate' => 2],
        ], $j['campaigns']);

        $bt = $j['buyer_totals'];
        $this->assertSame(2, $bt['destinations']);
        $this->assertEquals(110, $bt['answered']);
        $this->assertEquals(25, $bt['missed']);
        $this->assertEquals(2, $bt['replacement']);
        $this->assertEquals(65, $bt['counted']);
        $this->assertEquals(575, $bt['total_bill']);
        $this->assertEqualsWithDelta(575 / 65, $bt['rate'], 1e-9);

        $ct = $j['campaign_totals'];
        $this->assertSame(2, $ct['camps']);
        $this->assertSame(2, $ct['destinations']);
        $this->assertEquals(80, $ct['answered']);
        $this->assertEquals(5, $ct['missed']);
        $this->assertEquals(18, $ct['replacement']);
        $this->assertEquals(55, $ct['counted']);
        $this->assertEquals(180, $ct['total_bill']);
        $this->assertEqualsWithDelta(180 / 55, $ct['rate'], 1e-9);

        $this->assertEquals(575, $j['revenue']);
        $this->assertEquals(180, $j['cost']);
        $this->assertEquals(0, $j['portal_expenses']);
        $this->assertEquals(395, $j['profit']);
    }

    public function testCompleteReportChargesFullMonthPortalExpenses(): void
    {
        $this->seedDataset();
        $j = $this->get('/analytics/complete-report?from=2026-05-01&to=2026-05-31')['json'];
        $this->assertEquals(95, $j['portal_expenses']);
        $this->assertEquals(575 - 180 - 95, $j['profit']);
    }

    public function testCompleteReportBundlesCodeAndSourceVariantsAndDropsZeroCountedRows(): void
    {
        $a = self::seedCampaign('C-03');
        $b = self::seedCampaign('C 03');
        $z = self::seedCampaign('C-07');
        $buyer = self::seedBuyer('IDLE', 5.0);
        self::seedCampaignRecord($a, 'DXTST', '2026-05-04', 10, 2.0, 12);
        self::seedCampaignRecord($a, 'DXTST', '2026-05-05', 10, 2.0, 10);
        self::seedCampaignRecord($b, 'dx-tst', '2026-05-06', 5, 2.0, 9);
        self::seedCampaignRecord($z, 'ZERO', '2026-05-06', 0, 9.0, 40);
        self::seedBuyerRecord($buyer, '2026-05-06', 0, 5.0, 7, 1);

        $j = $this->get('/analytics/complete-report')['json'];
        $this->assertSame([], $j['buyers']);
        $this->assertSame(0, $j['buyer_totals']['destinations']);
        $this->assertEquals(0, $j['buyer_totals']['rate']);

        $this->assertCount(1, $j['campaigns']);
        $row = $j['campaigns'][0];
        $this->assertSame('C-03', $row['camp']);
        $this->assertSame('DXTST', $row['destination']);
        $this->assertEquals(31, $row['answered']);
        $this->assertEquals(25, $row['counted']);
        $this->assertEquals(50, $row['total_bill']);
        $this->assertEquals(6, $row['replacement']); // (12-10) + (10-10) + (9-5)
        $this->assertSame(1, $j['campaign_totals']['camps']);
        $this->assertSame(1, $j['campaign_totals']['destinations']);

        $this->assertSame('2026-05-04', $j['from']);
        $this->assertSame('2026-05-06', $j['to']);
        $this->assertEquals(-50, $j['profit']);
    }

    public function testCompleteReportForEmptyRangeIsAllZero(): void
    {
        $j = $this->get('/analytics/complete-report?from=2030-01-01&to=2030-01-02')['json'];
        $this->assertNull($j['from']);
        $this->assertNull($j['to']);
        $this->assertSame([], $j['buyers']);
        $this->assertSame([], $j['campaigns']);
        $this->assertEquals(0, $j['profit']);
        $this->assertSame(0, $j['campaign_totals']['camps']);
    }
}
