<?php

declare(strict_types=1);

namespace Tests\Integration;

use Tests\Api\AuthApiHelpers;
use Tests\Api\StaffFixtures;
use Tests\ApiTestCase;

/**
 * One person's life on the roster, followed through every module that reads it: the check-in
 * bot's days on the Attendance page and the Staff page's attendance sheet, the leaves /
 * salaries / salary-hold sheets, the Queues boards, the Review sheets and the Top Performer
 * ticks. A bystander (Amy) shares every sheet, and must come out of it all untouched.
 */
final class StaffLifecycleWorkflowTest extends ApiTestCase
{
    use AuthApiHelpers;
    use StaffFixtures;

    private const ZACK_BOT = 9001;
    private const AMY_BOT  = 9002;

    protected function setUp(): void
    {
        parent::setUp();
        self::resetStaffTables();
        self::resetTables(
            'queue_assignment_codes', 'queue_assignments', 'queue_codes',
            'review_entries', 'department_reviews',
            'top_performer_ticks', 'top_performer_months', 'users', 'sessions', 'audit_log'
        );
    }

    /** Two departments, two bot accounts, two people added in one paste, linked by name. */
    private function arrangeRoster(): array
    {
        $sales   = $this->post('/departments', ['name' => 'Sales']);
        $support = $this->post('/departments', ['name' => 'Support']);
        $this->assertStatus(201, $sales);
        $this->assertStatus(201, $support);

        // The bot tags names with a |Department| suffix; its username is dotted.
        self::botAccount(self::ZACK_BOT, 'Zack Brown |Audit|', 'zachary.brown');
        self::botAccount(self::AMY_BOT, 'Amy Lee', 'amyl');

        $r = $this->post('/staff', ['names' => "Zack Brown\nAmy Lee", 'department_ids' => [$sales['json']['id']]]);
        $this->assertStatus(201, $r);
        $byName = array_column($r['json']['created'], null, 'name');
        $this->assertSame((string) self::ZACK_BOT, $byName['Zack Brown']['attendance_user_id']);
        $this->assertSame((string) self::AMY_BOT, $byName['Amy Lee']['attendance_user_id']);
        $this->assertSame([['id' => $sales['json']['id'], 'name' => 'Sales']], $byName['Zack Brown']['departments']);

        return [
            'sales'   => $sales['json']['id'],
            'support' => $support['json']['id'],
            'zack'    => $byName['Zack Brown']['id'],
            'amy'     => $byName['Amy Lee']['id'],
        ];
    }

    private function arrangeBotDays(): void
    {
        self::botDay(self::ZACK_BOT, '2026-05-04', '09:10', '17:00', 'Zack Brown |Audit|');
        self::botBreak(self::ZACK_BOT, '2026-05-04', '12:00', '12:30', 30, 'Zack Brown |Audit|');
        self::botBreak(self::ZACK_BOT, '2026-05-04', '15:00', '15:45', 45, 'Zack Brown |Audit|');
        self::botDay(self::ZACK_BOT, '2026-05-05', '09:00', null, 'Zack Brown |Audit|');

        self::botDay(self::AMY_BOT, '2026-05-04', '08:55', '17:05', 'Amy Lee');
        self::botBreak(self::AMY_BOT, '2026-05-04', '13:00', '13:20', 20, 'Amy Lee');
    }

    /** @return array<string, array> roster rows for a day, keyed by staff name */
    private function roster(string $date): array
    {
        $r = $this->get("/attendance/roster?date={$date}");
        $this->assertStatus(200, $r);
        return array_column($r['json']['rows'], null, 'staff_name');
    }

    /** @return array<string, array> the attendance sheet for May, keyed "name|date" */
    private function sheet(): array
    {
        $r = $this->get('/staff-attendance?from=2026-05-01&to=2026-05-31');
        $this->assertStatus(200, $r);
        $out = [];
        foreach ($r['json']['rows'] as $row) {
            $key = "{$row['staff_name']}|{$row['work_date']}";
            $this->assertArrayNotHasKey($key, $out, 'one row per person per day');
            $out[$key] = $row;
        }
        return $out;
    }

