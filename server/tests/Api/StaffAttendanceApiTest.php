<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

/** The Staff page's Complete Attendance sheet: /staff-attendance. */
final class StaffAttendanceApiTest extends ApiTestCase
{
    use StaffFixtures;

    private const DAY = '2026-05-04';

    protected function setUp(): void
    {
        parent::setUp();
        self::resetStaffTables();
    }

    /** A staff member linked to bot account $userId. */
    private static function linkedStaff(string $name, int $userId): array
    {
        self::botAccount($userId, $name);
        return self::staffRow($name, ['attendance_user_id' => (string) $userId]);
    }

    private function sheet(string $query = ''): array
    {
        $r = $this->get('/staff-attendance?from=2026-05-01&to=2026-05-31' . $query);
        $this->assertStatus(200, $r);
        return $r['json'];
    }

    public function testListShowsABotDayAsFetchedWithLocalTimesAndTheBotsBreakTotal(): void
    {
        $s = self::linkedStaff('Alice', 1001);
        self::botDay(1001, self::DAY, '09:12', '17:40');
        self::botBreak(1001, self::DAY, '12:00', '12:30', 30);
        self::botBreak(1001, self::DAY, '15:00', '15:15', 15);

        $json = $this->sheet();
        $this->assertSame('America/New_York', $json['timezone']);
        $this->assertTrue($json['fetched']);
        $this->assertSame('2026-05-01', $json['from']);
        $this->assertCount(1, $json['rows']);
        $this->assertSame([
            'id'         => null,
            'source'     => 'fetched',
            'edited'     => false,
            'staff_id'   => (int) $s['id'],
            'staff_name' => 'Alice',
            'work_date'  => self::DAY,
            'login_at'   => '09:12',
            'logout_at'  => '17:40',
            'break_min'  => 45,
            'status'     => 'present',
            'note'       => '',
        ], $json['rows'][0]);
    }

    public function testACorrectionWithABlankBreakFallsBackToTheBotsBreaks(): void
    {
        $s = self::linkedStaff('Alice', 1001);
        self::botDay(1001, self::DAY, '09:12', '17:40');
        self::botBreak(1001, self::DAY, '12:00', '12:30', 30);

        $r = $this->post('/staff-attendance', [
            'staff_id' => (int) $s['id'], 'work_date' => self::DAY,
            'login_at' => '09:00', 'logout_at' => '17:40', 'break_min' => null, 'status' => 'present',
        ]);
        $this->assertStatus(201, $r);
        $this->assertSame('09:00', $r['json']['login_at']);
        $this->assertSame(30, $r['json']['break_min']);

        // A break typed in replaces the bot's; cleared again, the bot's total is back.
        $id = $r['json']['id'];
        $this->assertSame(10, $this->put("/staff-attendance/{$id}", ['break_min' => 10])['json']['break_min']);
        $this->assertSame(10, $this->put("/staff-attendance/{$id}", ['note' => 'late bus'])['json']['break_min'], 'not sent keeps it');
        $this->assertSame(30, $this->put("/staff-attendance/{$id}", ['break_min' => ''])['json']['break_min'], 'blank falls back');

        $roster = $this->get('/attendance/roster?date=' . self::DAY)['json'];
        $row = array_values(array_filter($roster['rows'] ?? $roster, static fn ($d) => ($d['staff_name'] ?? null) === 'Alice'))[0];
        $this->assertSame(30, $row['break_min'], 'the Attendance page agrees');
    }

    public function testFetchedStatusFollowsTheClockTimes(): void
    {
        self::linkedStaff('In', 1);
        self::linkedStaff('Away', 2);
        self::botDay(1, self::DAY, '09:00', null);
        self::botDay(2, self::DAY, null, null);

        $status = array_column($this->sheet()['rows'], 'status', 'staff_name');
        $this->assertSame(['Away' => 'absent', 'In' => 'still in'], $status);
    }

    public function testBotDaysOfUnlinkedAccountsAreNotListed(): void
    {
        self::botAccount(77, 'Stranger');
        self::botDay(77, self::DAY, '09:00', '17:00');
        $this->assertSame([], $this->sheet()['rows']);
    }

