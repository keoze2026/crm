<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

final class VendorApiTest extends ApiTestCase
{
    use SeedsCallData;

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('vendors', 'vendor_payments', 'call_records', 'campaigns', 'buyers');
    }

    private static function seedVendor(string $name, bool $manual, float $opening = 0.0, int $sort = 0): int
    {
        return (int) self::insert('vendors', [
            'name' => $name, 'is_manual' => $manual, 'opening_advance' => (string) $opening, 'sort_order' => $sort,
        ])['id'];
    }

    private static function seedPayment(string $vendor, string $date, float $paid): int
    {
        return (int) self::insert('vendor_payments', [
            'vendor' => $vendor, 'entry_date' => $date, 'amount_paid' => (string) $paid,
        ])['id'];
    }

    // ── vendors ──────────────────────────────────────────────────────────────

    public function testIndexMergesCampaignSourcesWithVendorRows(): void
    {
        $c = self::seedCampaign('C-03');
        self::seedCampaignRecord($c, 'DXTST ', '2026-05-04', 1, 1.0);
        self::seedCampaignRecord($c, 'DXTST', '2026-05-05', 1, 1.0);
        self::seedCampaignRecord($c, 'PDSO', '2026-05-04', 1, 1.0);
        self::seedCampaignRecord($c, 'alpha', '2026-05-04', 1, 1.0);
        self::seedCampaignRecord($c, '   ', '2026-05-04', 1, 1.0);
        self::seedCampaignRecord($c, null, '2026-05-04', 1, 1.0);
        self::seedBuyerRecord(self::seedBuyer('BUYERONLY'), '2026-05-04', 1, 1.0);

        $dx = self::seedVendor('dxtst', false, -25.5);
        $mz = self::seedVendor('Manual Z', true);
        $ma = self::seedVendor('Manual A', true, 10);
        $late = self::seedVendor('Late', false, 0, 5);

        $r = $this->get('/vendors');
        $this->assertStatus(200, $r);
        $this->assertSame(['alpha', 'dxtst', 'PDSO', 'Manual A', 'Manual Z', 'Late'], array_column($r['json'], 'name'));

        $byName = array_column($r['json'], null, 'name');
        $this->assertSame(['id' => null, 'name' => 'alpha', 'is_manual' => false, 'opening_advance' => 0, 'sort_order' => 0], $byName['alpha']);
        $this->assertSame($dx, $byName['dxtst']['id']);
        $this->assertEquals(-25.5, $byName['dxtst']['opening_advance']);
        $this->assertFalse($byName['dxtst']['is_manual']);
        $this->assertSame($ma, $byName['Manual A']['id']);
        $this->assertTrue($byName['Manual A']['is_manual']);
        $this->assertEquals(10, $byName['Manual A']['opening_advance']);
        $this->assertSame($mz, $byName['Manual Z']['id']);
        $this->assertSame(5, $byName['Late']['sort_order']);
        $this->assertSame($late, $byName['Late']['id']);
    }

    public function testStoreAddsAManualVendor(): void
    {
        $r = $this->post('/vendors', ['name' => '  New Source ']);
        $this->assertStatus(201, $r);
        $this->assertSame('New Source', $r['json']['name']);
        $this->assertTrue($r['json']['is_manual']);
        $this->assertEquals(0, $r['json']['opening_advance']);
        $this->assertIsInt($r['json']['id']);
    }

    public function testStoreValidatesNameAndRejectsCaseInsensitiveDuplicates(): void
    {
        $empty = $this->post('/vendors', ['name' => ' ']);
        $this->assertStatus(422, $empty);
        $this->assertSame('Vendor name is required', $empty['json']['error']);

        self::seedVendor('DXTST', false);
        $dup = $this->post('/vendors', ['name' => ' dxtst ']);
        $this->assertStatus(409, $dup);
        $this->assertSame('A vendor with that name already exists', $dup['json']['error']);
        $this->assertSame(1, (int) self::dbValue('SELECT COUNT(*) FROM vendors'));
    }

    public function testUpsertMetaCreatesThenUpdatesTheOpeningAdvanceByName(): void
    {
        $created = $this->put('/vendors', ['name' => 'DXTST', 'opening_advance' => -120.5]);
        $this->assertStatus(200, $created);
        $this->assertSame('DXTST', $created['json']['name']);
        $this->assertFalse($created['json']['is_manual']);
        $this->assertEquals(-120.5, $created['json']['opening_advance']);

        $updated = $this->put('/vendors', ['name' => ' dxtst ', 'opening_advance' => '75']);
        $this->assertSame($created['json']['id'], $updated['json']['id']);
        $this->assertSame('DXTST', $updated['json']['name']);
        $this->assertEquals(75, $updated['json']['opening_advance']);

        $kept = $this->put('/vendors', ['name' => 'DXTST']);
        $this->assertEquals(75, $kept['json']['opening_advance']);

        $this->assertSame(1, (int) self::dbValue('SELECT COUNT(*) FROM vendors'));
    }

    public function testUpsertMetaKeepsTheManualFlagAndDefaultsNewRowsToZero(): void
    {
        self::seedVendor('Hand', true, 5);
        $this->assertTrue($this->put('/vendors', ['name' => 'HAND', 'opening_advance' => 9])['json']['is_manual']);
        $this->assertEquals(0, $this->put('/vendors', ['name' => 'Fresh'])['json']['opening_advance']);
        $this->assertEquals(0, $this->put('/vendors', ['name' => 'Junk', 'opening_advance' => 'abc'])['json']['opening_advance']);
    }

    public function testUpsertMetaRequiresName(): void
    {
        $r = $this->put('/vendors', ['opening_advance' => 5]);
        $this->assertStatus(422, $r);
        $this->assertSame('Vendor name is required', $r['json']['error']);
    }

    public function testDestroyRemovesManualVendorAndItsLedgerRows(): void
    {
        $id = self::seedVendor('Hand Made', true);
        self::seedPayment('Hand Made', '2026-05-04', 10);
        self::seedPayment(' hand made ', '2026-05-05', 10);
        self::seedPayment('Other', '2026-05-04', 10);

        $r = $this->delete("/vendors/{$id}");
        $this->assertStatus(200, $r);
        $this->assertSame(['deleted' => true], $r['json']);
        $this->assertSame(0, (int) self::dbValue('SELECT COUNT(*) FROM vendors'));
        $this->assertSame(['Other'], self::db()->query('SELECT vendor FROM vendor_payments')->fetchAll(\PDO::FETCH_COLUMN));
    }

    public function testDestroyRefusesDiscoveredVendorsAndUnknownIds(): void
    {
        $id = self::seedVendor('DXTST', false);
        self::seedPayment('DXTST', '2026-05-04', 10);

        $r = $this->delete("/vendors/{$id}");
        $this->assertStatus(422, $r);
        $this->assertSame('Only manually-added vendors can be deleted', $r['json']['error']);
        $this->assertSame(1, (int) self::dbValue('SELECT COUNT(*) FROM vendor_payments'));

        $missing = $this->delete('/vendors/999');
        $this->assertStatus(404, $missing);
        $this->assertSame('Vendor not found', $missing['json']['error']);
    }

    // ── payments ledger ──────────────────────────────────────────────────────

    private function seedLedger(): array
    {
        self::seedVendor('DXTST', false, 100);
        $c3 = self::seedCampaign('C-03');
        $c5 = self::seedCampaign('C-05');
        self::seedCampaignRecord($c3, 'DXTST', '2026-04-28', 10, 4.0);
        self::seedCampaignRecord($c3, 'DXTST', '2026-05-04', 20, 4.0);
        self::seedCampaignRecord($c5, 'DXTST', '2026-05-04', 5, 2.0);
        self::seedCampaignRecord($c3, ' dxtst ', '2026-05-06', 3, 5.0);
        self::seedCampaignRecord($c3, 'PDSO', '2026-05-04', 100, 1.0);
        self::seedBuyerRecord(self::seedBuyer('DXTST'), '2026-05-04', 100, 1.0);

        return [
            'apr20' => self::seedPayment('DXTST', '2026-04-20', 70),
            'may05' => self::seedPayment('dxtst', '2026-05-05', 50),
            'may06' => self::seedPayment('DXTST', '2026-05-06', 20),
            'jun01' => self::seedPayment('DXTST', '2026-06-01', 999),
            'other' => self::seedPayment('PDSO', '2026-05-04', 5),
        ];
    }

    public function testPaymentsRequireAVendor(): void
    {
        $r = $this->get('/vendor-payments');
        $this->assertStatus(422, $r);
        $this->assertSame('A vendor is required', $r['json']['error']);
    }

    public function testPaymentsJoinCampaignDaysWithPaymentDaysAndCarryTheBalanceForward(): void
    {
        $ids = $this->seedLedger();

        $r = $this->get('/vendor-payments?vendor=%20DxTsT%20&from=2026-05-01&to=2026-05-31');
        $this->assertStatus(200, $r);
        $j = $r['json'];

        $this->assertEquals([
            ['entry_date' => '2026-05-04', 'converted_calls' => 25, 'payments' => 90, 'amount_paid' => 0,
             'payment_id' => null, 'vendor' => 'DxTsT', 'price' => 3.6],
            ['entry_date' => '2026-05-05', 'converted_calls' => 0, 'payments' => 0, 'amount_paid' => 50,
             'payment_id' => $ids['may05'], 'vendor' => 'DxTsT', 'price' => 0],
            ['entry_date' => '2026-05-06', 'converted_calls' => 3, 'payments' => 15, 'amount_paid' => 20,
             'payment_id' => $ids['may06'], 'vendor' => 'DxTsT', 'price' => 5],
        ], $j['rows']);

        // prior_net = paid before May (70) − charged before May (10 × 4 = 40).
        $this->assertEquals(100, $j['opening_advance']);
        $this->assertEquals(30, $j['prior_net']);
        $this->assertEquals(130, $j['initial_advance']);
    }

    public function testPaymentsWithoutFromShowTheWholeLedgerAndNoPriorNet(): void
    {
        $this->seedLedger();
        $j = $this->get('/vendor-payments?vendor=DXTST')['json'];

        $this->assertSame(
            ['2026-04-20', '2026-04-28', '2026-05-04', '2026-05-05', '2026-05-06', '2026-06-01'],
            array_column($j['rows'], 'entry_date')
        );
        $this->assertEquals(0, $j['prior_net']);
        $this->assertEquals(100, $j['initial_advance']);

        $paid    = array_sum(array_column($j['rows'], 'amount_paid'));
        $charged = array_sum(array_column($j['rows'], 'payments'));
        $this->assertEquals(1139, $paid);
        $this->assertEquals(145, $charged);
    }

    public function testCarryForwardIsConsistentAcrossConsecutivePeriods(): void
    {
        $this->seedLedger();

        $may  = $this->get('/vendor-payments?vendor=DXTST&from=2026-05-01&to=2026-05-31')['json'];
        $june = $this->get('/vendor-payments?vendor=DXTST&from=2026-06-01&to=2026-06-30')['json'];

        $mayClose = $may['initial_advance']
            + array_sum(array_column($may['rows'], 'amount_paid'))
            - array_sum(array_column($may['rows'], 'payments'));
        $this->assertEquals(130 + 70 - 105, $mayClose);
        $this->assertEquals($mayClose, $june['initial_advance']);
    }

    public function testPaymentsForUnknownVendorAreEmptyWithZeroSeed(): void
    {
        $j = $this->get('/vendor-payments?vendor=NOBODY&from=2026-01-01')['json'];
        $this->assertSame([], $j['rows']);
        $this->assertEquals(0, $j['opening_advance']);
        $this->assertEquals(0, $j['prior_net']);
        $this->assertEquals(0, $j['initial_advance']);
    }

    public function testStorePaymentUpsertsOneRowPerVendorDay(): void
    {
        $r = $this->post('/vendor-payments', ['vendor' => ' DXTST ', 'entry_date' => '2026-05-04', 'amount_paid' => '12.5']);
        $this->assertStatus(201, $r);
        $this->assertSame('DXTST', $r['json']['vendor']);
        $this->assertSame('2026-05-04', $r['json']['entry_date']);
        $this->assertEquals(12.5, $r['json']['amount_paid']);

        $again = $this->post('/vendor-payments', ['vendor' => 'dxtst', 'entry_date' => '2026-05-04', 'amount_paid' => 40]);
        $this->assertStatus(201, $again);
        $this->assertSame($r['json']['id'], $again['json']['id']);
        $this->assertEquals(40, $again['json']['amount_paid']);
        $this->assertSame(1, (int) self::dbValue('SELECT COUNT(*) FROM vendor_payments'));
        $this->assertEquals(40, self::dbValue('SELECT amount_paid FROM vendor_payments'));
    }

    public function testStorePaymentClampsNegativeAmountsToZero(): void
    {
        $r = $this->post('/vendor-payments', ['vendor' => 'DXTST', 'entry_date' => '2026-05-04', 'amount_paid' => -9]);
        $this->assertStatus(201, $r);
        $this->assertEquals(0, $r['json']['amount_paid']);
    }

    public function testStorePaymentValidatesVendorAndDate(): void
    {
        $noVendor = $this->post('/vendor-payments', ['entry_date' => '2026-05-04']);
        $this->assertStatus(422, $noVendor);
        $this->assertSame('A vendor is required', $noVendor['json']['error']);

        foreach (['2026-02-30', '2026-5-4', '04/05/2026', ''] as $bad) {
            $r = $this->post('/vendor-payments', ['vendor' => 'DXTST', 'entry_date' => $bad]);
            $this->assertStatus(422, $r);
            $this->assertSame('A valid entry date is required', $r['json']['error']);
        }
        $this->assertSame(0, (int) self::dbValue('SELECT COUNT(*) FROM vendor_payments'));
    }

    public function testUpdatePaymentChangesAmountAndDate(): void
    {
        $id = self::seedPayment('DXTST', '2026-05-04', 10);

        $r = $this->put("/vendor-payments/{$id}", ['amount_paid' => 25.75]);
        $this->assertStatus(200, $r);
        $this->assertEquals(25.75, $r['json']['amount_paid']);
        $this->assertSame('2026-05-04', $r['json']['entry_date']);

        $moved = $this->put("/vendor-payments/{$id}", ['entry_date' => '2026-05-09']);
        $this->assertSame('2026-05-09', $moved['json']['entry_date']);
        $this->assertEquals(25.75, $moved['json']['amount_paid']);

        // An invalid date is ignored rather than rejected.
        $ignored = $this->put("/vendor-payments/{$id}", ['entry_date' => 'soon', 'amount_paid' => -3]);
        $this->assertSame('2026-05-09', $ignored['json']['entry_date']);
        $this->assertEquals(0, $ignored['json']['amount_paid']);
    }

    public function testUpdateUnknownPaymentIs404(): void
    {
        $r = $this->put('/vendor-payments/999', ['amount_paid' => 1]);
        $this->assertStatus(404, $r);
        $this->assertSame('Payment row not found', $r['json']['error']);
    }

    public function testDestroyPayment(): void
    {
        $id = self::seedPayment('DXTST', '2026-05-04', 10);
        $this->assertSame(['deleted' => true], $this->delete("/vendor-payments/{$id}")['json']);
        $this->assertSame(['deleted' => false], $this->delete("/vendor-payments/{$id}")['json']);
        $this->assertSame(0, (int) self::dbValue('SELECT COUNT(*) FROM vendor_payments'));
    }
}