    /** @return array<string, array> the May summary keyed by staff name */
    private function summary(): array
    {
        $r = $this->get('/attendance/summary?from=2026-05-01&to=2026-05-31');
        $this->assertStatus(200, $r);
        return array_column($r['json'], null, 'staff_name');
    }

    /** @return array<int, array{string,string}> [staff_name, work_date] pairs */
    private function exceptions(string $type): array
    {
        $r = $this->get("/attendance/exceptions?type={$type}&from=2026-05-01&to=2026-05-31");
        $this->assertStatus(200, $r);
        return array_map(static fn ($row) => [$row['staff_name'], $row['work_date']], $r['json']['rows']);
    }

    public function testBotDaysAndHandKeyedCorrectionsAgreeAcrossAttendanceAndStaffPages(): void
    {
        $ids = $this->arrangeRoster();
        $this->arrangeBotDays();
        $r = $this->put("/staff/{$ids['zack']}", ['expected_login' => '09:00', 'expected_logout' => '17:00']);
        $this->assertStatus(200, $r);
        $this->assertSame('09:00', $r['json']['expected_login']);

        $amyBefore = $this->roster('2026-05-04')['Amy Lee'];

        // ── The bot's own account of the days ──
        $zack = $this->roster('2026-05-04')['Zack Brown'];
        $this->assertSame($ids['zack'], $zack['staff_id']);
        $this->assertSame(75, $zack['break_min']);
        $this->assertSame(15, $zack['over_break_min']);
        $this->assertSame(10, $zack['late_min']);
        $this->assertSame(0, $zack['early_min']);
        $this->assertSame('present', $zack['status']);
        $this->assertFalse($zack['edited']);
        $this->assertNull($amyBefore['late_min'], 'no schedule, nothing to be late against');

        $sheet = $this->sheet();
        $this->assertSame(['fetched', null, '09:10', '17:00', 75, 'present', false], [
            $sheet['Zack Brown|2026-05-04']['source'], $sheet['Zack Brown|2026-05-04']['id'],
            $sheet['Zack Brown|2026-05-04']['login_at'], $sheet['Zack Brown|2026-05-04']['logout_at'],
            $sheet['Zack Brown|2026-05-04']['break_min'], $sheet['Zack Brown|2026-05-04']['status'],
            $sheet['Zack Brown|2026-05-04']['edited'],
        ]);
        $this->assertSame('still in', $sheet['Zack Brown|2026-05-05']['status']);
        $this->assertSame(20, $sheet['Amy Lee|2026-05-04']['break_min']);

        $summary = $this->summary();
        $this->assertSame((string) self::ZACK_BOT, (string) $summary['Zack Brown']['user_id']);
        $this->assertSame(2, (int) $summary['Zack Brown']['days_present']);
        $this->assertSame(1, (int) $summary['Zack Brown']['days_complete']);
        $this->assertEqualsWithDelta(7.83, (float) $summary['Zack Brown']['total_hours'], 0.001);

        $this->assertSame([['Zack Brown', '2026-05-04']], $this->exceptions('over_break'));
        $this->assertSame([['Zack Brown', '2026-05-05']], $this->exceptions('missing_logout'));
        $this->assertSame([['Zack Brown', '2026-05-04']], $this->exceptions('late'));

        // ── A supervisor corrects both of Zack's days on the attendance sheet ──
        $r = $this->post('/staff-attendance', [
            'staff_id' => $ids['zack'], 'work_date' => '2026-05-04',
            'login_at' => '09:00', 'logout_at' => '17:00', 'break_min' => 50, 'status' => 'present', 'note' => 'bot glitch',
        ]);
        $this->assertStatus(201, $r);
        $this->assertSame('fetched', $r['json']['source']);
        $this->assertTrue($r['json']['edited']);
        $this->assertSame(50, $r['json']['break_min']);
        $overrideId = $r['json']['id'];
        $this->assertIsInt($overrideId);

        $r = $this->post('/staff-attendance', [
            'staff_id' => $ids['zack'], 'work_date' => '2026-05-05',
            'login_at' => '09:00', 'logout_at' => '17:30', 'break_min' => 30, 'status' => 'present',
        ]);
        $this->assertStatus(201, $r);

        // The correction wins everywhere the day is shown.
        $zack = $this->roster('2026-05-04')['Zack Brown'];
        $this->assertEquals([50, 0, 0, true, 8.0], [
            $zack['break_min'], $zack['over_break_min'], $zack['late_min'], $zack['edited'], $zack['hours'],
        ]);
        $sheet = $this->sheet();
        $this->assertSame(['09:00', 50, 'bot glitch', $overrideId], [
            $sheet['Zack Brown|2026-05-04']['login_at'], $sheet['Zack Brown|2026-05-04']['break_min'],
            $sheet['Zack Brown|2026-05-04']['note'], $sheet['Zack Brown|2026-05-04']['id'],
        ]);
        $this->assertSame('17:30', $sheet['Zack Brown|2026-05-05']['logout_at']);

        $breaks = $this->get('/attendance/breaks?user_id=' . self::ZACK_BOT . '&date=2026-05-04');
        $this->assertStatus(200, $breaks);
        $this->assertSame(50, $breaks['json']['totalMin']);
        $this->assertTrue($breaks['json']['overridden']);
        $this->assertCount(2, $breaks['json']['breaks'], "the bot's own breaks are still listed");

        $summary = $this->summary();
        $this->assertSame(2, (int) $summary['Zack Brown']['days_complete']);
        $this->assertEqualsWithDelta(16.5, (float) $summary['Zack Brown']['total_hours'], 0.001);
        $this->assertSame([], $this->exceptions('over_break'));
        $this->assertSame([], $this->exceptions('missing_logout'));
        $this->assertSame([], $this->exceptions('late'));

        // A day the bot never saw, keyed in by hand, is still a day on both pages.
        $r = $this->post('/staff-attendance', [
            'staff_id' => $ids['zack'], 'work_date' => '2026-05-06',
            'login_at' => '09:00', 'logout_at' => '13:00', 'status' => 'half day',
        ]);
        $this->assertStatus(201, $r);
        $this->assertSame('manual', $r['json']['source']);
        $days = $this->get('/attendance/days?from=2026-05-06&to=2026-05-06');
        $this->assertCount(1, $days['json']['rows']);
        $half = $days['json']['rows'][0];
        $this->assertSame([(string) self::ZACK_BOT, $ids['zack'], 'half day', true, false, true], [
            $half['user_id'], $half['staff_id'], $half['status'], $half['present'], $half['bot_seen'], $half['edited'],
        ]);
        $this->assertSame('half day', $this->sheet()['Zack Brown|2026-05-06']['status']);
        $summary = $this->summary();
        $this->assertSame(3, (int) $summary['Zack Brown']['days_present']);
        $this->assertEqualsWithDelta(20.5, (float) $summary['Zack Brown']['total_hours'], 0.001);

        // Removing the correction hands the day back to the bot, on both pages.
        $this->assertSame(['deleted' => true], $this->delete("/staff-attendance/{$overrideId}")['json']);
        $zack = $this->roster('2026-05-04')['Zack Brown'];
        $this->assertSame([75, false, 10], [$zack['break_min'], $zack['edited'], $zack['late_min']]);
        $row = $this->sheet()['Zack Brown|2026-05-04'];
        $this->assertSame([null, '09:10', 75, false], [$row['id'], $row['login_at'], $row['break_min'], $row['edited']]);
        $this->assertFalse($this->get('/attendance/breaks?user_id=' . self::ZACK_BOT . '&date=2026-05-04')['json']['overridden']);

        // The bot's own tables were never written, and Amy never moved.
        $this->assertSame(3, self::countRows('SELECT count(*) FROM attendance_days'));
        $this->assertSame(3, self::countRows('SELECT count(*) FROM attendance_breaks'));
        $this->assertEquals($amyBefore, $this->roster('2026-05-04')['Amy Lee']);
    }