    public function testListMergesHandKeyedDaysSortedByDateDescThenName(): void
    {
        $b = self::staffRow('bob');
        $a = self::staffRow('Amy');
        self::insert('staff_attendance', ['staff_id' => $b['id'], 'work_date' => '2026-05-02', 'login_at' => '10:00']);
        self::insert('staff_attendance', ['staff_id' => $a['id'], 'work_date' => '2026-05-02', 'status' => 'absent']);
        self::insert('staff_attendance', ['staff_id' => $a['id'], 'work_date' => '2026-05-05', 'note' => 'late bus']);
        self::insert('staff_attendance', ['staff_id' => $a['id'], 'work_date' => '2026-06-01']);

        $rows = $this->sheet()['rows'];
        $this->assertSame(
            [['2026-05-05', 'Amy'], ['2026-05-02', 'Amy'], ['2026-05-02', 'bob']],
            array_map(fn ($r) => [$r['work_date'], $r['staff_name']], $rows)
        );
        $this->assertSame('manual', $rows[0]['source']);
        $this->assertTrue($rows[0]['edited']);
        $this->assertIsInt($rows[0]['id']);
        $this->assertSame('late bus', $rows[0]['note']);
        $this->assertSame('10:00', $rows[2]['login_at']);
        $this->assertSame(0, $rows[2]['break_min']);
    }

    public function testListFiltersByStaffId(): void
    {
        $a = self::linkedStaff('Amy', 1);
        $b = self::linkedStaff('Bob', 2);
        self::botDay(1, self::DAY, '09:00', '17:00');
        self::botDay(2, self::DAY, '09:00', '17:00');
        self::insert('staff_attendance', ['staff_id' => $b['id'], 'work_date' => '2026-05-06']);

        $rows = $this->sheet("&staff_id={$a['id']}")['rows'];
        $this->assertSame(['Amy'], array_column($rows, 'staff_name'));
    }

    public function testMalformedRangeFallsBackToDefaults(): void
    {
        $r = $this->get('/staff-attendance?from=2026-02-30&to=nope');
        $this->assertStatus(200, $r);
        $this->assertSame(date('Y-m-01'), $r['json']['from']);
        $this->assertSame(date('Y-m-d'), $r['json']['to']);
    }

    public function testOverrideReplacesTheBotDayAndTheManualDuplicateIsDropped(): void
    {
        $s = self::linkedStaff('Alice', 1001);
        self::botDay(1001, self::DAY, '09:12', '17:40');
        self::botBreak(1001, self::DAY, '12:00', '12:30', 30);
        $o = self::insert('staff_attendance', [
            'staff_id' => $s['id'], 'work_date' => self::DAY,
            'login_at' => '08:55', 'logout_at' => null, 'break_min' => 10,
            'status' => 'half day', 'note' => 'fixed',
        ]);

        $rows = $this->sheet()['rows'];
        $this->assertCount(1, $rows);
        $this->assertSame((int) $o['id'], $rows[0]['id']);
        $this->assertSame('fetched', $rows[0]['source']);
        $this->assertTrue($rows[0]['edited']);
        $this->assertSame('08:55', $rows[0]['login_at']);
        $this->assertNull($rows[0]['logout_at']);
        $this->assertSame(10, $rows[0]['break_min']);
        $this->assertSame('half day', $rows[0]['status']);
        $this->assertSame('fixed', $rows[0]['note']);
    }

    public function testStoreValidatesStaffAndDate(): void
    {
        $s = self::staffRow('Amy');
        $r = $this->post('/staff-attendance', ['staff_id' => 999, 'work_date' => self::DAY]);
        $this->assertStatus(422, $r);
        $this->assertSame('Pick a staff member', $r['json']['error']);
        $this->assertStatus(422, $this->post('/staff-attendance', ['work_date' => self::DAY]));

        $r = $this->post('/staff-attendance', ['staff_id' => $s['id'], 'work_date' => '2026-02-30']);
        $this->assertStatus(422, $r);
        $this->assertSame('A date is required', $r['json']['error']);
    }

    public function testStoreKeysInAManualDayWithNormalisedValues(): void
    {
        $s = self::staffRow('Amy');
        $r = $this->post('/staff-attendance', [
            'staff_id'  => $s['id'],
            'work_date' => self::DAY,
            'login_at'  => '8:05',
            'logout_at' => '25:00',
            'break_min' => 5000,
            'note'      => '  hi  ',
        ]);
        $this->assertStatus(201, $r);
        $this->assertSame('manual', $r['json']['source']);
        $this->assertSame('08:05', $r['json']['login_at']);
        $this->assertNull($r['json']['logout_at']);
        $this->assertSame(1440, $r['json']['break_min']);
        $this->assertSame('present', $r['json']['status']);
        $this->assertSame('hi', $r['json']['note']);
    }

