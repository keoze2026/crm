<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

final class StaffRosterApiTest extends ApiTestCase
{
    use StaffFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        self::resetStaffTables();
    }

    // ─── /staff ────────────────────────────────────────────────────────────────

    public function testIndexListsStaffBySortOrderThenNameWithDepartments(): void
    {
        $ops   = self::departmentRow('Ops', 1);
        $audit = self::departmentRow('Audit', 0);
        $zed   = self::staffRow('zed', ['sort_order' => 0]);
        $amy   = self::staffRow('Amy', ['sort_order' => 0]);
        self::staffRow('Bob', ['sort_order' => -1]);
        self::insert('staff_departments', ['staff_id' => $amy['id'], 'department_id' => $ops['id']]);
        self::insert('staff_departments', ['staff_id' => $amy['id'], 'department_id' => $audit['id']]);

        $r = $this->get('/staff');
        $this->assertStatus(200, $r);
        $this->assertSame(['Bob', 'Amy', 'zed'], array_column($r['json'], 'name'));

        $amyRow = $r['json'][1];
        $this->assertSame((int) $amy['id'], $amyRow['id']);
        $this->assertSame('active', $amyRow['status']);
        $this->assertNull($amyRow['expected_login']);
        $this->assertSame(
            [['id' => (int) $audit['id'], 'name' => 'Audit'], ['id' => (int) $ops['id'], 'name' => 'Ops']],
            $amyRow['departments']
        );
        $this->assertSame([], $r['json'][2]['departments']);
        $this->assertSame((int) $zed['id'], $r['json'][2]['id']);
    }

    public function testStoreRequiresAName(): void
    {
        $r = $this->post('/staff', ['name' => '  ']);
        $this->assertStatus(422, $r);
        $this->assertSame('A name is required', $r['json']['error']);
        $this->assertStatus(422, $this->post('/staff', []));
    }

    public function testStoreCreatesOneNameAndAnswers201(): void
    {
        $r = $this->post('/staff', ['name' => '  Jane Doe ']);
        $this->assertStatus(201, $r);
        $this->assertCount(1, $r['json']['created']);
        $this->assertSame([], $r['json']['existing']);
        $this->assertSame('Jane Doe', $r['json']['created'][0]['name']);
        $this->assertSame('active', $r['json']['created'][0]['status']);
    }

    public function testStoreSplitsAPastedListAndReportsExistingNamesCaseInsensitively(): void
    {
        $old = self::staffRow('Mary Ann');

        $r = $this->post('/staff', ['names' => ["alpha, beta\nMARY ANN", 'Alpha; gamma']]);
        $this->assertStatus(201, $r);
        $created = array_column($r['json']['created'], 'name');
        sort($created);
        $this->assertSame(['alpha', 'beta', 'gamma'], $created);
        $this->assertSame([(int) $old['id']], array_column($r['json']['existing'], 'id'));
        $this->assertSame(4, (int) self::db()->query('SELECT COUNT(*) FROM staff')->fetchColumn());
    }

    public function testStoreOfOnlyExistingNamesAnswers200(): void
    {
        self::staffRow('Kim');
        $r = $this->post('/staff', ['name' => 'kim']);
        $this->assertStatus(200, $r);
        $this->assertSame([], $r['json']['created']);
        $this->assertSame(['Kim'], array_column($r['json']['existing'], 'name'));
    }

    public function testStoreFilesNewAndExistingPeopleUnderTheGivenDepartments(): void
    {
        $dept = self::departmentRow('Sales');
        self::staffRow('Existing');

        $r = $this->post('/staff', ['names' => ['New One', 'Existing'], 'department_ids' => [$dept['id'], 99999]]);
        $this->assertStatus(201, $r);
        $this->assertSame('Sales', $r['json']['created'][0]['departments'][0]['name']);
        $this->assertSame('Sales', $r['json']['existing'][0]['departments'][0]['name']);
        $this->assertSame(2, (int) self::db()->query('SELECT COUNT(*) FROM staff_departments')->fetchColumn());
    }

    public function testStoreLinksTheCheckInAccountByNormalisedName(): void
    {
        self::botAccount(5001, 'Zack Brown |Audit|');
        self::botAccount(5002, 'F 5');
        self::botAccount(5003, 'Someone Else', 'deniis');

        $r = $this->post('/staff', ['names' => ['Zack Brown', 'F.5', 'Denis']]);
        $this->assertStatus(201, $r);
        $links = array_column($r['json']['created'], 'attendance_user_id', 'name');
        $this->assertSame('5001', $links['Zack Brown']);
        $this->assertSame('5002', $links['F.5']);
        $this->assertNull($links['Denis']);
    }

    public function testStoreLinksByUsernameAndPrefersAnExactDisplayName(): void
    {
        self::botAccount(6001, 'Other', 'jdoe');
        self::botAccount(6002, 'J Doe |Ops|');
        self::botAccount(6003, 'jdoe');

        $r = $this->post('/staff', ['name' => 'jdoe']);
        $this->assertSame('6003', $r['json']['created'][0]['attendance_user_id']);
    }

    public function testStoreNeverTakesAnAccountAnotherStaffRowHolds(): void
    {
        self::botAccount(7001, 'Pat');
        self::staffRow('Patrick', ['attendance_user_id' => '7001']);

        $r = $this->post('/staff', ['name' => 'Pat']);
        $this->assertStatus(201, $r);
        $this->assertNull($r['json']['created'][0]['attendance_user_id']);
    }

    public function testUpdateChangesFieldsAndSchedule(): void
    {
        $s = self::staffRow('Lee');
        $r = $this->put("/staff/{$s['id']}", [
            'sort_order'      => 4,
            'status'          => 'LEAVE',
            'expected_login'  => '9:05',
            'expected_logout' => '17:30:00',
        ]);
        $this->assertStatus(200, $r);
        $this->assertSame(4, $r['json']['sort_order']);
        $this->assertSame('leave', $r['json']['status']);
        $this->assertSame('09:05', $r['json']['expected_login']);
        $this->assertSame('17:30', $r['json']['expected_logout']);
        $this->assertSame('Lee', $r['json']['name']);
    }

    public function testUpdateClearsAScheduleOnlyWhenTheKeyIsSent(): void
    {
        $s = self::staffRow('Lee', ['expected_login' => '09:00', 'expected_logout' => '17:00']);

        $r = $this->put("/staff/{$s['id']}", ['expected_login' => null]);
        $this->assertNull($r['json']['expected_login']);
        $this->assertSame('17:00', $r['json']['expected_logout']);

        $r = $this->put("/staff/{$s['id']}", ['expected_logout' => 'not a time']);
        $this->assertNull($r['json']['expected_logout']);
    }

    public function testUpdateTreatsAnUnknownStatusAsActive(): void
    {
        $s = self::staffRow('Lee', ['status' => 'inactive']);
        $r = $this->put("/staff/{$s['id']}", ['status' => 'fired']);
        $this->assertSame('active', $r['json']['status']);
    }

    public function testUpdateRejectsABlankOrDuplicateName(): void
    {
        $a = self::staffRow('Ann');
        self::staffRow('Ben');

        $this->assertStatus(422, $this->put("/staff/{$a['id']}", ['name' => ' ']));
        $r = $this->put("/staff/{$a['id']}", ['name' => ' BEN ']);
        $this->assertStatus(409, $r);
        $this->assertSame('Another staff member is already called that', $r['json']['error']);

        $r = $this->put("/staff/{$a['id']}", ['name' => 'ANN']);
        $this->assertStatus(200, $r);
        $this->assertSame('ANN', $r['json']['name']);
    }

    public function testRenameRelinksTheCheckInAccount(): void
    {
        self::botAccount(8001, 'Old Name');
        self::botAccount(8002, 'New Name');
        $s = self::staffRow('Old Name', ['attendance_user_id' => '8001']);

        $r = $this->put("/staff/{$s['id']}", ['name' => 'New Name']);
        $this->assertSame('8002', $r['json']['attendance_user_id']);

        $r = $this->put("/staff/{$s['id']}", ['name' => 'Nobody']);
        $this->assertNull($r['json']['attendance_user_id']);
    }

    public function testUpdateReplacesTheDepartmentSet(): void
    {
        $a = self::departmentRow('A', 0);
        $b = self::departmentRow('B', 1);
        $s = self::staffRow('Lee');
        self::insert('staff_departments', ['staff_id' => $s['id'], 'department_id' => $a['id']]);

        $r = $this->put("/staff/{$s['id']}", ['department_ids' => [$b['id'], 424242]]);
        $this->assertSame([['id' => (int) $b['id'], 'name' => 'B']], $r['json']['departments']);

        $r = $this->put("/staff/{$s['id']}", ['department_ids' => []]);
        $this->assertSame([], $r['json']['departments']);
    }

    public function testUpdateOfUnknownStaffIs404(): void
    {
        $r = $this->put('/staff/999', ['sort_order' => 1]);
        $this->assertStatus(404, $r);
        $this->assertSame('Staff member not found', $r['json']['error']);
    }

    public function testUpdateOfUnknownStaffWithDepartmentsIs404(): void
    {
        $d = self::departmentRow('Ops');
        $this->assertStatus(404, $this->put('/staff/999', ['department_ids' => [$d['id']]]));
    }

    public function testDestroyCascadesTheirSheetRows(): void
    {
        $d = self::departmentRow('Ops');
        $s = self::staffRow('Gone');
        self::insert('staff_departments', ['staff_id' => $s['id'], 'department_id' => $d['id']]);
        self::insert('staff_attendance', ['staff_id' => $s['id'], 'work_date' => '2026-05-04']);
        self::insert('staff_leaves', ['staff_id' => $s['id'], 'leave_date' => '2026-05-04']);
        self::insert('staff_salaries', ['staff_id' => $s['id'], 'month' => '2026-05-01']);
        self::insert('staff_salary_holds', ['staff_id' => $s['id'], 'month' => '2026-05-01']);

        $r = $this->delete("/staff/{$s['id']}");
        $this->assertStatus(200, $r);
        $this->assertSame(['deleted' => true], $r['json']);
        foreach (['staff', 'staff_departments', 'staff_attendance', 'staff_leaves', 'staff_salaries', 'staff_salary_holds'] as $t) {
            $this->assertSame(0, (int) self::db()->query("SELECT COUNT(*) FROM {$t}")->fetchColumn(), $t);
        }
        $this->assertSame(1, (int) self::db()->query('SELECT COUNT(*) FROM departments')->fetchColumn());

        $this->assertSame(['deleted' => false], $this->delete("/staff/{$s['id']}")['json']);
    }

    // ─── /departments ──────────────────────────────────────────────────────────

    public function testDepartmentsListInOrderWithStaffCounts(): void
    {
        $b = self::departmentRow('Beta', 1);
        $a = self::departmentRow('Alpha', 0);
        $s1 = self::staffRow('One');
        $s2 = self::staffRow('Two');
        self::insert('staff_departments', ['staff_id' => $s1['id'], 'department_id' => $b['id']]);
        self::insert('staff_departments', ['staff_id' => $s2['id'], 'department_id' => $b['id']]);

        $r = $this->get('/departments');
        $this->assertStatus(200, $r);
        $this->assertSame(['Alpha', 'Beta'], array_column($r['json'], 'name'));
        $this->assertSame([0, 2], array_column($r['json'], 'staff_count'));
        $this->assertSame((int) $a['id'], $r['json'][0]['id']);
    }

    public function testStoreDepartmentAppendsAtTheEnd(): void
    {
        self::departmentRow('First', 5);
        $r = $this->post('/departments', ['name' => ' Second ']);
        $this->assertStatus(201, $r);
        $this->assertSame('Second', $r['json']['name']);
        $this->assertSame(6, $r['json']['sort_order']);
        $this->assertSame(0, $r['json']['staff_count']);
    }

    public function testStoreDepartmentValidatesNameAndDuplicates(): void
    {
        self::departmentRow('Ops');
        $this->assertStatus(422, $this->post('/departments', ['name' => '']));
        $r = $this->post('/departments', ['name' => ' ops ']);
        $this->assertStatus(409, $r);
        $this->assertSame('That department is already listed', $r['json']['error']);
    }

    public function testUpdateDepartmentRenames(): void
    {
        $d = self::departmentRow('Ops');
        $r = $this->put("/departments/{$d['id']}", ['name' => 'Operations']);
        $this->assertStatus(200, $r);
        $this->assertSame('Operations', $r['json']['name']);
        $this->assertSame((int) $d['id'], $r['json']['id']);
    }

    public function testUpdateDepartmentValidationConflictAndNotFound(): void
    {
        $d = self::departmentRow('Ops');
        self::departmentRow('Sales');
        $this->assertStatus(422, $this->put("/departments/{$d['id']}", ['name' => ' ']));
        $this->assertStatus(409, $this->put("/departments/{$d['id']}", ['name' => 'SALES']));
        $r = $this->put('/departments/999', ['name' => 'Nothing']);
        $this->assertStatus(404, $r);
        $this->assertSame('Department not found', $r['json']['error']);
    }

    public function testDestroyDepartmentKeepsItsStaff(): void
    {
        $d = self::departmentRow('Ops');
        $s = self::staffRow('Stays');
        self::insert('staff_departments', ['staff_id' => $s['id'], 'department_id' => $d['id']]);

        $this->assertSame(['deleted' => true], $this->delete("/departments/{$d['id']}")['json']);
        $this->assertSame(['deleted' => false], $this->delete("/departments/{$d['id']}")['json']);

        $staff = $this->get('/staff')['json'];
        $this->assertSame('Stays', $staff[0]['name']);
        $this->assertSame([], $staff[0]['departments']);
    }
}