    public function testRenamingAPersonPropagatesAndDeletingThemCascadesWithoutTouchingOthers(): void
    {
        $ids = $this->arrangeRoster();
        $this->arrangeBotDays();
        [$zackId, $amyId, $sales] = [$ids['zack'], $ids['amy'], $ids['sales']];

        // Zack across every sheet — Amy alongside him on each.
        $this->assertStatus(201, $this->post('/staff-attendance', [
            'staff_id' => $zackId, 'work_date' => '2026-05-04', 'login_at' => '09:00', 'logout_at' => '17:00', 'break_min' => 40, 'status' => 'present',
        ]));
        foreach ([$zackId, $amyId] as $sid) {
            $this->assertStatus(201, $this->post('/staff-leaves', ['staff_id' => $sid, 'department_id' => $sales, 'leave_date' => '2026-05-07', 'sick_leave' => 'Yes']));
            $this->assertStatus(201, $this->post('/staff-salaries', ['staff_id' => $sid, 'department_id' => $sales, 'month' => '2026-05', 'amount' => 1200, 'status' => 'Received']));
            $this->assertStatus(201, $this->post('/staff-salary-holds', ['staff_id' => $sid, 'month' => '2026-05', 'reason' => 'Docs missing']));
        }

        $codes = $this->post('/queue-codes', ['codes' => 'BHS, BOP']);
        $this->assertStatus(201, $codes);
        $codeIds = array_column($codes['json']['created'], 'id', 'code');
        $this->assertStatus(201, $this->post('/queues', ['board' => 'forwarding', 'person_id' => $zackId, 'code_ids' => [$codeIds['BHS'], $codeIds['BOP']]]));
        $this->assertStatus(201, $this->post('/queues', ['board' => 'camp_flow', 'person_id' => $zackId, 'code_ids' => [$codeIds['BOP']]]));
        $this->assertStatus(201, $this->post('/queues', ['board' => 'forwarding', 'person_id' => $amyId, 'code_ids' => [$codeIds['BHS']]]));

        // Review rows are written against the name; the link is resolved from it.
        $perf = $this->post('/review-entries', ['kind' => 'performance', 'person_name' => 'zack brown', 'department_id' => $sales, 'month' => '2026-05', 'rating' => 'Good', 'percentage' => 88]);
        $this->assertStatus(201, $perf);
        $this->assertSame($zackId, $perf['json']['staff_id']);
        $beh = $this->post('/review-entries', ['kind' => 'behaviour', 'staff_id' => $zackId, 'person_name' => 'Zack Brown', 'month' => '2026-05', 'rating' => 'Excellent']);
        $this->assertStatus(201, $beh);
        $amyPerf = $this->post('/review-entries', ['kind' => 'performance', 'person_name' => 'Amy Lee', 'month' => '2026-05', 'percentage' => 91]);
        $this->assertSame($amyId, $amyPerf['json']['staff_id']);

        $this->assertStatus(200, $this->put('/top-performer?month=2026-05', [
            'ticks' => [(string) $zackId => ['documentation', 'written'], (string) $amyId => ['written']],
        ]));

        $account = self::insert('users', ['username' => 'zack', 'name' => 'Zack Brown', 'staff_id' => $zackId, 'role' => 'member']);

        // ── Rename: the bot link follows (his dotted username still matches) and every
        // sheet that reads the roster shows the new name. ──
        $r = $this->put("/staff/{$zackId}", ['name' => 'Zachary Brown']);
        $this->assertStatus(200, $r);
        $this->assertSame((string) self::ZACK_BOT, $r['json']['attendance_user_id']);

        $this->assertArrayHasKey('Zachary Brown', $this->roster('2026-05-04'));
        $this->assertSame(40, $this->roster('2026-05-04')['Zachary Brown']['break_min'], 'override survives the rename');
        $this->assertArrayHasKey('Zachary Brown|2026-05-05', $this->sheet());
        $this->assertArrayHasKey('Zachary Brown', $this->summary());
        $this->assertContains(['Zachary Brown', '2026-05-05'], $this->exceptions('missing_logout'));

        $names = fn (string $path, string $key = 'staff_name') => array_column($this->get($path)['json'], $key);
        $this->assertSame(['Zachary Brown', 'Amy Lee'], $names('/staff-leaves?from=2026-05-01&to=2026-05-31'));
        $this->assertSame(['Zachary Brown', 'Amy Lee'], $names('/staff-salaries?month=2026-05'));
        $this->assertSame(['Zachary Brown', 'Amy Lee'], $names('/staff-salary-holds'));
        $this->assertSame(['Zachary Brown', 'Amy Lee'], $names('/queues?board=forwarding', 'name'));
        $this->assertSame(['Zachary Brown'], $names('/queues?board=camp_flow', 'name'));

        // Reviews keep the name they were written with, but stay linked.
        $entries = $this->get('/review-entries?kind=performance&month=2026-05')['json'];
        $this->assertSame(['zack brown', 'Amy Lee'], array_column($entries, 'person_name'));
        $this->assertSame([$zackId, $amyId], array_column($entries, 'staff_id'));

        // ── Delete Zack ──
        $this->assertSame(['deleted' => true], $this->delete("/staff/{$zackId}")['json']);

        $this->assertSame(['Amy Lee'], array_column($this->get('/staff')['json'], 'name'));
        $depts = array_column($this->get('/departments')['json'], 'staff_count', 'name');
        $this->assertSame(['Sales' => 1, 'Support' => 0], $depts);

        $this->assertSame(['Amy Lee'], $names('/staff-leaves?from=2026-05-01&to=2026-05-31'));
        $this->assertSame(['Amy Lee'], $names('/staff-salaries?month=2026-05'));
        $this->assertSame(['Amy Lee'], $names('/staff-salary-holds'));
        $this->assertSame(['Amy Lee'], $names('/queues?board=forwarding', 'name'));
        $this->assertSame([], $this->get('/queues?board=camp_flow')['json']);
        $usage = array_column($this->get('/queue-codes')['json'], 'usage_count', 'code');
        $this->assertEquals(['BHS' => 1, 'BOP' => 0], $usage);

        // His correction is gone with him; the bot's days remain, now unowned.
        $this->assertSame(0, self::countRows('SELECT count(*) FROM staff_attendance'));
        $this->assertSame(['Amy Lee|2026-05-04'], array_keys($this->sheet()));
        $orphans = array_filter(
            $this->get('/attendance/days?from=2026-05-01&to=2026-05-31')['json']['rows'],
            static fn ($row) => $row['user_id'] === (string) self::ZACK_BOT
        );
        $this->assertCount(2, $orphans);
        foreach ($orphans as $row) {
            $this->assertNull($row['staff_id']);
            $this->assertSame('Zack Brown |Audit|', $row['staff_name']);
            $this->assertFalse($row['edited']);
        }
        $this->assertSame(75, $this->roster('2026-05-04')['Zack Brown |Audit|']['break_min'], 'bot figures are back');

        // Review rows outlive him, unlinked; the Top Performer ticks do not.
        $perfRows = $this->get('/review-entries?kind=performance&month=2026-05')['json'];
        $this->assertSame([null, $amyId], array_column($perfRows, 'staff_id'));
        $this->assertSame('zack brown', $perfRows[0]['person_name']);
        $this->assertNull($this->get('/review-entries?kind=behaviour&month=2026-05')['json'][0]['staff_id']);
        $ticks = $this->get('/top-performer?month=2026-05')['json']['ticks'];
        $this->assertSame([(string) $amyId => ['written']], $ticks);

        // The login he had stays, detached from the roster.
        $row = self::db()->query("SELECT staff_id FROM users WHERE id = {$account['id']}")->fetch();
        $this->assertNull($row['staff_id']);

        // Saving the month with his stale tick (an old tab) is refused and changes nothing.
        $r = $this->put('/top-performer?month=2026-05', ['ticks' => [(string) $zackId => ['written'], (string) $amyId => []]]);
        $this->assertStatus(422, $r);
        $this->assertSame([(string) $amyId => ['written']], $this->get('/top-performer?month=2026-05')['json']['ticks']);

        // Nothing of Amy's was disturbed, and the bot's tables are exactly as they were.
        $this->assertSame(3, self::countRows('SELECT count(*) FROM attendance_days'));
        $this->assertSame(2, self::countRows('SELECT count(*) FROM attendance_staff'));
        $this->assertSame(20, $this->roster('2026-05-04')['Amy Lee']['break_min']);
    }

