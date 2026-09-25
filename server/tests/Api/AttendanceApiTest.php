<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

/**
 * /attendance/* — the bot's days and breaks read the bot's way (10-minute grace, 07:00
 * end-of-day cutoff, America/New_York), with any staff_attendance row replacing the day.
 */
final class AttendanceApiTest extends ApiTestCase
{
    use StaffFixtures;

    private const DAY  = '2026-05-04';
    private const NEXT = '2026-05-05';

    protected function setUp(): void
    {
        parent::setUp();
        self::resetStaffTables();
    }

    private static function linkedStaff(string $name, int $userId, array $extra = []): array
    {
        self::botAccount($userId, $name);
        return self::staffRow($name, ['attendance_user_id' => (string) $userId] + $extra);
    }

    /**
     * Alice (bot 1001, expected 09:00–17:00): in 09:12, out 16:50, two breaks —
     * 30 stated / back after 45 (5 late past the grace) and 40 stated / back after 40.
     */
    private static function seedAlice(): array
    {
        $s = self::linkedStaff('Alice', 1001, ['expected_login' => '09:00', 'expected_logout' => '17:00']);
        self::botDay(1001, self::DAY, '09:12', '16:50', 'Alice');
        self::botBreak(1001, self::DAY, '12:00', '12:45', 30, 'Alice');
        self::botBreak(1001, self::DAY, '15:00', '15:40', 40, 'Alice');
        return $s;
    }

    private function roster(string $date = self::DAY): array
    {
        $r = $this->get("/attendance/roster?date={$date}");
        $this->assertStatus(200, $r);
        return $r['json'];
    }

    private static function byName(array $rows): array
    {
        return array_column($rows, null, 'staff_name');
    }

    // ─── /attendance/staff ─────────────────────────────────────────────────────

    public function testStaffListsTheBotRosterByNameWithNullsLast(): void
    {
        self::botAccount(3, null, 'ghost');
        self::botAccount(2, 'Zoe');
        self::botAccount(1, 'Adam');

        $r = $this->get('/attendance/staff');
        $this->assertStatus(200, $r);
        $this->assertSame(['1', '2', '3'], array_column($r['json'], 'user_id'));
        $this->assertSame(['Adam', 'Zoe', null], array_column($r['json'], 'staff_name'));
    }

    // ─── /attendance/roster ────────────────────────────────────────────────────

    public function testRosterDerivesHoursBreaksAndScheduleMarks(): void
    {
        $s = self::seedAlice();

        $json = $this->roster();
        $this->assertSame('America/New_York', $json['timezone']);
        $this->assertSame(60, $json['breakAllowanceMin']);
        $this->assertSame(self::DAY, $json['date']);
        $row = $json['rows'][0];

        $this->assertSame('1001', $row['user_id']);
        $this->assertSame((int) $s['id'], $row['staff_id']);
        $this->assertSame('2026-05-04 09:12', self::asLocal($row['login_at']));
        $this->assertSame('2026-05-04 16:50', self::asLocal($row['logout_at']));
        $this->assertEqualsWithDelta(7.63, $row['hours'], 0.001);
        $this->assertSame(70, $row['break_min']);
        $this->assertSame(2, $row['break_count']);
        $this->assertSame('30, 40', $row['break_detail']);
        $this->assertSame(85, $row['break_actual_min']);
        $this->assertSame(1, $row['late_return_count']);
        $this->assertSame(5, $row['late_return_min']);
        $this->assertSame(0, $row['out_till_eod_count']);
        $this->assertFalse($row['on_break']);
        $this->assertSame(10, $row['over_break_min']);
        $this->assertEqualsWithDelta(6.47, $row['net_hours'], 0.001);
        $this->assertSame('09:00', $row['expected_login']);
        $this->assertSame('17:00', $row['expected_logout']);
        $this->assertSame(12, $row['late_min']);
        $this->assertSame(10, $row['early_min']);
        $this->assertSame('present', $row['status']);
        $this->assertTrue($row['present']);
        $this->assertFalse($row['still_in']);
        $this->assertFalse($row['status_set']);
        $this->assertFalse($row['edited']);
        $this->assertTrue($row['bot_seen']);
    }

