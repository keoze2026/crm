<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

/** The Leaves, Salaries and Salary Hold sheets of the Staff page. */
final class StaffSheetsApiTest extends ApiTestCase
{
    use StaffFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        self::resetStaffTables();
    }

    // ─── /staff-leaves ─────────────────────────────────────────────────────────

    public function testLeavesListTheRangeByDateThenOrder(): void
    {
        $s = self::staffRow('Amy');
        $d = self::departmentRow('Ops');
        self::insert('staff_leaves', ['staff_id' => $s['id'], 'leave_date' => '2026-05-10', 'sort_order' => 0]);
        self::insert('staff_leaves', ['staff_id' => $s['id'], 'leave_date' => '2026-05-03', 'sort_order' => 2, 'department_id' => $d['id'], 'sick_leave' => 'flu']);
        self::insert('staff_leaves', ['staff_id' => $s['id'], 'leave_date' => '2026-05-03', 'sort_order' => 1]);
        self::insert('staff_leaves', ['staff_id' => $s['id'], 'leave_date' => '2026-06-01']);

        $r = $this->get('/staff-leaves?from=2026-05-01&to=2026-05-31');
        $this->assertStatus(200, $r);
        $this->assertSame(['2026-05-03', '2026-05-03', '2026-05-10'], array_column($r['json'], 'leave_date'));
        $this->assertSame([1, 2, 0], array_column($r['json'], 'sort_order'));
        $this->assertSame('Ops', $r['json'][1]['department_name']);
        $this->assertSame((int) $d['id'], $r['json'][1]['department_id']);
        $this->assertSame('flu', $r['json'][1]['sick_leave']);
        $this->assertSame('Amy', $r['json'][0]['staff_name']);
        $this->assertNull($r['json'][0]['department_id']);
    }

    public function testStoreLeaveValidatesStaffAndDate(): void
    {
        $s = self::staffRow('Amy');
        $this->assertStatus(422, $this->post('/staff-leaves', ['staff_id' => 404, 'leave_date' => '2026-05-01']));
        $r = $this->post('/staff-leaves', ['staff_id' => $s['id'], 'leave_date' => '05/01/2026']);
        $this->assertStatus(422, $r);
        $this->assertSame('A date is required', $r['json']['error']);
    }

    public function testStoreLeaveKeepsMarkersAndReturnDates(): void
    {
        $s = self::staffRow('Amy');
        $d = self::departmentRow('Ops');
        self::insert('staff_leaves', ['staff_id' => $s['id'], 'leave_date' => '2026-05-01', 'sort_order' => 7]);

        $r = $this->post('/staff-leaves', [
            'staff_id'        => $s['id'],
            'department_id'   => $d['id'],
            'leave_date'      => '2026-05-04',
            'sick_leave'      => ' Yes ',
            'half_day'        => 'AM',
            'aob'             => str_repeat('x', 300),
            'expected_return' => '2026-05-06',
            'actual_return'   => 'soon',
        ]);
        $this->assertStatus(201, $r);
        $row = $r['json'];
        $this->assertSame('Yes', $row['sick_leave']);
        $this->assertSame('AM', $row['half_day']);
        $this->assertSame('', $row['break_leave']);
        $this->assertSame(200, mb_strlen($row['aob']));
        $this->assertSame('2026-05-06', $row['expected_return']);
        $this->assertNull($row['actual_return']);
        $this->assertSame(8, $row['sort_order']);
        $this->assertSame('Ops', $row['department_name']);
    }

    public function testStoreLeaveDropsAnUnknownDepartment(): void
    {
        $s = self::staffRow('Amy');
        $r = $this->post('/staff-leaves', ['staff_id' => $s['id'], 'leave_date' => '2026-05-04', 'department_id' => 999]);
        $this->assertStatus(201, $r);
        $this->assertNull($r['json']['department_id']);
    }

    public function testUpdateLeavePatchesAndClearsReturnDates(): void
    {
        $a = self::staffRow('Amy');
        $b = self::staffRow('Bob');
        $d = self::departmentRow('Ops');
        $l = self::insert('staff_leaves', [
            'staff_id' => $a['id'], 'department_id' => $d['id'], 'leave_date' => '2026-05-04',
            'sick_leave' => 'yes', 'expected_return' => '2026-05-06', 'actual_return' => '2026-05-07',
        ]);

        $r = $this->put("/staff-leaves/{$l['id']}", [
            'staff_id'        => $b['id'],
            'late_login'      => '20m',
            'expected_return' => null,
            'leave_date'      => 'garbage',
        ]);
        $this->assertStatus(200, $r);
        $this->assertSame('Bob', $r['json']['staff_name']);
        $this->assertSame('20m', $r['json']['late_login']);
        $this->assertSame('yes', $r['json']['sick_leave']);
        $this->assertSame('2026-05-04', $r['json']['leave_date']);
        $this->assertNull($r['json']['expected_return']);
        $this->assertSame('2026-05-07', $r['json']['actual_return']);
        $this->assertSame((int) $d['id'], $r['json']['department_id']);

        $r = $this->put("/staff-leaves/{$l['id']}", ['department_id' => null, 'leave_date' => '2026-05-05']);
        $this->assertNull($r['json']['department_id']);
        $this->assertSame('2026-05-05', $r['json']['leave_date']);
    }

    public function testUpdateLeaveRejectsAnUnknownStaffAndMissingRow(): void
    {
        $s = self::staffRow('Amy');
        $l = self::insert('staff_leaves', ['staff_id' => $s['id'], 'leave_date' => '2026-05-04']);
        $this->assertStatus(422, $this->put("/staff-leaves/{$l['id']}", ['staff_id' => 999]));
        $r = $this->put('/staff-leaves/999', ['aob' => 'x']);
        $this->assertStatus(404, $r);
        $this->assertSame('Leave row not found', $r['json']['error']);
    }

    public function testDestroyLeave(): void
    {
        $s = self::staffRow('Amy');
        $l = self::insert('staff_leaves', ['staff_id' => $s['id'], 'leave_date' => '2026-05-04']);
        $this->assertSame(['deleted' => true], $this->delete("/staff-leaves/{$l['id']}")['json']);
        $this->assertSame(['deleted' => false], $this->delete("/staff-leaves/{$l['id']}")['json']);
    }

    // ─── /staff-salaries ───────────────────────────────────────────────────────

    public function testSalariesRequireAValidMonth(): void
    {
        $this->assertStatus(422, $this->get('/staff-salaries'));
        $r = $this->get('/staff-salaries?month=2026-13');
        $this->assertStatus(422, $r);
        $this->assertSame('month must be YYYY-MM', $r['json']['error']);
    }

    public function testSalariesListOneMonthInSheetOrder(): void
    {
        $a = self::staffRow('Amy');
        $b = self::staffRow('Bob');
        self::insert('staff_salaries', ['staff_id' => $a['id'], 'month' => '2026-05-01', 'sort_order' => 2, 'amount' => '1500.50', 'status' => 'Received']);
        self::insert('staff_salaries', ['staff_id' => $b['id'], 'month' => '2026-05-01', 'sort_order' => 1]);
        self::insert('staff_salaries', ['staff_id' => $a['id'], 'month' => '2026-04-01']);

        $r = $this->get('/staff-salaries?month=2026-05-17');
        $this->assertStatus(200, $r);
        $this->assertSame(['Bob', 'Amy'], array_column($r['json'], 'staff_name'));
        $this->assertSame('2026-05-01', $r['json'][1]['month']);
        $this->assertSame(1500.5, $r['json'][1]['amount']);
        $this->assertNull($r['json'][0]['amount']);
        $this->assertSame('Received', $r['json'][1]['status']);
    }

    public function testStoreSalaryValidates(): void
    {
        $s = self::staffRow('Amy');
        $this->assertStatus(422, $this->post('/staff-salaries', ['staff_id' => 0, 'month' => '2026-05']));
        $this->assertStatus(422, $this->post('/staff-salaries', ['staff_id' => $s['id'], 'month' => 'May']));
    }

    public function testStoreSalaryUpsertsOneRowPerPersonPerMonth(): void
    {
        $s = self::staffRow('Amy');
        $d = self::departmentRow('Ops');

        $first = $this->post('/staff-salaries', [
            'staff_id' => $s['id'], 'month' => '2026-05', 'amount' => '1234.567', 'status' => 'Pending', 'department_id' => $d['id'],
        ]);
        $this->assertStatus(201, $first);
        $this->assertSame(1234.57, $first['json']['amount']);
        $this->assertSame('2026-05-01', $first['json']['month']);
        $this->assertSame('Ops', $first['json']['department_name']);

        $second = $this->post('/staff-salaries', ['staff_id' => $s['id'], 'month' => '2026-05-20', 'amount' => '', 'status' => 'Received']);
        $this->assertSame($first['json']['id'], $second['json']['id']);
        $this->assertNull($second['json']['amount']);
        $this->assertSame('Received', $second['json']['status']);
        $this->assertNull($second['json']['department_id']);
        $this->assertSame(1, (int) self::db()->query('SELECT COUNT(*) FROM staff_salaries')->fetchColumn());
    }

    public function testUpdateSalaryPatchesAndClearsAmount(): void
    {
        $s = self::staffRow('Amy');
        $d = self::departmentRow('Ops');
        $row = self::insert('staff_salaries', [
            'staff_id' => $s['id'], 'month' => '2026-05-01', 'amount' => '100', 'status' => 'Pending', 'note' => 'n', 'department_id' => $d['id'],
        ]);

        $r = $this->put("/staff-salaries/{$row['id']}", ['status' => 'Received']);
        $this->assertStatus(200, $r);
        $this->assertSame('Received', $r['json']['status']);
        $this->assertEquals(100, $r['json']['amount']);
        $this->assertSame('n', $r['json']['note']);
        $this->assertSame((int) $d['id'], $r['json']['department_id']);

        $r = $this->put("/staff-salaries/{$row['id']}", ['amount' => null, 'department_id' => null]);
        $this->assertNull($r['json']['amount']);
        $this->assertNull($r['json']['department_id']);
    }

    public function testUpdateSalaryUnknownRowIs404(): void
    {
        $r = $this->put('/staff-salaries/999', ['status' => 'x']);
        $this->assertStatus(404, $r);
        $this->assertSame('Salary row not found', $r['json']['error']);
    }

    public function testDestroySalary(): void
    {
        $s = self::staffRow('Amy');
        $row = self::insert('staff_salaries', ['staff_id' => $s['id'], 'month' => '2026-05-01']);
        $this->assertSame(['deleted' => true], $this->delete("/staff-salaries/{$row['id']}")['json']);
        $this->assertSame(['deleted' => false], $this->delete("/staff-salaries/{$row['id']}")['json']);
    }

    // ─── /staff-salary-holds ───────────────────────────────────────────────────

    public function testSalaryHoldsListEveryMonthNewestFirst(): void
    {
        $s = self::staffRow('Amy');
        self::insert('staff_salary_holds', ['staff_id' => $s['id'], 'month' => '2026-03-01', 'reason' => 'old']);
        self::insert('staff_salary_holds', ['staff_id' => $s['id'], 'month' => '2026-05-01', 'reason' => 'b', 'sort_order' => 2]);
        self::insert('staff_salary_holds', ['staff_id' => $s['id'], 'month' => '2026-05-01', 'reason' => 'a', 'sort_order' => 1]);

        $r = $this->get('/staff-salary-holds');
        $this->assertStatus(200, $r);
        $this->assertSame(['a', 'b', 'old'], array_column($r['json'], 'reason'));
        $this->assertSame('2026-05-01', $r['json'][0]['month']);
        $this->assertSame('On Hold', $r['json'][0]['status']);
        $this->assertSame('Amy', $r['json'][0]['staff_name']);
    }

    public function testStoreSalaryHoldDefaultsToOnHoldAndKeepsLineBreaks(): void
    {
        $s = self::staffRow('Amy');
        self::insert('staff_salary_holds', ['staff_id' => $s['id'], 'month' => '2026-01-01', 'sort_order' => 3]);

        $r = $this->post('/staff-salary-holds', ['staff_id' => $s['id'], 'month' => '2026-05', 'reason' => " line one\nline two "]);
        $this->assertStatus(201, $r);
        $this->assertSame('On Hold', $r['json']['status']);
        $this->assertSame("line one\nline two", $r['json']['reason']);
        $this->assertSame('2026-05-01', $r['json']['month']);
        $this->assertSame(4, $r['json']['sort_order']);

        $again = $this->post('/staff-salary-holds', ['staff_id' => $s['id'], 'month' => '2026-05', 'status' => 'Disbursed']);
        $this->assertStatus(201, $again);
        $this->assertNotSame($r['json']['id'], $again['json']['id']);
        $this->assertSame('Disbursed', $again['json']['status']);
    }

    public function testStoreSalaryHoldValidates(): void
    {
        $s = self::staffRow('Amy');
        $this->assertStatus(422, $this->post('/staff-salary-holds', ['staff_id' => 999, 'month' => '2026-05']));
        $this->assertStatus(422, $this->post('/staff-salary-holds', ['staff_id' => $s['id'], 'month' => '2026-00']));
        $r = $this->post('/staff-salary-holds', ['staff_id' => $s['id'], 'month' => '2026-05', 'status' => 'Paid']);
        $this->assertStatus(422, $r);
        $this->assertSame('status must be "On Hold" or "Disbursed"', $r['json']['error']);
        $this->assertSame(0, (int) self::db()->query('SELECT COUNT(*) FROM staff_salary_holds')->fetchColumn());
    }

    public function testUpdateSalaryHoldRepointsAndResolves(): void
    {
        $a = self::staffRow('Amy');
        $b = self::staffRow('Bob');
        $h = self::insert('staff_salary_holds', ['staff_id' => $a['id'], 'month' => '2026-05-01', 'reason' => 'why']);

        $r = $this->put("/staff-salary-holds/{$h['id']}", ['staff_id' => $b['id'], 'month' => '2026-06', 'status' => 'Disbursed']);
        $this->assertStatus(200, $r);
        $this->assertSame('Bob', $r['json']['staff_name']);
        $this->assertSame('2026-06-01', $r['json']['month']);
        $this->assertSame('Disbursed', $r['json']['status']);
        $this->assertSame('why', $r['json']['reason']);
    }

    public function testUpdateSalaryHoldValidatesAndReports404(): void
    {
        $s = self::staffRow('Amy');
        $h = self::insert('staff_salary_holds', ['staff_id' => $s['id'], 'month' => '2026-05-01']);

        $this->assertStatus(422, $this->put("/staff-salary-holds/{$h['id']}", ['month' => '']));
        $this->assertStatus(422, $this->put("/staff-salary-holds/{$h['id']}", ['staff_id' => 999]));
        $this->assertStatus(422, $this->put("/staff-salary-holds/{$h['id']}", ['status' => 'on hold']));
        $r = $this->put('/staff-salary-holds/999', ['reason' => 'x']);
        $this->assertStatus(404, $r);
        $this->assertSame('Salary hold row not found', $r['json']['error']);
    }

    public function testDestroySalaryHold(): void
    {
        $s = self::staffRow('Amy');
        $h = self::insert('staff_salary_holds', ['staff_id' => $s['id'], 'month' => '2026-05-01']);
        $this->assertSame(['deleted' => true], $this->delete("/staff-salary-holds/{$h['id']}")['json']);
        $this->assertSame(['deleted' => false], $this->delete("/staff-salary-holds/{$h['id']}")['json']);
    }
}
