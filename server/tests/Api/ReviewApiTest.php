<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

final class ReviewApiTest extends ApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('review_entries', 'department_reviews', 'staff_departments', 'departments', 'staff');
    }

    private static function department(string $name, int $sort = 0): int
    {
        return (int) self::insert('departments', ['name' => $name, 'sort_order' => $sort])['id'];
    }

    private static function staff(string $name): int
    {
        return (int) self::insert('staff', ['name' => $name])['id'];
    }

    private function entry(array $body): array
    {
        $r = $this->post('/review-entries', $body + ['kind' => 'performance', 'month' => '2026-08']);
        $this->assertStatus(201, $r);
        return $r['json'];
    }

    // ─── Departments ────────────────────────────────────────────────────────────

    public function testDepartmentsRequireAMonth(): void
    {
        $this->assertStatus(422, $this->get('/review-departments'));
        $this->assertStatus(422, $this->get('/review-departments?month=2026-13'));
        $this->assertStatus(422, $this->get('/review-departments?month=Aug'));
    }

    public function testDepartmentsListEveryDepartmentWithThatMonthsScore(): void
    {
        $sales  = self::department('Sales', 1);
        $agents = self::department('Agents', 0);
        self::insert('department_reviews', ['department_id' => $sales, 'month' => '2026-08-01', 'performance' => 'Good', 'percentage' => '87.5']);
        self::insert('department_reviews', ['department_id' => $sales, 'month' => '2026-07-01', 'performance' => 'Poor', 'percentage' => '40']);

        $r = $this->get('/review-departments?month=2026-08');
        $this->assertStatus(200, $r);
        $this->assertSame(['Agents', 'Sales'], array_column($r['json'], 'name'));
        $this->assertSame($agents, $r['json'][0]['id']);
        $this->assertSame('', $r['json'][0]['performance']);
        $this->assertNull($r['json'][0]['percentage']);
        $this->assertSame('Good', $r['json'][1]['performance']);
        $this->assertSame(87.5, $r['json'][1]['percentage']);

        $july = $this->get('/review-departments?month=2026-07-15')['json'];
        $this->assertSame('Poor', $july[1]['performance']);
    }

    public function testStoreDepartmentWithAScoreForTheMonth(): void
    {
        $r = $this->post('/review-departments', [
            'month' => '2026-08', 'name' => '  Sales ', 'performance' => ' Excellent ', 'percentage' => 150,
        ]);
        $this->assertStatus(201, $r);
        $this->assertSame('Sales', $r['json']['name']);
        $this->assertSame('Excellent', $r['json']['performance']);
        $this->assertEquals(100, $r['json']['percentage']);

        $this->assertSame('', $this->get('/review-departments?month=2026-09')['json'][0]['performance']);
    }

    public function testStoreDepartmentWithoutAScoreWritesNoMonthRow(): void
    {
        $r = $this->post('/review-departments', ['month' => '2026-08', 'name' => 'Sales']);
        $this->assertStatus(201, $r);
        $this->assertNull($r['json']['percentage']);
        $this->assertSame(0, (int) self::db()->query('SELECT count(*) FROM department_reviews')->fetchColumn());
    }

    public function testStoreDepartmentAppendsSortOrder(): void
    {
        self::department('A', 7);
        $r = $this->post('/review-departments', ['month' => '2026-08', 'name' => 'B']);
        $this->assertSame(8, $r['json']['sort_order']);
        $r = $this->post('/review-departments', ['month' => '2026-08', 'name' => 'C', 'sort_order' => 2]);
        $this->assertSame(2, $r['json']['sort_order']);
    }

    public function testStoreDepartmentValidation(): void
    {
        self::department('Sales');
        $this->assertStatus(422, $this->post('/review-departments', ['name' => 'X']));
        $this->assertStatus(422, $this->post('/review-departments', ['month' => '2026-08', 'name' => '  ']));
        $this->assertStatus(409, $this->post('/review-departments', ['month' => '2026-08', 'name' => ' sales']));
    }

    public function testUpdateDepartmentScoresOnlyTheGivenMonth(): void
    {
        $id = self::department('Sales');
        $r  = $this->put("/review-departments/{$id}", ['month' => '2026-08', 'performance' => 'Average', 'percentage' => '-5']);
        $this->assertStatus(200, $r);
        $this->assertSame('Average', $r['json']['performance']);
        $this->assertEquals(0, $r['json']['percentage']);

        $r = $this->put("/review-departments/{$id}", ['month' => '2026-08', 'performance' => 'Good', 'percentage' => '']);
        $this->assertSame('Good', $r['json']['performance']);
        $this->assertNull($r['json']['percentage']);

        $this->put("/review-departments/{$id}", ['month' => '2026-09', 'performance' => 'Poor']);
        $this->assertSame('Good', $this->get('/review-departments?month=2026-08')['json'][0]['performance']);
        $this->assertSame(2, (int) self::db()->query('SELECT count(*) FROM department_reviews')->fetchColumn());
    }

    public function testUpdateDepartmentRenameAndReorderLeaveScoresAlone(): void
    {
        $id = self::department('Sales');
        self::insert('department_reviews', ['department_id' => $id, 'month' => '2026-08-01', 'performance' => 'Good', 'percentage' => '90']);

        $r = $this->put("/review-departments/{$id}", ['month' => '2026-08', 'name' => 'Sales Team', 'sort_order' => 4]);
        $this->assertStatus(200, $r);
        $this->assertSame('Sales Team', $r['json']['name']);
        $this->assertSame(4, $r['json']['sort_order']);
        $this->assertSame('Good', $r['json']['performance']);
        $this->assertEquals(90, $r['json']['percentage']);
    }

    public function testUpdateDepartmentValidation(): void
    {
        $id = self::department('Sales');
        self::department('Agents');
        $this->assertStatus(422, $this->put("/review-departments/{$id}", ['name' => 'X']));
        $this->assertStatus(422, $this->put("/review-departments/{$id}", ['month' => '2026-08', 'name' => '']));
        $this->assertStatus(409, $this->put("/review-departments/{$id}", ['month' => '2026-08', 'name' => 'AGENTS']));
        $this->assertStatus(200, $this->put("/review-departments/{$id}", ['month' => '2026-08', 'name' => 'SALES']));
        $this->assertStatus(404, $this->put('/review-departments/9999', ['month' => '2026-08', 'name' => 'New']));
    }

    public function testDestroyDepartmentKeepsItsEntriesUnfiledAndDropsItsScores(): void
    {
        $id = self::department('Sales');
        self::insert('department_reviews', ['department_id' => $id, 'month' => '2026-08-01', 'performance' => 'Good']);
        $entry = $this->entry(['person_name' => 'Alice', 'department_id' => $id]);
        $this->assertSame($id, $entry['department_id']);

        $this->assertSame(['deleted' => true], $this->delete("/review-departments/{$id}")['json']);
        $rows = $this->get('/review-entries?kind=performance&month=2026-08')['json'];
        $this->assertCount(1, $rows);
        $this->assertNull($rows[0]['department_id']);
        $this->assertSame(0, (int) self::db()->query('SELECT count(*) FROM department_reviews')->fetchColumn());
        $this->assertSame(['deleted' => false], $this->delete("/review-departments/{$id}")['json']);
    }

    // ─── Entries ────────────────────────────────────────────────────────────────

    public function testEntriesRequireAKnownKind(): void
    {
        $this->assertStatus(422, $this->get('/review-entries'));
        $this->assertStatus(422, $this->get('/review-entries?kind=attendance'));
        $this->assertStatus(200, $this->get('/review-entries?kind=Performance'));
    }

    public function testStorePerformanceEntryLinksStaffByNameAndClampsPercentage(): void
    {
        $alice = self::staff('Alice Smith');
        $dept  = self::department('Sales');

        $row = $this->entry([
            'person_name'     => '  alice smith ',
            'department_id'   => $dept,
            'department_note' => ' Closer ',
            'rating'          => ' Excellent ',
            'percentage'      => '120',
            'notes'           => "  Line one\nLine two  ",
            'month'           => '2026-08-17',
        ]);
        $this->assertSame('performance', $row['kind']);
        $this->assertSame('alice smith', $row['person_name']);
        $this->assertSame($alice, $row['staff_id']);
        $this->assertSame($dept, $row['department_id']);
        $this->assertSame('Closer', $row['department_note']);
        $this->assertSame('Excellent', $row['rating']);
        $this->assertEquals(100, $row['percentage']);
        $this->assertSame("Line one\nLine two", $row['notes']);
        $this->assertSame('2026-08-01', $row['month']);
        $this->assertSame(0, $row['sort_order']);
    }

    public function testStoreEntryPrefersAnExplicitStaffIdAndKeepsTheTypedName(): void
    {
        self::staff('Alice');
        $bob = self::staff('Bob');
        $row = $this->entry(['person_name' => 'Alice', 'staff_id' => $bob]);
        $this->assertSame($bob, $row['staff_id']);
        $this->assertSame('Alice', $row['person_name']);
    }

    public function testStoreEntryForSomeoneOffTheRosterIsUnlinked(): void
    {
        $row = $this->entry(['person_name' => 'Stranger', 'staff_id' => 9999, 'department_id' => 9999]);
        $this->assertNull($row['staff_id']);
        $this->assertNull($row['department_id']);
        $this->assertSame('Stranger', $row['person_name']);
    }

    public function testBehaviourEntriesNeverCarryAPercentage(): void
    {
        $row = $this->entry(['kind' => 'behaviour', 'person_name' => 'Alice', 'rating' => 'Good', 'percentage' => 70]);
        $this->assertSame('behaviour', $row['kind']);
        $this->assertNull($row['percentage']);
        $this->assertSame('Good', $row['rating']);
    }

    public function testStoreEntryCapsLabelAndNoteLengths(): void
    {
        $row = $this->entry([
            'person_name' => 'Alice',
            'rating'      => str_repeat('r', 300),
            'notes'       => str_repeat('n', 3000),
        ]);
        $this->assertSame(120, mb_strlen($row['rating']));
        $this->assertSame(2000, mb_strlen($row['notes']));
    }

    public function testStoreEntryValidation(): void
    {
        $this->assertStatus(422, $this->post('/review-entries', ['person_name' => 'A', 'month' => '2026-08']));
        $this->assertStatus(422, $this->post('/review-entries', ['kind' => 'other', 'person_name' => 'A', 'month' => '2026-08']));
        $this->assertStatus(422, $this->post('/review-entries', ['kind' => 'performance', 'person_name' => ' ', 'month' => '2026-08']));
        $this->assertStatus(422, $this->post('/review-entries', ['kind' => 'performance', 'person_name' => 'A']));
        $this->assertStatus(422, $this->post('/review-entries', ['kind' => 'behaviour', 'person_name' => 'A', 'month' => '1969-12']));
        $this->assertSame(0, (int) self::db()->query('SELECT count(*) FROM review_entries')->fetchColumn());
    }

    public function testSortOrderIsCountedPerKind(): void
    {
        $this->assertSame(0, $this->entry(['person_name' => 'A'])['sort_order']);
        $this->assertSame(1, $this->entry(['person_name' => 'B'])['sort_order']);
        $this->assertSame(0, $this->entry(['kind' => 'behaviour', 'person_name' => 'C'])['sort_order']);
        $this->assertSame(9, $this->entry(['person_name' => 'D', 'sort_order' => 9])['sort_order']);
    }

    public function testEntriesAreFilteredByKindAndMonthAndOrdered(): void
    {
        $this->entry(['person_name' => 'Late', 'sort_order' => 5]);
        $this->entry(['person_name' => 'Early', 'sort_order' => 1]);
        $this->entry(['person_name' => 'Tie', 'sort_order' => 5]);
        $this->entry(['person_name' => 'July', 'month' => '2026-07']);
        $this->entry(['kind' => 'behaviour', 'person_name' => 'Behave']);

        $aug = $this->get('/review-entries?kind=performance&month=2026-08')['json'];
        $this->assertSame(['Early', 'Late', 'Tie'], array_column($aug, 'person_name'));

        $all = $this->get('/review-entries?kind=performance')['json'];
        $this->assertCount(4, $all);

        $this->assertSame(['Behave'], array_column($this->get('/review-entries?kind=behaviour&month=2026-08')['json'], 'person_name'));
        // An unreadable month is ignored rather than narrowing to nothing.
        $this->assertCount(4, $this->get('/review-entries?kind=performance&month=garbage')['json']);
    }

    public function testUpdateEntryChangesOnlyTheFieldsSent(): void
    {
        $dept = self::department('Sales');
        $row  = $this->entry(['person_name' => 'Alice', 'department_id' => $dept, 'rating' => 'Good', 'percentage' => 80, 'notes' => 'n']);

        $r = $this->put("/review-entries/{$row['id']}", ['rating' => 'Excellent']);
        $this->assertStatus(200, $r);
        $this->assertSame('Excellent', $r['json']['rating']);
        $this->assertSame($dept, $r['json']['department_id']);
        $this->assertEquals(80, $r['json']['percentage']);
        $this->assertSame('n', $r['json']['notes']);
        $this->assertSame('Alice', $r['json']['person_name']);
        $this->assertSame('2026-08-01', $r['json']['month']);
    }

    public function testUpdateEntryCanClearDepartmentPercentageAndNotes(): void
    {
        $dept = self::department('Sales');
        $row  = $this->entry(['person_name' => 'Alice', 'department_id' => $dept, 'percentage' => 80, 'notes' => 'n']);

        $r = $this->put("/review-entries/{$row['id']}", ['department_id' => null, 'percentage' => null, 'notes' => '']);
        $this->assertStatus(200, $r);
        $this->assertNull($r['json']['department_id']);
        $this->assertNull($r['json']['percentage']);
        $this->assertSame('', $r['json']['notes']);
    }

    public function testUpdateEntryRepointsTheStaffLinkWithTheName(): void
    {
        $alice = self::staff('Alice');
        $bob   = self::staff('Bob');
        $row   = $this->entry(['person_name' => 'Alice']);
        $this->assertSame($alice, $row['staff_id']);

        $r = $this->put("/review-entries/{$row['id']}", ['person_name' => 'bob']);
        $this->assertSame('bob', $r['json']['person_name']);
        $this->assertSame($bob, $r['json']['staff_id']);

        $r = $this->put("/review-entries/{$row['id']}", ['person_name' => 'Nobody']);
        $this->assertNull($r['json']['staff_id']);

        $r = $this->put("/review-entries/{$row['id']}", ['staff_id' => $alice]);
        $this->assertSame($alice, $r['json']['staff_id']);
        $this->assertSame('Nobody', $r['json']['person_name']);
    }

    public function testUpdateEntryMovesItToAnotherMonthAndPosition(): void
    {
        $row = $this->entry(['person_name' => 'Alice']);
        $r   = $this->put("/review-entries/{$row['id']}", ['month' => '2026-07', 'sort_order' => 3]);
        $this->assertSame('2026-07-01', $r['json']['month']);
        $this->assertSame(3, $r['json']['sort_order']);
        $this->assertSame([], $this->get('/review-entries?kind=performance&month=2026-08')['json']);
    }

    public function testUpdateEntryRefusesAnUnreadableMonthInsteadOfDroppingIt(): void
    {
        $row = $this->entry(['person_name' => 'Alice']);

        $r = $this->put("/review-entries/{$row['id']}", ['month' => 'not-a-month']);
        $this->assertStatus(422, $r);
        $this->assertSame(
            '2026-08-01',
            self::db()->query("SELECT to_char(month, 'YYYY-MM-DD') FROM review_entries WHERE id = {$row['id']}")->fetchColumn()
        );
    }

    public function testUpdateUnknownEntryIs404(): void
    {
        $this->assertStatus(404, $this->put('/review-entries/9999', ['rating' => 'Good']));
    }

    public function testDestroyEntry(): void
    {
        $row = $this->entry(['person_name' => 'Alice']);
        $this->assertSame(['deleted' => true], $this->delete("/review-entries/{$row['id']}")['json']);
        $this->assertSame(['deleted' => false], $this->delete("/review-entries/{$row['id']}")['json']);
        $this->assertSame([], $this->get('/review-entries?kind=performance')['json']);
    }

    public function testRemovingStaffKeepsTheirReviewsWithTheWrittenName(): void
    {
        $alice = self::staff('Alice');
        $row   = $this->entry(['person_name' => 'Alice']);
        self::db()->exec("DELETE FROM staff WHERE id = {$alice}");

        $rows = $this->get('/review-entries?kind=performance&month=2026-08')['json'];
        $this->assertSame($row['id'], $rows[0]['id']);
        $this->assertNull($rows[0]['staff_id']);
        $this->assertSame('Alice', $rows[0]['person_name']);
    }
}