    public function testRosterBreakReturnedWithinTheGraceIsNotLate(): void
    {
        self::linkedStaff('Gil', 1);
        self::botDay(1, self::DAY, '09:00', '17:00');
        self::botBreak(1, self::DAY, '12:00', '12:40', 30);
        self::botBreak(1, self::DAY, '14:00', '14:41', 30);

        $row = $this->roster()['rows'][0];
        $this->assertSame(1, $row['late_return_count']);
        $this->assertSame(1, $row['late_return_min']);
        $this->assertSame(60, $row['break_min']);
        $this->assertSame(0, $row['over_break_min']);
    }

    public function testRosterCoversUnlinkedBotDaysAndHandKeyedOnlyDays(): void
    {
        self::seedAlice();
        self::botDay(1002, self::DAY, '08:30', null, 'Bob Bot');
        $cara = self::staffRow('Cara');
        $dee  = self::staffRow('Dee');
        self::insert('staff_attendance', [
            'staff_id' => $cara['id'], 'work_date' => self::DAY,
            'login_at' => '10:00', 'logout_at' => '14:00', 'break_min' => 15, 'status' => 'half day',
        ]);
        self::insert('staff_attendance', ['staff_id' => $dee['id'], 'work_date' => self::DAY, 'status' => 'absent']);

        $rows = $this->roster()['rows'];
        $this->assertSame(['Bob Bot', 'Alice', 'Cara', 'Dee'], array_column($rows, 'staff_name'));

        $bob = $rows[0];
        $this->assertSame('1002', $bob['user_id']);
        $this->assertNull($bob['staff_id']);
        $this->assertTrue($bob['still_in']);
        $this->assertSame('still in', $bob['status']);
        $this->assertTrue($bob['present']);
        $this->assertNull($bob['hours']);
        $this->assertNull($bob['late_min']);
        $this->assertNull($bob['expected_login']);

        $c = $rows[2];
        $this->assertSame('staff-' . $cara['id'], $c['user_id']);
        $this->assertFalse($c['bot_seen']);
        $this->assertTrue($c['edited']);
        $this->assertSame('half day', $c['status']);
        $this->assertTrue($c['status_set']);
        $this->assertTrue($c['present']);
        $this->assertSame('2026-05-04 10:00', self::asLocal($c['login_at']));
        $this->assertEqualsWithDelta(4.0, $c['hours'], 0.001);
        $this->assertEqualsWithDelta(3.75, $c['net_hours'], 0.001);
        $this->assertSame(15, $c['break_min']);
        $this->assertSame(0, $c['break_count']);

        $d = $rows[3];
        $this->assertSame('absent', $d['status']);
        $this->assertFalse($d['present']);
        $this->assertNull($d['login_at']);
    }

    public function testRosterOverrideReplacesTheBotDay(): void
    {
        $s = self::seedAlice();
        self::insert('staff_attendance', [
            'staff_id' => $s['id'], 'work_date' => self::DAY,
            'login_at' => '08:55', 'logout_at' => '17:30', 'break_min' => 20, 'status' => 'half day',
        ]);

        $rows = $this->roster()['rows'];
        $this->assertCount(1, $rows);
        $row = $rows[0];
        $this->assertSame('1001', $row['user_id']);
        $this->assertTrue($row['edited']);
        $this->assertTrue($row['bot_seen']);
        $this->assertSame('2026-05-04 08:55', self::asLocal($row['login_at']));
        $this->assertSame('2026-05-04 17:30', self::asLocal($row['logout_at']));
        $this->assertSame(20, $row['break_min']);
        $this->assertSame(0, $row['over_break_min']);
        $this->assertSame(2, $row['break_count']);
        $this->assertSame('half day', $row['status']);
        $this->assertTrue($row['status_set']);
        $this->assertSame(0, $row['late_min']);
        $this->assertSame(0, $row['early_min']);
        $this->assertEqualsWithDelta(8.58, $row['hours'], 0.001);
        $this->assertEqualsWithDelta(8.25, $row['net_hours'], 0.001);
    }

    public function testRosterOverrideSetToAbsentIsNotPresent(): void
    {
        $s = self::seedAlice();
        self::insert('staff_attendance', [
            'staff_id' => $s['id'], 'work_date' => self::DAY,
            'login_at' => '09:12', 'logout_at' => '16:50', 'status' => 'absent',
        ]);
        $row = $this->roster()['rows'][0];
        $this->assertFalse($row['present']);
        $this->assertSame('absent', $row['status']);
    }