    public function testRenamingAwayFromTheBotsNameUnlinksTheDaysAndRenamingBackRestoresThem(): void
    {
        $ids = $this->arrangeRoster();
        $this->arrangeBotDays();
        $this->assertStatus(201, $this->post('/staff-attendance', [
            'staff_id' => $ids['zack'], 'work_date' => '2026-05-04', 'login_at' => '09:00', 'logout_at' => '17:00', 'break_min' => 40, 'status' => 'present',
        ]));

        // A name neither the bot's display name nor its username normalises to.
        $r = $this->put("/staff/{$ids['zack']}", ['name' => 'Zed Brown']);
        $this->assertNull($r['json']['attendance_user_id']);

        // On both pages, the bot's days fall back to the bot's own name and figures, and his
        // correction becomes a stand-alone hand-keyed day of his own.
        $sheet = $this->sheet();
        $this->assertSame(['Amy Lee|2026-05-04', 'Zed Brown|2026-05-04'], array_keys($sheet));
        $this->assertSame('manual', $sheet['Zed Brown|2026-05-04']['source']);

        $roster = $this->roster('2026-05-04');
        $this->assertSame(75, $roster['Zack Brown |Audit|']['break_min']);
        $this->assertNull($roster['Zack Brown |Audit|']['staff_id']);
        $this->assertSame('staff-' . $ids['zack'], $roster['Zed Brown']['user_id']);
        $this->assertFalse($roster['Zed Brown']['bot_seen']);
        $this->assertSame(40, $roster['Zed Brown']['break_min']);

        // Renaming back relinks, and the correction is an override again.
        $r = $this->put("/staff/{$ids['zack']}", ['name' => 'Zack Brown']);
        $this->assertSame((string) self::ZACK_BOT, $r['json']['attendance_user_id']);
        $roster = $this->roster('2026-05-04');
        $names  = array_keys($roster);
        sort($names);
        $this->assertSame(['Amy Lee', 'Zack Brown'], $names);
        $this->assertSame(40, $roster['Zack Brown']['break_min']);
        $this->assertTrue($roster['Zack Brown']['edited']);
        $this->assertTrue($roster['Zack Brown']['bot_seen']);
        $this->assertSame('fetched', $this->sheet()['Zack Brown|2026-05-04']['source']);
    }

