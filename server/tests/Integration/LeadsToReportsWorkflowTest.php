<?php

declare(strict_types=1);

namespace Tests\Integration;

use Tests\ApiTestCase;

/**
 * Money in, money out: buyers, campaigns and their sources are set up on their own pages,
 * lead records keyed in against them, portal overheads added per month — and the dashboard
 * summary, the monthly trend, the top lists, the Complete Report and the per-page totals must
 * all tell the same story, before and after rates are edited and entities removed.
 */
final class LeadsToReportsWorkflowTest extends ApiTestCase
{
    private const APRIL = 'from=2026-04-01&to=2026-04-30';

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('call_records', 'destinations', 'buyers', 'campaigns', 'portal_expenses');
    }

    /** @return array<string,int> */
    private function arrange(): array
    {
        $b1 = $this->post('/buyers', ['code' => 'B1', 'rate' => 10]);
        $b2 = $this->post('/buyers', ['code' => 'B2', 'rate' => 5]);
        $c  = $this->post('/campaigns', ['code' => 'C-03']);
        $this->assertStatus(201, $b1);
        $this->assertStatus(201, $b2);
        $this->assertStatus(201, $c);
        $src1 = $this->post('/destinations', ['name' => 'SRC1', 'rate' => 2, 'campaign_id' => $c['json']['id']]);
        $this->assertStatus(201, $src1);

        $ids = ['b1' => $b1['json']['id'], 'b2' => $b2['json']['id'], 'c03' => $c['json']['id'], 'src1' => $src1['json']['id']];

        // Buyer rows bill at the buyer's rate — whatever the form might send.
        $r = $this->post('/records', ['record_type' => 'buyer', 'record_date' => '2026-04-06', 'buyer_id' => $ids['b1'], 'counted' => 50, 'answered' => 60, 'missed' => 5, 'rate' => 99]);
        $this->assertStatus(201, $r);
        $this->assertEquals(10.0, $r['json']['rate']);
        $ids['rec_b1_mon'] = $r['json']['id'];
        // A Saturday: in every dashboard figure, but not on the Buyers page (working days only).
        $this->assertStatus(201, $this->post('/records', ['record_type' => 'buyer', 'record_date' => '2026-04-11', 'buyer_code' => 'B1', 'counted' => 10, 'answered' => 10]));
        $this->assertStatus(201, $this->post('/records', ['record_type' => 'buyer', 'record_date' => '2026-04-07', 'buyer_id' => $ids['b2'], 'counted' => 20, 'answered' => 25, 'missed' => 5]));

        // Cost rows inherit the source's rate; a new source is created with the rate given.
        $r = $this->post('/records', ['record_type' => 'campaign', 'record_date' => '2026-04-06', 'campaign_id' => $ids['c03'], 'source' => 'SRC1', 'counted' => 40, 'answered' => 45]);
        $this->assertEquals(2.0, $r['json']['rate']);
        $r = $this->post('/records', ['record_type' => 'campaign', 'record_date' => '2026-04-08', 'campaign_code' => 'c 03', 'source' => 'SRC2', 'rate' => 1.5, 'counted' => 20, 'answered' => 20]);
        $this->assertStatus(201, $r);
        $this->assertSame($ids['c03'], $r['json']['campaign_id'], 'the typed code resolves to the same campaign');

        $this->assertStatus(201, $this->post('/portal-expenses', ['month' => '2026-04', 'name' => 'Provider A', 'total_amount' => 90]));
        $this->assertStatus(201, $this->post('/portal-expenses', ['month' => '2026-03', 'name' => 'Provider A', 'total_amount' => 1000]));

        return $ids;
    }

    /** Revenue / cost / overheads / profit as each report states them, which must agree. */
    private function assertReportsAgree(float $revenue, float $cost, float $portal): void
    {
        $profit = $revenue - $cost - $portal;

        $s = $this->get('/analytics/summary?' . self::APRIL)['json'];
        $this->assertEquals([$revenue, $cost, $portal, $profit], [$s['revenue'], $s['cost'], $s['portal_expenses'], $s['margin']], 'summary');

        $t = $this->get('/analytics/trends?granularity=month&' . self::APRIL)['json'];
        $this->assertCount(1, $t);
        $this->assertEquals(['2026-04', $revenue, $cost, $portal, $profit], [$t[0]['period'], $t[0]['revenue'], $t[0]['cost'], $t[0]['portal_expenses'], $t[0]['margin']], 'trends');

        $c = $this->get('/analytics/complete-report?' . self::APRIL)['json'];
        $this->assertEquals([$revenue, $cost, $portal, $profit], [$c['revenue'], $c['cost'], $c['portal_expenses'], $c['profit']], 'complete report');
        $this->assertEquals($revenue, $c['buyer_totals']['total_bill']);
        $this->assertEquals($cost, $c['campaign_totals']['total_bill']);

        $top = $this->get('/analytics/top-buyers?limit=50&' . self::APRIL)['json'];
        $this->assertEquals($revenue, array_sum(array_column($top, 'revenue')), 'top buyers');
        $camps = $this->get('/analytics/top-campaigns?limit=50&' . self::APRIL)['json'];
        $this->assertEquals($cost, array_sum(array_column($camps, 'cost')), 'top campaigns');
        $sources = $this->get('/analytics/top-sources?limit=50&' . self::APRIL)['json'];
        $this->assertEquals($cost, array_sum(array_column($sources, 'cost')), 'top sources');

        $records = $this->get('/records?per_page=9999&' . self::APRIL)['json']['data'];
        $bill = static fn (string $type) => array_sum(array_column(array_filter($records, static fn ($r) => $r['record_type'] === $type), 'total_bill'));
        $this->assertEquals($revenue, $bill('buyer'), 'records list');
        $this->assertEquals($cost, $bill('campaign'), 'records list');
    }

    public function testEveryReportAgreesOnTheSameMonth(): void
    {
        $ids = $this->arrange();

        $this->assertReportsAgree(700.0, 110.0, 90.0);

        $s = $this->get('/analytics/summary?' . self::APRIL)['json'];
        $this->assertEquals([80, 95, 10, 90.5, 2, 1], [
            $s['counted'], $s['answered'], $s['missed'], $s['answer_rate'], $s['active_buyers'], $s['active_campaigns'],
        ]);

        $c = $this->get('/analytics/complete-report?' . self::APRIL)['json'];
        $this->assertSame(['B1', 'B2'], array_column($c['buyers'], 'code'));
        $this->assertSame(['2026-04-06', '2026-04-11'], [$c['from'], $c['to']]);
        $this->assertSame([1, 2], [$c['campaign_totals']['camps'], $c['campaign_totals']['destinations']]);

        // The Buyers page counts working days only: the Saturday's 10 leads are not there.
        $buyers = array_column($this->get('/buyers?' . self::APRIL)['json'], null, 'code');
        $this->assertEquals([50, 500.0, 1], [$buyers['B1']['counted'], $buyers['B1']['revenue'], $buyers['B1']['record_days']]);
        $this->assertEquals([20, 100.0], [$buyers['B2']['counted'], $buyers['B2']['revenue']]);

        // The campaign's source panel, including the source the record form created.
        $sources = array_column($this->get("/campaigns/{$ids['c03']}/sources")['json'], null, 'name');
        $this->assertEquals([2.0, 40.0, 80.0], [$sources['SRC1']['rate'], $sources['SRC1']['counted'], $sources['SRC1']['cost']]);
        $this->assertEquals([1.5, 30.0], [$sources['SRC2']['rate'], $sources['SRC2']['cost']]);

        // A range that only partly covers April charges none of its overheads.
        $partial = $this->get('/analytics/summary?from=2026-04-06&to=2026-04-30')['json'];
        $this->assertEquals([0.0, 590.0], [$partial['portal_expenses'], $partial['margin']]);
        // The year bucket carries every month's overheads, March's included.
        $q = $this->get('/analytics/trends?granularity=year&from=2026-01-01&to=2026-12-31')['json'];
        $this->assertEquals([700.0, 110.0, 1090.0, -500.0], [$q[0]['revenue'], $q[0]['cost'], $q[0]['portal_expenses'], $q[0]['margin']]);
    }

    public function testRateAndRecordEditsRestampHistoryAndEveryReportFollows(): void
    {
        $ids = $this->arrange();

        // The buyer's definite rate changes: every one of their rows re-bills.
        $this->assertStatus(200, $this->put("/buyers/{$ids['b1']}", ['code' => 'B1', 'rate' => 12]));
        $this->assertReportsAgree(820.0, 110.0, 90.0);

        // So does a source's rate, and the campaign's source panel shows it.
        $this->assertStatus(200, $this->put("/destinations/{$ids['src1']}", ['rate' => 3]));
        $this->assertReportsAgree(820.0, 150.0, 90.0);
        $sources = array_column($this->get("/campaigns/{$ids['c03']}/sources")['json'], null, 'name');
        $this->assertEquals([3.0, 120.0], [$sources['SRC1']['rate'], $sources['SRC1']['cost']]);
        $this->assertEquals(30.0, $sources['SRC2']['cost'], 'the other source is untouched');

        // A corrected lead count on one record.
        $r = $this->put("/records/{$ids['rec_b1_mon']}", ['counted' => 40]);
        $this->assertStatus(200, $r);
        $this->assertEquals(480.0, $r['json']['total_bill']);
        $this->assertReportsAgree(700.0, 150.0, 90.0);

        // The month's overheads are revised.
        $pe = $this->get('/portal-expenses?month=2026-04')['json'][0];
        $this->assertStatus(200, $this->put("/portal-expenses/{$pe['id']}", ['total_amount' => 150]));
        $this->assertReportsAgree(700.0, 150.0, 150.0);

        // Moving a record out of April takes it out of every April figure.
        $this->assertStatus(200, $this->put("/records/{$ids['rec_b1_mon']}", ['record_date' => '2026-05-04']));
        $this->assertReportsAgree(220.0, 150.0, 150.0);
    }

    public function testRemovingABuyerOrCampaignTakesItsLeadsOutOfEveryReport(): void
    {
        $ids = $this->arrange();

        $this->assertSame(['deleted' => true], $this->delete("/buyers/{$ids['b2']}")['json']);
        $this->assertReportsAgree(600.0, 110.0, 90.0);
        $this->assertSame(['B1'], array_column($this->get('/buyers')['json'], 'code'));

        $this->assertStatus(200, $this->delete("/campaigns/{$ids['c03']}"));
        $this->assertReportsAgree(600.0, 0.0, 90.0);
        $this->assertSame([], $this->get('/destinations')['json'], "the campaign's sources went with it");
        $this->assertSame([], $this->get('/analytics/top-sources?' . self::APRIL)['json']);

        $c = $this->get('/analytics/complete-report?' . self::APRIL)['json'];
        $this->assertSame([], $c['campaigns']);
        $this->assertSame(0, $c['campaign_totals']['camps']);
        $this->assertSame(2, $this->get('/records?per_page=9999')['json']['meta']['total'], 'the two B1 rows remain');
    }
}