    public function testRosterOverrideCanClearTheLogin(): void
    {
        $s = self::seedAlice();
        self::insert('staff_attendance', ['staff_id' => $s['id'], 'work_date' => self::DAY, 'status' => '']);
        $row = $this->roster()['rows'][0];
        $this->assertNull($row['login_at']);
        $this->assertSame('absent', $row['status']);
        $this->assertFalse($row['present']);
        $this->assertNull($row['late_min']);
    }

    public function testRosterDefaultsToTodayInTheOrgZone(): void
    {
        $this->assertSame(self::orgToday(), $this->get('/attendance/roster')['json']['date']);
    }

    // ─── /attendance/live ──────────────────────────────────────────────────────

    public function testLiveListsWhoIsCheckedInTodayWithLateness(): void
    {
        $today = self::orgToday();
        $yesterday = (new \DateTimeImmutable($today))->modify('-1 day')->format('Y-m-d');
        self::linkedStaff('Eve', 2001, ['expected_login' => '09:00']);
        self::linkedStaff('Fay', 2002);
        self::botDay(2001, $today, '09:25', null);
        self::botDay(2002, $today, '08:00', '12:00');
        self::botDay(2003, $yesterday, '08:00', null, 'Yesterday');

        $r = $this->get('/attendance/live');
        $this->assertStatus(200, $r);
        $this->assertCount(1, $r['json']);
        $row = $r['json'][0];
        $this->assertSame('2001', $row['user_id']);
        $this->assertSame('Eve', $row['staff_name']);
        $this->assertSame(25, $row['late_min']);
        $this->assertNull($row['early_min']);
        $this->assertSame('09:00', $row['expected_login']);
    }

    public function testLiveHonoursAnOverrideThatFillsInTheLogout(): void
    {
        $today = self::orgToday();
        $s = self::linkedStaff('Eve', 2001);
        self::botDay(2001, $today, '09:00', null);
        self::insert('staff_attendance', ['staff_id' => $s['id'], 'work_date' => $today, 'login_at' => '09:00', 'logout_at' => '10:00']);

        $this->assertSame([], $this->get('/attendance/live')['json']);
    }

    // ─── /attendance/on-break ──────────────────────────────────────────────────

    public function testOnBreakListsOnlyBreaksStillRunning(): void
    {
        $ny = new \DateTimeImmutable('now', new \DateTimeZone(self::ORG_TZ));
        if ($ny->format('H:i') >= '07:00' && $ny->format('H:i') < '07:45') {
            $this->markTestSkipped('The 07:00 cutoff falls inside the seeded break.');
        }
        $today = self::orgToday();
        self::botAccount(4001, 'Roster Name');
        self::db()->exec(
            "INSERT INTO attendance_breaks (user_id, work_date, staff_name, taken_at, duration_min, urgent, raw)
             VALUES (4001, '{$today}', 'Break Name', now() - INTERVAL '40 minutes', 15, true, 'taking 15')"
        );
        self::db()->exec(
            "INSERT INTO attendance_breaks (user_id, work_date, taken_at, returned_at, duration_min)
             VALUES (4002, '{$today}', now() - INTERVAL '30 minutes', now() - INTERVAL '5 minutes', 30)"
        );
        self::botBreak(4003, self::DAY, '16:00', null, 15);

        $r = $this->get('/attendance/on-break');
        $this->assertStatus(200, $r);
        $this->assertCount(1, $r['json']);
        $row = $r['json'][0];
        $this->assertSame('4001', $row['user_id']);
        $this->assertSame('Roster Name', $row['staff_name']);
        $this->assertSame($today, $row['work_date']);
        $this->assertSame(15, $row['duration_min']);
        $this->assertTrue($row['urgent']);
        $this->assertSame(40, $row['out_for_min']);
        $this->assertSame(15, $row['late_min']);
    }

    // ─── /attendance/days ──────────────────────────────────────────────────────