    public function testDeletingADepartmentUnfilesPeopleSheetsAndReviewsButKeepsTheirRows(): void
    {
        $ids = $this->arrangeRoster();

        // The Review page's department tab writes into the same catalogue the Staff page reads.
        $r = $this->post('/review-departments', ['name' => 'Retention', 'month' => '2026-05', 'performance' => 'Good', 'percentage' => 70]);
        $this->assertStatus(201, $r);
        $retention = $r['json']['id'];
        $this->assertContains('Retention', array_column($this->get('/departments')['json'], 'name'));
        $this->assertStatus(200, $this->put("/staff/{$ids['amy']}", ['department_ids' => [$ids['sales'], $retention]]));

        $this->assertStatus(201, $this->post('/staff-leaves', ['staff_id' => $ids['amy'], 'department_id' => $retention, 'leave_date' => '2026-05-07']));
        $this->assertStatus(201, $this->post('/staff-salaries', ['staff_id' => $ids['amy'], 'department_id' => $retention, 'month' => '2026-05', 'amount' => 900]));
        $this->assertStatus(201, $this->post('/review-entries', ['kind' => 'performance', 'person_name' => 'Amy Lee', 'department_id' => $retention, 'month' => '2026-05']));

        // A second month's score, so the cascade is seen to take every month.
        $this->assertStatus(200, $this->put("/review-departments/{$retention}", ['month' => '2026-06', 'performance' => 'Average', 'percentage' => 55]));

        $this->assertSame(['deleted' => true], $this->delete("/departments/{$retention}")['json']);

        $amy = array_column($this->get('/staff')['json'], null, 'name')['Amy Lee'];
        $this->assertSame([['id' => $ids['sales'], 'name' => 'Sales']], $amy['departments']);
        $leave = $this->get('/staff-leaves?from=2026-05-01&to=2026-05-31')['json'][0];
        $this->assertSame([null, null], [$leave['department_id'], $leave['department_name']]);
        $salary = $this->get('/staff-salaries?month=2026-05')['json'][0];
        $this->assertEquals([null, 900.0], [$salary['department_id'], $salary['amount']]);
        $entry = $this->get('/review-entries?kind=performance&month=2026-05')['json'][0];
        $this->assertNull($entry['department_id']);
        $this->assertSame($ids['amy'], $entry['staff_id']);
        $this->assertSame(0, self::countRows('SELECT count(*) FROM department_reviews'));
        $this->assertSame(['Sales', 'Support'], array_column($this->get('/review-departments?month=2026-05')['json'], 'name'));
    }

