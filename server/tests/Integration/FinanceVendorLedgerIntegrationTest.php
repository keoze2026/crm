<?php

declare(strict_types=1);

namespace Tests\Integration;

use Tests\ApiTestCase;

/**
 * Vendors fed by the call records: sources keyed in on the cost side become vendor tabs,
 * the ledger charges what those records charged, payments and an opening advance build a
 * balance, and that balance carries forward consistently from one period to the next while
 * records, rates and payments are edited underneath it.
 */
final class FinanceVendorLedgerIntegrationTest extends ApiTestCase
{
    private const JUL = 'from=2026-07-01&to=2026-07-31';
    private const AUG = 'from=2026-08-01&to=2026-08-31';
    private const SEP = 'from=2026-09-01&to=2026-09-30';

    private int $c03;
    private int $c07;
    private int $adsterra;
    /** @var array<string,int> */
    private array $recordIds = [];

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('call_records', 'buyers', 'campaigns', 'destinations', 'vendors', 'vendor_payments');
    }

    private function create(string $path, array $body): array
    {
        $r = $this->post($path, $body);
        $this->assertStatus(201, $r);
        return $r['json'];
    }

    /** AdsTerra @10 across two campaigns and three months; PropAds @5 in August. */
    private function keyInTraffic(): void
    {
        $this->c03 = $this->create('/campaigns', ['code' => 'C-03'])['id'];
        $this->c07 = $this->create('/campaigns', ['code' => 'C-07'])['id'];
        $this->adsterra = $this->create('/destinations', ['name' => 'AdsTerra', 'rate' => 10, 'campaign_id' => $this->c03])['id'];
        $this->create('/destinations', ['name' => 'PropAds', 'rate' => 5, 'campaign_id' => $this->c07]);

        foreach ([
            'jul28' => [$this->c03, 'AdsTerra', '2026-07-28', 5],
            'aug03' => [$this->c03, 'AdsTerra', '2026-08-03', 10],
            'aug10' => [$this->c07, 'AdsTerra', '2026-08-10', 2],
            'aug20' => [$this->c03, 'AdsTerra', '2026-08-20', 4],
            'sep02' => [$this->c03, 'AdsTerra', '2026-09-02', 6],
            'prop'  => [$this->c07, 'PropAds', '2026-08-05', 3],
        ] as $key => [$campaign, $source, $date, $counted]) {
            $this->recordIds[$key] = $this->create('/records', [
                'record_type' => 'campaign', 'campaign_id' => $campaign, 'source' => $source,
                'record_date' => $date, 'counted' => $counted, 'answered' => $counted,
            ])['id'];
        }
    }

    private function ledger(string $vendor, string $range = ''): array
    {
        $r = $this->get('/vendor-payments?vendor=' . rawurlencode($vendor) . ($range !== '' ? "&{$range}" : ''));
        $this->assertStatus(200, $r);
        return $r['json'];
    }

    /** initial + Σ paid − Σ payments, exactly as the page derives the Due/Advance figure. */
    private static function closing(array $ledger): float
    {
        return $ledger['initial_advance']
            + array_sum(array_column($ledger['rows'], 'amount_paid'))
            - array_sum(array_column($ledger['rows'], 'payments'));
    }

    private function assertCarriesForward(string $vendor): void
    {
        $jul = $this->ledger($vendor, self::JUL);
        $aug = $this->ledger($vendor, self::AUG);
        $sep = $this->ledger($vendor, self::SEP);
        $all = $this->ledger($vendor);
        $this->assertEqualsWithDelta(self::closing($jul), $aug['initial_advance'], 0.001, 'Jul → Aug');
        $this->assertEqualsWithDelta(self::closing($aug), $sep['initial_advance'], 0.001, 'Aug → Sep');
        $this->assertEqualsWithDelta(self::closing($all), self::closing($sep), 0.001, 'whole ledger closes where September does');
    }

    private function pay(string $vendor, string $date, float $amount): int
    {
        return $this->create('/vendor-payments', ['vendor' => $vendor, 'entry_date' => $date, 'amount_paid' => $amount])['id'];
    }

    public function testSourcesBecomeTabsAndTheLedgerChargesWhatAnalyticsCharges(): void
    {
        $this->keyInTraffic();

        $tabs = $this->get('/vendors')['json'];
        $this->assertSame(['AdsTerra', 'PropAds'], array_column($tabs, 'name'));
        $this->assertSame([null, null], array_column($tabs, 'id'));

        $aug = $this->ledger('AdsTerra', self::AUG);
        $this->assertSame(['2026-08-03', '2026-08-10', '2026-08-20'], array_column($aug['rows'], 'entry_date'));
        $this->assertSame([10, 2, 4], array_column($aug['rows'], 'converted_calls'));
        $this->assertEquals([100, 20, 40], array_column($aug['rows'], 'payments'));

        // Same money, three other views of it.
        $top = array_column($this->get('/analytics/top-sources?' . self::AUG)['json'], null, 'source');
        $this->assertEquals(array_sum(array_column($aug['rows'], 'payments')), $top['AdsTerra']['cost']);
        $this->assertEquals(array_sum(array_column($aug['rows'], 'converted_calls')), $top['AdsTerra']['counted']);
        $cr = $this->get('/analytics/complete-report?' . self::AUG)['json'];
        $fromReport = array_sum(array_map(static fn ($r) => $r['destination'] === 'AdsTerra' ? $r['total_bill'] : 0, $cr['campaigns']));
        $this->assertEquals(160, $fromReport);
        $vendorTotal = 0.0;
        foreach ($tabs as $tab) {
            $vendorTotal += array_sum(array_column($this->ledger($tab['name'], self::AUG)['rows'], 'payments'));
        }
        $this->assertEquals($this->get('/analytics/summary?' . self::AUG)['json']['cost'], $vendorTotal);
    }

    public function testOpeningAdvanceAndPaymentsCarryForwardAcrossConsecutivePeriods(): void
    {
        $this->keyInTraffic();

        $meta = $this->put('/vendors', ['name' => 'AdsTerra', 'opening_advance' => 100]);
        $this->assertStatus(200, $meta);
        $this->assertSame($meta['json']['id'], array_column($this->get('/vendors')['json'], 'id', 'name')['AdsTerra']);

        $this->pay('AdsTerra', '2026-07-28', 60);
        $this->pay('AdsTerra', '2026-08-03', 50);
        $idle = $this->pay('AdsTerra', '2026-08-15', 80);
        $this->pay('AdsTerra', '2026-09-02', 30);
        // Paying the same day again sets the amount rather than adding a row.
        $this->assertSame($idle, $this->pay('adsterra ', '2026-08-15', 90));

        $jul = $this->ledger('AdsTerra', self::JUL);
        $this->assertEquals([100, 0, 100], [$jul['opening_advance'], $jul['prior_net'], $jul['initial_advance']]);
        $this->assertEquals(110, self::closing($jul));

        $aug = $this->ledger('AdsTerra', self::AUG);
        $this->assertEquals(110, $aug['initial_advance']);
        $this->assertSame(['2026-08-03', '2026-08-10', '2026-08-15', '2026-08-20'], array_column($aug['rows'], 'entry_date'));
        $this->assertEquals([50, 0, 90, 0], array_column($aug['rows'], 'amount_paid'));
        $this->assertEquals([100, 20, 0, 40], array_column($aug['rows'], 'payments'));
        $this->assertSame($idle, $aug['rows'][2]['payment_id']);
        $this->assertEquals(90, self::closing($aug));

        $sep = $this->ledger('AdsTerra', self::SEP);
        $this->assertEquals(90, $sep['initial_advance']);
        $this->assertEquals(60, self::closing($sep));
        $this->assertCarriesForward('AdsTerra');

        // A vendor with no payments and no seed just runs a Due from zero.
        $prop = $this->ledger('PropAds', self::SEP);
        $this->assertEquals([0, -15], [$prop['opening_advance'], $prop['initial_advance']]);
    }

    public function testEditsUnderneathTheLedgerReBaseEveryLaterPeriod(): void
    {
        $this->keyInTraffic();
        $this->put('/vendors', ['name' => 'AdsTerra', 'opening_advance' => 100]);
        $this->pay('AdsTerra', '2026-07-28', 60);
        $this->pay('AdsTerra', '2026-08-03', 50);
        $moved = $this->pay('AdsTerra', '2026-08-15', 90);
        $this->pay('AdsTerra', '2026-09-02', 30);
        $this->assertEquals(90, $this->ledger('AdsTerra', self::SEP)['initial_advance']);

        // A record edited on the Records page.
        $this->assertStatus(200, $this->put("/records/{$this->recordIds['aug03']}", ['counted' => 12]));
        $this->assertEquals(70, $this->ledger('AdsTerra', self::SEP)['initial_advance']);
        $this->assertCarriesForward('AdsTerra');

        // The source's rate changed on the Campaigns page re-prices every month of the ledger.
        $this->assertStatus(200, $this->put("/destinations/{$this->adsterra}", ['rate' => 11]));
        $sep = $this->ledger('AdsTerra', self::SEP);
        $this->assertEquals(100 + (60 - 55) + (140 - 198), $sep['initial_advance']);
        $this->assertEquals(11, $sep['rows'][0]['price']);
        $this->assertEquals(11, self::closing($sep));
        $this->assertEquals(
            array_sum(array_column($this->ledger('AdsTerra', self::AUG)['rows'], 'payments')),
            array_column($this->get('/analytics/top-sources?' . self::AUG)['json'], 'cost', 'source')['AdsTerra']
        );
        $this->assertCarriesForward('AdsTerra');

        // A payment back-dated into another month moves between periods but not the end balance.
        $r = $this->put("/vendor-payments/{$moved}", ['entry_date' => '2026-09-05']);
        $this->assertStatus(200, $r);
        $sep = $this->ledger('AdsTerra', self::SEP);
        $this->assertEquals(47 - 90, $sep['initial_advance']);
        $this->assertEquals(11, self::closing($sep));
        $this->assertCarriesForward('AdsTerra');

        // Raising the seed lifts every period by the same amount.
        $this->put('/vendors', ['name' => 'AdsTerra', 'opening_advance' => 150]);
        $this->assertEquals(47 - 90 + 50, $this->ledger('AdsTerra', self::SEP)['initial_advance']);
        $this->assertEquals(150 + 0, $this->ledger('AdsTerra', self::JUL)['initial_advance']);
        $this->assertCarriesForward('AdsTerra');

        // Deleting a record removes its charge from the ledger.
        $this->delete("/records/{$this->recordIds['jul28']}");
        $this->assertEquals([0], array_column($this->ledger('AdsTerra', self::JUL)['rows'], 'payments'));
        $this->assertEquals(150 + 60, $this->ledger('AdsTerra', self::AUG)['initial_advance']);
        $this->assertCarriesForward('AdsTerra');
    }

    public function testTheLedgerMergesSpellingVariantsThatTopSourcesListsApart(): void
    {
        $this->keyInTraffic();
        $this->create('/records', ['record_type' => 'campaign', 'campaign_id' => $this->c07, 'source' => 'adsterra',
            'rate' => 10, 'record_date' => '2026-08-10', 'counted' => 1]);

        $top = array_column($this->get('/analytics/top-sources?' . self::AUG)['json'], 'cost', 'source');
        $this->assertEquals(['AdsTerra' => 160, 'PropAds' => 15, 'adsterra' => 10], $top);

        $this->assertSame(['adsterra', 'propads'], array_map('strtolower', array_column($this->get('/vendors')['json'], 'name')));
        $aug = $this->ledger('ADSTERRA', self::AUG);
        $this->assertEquals([100, 30, 40], array_column($aug['rows'], 'payments'));
        $this->assertEquals($top['AdsTerra'] + $top['adsterra'], array_sum(array_column($aug['rows'], 'payments')));

        // The complete report bundles the variants the same way the ledger does.
        $cr  = $this->get('/analytics/complete-report?' . self::AUG)['json'];
        $ads = array_filter($cr['campaigns'], static fn ($r) => strtoupper($r['destination']) === 'ADSTERRA');
        $this->assertEquals(170, array_sum(array_column($ads, 'total_bill')));
    }

    public function testManualVendorLivesAndDiesWithItsOwnLedgerOnly(): void
    {
        $this->keyInTraffic();
        $manual = $this->create('/vendors', ['name' => 'Direct Deal']);
        $this->assertTrue($manual['is_manual']);
        $this->assertStatus(409, $this->post('/vendors', ['name' => ' direct deal ']));
        $this->pay('Direct Deal', '2026-08-01', 500);
        $this->pay('AdsTerra', '2026-08-03', 25);
        $seeded = $this->put('/vendors', ['name' => 'AdsTerra', 'opening_advance' => -40])['json'];

        $this->assertSame(['AdsTerra', 'PropAds', 'Direct Deal'], array_column($this->get('/vendors')['json'], 'name'));
        $this->assertEquals(500, self::closing($this->ledger('Direct Deal', self::AUG)));

        // A discovered source is never deletable, even once it has a metadata row.
        $this->assertStatus(422, $this->delete("/vendors/{$seeded['id']}"));
        $this->assertSame(['deleted' => true], $this->delete("/vendors/{$manual['id']}")['json']);

        $this->assertSame(['AdsTerra', 'PropAds'], array_column($this->get('/vendors')['json'], 'name'));
        $this->assertSame([], $this->ledger('Direct Deal')['rows']);
        $ads = $this->ledger('AdsTerra', self::AUG);
        $this->assertEquals(-40 - 50, $ads['initial_advance']);
        $this->assertEquals(25, $ads['rows'][0]['amount_paid']);
        $this->assertEquals(175, $this->get('/analytics/summary?' . self::AUG)['json']['cost']);
    }

    /**
     * The ledger holds one payment per vendor per day (migration 026's unique index), and a
     * second POST for a day is folded into the first. Moving an existing payment onto a day
     * that already has one hits that index instead: the request dies with a 500 rather than
     * being refused (or merged) the way the rest of the API handles a clash.
     */
    public function testMovingAPaymentOntoADayThatAlreadyHasOneIsRefusedCleanly(): void
    {
        $this->keyInTraffic();
        $this->pay('AdsTerra', '2026-08-03', 50);
        $second = $this->pay('AdsTerra', '2026-08-04', 20);

        $r = $this->put("/vendor-payments/{$second}", ['entry_date' => '2026-08-03']);
        $this->assertContains($r['status'], [200, 409], "Clash on the (vendor, day) index must not surface as a server error. Body: {$r['body']}");
        $this->assertEquals(70, array_sum(array_column($this->ledger('AdsTerra', self::AUG)['rows'], 'amount_paid')), 'no money may be lost or double-counted');
    }
}