    public function testDaysListsTheRangeNewestFirstAndFiltersByUser(): void
    {
        self::seedAlice();
        self::botDay(1001, self::NEXT, '09:00', null, 'Alice');
        self::botDay(1002, self::DAY, '09:00', '17:00', 'Bob');
        self::botDay(1002, '2026-05-10', '09:00', '17:00', 'Bob');

        $r = $this->get('/attendance/days?from=2026-05-04&to=2026-05-05');
        $this->assertStatus(200, $r);
        $this->assertSame(60, $r['json']['breakAllowanceMin']);
        $this->assertSame(
            [[self::NEXT, 'Alice'], [self::DAY, 'Alice'], [self::DAY, 'Bob']],
            array_map(fn ($x) => [$x['work_date'], $x['staff_name']], $r['json']['rows'])
        );
        $this->assertFalse($r['json']['rows'][0]['completed']);
        $this->assertTrue($r['json']['rows'][1]['completed']);
        $this->assertSame(70, $r['json']['rows'][1]['break_min']);
        $this->assertSame(10, $r['json']['rows'][1]['over_break_min']);

        $r = $this->get('/attendance/days?from=2026-05-01&to=2026-05-31&user_id=1002');
        $this->assertSame(['2026-05-10', self::DAY], array_column($r['json']['rows'], 'work_date'));
    }

    public function testDaysFilterFindsAHandKeyedDayByItsStandInId(): void
    {
        $s = self::staffRow('Cara');
        self::insert('staff_attendance', ['staff_id' => $s['id'], 'work_date' => self::DAY, 'login_at' => '09:00']);

        $r = $this->get("/attendance/days?from=2026-05-01&to=2026-05-31&user_id=staff-{$s['id']}");
        $this->assertStatus(200, $r);
        $this->assertCount(1, $r['json']['rows']);
        $this->assertFalse($r['json']['rows'][0]['completed']);
    }

    public function testDaysCountBreaksOutTillEod(): void
    {
        self::linkedStaff('Ola', 9);
        self::botDay(9, self::DAY, '09:00', '17:00');
        self::botBreak(9, self::DAY, '16:00', null, 15);

        $row = $this->get('/attendance/days?from=2026-05-04&to=2026-05-04')['json']['rows'][0];
        $this->assertSame(1, $row['out_till_eod_count']);
        $this->assertFalse($row['on_break']);
        $this->assertSame(900, $row['break_actual_min']);
        $this->assertSame(875, $row['late_return_min']);
        $this->assertSame(15, $row['break_min']);
    }

    // ─── /attendance/summary ───────────────────────────────────────────────────

    public function testSummaryTotalsPresenceAndHoursPerPerson(): void
    {
        self::seedAlice();
        self::botDay(1001, self::NEXT, '09:00', null, 'Alice');
        $dee = self::staffRow('Dee');
        self::insert('staff_attendance', ['staff_id' => $dee['id'], 'work_date' => self::DAY, 'status' => 'absent']);
        self::insert('staff_attendance', ['staff_id' => $dee['id'], 'work_date' => self::NEXT, 'login_at' => '09:00', 'logout_at' => '13:30']);

        $r = $this->get('/attendance/summary?from=2026-05-01&to=2026-05-31');
        $this->assertStatus(200, $r);
        $rows = self::byName($r['json']);

        $this->assertSame('1001', (string) $rows['Alice']['user_id']);
        $this->assertSame(2, (int) $rows['Alice']['days_present']);
        $this->assertSame(1, (int) $rows['Alice']['days_complete']);
        $this->assertEqualsWithDelta(7.63, (float) $rows['Alice']['total_hours'], 0.001);
        $this->assertSame(self::DAY, $rows['Alice']['first_day']);
        $this->assertSame(self::NEXT, $rows['Alice']['last_day']);

        $this->assertSame('staff-' . $dee['id'], $rows['Dee']['user_id']);
        $this->assertSame(1, (int) $rows['Dee']['days_present']);
        $this->assertSame(1, (int) $rows['Dee']['days_complete']);
        $this->assertEqualsWithDelta(4.5, (float) $rows['Dee']['total_hours'], 0.001);
    }

    // ─── /attendance/breaks ────────────────────────────────────────────────────

    public function testBreaksRequiresAUser(): void
    {
        $r = $this->get('/attendance/breaks?date=2026-05-04');
        $this->assertStatus(422, $r);
        $this->assertSame('user_id is required', $r['json']['error']);
    }