    public function testAnAttendanceSupervisorCorrectsADayAndTheTrailSaysWho(): void
    {
        $ids = $this->arrangeRoster();
        $this->arrangeBotDays();

        // The Attendance page alone: enough to correct a day, not to see pay or leave.
        $sup = self::createEnrolledUser('sup', 'member', ['attendance']);
        $this->loginAs($sup);
        $this->assertStatus(403, $this->get('/staff-salaries?month=2026-05', true));
        $this->assertStatus(403, $this->get('/staff-leaves', true));
        $this->assertStatus(403, $this->post('/departments', ['name' => 'Rogue'], true));

        $r = $this->post('/staff-attendance', [
            'staff_id' => $ids['zack'], 'work_date' => '2026-05-05', 'login_at' => '09:00', 'logout_at' => '17:00', 'break_min' => 30, 'status' => 'present',
        ], true);
        $this->assertStatus(201, $r);
        $id = $r['json']['id'];
        $this->assertStatus(200, $this->put("/staff-attendance/{$id}", ['note' => 'forgot to log out'], true));

        $day = array_values(array_filter(
            $this->get('/attendance/days?from=2026-05-05&to=2026-05-05', true)['json']['rows'],
            static fn ($row) => $row['staff_id'] === $ids['zack']
        ))[0];
        $this->assertSame(['present', true, true], [$day['status'], $day['completed'], $day['edited']]);
        $this->assertSame('forgot to log out', $this->sheet()['Zack Brown|2026-05-05']['note']);

        $this->assertSame(['deleted' => true], $this->delete("/staff-attendance/{$id}", true)['json']);
        $this->assertSame('still in', $this->sheet()['Zack Brown|2026-05-05']['status']);

        $trail = array_values(array_filter(self::auditRows(), static fn ($r) => $r['entity_type'] === 'staff-attendance'));
        $this->assertSame(
            ['staff-attendance.create', 'staff-attendance.update', 'staff-attendance.delete'],
            array_column($trail, 'action')
        );
        foreach ($trail as $row) {
            $this->assertSame((int) $sup['id'], (int) $row['user_id']);
            $this->assertSame('sup@example.test', $row['user_email']);
        }
        $this->assertSame([null, $id, $id], array_map(static fn ($r) => $r['entity_id'] === null ? null : (int) $r['entity_id'], $trail));
        $this->assertSame(0, self::countRows("SELECT count(*) FROM audit_log WHERE path = '/departments'"), 'the refused write left no trace');
    }
}
