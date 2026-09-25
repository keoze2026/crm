<?php

declare(strict_types=1);

namespace Tests\Integration;

use Tests\ApiTestCase;

/**
 * Portal expenses keyed in on their own page feeding the profit figures of the dashboard,
 * the trend chart and the complete report — the full-month rule across month boundaries,
 * and edits / deletes propagating to every one of them.
 */
final class FinancePortalExpenseIntegrationTest extends ApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('call_records', 'buyers', 'campaigns', 'destinations', 'portal_expenses');
    }

    /** Aug: revenue 300 / cost 60. Sep: revenue 200 / cost 40. */
    private function keyInTwoMonths(): void
    {
        $buyer = $this->post('/buyers', ['code' => 'RTG 04', 'rate' => 10])['json']['id'];
        $camp  = $this->post('/campaigns', ['code' => 'C-03'])['json']['id'];
        foreach ([['2026-08-03', 10], ['2026-08-31', 20], ['2026-09-01', 5], ['2026-09-15', 15]] as [$date, $counted]) {
            $this->assertStatus(201, $this->post('/records', ['record_type' => 'buyer', 'record_date' => $date, 'buyer_id' => $buyer, 'counted' => $counted]));
            $this->assertStatus(201, $this->post('/records', ['record_type' => 'campaign', 'record_date' => $date, 'campaign_id' => $camp, 'source' => 'AdsTerra', 'rate' => 2, 'counted' => $counted]));
        }
    }

    private function expense(string $month, string $name, float $total): int
    {
        $r = $this->post('/portal-expenses', ['month' => $month, 'name' => $name, 'voice_minutes' => $total / 2, 'total_amount' => $total]);
        $this->assertStatus(201, $r);
        return $r['json']['id'];
    }

    /** @return array{0: float, 1: float, 2: float} [summary portal, summary margin, complete-report profit] */
    private function profitFor(string $query): array
    {
        $s  = $this->get("/analytics/summary?{$query}")['json'];
        $cr = $this->get("/analytics/complete-report?{$query}")['json'];
        $this->assertEquals($s['portal_expenses'], $cr['portal_expenses'], "portal expenses for {$query}");
        $this->assertEquals($s['margin'], $cr['profit'], "profit for {$query}");
        return [(float) $s['portal_expenses'], (float) $s['margin'], (float) $cr['profit']];
    }

    /** @return array<string, array{portal: float, margin: float}> */
    private function monthlyTrend(string $query = ''): array
    {
        $out = [];
        foreach ($this->get('/analytics/trends?granularity=month' . ($query !== '' ? "&{$query}" : ''))['json'] as $row) {
            $out[$row['period']] = ['portal' => (float) $row['portal_expenses'], 'margin' => (float) $row['margin']];
        }
        return $out;
    }

    public function testExpensesChargeOnlyTheMonthsARangeFullyCoversAndFollowEditsAndDeletes(): void
    {
        $this->keyInTwoMonths();
        $this->expense('2026-08', 'Twilio', 100);
        $byoc = $this->expense('2026-08-17', 'BYOC', 50);
        $sep  = $this->expense('2026-09-01', 'Twilio', 70);

        $aug = $this->get('/portal-expenses?month=2026-08')['json'];
        $this->assertSame(['2026-08-01', '2026-08-01'], array_column($aug, 'month'));
        $this->assertSame([0, 1], array_column($aug, 'sort_order'));

        $this->assertEquals([150, 300 - 60 - 150, 90], $this->profitFor('from=2026-08-01&to=2026-08-31'));
        $this->assertEquals([0, 240, 240], $this->profitFor('from=2026-08-02&to=2026-08-31'));
        $this->assertEquals([0, 80, 80], $this->profitFor('from=2026-08-01&to=2026-08-30'));
        $this->assertEquals([220, 500 - 100 - 220, 180], $this->profitFor('from=2026-08-01&to=2026-09-30'));
        // A range that straddles the boundary is charged only for the month it fully holds.
        $this->assertEquals([70, 400 - 80 - 70, 250], $this->profitFor('from=2026-08-15&to=2026-09-30'));
        $this->assertEquals([220, 180, 180], $this->profitFor('from=2026-07-15&to=2026-09-30'));
        $this->assertEquals([0, 320, 320], $this->profitFor('from=2026-08-15&to=2026-09-29'));
        // Open-ended sides take every month beyond them.
        $this->assertEquals([70, 160 - 70, 90], $this->profitFor('from=2026-09-01'));
        $this->assertEquals([150, 240 - 150, 90], $this->profitFor('to=2026-08-31'));
        $this->assertEquals([220, 400 - 220, 180], $this->profitFor(''));

        // Unscoped month trend carries each month's own overheads and re-adds to all-time.
        $this->assertEquals(['2026-08' => ['portal' => 150, 'margin' => 90], '2026-09' => ['portal' => 70, 'margin' => 90]], $this->monthlyTrend());
        $this->assertEquals(180, array_sum(array_column($this->monthlyTrend(), 'margin')));

        // Edit on the Portal Expenses page → every profit figure moves.
        $r = $this->put("/portal-expenses/{$byoc}", ['total_amount' => 80]);
        $this->assertStatus(200, $r);
        $this->assertSame('2026-08-01', $r['json']['month']);
        $this->assertEquals([180, 60, 60], $this->profitFor('from=2026-08-01&to=2026-08-31'));
        $this->assertEquals(180, $this->monthlyTrend()['2026-08']['portal']);
        $this->assertEquals(250, $this->get('/analytics/trends?granularity=year')['json'][0]['portal_expenses']);

        // Delete → gone everywhere.
        $this->assertSame(['deleted' => true], $this->delete("/portal-expenses/{$sep}")['json']);
        $this->assertEquals([0, 160, 160], $this->profitFor('from=2026-09-01&to=2026-09-30'));
        $this->assertEquals(0, $this->monthlyTrend()['2026-09']['portal']);
        $this->assertEquals([180, 400 - 180, 220], $this->profitFor(''));
    }

    public function testMarginPercentAndDeltasUseTheChargedExpenses(): void
    {
        $this->keyInTwoMonths();
        $this->expense('2026-08', 'Twilio', 120);
        $this->expense('2026-09', 'Twilio', 40);

        $s = $this->get('/analytics/summary?from=2026-08-01&to=2026-08-31')['json'];
        $this->assertEquals(120, $s['margin']);
        $this->assertEquals(40.0, $s['margin_pct']);

        // A 61-day window: Aug + Sep charged; the previous 61 days hold nothing.
        $both = $this->get('/analytics/summary?from=2026-08-01&to=2026-09-30')['json'];
        $this->assertEquals(500 - 100 - 160, $both['margin']);
        $this->assertEquals(48.0, $both['margin_pct']);
        $this->assertNull($both['deltas']['margin']);
    }

    /**
     * The dashboard and the Reports page ask for month buckets over the range the user picked,
     * which usually starts mid-month. The trend's own comment says a bucket is charged only
     * for a month it fully covers, "the same rule the summary uses" — but the first and last
     * buckets of a partial range are charged their whole month, so the chart's margins no
     * longer add up to the KPI card's.
     */
    public function testMonthTrendOverAPartialRangeChargesWhatTheSummaryCharges(): void
    {
        $this->keyInTwoMonths();
        $this->expense('2026-08', 'Twilio', 150);
        $this->expense('2026-09', 'Twilio', 70);

        $query = 'from=2026-08-15&to=2026-09-30';
        [$portal, $margin] = $this->profitFor($query);
        $this->assertEquals(70, $portal);

        $trend = $this->monthlyTrend($query);
        $this->assertEquals($portal, array_sum(array_column($trend, 'portal')), 'Aug is only half inside the range, so it must not be charged');
        $this->assertEquals($margin, array_sum(array_column($trend, 'margin')));
    }

    /** Same mismatch for year buckets: they are charged every month of the year, even months outside the range. */
    public function testYearTrendOverAPartialRangeChargesWhatTheSummaryCharges(): void
    {
        $this->keyInTwoMonths();
        $this->expense('2026-03', 'Old provider', 500);
        $this->expense('2026-09', 'Twilio', 70);

        $query = 'from=2026-08-01&to=2026-09-30';
        [$portal, $margin] = $this->profitFor($query);
        $this->assertEquals(70, $portal);

        $year = $this->get("/analytics/trends?granularity=year&{$query}")['json'];
        $this->assertCount(1, $year);
        $this->assertEquals($portal, $year[0]['portal_expenses'], 'March lies outside the range');
        $this->assertEquals($margin, $year[0]['margin']);
    }
}
