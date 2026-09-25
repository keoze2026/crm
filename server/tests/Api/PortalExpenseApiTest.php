<?php

declare(strict_types=1);

namespace Tests\Api;

use PHPUnit\Framework\Attributes\DataProvider;
use Tests\ApiTestCase;

final class PortalExpenseApiTest extends ApiTestCase
{
    use SeedsCallData;

    private const MONEY = ['voice_minutes', 'rejected_calls', 'rent_values', 'call_recording', 'voip_shield', 'other_expenses', 'total_amount'];

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('portal_expenses');
    }

    private function seedExpense(string $month, string $name, int $sort = 0, float $total = 0.0): int
    {
        return (int) self::insert('portal_expenses', [
            'month' => $month, 'name' => $name, 'sort_order' => $sort, 'total_amount' => (string) $total,
        ])['id'];
    }

    public function testStoreNormalisesMonthAndPersistsEveryComponent(): void
    {
        $r = $this->post('/portal-expenses', [
            'month' => '2026-03-17', 'name' => '  Telnyx ',
            'voice_minutes' => 10.5, 'rejected_calls' => '2.25', 'rent_values' => 3,
            'call_recording' => 4, 'voip_shield' => 5, 'other_expenses' => 6.125, 'total_amount' => 30.875,
        ]);
        $this->assertStatus(201, $r);
        $e = $r['json'];
        $this->assertIsInt($e['id']);
        $this->assertSame('2026-03-01', $e['month']);
        $this->assertSame('Telnyx', $e['name']);
        $this->assertEquals(10.5, $e['voice_minutes']);
        $this->assertEquals(2.25, $e['rejected_calls']);
        $this->assertEquals(3, $e['rent_values']);
        $this->assertEquals(4, $e['call_recording']);
        $this->assertEquals(5, $e['voip_shield']);
        $this->assertEquals(6.125, $e['other_expenses']);
        $this->assertEquals(30.875, $e['total_amount']);
        $this->assertSame(0, $e['sort_order']);

        $this->assertSame('2026-03-01', self::dbValue("SELECT to_char(month, 'YYYY-MM-DD') FROM portal_expenses"));
    }

    public function testStoreClampsNegativeAndNonNumericMoneyToZero(): void
    {
        $r = $this->post('/portal-expenses', [
            'month' => '2026-03', 'name' => 'X', 'voice_minutes' => -5, 'rent_values' => 'abc', 'total_amount' => '-1',
        ]);
        $this->assertStatus(201, $r);
        foreach (self::MONEY as $k) {
            $this->assertEquals(0, $r['json'][$k], $k);
        }
    }

    public function testStoreAppendsToTheEndOfTheMonthsList(): void
    {
        $this->seedExpense('2026-03-01', 'A', 4);
        $this->seedExpense('2026-04-01', 'Other month', 9);

        $this->assertSame(5, $this->post('/portal-expenses', ['month' => '2026-03', 'name' => 'B'])['json']['sort_order']);
        $this->assertSame(10, $this->post('/portal-expenses', ['month' => '2026-04', 'name' => 'C'])['json']['sort_order']);
        $this->assertSame(0, $this->post('/portal-expenses', ['month' => '2026-05', 'name' => 'D'])['json']['sort_order']);
        $this->assertSame(2, $this->post('/portal-expenses', ['month' => '2026-05', 'name' => 'E', 'sort_order' => 2])['json']['sort_order']);
    }

    public static function invalidMonths(): array
    {
        return [
            'missing'       => [null],
            'empty'         => [''],
            'month 13'      => ['2026-13'],
            'month 00'      => ['2026-00-01'],
            'words'         => ['March 2026'],
            'year too low'  => ['1969-12'],
            'not a string'  => [202603],
        ];
    }

    #[DataProvider('invalidMonths')]
    public function testStoreRejectsInvalidMonth(mixed $month): void
    {
        $body = ['name' => 'X'];
        if ($month !== null) {
            $body['month'] = $month;
        }
        $r = $this->post('/portal-expenses', $body);
        $this->assertStatus(422, $r);
        $this->assertSame('A valid month is required', $r['json']['error']);
    }

    public function testStoreRequiresName(): void
    {
        $r = $this->post('/portal-expenses', ['month' => '2026-03', 'name' => '   ']);
        $this->assertStatus(422, $r);
        $this->assertSame('Name is required', $r['json']['error']);
        $this->assertSame(0, (int) self::dbValue('SELECT COUNT(*) FROM portal_expenses'));
    }

    public function testIndexFiltersByMonthAndOrdersBySortThenId(): void
    {
        $b = $this->seedExpense('2026-03-01', 'B', 1);
        $a = $this->seedExpense('2026-03-01', 'A', 0);
        $c = $this->seedExpense('2026-03-01', 'C', 1);
        $this->seedExpense('2026-04-01', 'April', 0);

        foreach (['2026-03', '2026-03-17'] as $q) {
            $r = $this->get("/portal-expenses?month={$q}");
            $this->assertStatus(200, $r);
            $this->assertSame([$a, $b, $c], array_column($r['json'], 'id'));
            $this->assertSame('2026-03-01', $r['json'][0]['month']);
        }

        $this->assertCount(4, $this->get('/portal-expenses')['json']);
        $this->assertSame([], $this->get('/portal-expenses?month=2026-06')['json']);
    }

    public function testUpdateChangesOnlySuppliedFields(): void
    {
        $id = (int) self::insert('portal_expenses', [
            'month' => '2026-03-01', 'name' => 'Old', 'voice_minutes' => '10', 'total_amount' => '10', 'sort_order' => 3,
        ])['id'];

        $r = $this->put("/portal-expenses/{$id}", ['name' => ' New ', 'voip_shield' => 7.5, 'total_amount' => -4, 'month' => '2030-01']);
        $this->assertStatus(200, $r);
        $e = $r['json'];
        $this->assertSame('New', $e['name']);
        $this->assertEquals(7.5, $e['voip_shield']);
        $this->assertEquals(0, $e['total_amount']);
        $this->assertEquals(10, $e['voice_minutes']);
        $this->assertSame(3, $e['sort_order']);
        // The month is not editable.
        $this->assertSame('2026-03-01', $e['month']);

        $this->assertSame(1, $this->put("/portal-expenses/{$id}", ['sort_order' => '1'])['json']['sort_order']);
    }

    public function testUpdateUnknownRowIs404(): void
    {
        $r = $this->put('/portal-expenses/999', ['name' => 'x']);
        $this->assertStatus(404, $r);
        $this->assertSame('Expense row not found', $r['json']['error']);
    }

    public function testDestroyDeletesRow(): void
    {
        $id   = $this->seedExpense('2026-03-01', 'A');
        $keep = $this->seedExpense('2026-03-01', 'B');
        $this->assertSame(['deleted' => true], $this->delete("/portal-expenses/{$id}")['json']);
        $this->assertSame(['deleted' => false], $this->delete("/portal-expenses/{$id}")['json']);
        $this->assertSame([$keep], array_column($this->get('/portal-expenses')['json'], 'id'));
    }
}