    public function testBreaksDetailEachBreakAndTheDayTotals(): void
    {
        self::seedAlice();

        $r = $this->get('/attendance/breaks?user_id=1001&date=2026-05-04');
        $this->assertStatus(200, $r);
        $j = $r['json'];
        $this->assertSame('1001', $j['userId']);
        $this->assertSame(10, $j['graceMin']);
        $this->assertSame('07:00', $j['eodCutoff']);
        $this->assertSame(60, $j['allowanceMin']);
        $this->assertSame(70, $j['totalMin']);
        $this->assertSame(10, $j['overMin']);
        $this->assertSame(85, $j['actualMin']);
        $this->assertSame(5, $j['lateMin']);
        $this->assertFalse($j['overridden']);

        $this->assertCount(2, $j['breaks']);
        [$first, $second] = $j['breaks'];
        $this->assertSame('2026-05-04 12:00', self::asLocal($first['taken_at']));
        $this->assertSame(30, $first['duration_min']);
        $this->assertSame(45, $first['actual_min']);
        $this->assertSame(5, $first['late_min']);
        $this->assertFalse($first['still_out']);
        $this->assertFalse($first['out_till_eod']);
        $this->assertSame('2026-05-05 07:00', self::asLocal($first['eod_at']));
        $this->assertSame(0, $second['late_min']);
    }

    public function testBreaksNeverReturnedFromRunToTheNextSevenAm(): void
    {
        self::botBreak(1, self::DAY, '16:00', null, 15);
        self::botBreak(1, self::NEXT, '2026-05-05 06:30', null, 10);

        $late = $this->get('/attendance/breaks?user_id=1&date=2026-05-04')['json']['breaks'][0];
        $this->assertTrue($late['out_till_eod']);
        $this->assertFalse($late['still_out']);
        $this->assertSame(900, $late['actual_min']);
        $this->assertSame(875, $late['late_min']);

        $early = $this->get('/attendance/breaks?user_id=1&date=2026-05-05')['json']['breaks'][0];
        $this->assertSame('2026-05-05 07:00', self::asLocal($early['eod_at']));
        $this->assertSame(30, $early['actual_min']);
        $this->assertSame(10, $early['late_min']);
    }

    public function testBreakOpenAcrossTheSpringForwardNightRunsSevenHours(): void
    {
        self::botBreak(1, '2026-03-07', '23:00', null, 15);
        $b = $this->get('/attendance/breaks?user_id=1&date=2026-03-07')['json']['breaks'][0];
        $this->assertSame(420, $b['actual_min']);
        $this->assertSame('2026-03-08 07:00', self::asLocal($b['eod_at']));
    }

    public function testBreaksTotalTakesTheOverride(): void
    {
        $s = self::seedAlice();
        self::insert('staff_attendance', ['staff_id' => $s['id'], 'work_date' => self::DAY, 'login_at' => '09:12', 'break_min' => 20]);

        $j = $this->get('/attendance/breaks?user_id=1001&date=2026-05-04')['json'];
        $this->assertTrue($j['overridden']);
        $this->assertSame(20, $j['totalMin']);
        $this->assertSame(0, $j['overMin']);
        $this->assertCount(2, $j['breaks']);
        $this->assertSame(85, $j['actualMin']);
    }

    public function testBreaksTotalAgreesWithTheRosterWhenAnOverrideLeavesTheBreakBlank(): void
    {
        $s = self::seedAlice();
        self::insert('staff_attendance', [
            'staff_id' => $s['id'], 'work_date' => self::DAY,
            'login_at' => '09:12', 'logout_at' => '16:50', 'break_min' => null,
        ]);

        $rosterBreak = $this->roster()['rows'][0]['break_min'];
        $sheetBreak  = $this->get('/staff-attendance?from=2026-05-04&to=2026-05-04')['json']['rows'][0]['break_min'];
        $detailTotal = $this->get('/attendance/breaks?user_id=1001&date=2026-05-04')['json']['totalMin'];

        $this->assertSame($rosterBreak, $sheetBreak);
        $this->assertSame($rosterBreak, $detailTotal, 'The break modal total disagrees with the roster for the same day');
    }

    // ─── /attendance/exceptions ────────────────────────────────────────────────

    public function testExceptionsRejectAnUnknownType(): void
    {
        $r = $this->get('/attendance/exceptions?type=nope&from=2026-05-01&to=2026-05-31');
        $this->assertStatus(422, $r);
        $this->assertSame('Invalid type', $r['json']['error']);
    }