    public function testStoringTheSameDayAgainUpdatesInsteadOfDuplicating(): void
    {
        $s = self::staffRow('Amy');
        $first  = $this->post('/staff-attendance', ['staff_id' => $s['id'], 'work_date' => self::DAY, 'login_at' => '09:00']);
        $second = $this->post('/staff-attendance', ['staff_id' => $s['id'], 'work_date' => self::DAY, 'login_at' => '10:00', 'status' => 'half day']);

        $this->assertSame($first['json']['id'], $second['json']['id']);
        $this->assertSame('10:00', $second['json']['login_at']);
        $this->assertSame('half day', $second['json']['status']);
        $this->assertSame(1, (int) self::db()->query('SELECT COUNT(*) FROM staff_attendance')->fetchColumn());
    }

    public function testStoreOnABotDayAnswersWithTheOverriddenFetchedRow(): void
    {
        $s = self::linkedStaff('Alice', 1001);
        self::botDay(1001, self::DAY, '09:12', '17:40');

        $r = $this->post('/staff-attendance', [
            'staff_id' => $s['id'], 'work_date' => self::DAY,
            'login_at' => '09:00', 'logout_at' => '17:00', 'break_min' => 20,
        ]);
        $this->assertStatus(201, $r);
        $this->assertSame('fetched', $r['json']['source']);
        $this->assertTrue($r['json']['edited']);
        $this->assertIsInt($r['json']['id']);
        $this->assertSame('09:00', $r['json']['login_at']);
        $this->assertSame(20, $r['json']['break_min']);
    }

    public function testUpdatePatchesOnlyTheSentFields(): void
    {
        $s = self::staffRow('Amy');
        $row = self::insert('staff_attendance', [
            'staff_id' => $s['id'], 'work_date' => self::DAY,
            'login_at' => '09:00', 'logout_at' => '17:00', 'break_min' => 30, 'status' => 'present', 'note' => 'n',
        ]);

        $r = $this->put("/staff-attendance/{$row['id']}", ['logout_at' => null, 'status' => 'still in']);
        $this->assertStatus(200, $r);
        $this->assertSame('09:00', $r['json']['login_at']);
        $this->assertNull($r['json']['logout_at']);
        $this->assertSame(30, $r['json']['break_min']);
        $this->assertSame('still in', $r['json']['status']);
        $this->assertSame('n', $r['json']['note']);

        $r = $this->put("/staff-attendance/{$row['id']}", ['break_min' => '45', 'login_at' => '07:30']);
        $this->assertSame(45, $r['json']['break_min']);
        $this->assertSame('07:30', $r['json']['login_at']);
        $this->assertSame('manual', $r['json']['source']);
    }

    public function testUpdateOfAnOverrideAnswersWithTheFetchedRow(): void
    {
        $s = self::linkedStaff('Alice', 1001);
        self::botDay(1001, self::DAY, '09:12', '17:40');
        $o = self::insert('staff_attendance', ['staff_id' => $s['id'], 'work_date' => self::DAY, 'login_at' => '09:12', 'break_min' => 0]);

        $r = $this->put("/staff-attendance/{$o['id']}", ['break_min' => 75]);
        $this->assertStatus(200, $r);
        $this->assertSame('fetched', $r['json']['source']);
        $this->assertSame(75, $r['json']['break_min']);
    }

    public function testUpdateOfUnknownRowIs404(): void
    {
        $r = $this->put('/staff-attendance/999', ['status' => 'present']);
        $this->assertStatus(404, $r);
        $this->assertSame('Attendance row not found', $r['json']['error']);
    }

    public function testDeletingAnOverrideRestoresTheBotDay(): void
    {
        $s = self::linkedStaff('Alice', 1001);
        self::botDay(1001, self::DAY, '09:12', '17:40');
        self::botBreak(1001, self::DAY, '12:00', '12:30', 30);
        $o = self::insert('staff_attendance', ['staff_id' => $s['id'], 'work_date' => self::DAY, 'break_min' => 5, 'status' => 'absent']);

        $this->assertSame(['deleted' => true], $this->delete("/staff-attendance/{$o['id']}")['json']);
        $this->assertSame(['deleted' => false], $this->delete("/staff-attendance/{$o['id']}")['json']);

        $row = $this->sheet()['rows'][0];
        $this->assertNull($row['id']);
        $this->assertFalse($row['edited']);
        $this->assertSame('09:12', $row['login_at']);
        $this->assertSame(30, $row['break_min']);
        $this->assertSame('present', $row['status']);
        $this->assertSame(1, (int) self::db()->query('SELECT COUNT(*) FROM attendance_days')->fetchColumn());
    }
}