    public function testMissingLogoutListsPastDaysLeftOpenUnlessCorrected(): void
    {
        $s = self::linkedStaff('Alice', 1001);
        self::linkedStaff('Bob', 1002);
        self::botDay(1001, self::DAY, '09:00', null);
        self::botDay(1002, self::DAY, '09:00', null);
        self::botDay(1002, self::NEXT, '09:00', '17:00');
        self::insert('staff_attendance', ['staff_id' => $s['id'], 'work_date' => self::DAY, 'login_at' => '09:00', 'logout_at' => '17:00']);

        $r = $this->get('/attendance/exceptions?type=missing_logout&from=2026-05-01&to=2026-05-31');
        $this->assertStatus(200, $r);
        $this->assertSame('missing_logout', $r['json']['type']);
        $this->assertSame(['Bob'], array_column($r['json']['rows'], 'staff_name'));
        $this->assertSame(self::DAY, $r['json']['rows'][0]['work_date']);
    }

    public function testMissingLogoutIgnoresToday(): void
    {
        $today = self::orgToday();
        self::linkedStaff('Now', 1);
        self::botDay(1, $today, '09:00', null);
        $r = $this->get("/attendance/exceptions?type=missing_logout&from=2026-01-01&to={$today}");
        $this->assertSame([], $r['json']['rows']);
    }

    public function testOverBreakUsesTheCorrectedTotal(): void
    {
        self::seedAlice();
        $bob = self::linkedStaff('Bob', 1002);
        self::botDay(1002, self::DAY, '09:00', '17:00');
        self::botBreak(1002, self::DAY, '12:00', '13:30', 90);
        self::insert('staff_attendance', ['staff_id' => $bob['id'], 'work_date' => self::DAY, 'login_at' => '09:00', 'break_min' => 30]);
        $cara = self::staffRow('Cara');
        self::insert('staff_attendance', ['staff_id' => $cara['id'], 'work_date' => self::DAY, 'login_at' => '09:00', 'break_min' => 75]);

        $r = $this->get('/attendance/exceptions?type=over_break&from=2026-05-01&to=2026-05-31');
        $this->assertStatus(200, $r);
        $rows = $r['json']['rows'];
        $this->assertSame(['Cara', 'Alice'], array_column($rows, 'staff_name'));
        $this->assertSame([15, 10], array_map('intval', array_column($rows, 'over_min')));
        $this->assertSame([75, 70], array_map('intval', array_column($rows, 'break_min')));
    }

    public function testLateUsesEachPersonsScheduleAndFallsBackToNine(): void
    {
        self::linkedStaff('Sched Ten', 1, ['expected_login' => '10:00']);
        self::linkedStaff('Sched Eight', 2, ['expected_login' => '08:00']);
        self::botDay(1, self::DAY, '09:30', '17:00');
        self::botDay(2, self::DAY, '08:20', '17:00');
        self::botDay(3, self::DAY, '09:30', '17:00', 'No Schedule');
        self::botDay(4, self::DAY, '08:59', '17:00', 'Early Bird');

        $r = $this->get('/attendance/exceptions?type=late&from=2026-05-01&to=2026-05-31');
        $this->assertStatus(200, $r);
        $rows = self::byName($r['json']['rows']);
        ksort($rows);
        $this->assertSame(['No Schedule', 'Sched Eight'], array_keys($rows));
        $this->assertSame('09:00', $rows['No Schedule']['expected_login']);
        $this->assertSame(30, (int) $rows['No Schedule']['late_min']);
        $this->assertSame('09:30:00', $rows['No Schedule']['local_login']);
        $this->assertSame('08:00', $rows['Sched Eight']['expected_login']);
        $this->assertSame(20, (int) $rows['Sched Eight']['late_min']);
    }

    public function testLateReturnListsBreaksBackPastTheGraceWorstFirst(): void
    {
        self::seedAlice();
        self::botBreak(1002, self::DAY, '16:00', null, 15, 'Bob');
        self::botBreak(1003, '2026-04-30', '12:00', '14:00', 15, 'April');

        $r = $this->get('/attendance/exceptions?type=late_return&from=2026-05-01&to=2026-05-31');
        $this->assertStatus(200, $r);
        $rows = $r['json']['rows'];
        $this->assertSame(['Bob', 'Alice'], array_column($rows, 'staff_name'));
        $this->assertSame([875, 5], array_map('intval', array_column($rows, 'late_min')));
        $this->assertTrue((bool) $rows[0]['out_till_eod']);
        $this->assertFalse((bool) $rows[1]['out_till_eod']);
        $this->assertSame(45, (int) $rows[1]['actual_min']);
    }
}
