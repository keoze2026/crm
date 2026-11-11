<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

/**
 * A shift that runs past midnight, counted as ONE day.
 *
 * The check-in bot files every message under the calendar date it was sent and keeps one row
 * per person per date, so a night shift lands as two half-rows: the login on the date it
 * started, the logout on the row for the morning it ended — alongside THAT date's own login,
 * once the person is working nights every night. Read literally each of those rows says the
 * person left seven hours before arriving.
 *
 * These tests seed the bot's tables exactly as the bot writes them and assert the hours that
 * come back out: the day's own, the month's total, and the schedule marks for somebody whose
 * agreed hours cross midnight.
 */
final class AttendanceOvernightApiTest extends ApiTestCase
{
    use StaffFixtures;

    /** Three nights on, then a morning the person did not come back. */
    private const N1 = '2026-05-11';
    private const N2 = '2026-05-12';
    private const N3 = '2026-05-13';
    private const N4 = '2026-05-14';

    protected function setUp(): void
    {
        parent::setUp();
        self::resetStaffTables();
    }

    /**
     * Nina works 12:00 to 05:00. Seeded the way the bot records it: the logout of each night
     * is written onto the NEXT date's row, which from the second night on already carries
     * that date's own login.
     */
    private static function seedNina(array $extra = ['expected_login' => '12:00', 'expected_logout' => '05:00']): array
    {
        self::botAccount(2001, 'Nina');
        $s = self::staffRow('Nina', ['attendance_user_id' => '2001'] + $extra);
        self::botDay(2001, self::N1, '12:00', null,    'Nina');   // first night: no logout yet
        self::botDay(2001, self::N2, '12:00', '05:00', 'Nina');   // 05:00 closed the N1 shift
        self::botDay(2001, self::N3, '12:00', '05:00', 'Nina');   // 05:00 closed the N2 shift
        self::botDay(2001, self::N4, null,    '05:00', 'Nina');   // 05:00 closed the N3 shift
        return $s;
    }

    private function days(string $from, string $to): array
    {
        $r = $this->get("/attendance/days?from={$from}&to={$to}");
        $this->assertStatus(200, $r);
        return array_column($r['json']['rows'], null, 'work_date');
    }

    // ─── The stitch ────────────────────────────────────────────────────────────

    public function testEachNightIsOneSeventeenHourDay(): void
    {
        self::seedNina();

        $rows = $this->days(self::N1, self::N4);

        // Three nights worked, newest first, and the morning after the last one is not a day
        // of its own.
        $this->assertSame([self::N3, self::N2, self::N1], array_keys($rows));

        foreach ([self::N1, self::N2, self::N3] as $night) {
            $this->assertEqualsWithDelta(17.0, $rows[$night]['hours'], 0.001, "hours on {$night}");
            $this->assertSame('present', $rows[$night]['status'], "status on {$night}");
            $this->assertTrue($rows[$night]['completed'], "completed on {$night}");
        }

        // Each night's logout is the 05:00 the bot filed under the following date.
        $this->assertSame(self::N1 . ' 12:00', self::asLocal($rows[self::N1]['login_at']));
        $this->assertSame(self::N2 . ' 05:00', self::asLocal($rows[self::N1]['logout_at']));
        $this->assertSame(self::N3 . ' 05:00', self::asLocal($rows[self::N2]['logout_at']));
        $this->assertSame(self::N4 . ' 05:00', self::asLocal($rows[self::N3]['logout_at']));
    }

    public function testTheMonthTotalAddsTheNightsUpRatherThanSubtractingThem(): void
    {
        self::seedNina();

        $r = $this->get('/attendance/summary?from=' . self::N1 . '&to=' . self::N4);
        $this->assertStatus(200, $r);
        $row = $r['json'][0];

        $this->assertSame('Nina', $row['staff_name']);
        $this->assertSame(3, (int) $row['days_present']);
        $this->assertSame(3, (int) $row['days_complete']);
        $this->assertEqualsWithDelta(51.0, $row['total_hours'], 0.001);
    }

    public function testTheNightIsNotAMissingLogoutNorTheMorningAnAbsence(): void
    {
        self::seedNina();

        $r = $this->get('/attendance/exceptions?type=missing_logout&from=' . self::N1 . '&to=' . self::N4);
        $this->assertStatus(200, $r);
        // N3 is the last night with a logout; nothing is open but a shift that has not ended.
        $this->assertSame([], array_column($r['json']['rows'], 'work_date'));

        // The morning after the last night is not on the roster at all.
        $roster = $this->get('/attendance/roster?date=' . self::N4);
        $this->assertStatus(200, $roster);
        $this->assertSame([], $roster['json']['rows']);
    }

    public function testAnOpenNightStillReadsAsStillIn(): void
    {
        self::botAccount(2002, 'Owen');
        self::staffRow('Owen', ['attendance_user_id' => '2002']);
        self::botDay(2002, self::N1, '12:00', null, 'Owen');

        $rows = $this->days(self::N1, self::N1);
        $this->assertNull($rows[self::N1]['logout_at']);
        $this->assertNull($rows[self::N1]['hours']);
        $this->assertSame('still in', $rows[self::N1]['status']);
    }

    // ─── What the stitch must NOT do ───────────────────────────────────────────

    public function testADayShiftKeepsItsOwnLogout(): void
    {
        self::botAccount(2003, 'Dana');
        self::staffRow('Dana', ['attendance_user_id' => '2003']);
        self::botDay(2003, self::N1, '09:00', '17:00', 'Dana');
        self::botDay(2003, self::N2, '09:00', '17:00', 'Dana');

        $rows = $this->days(self::N1, self::N2);
        $this->assertEqualsWithDelta(8.0, $rows[self::N1]['hours'], 0.001);
        $this->assertEqualsWithDelta(8.0, $rows[self::N2]['hours'], 0.001);
        $this->assertSame(self::N1 . ' 17:00', self::asLocal($rows[self::N1]['logout_at']));
    }

    public function testAForgottenLogoutDoesNotAdoptTheNextEveningsOne(): void
    {
        self::botAccount(2004, 'Finn');
        self::staffRow('Finn', ['attendance_user_id' => '2004']);
        self::botDay(2004, self::N1, '09:00', null, 'Finn');      // forgot to log out
        self::botDay(2004, self::N2, null, '17:00', 'Finn');      // and forgot to log in

        $rows = $this->days(self::N1, self::N2);
        // 17:00 the next day is 32 hours on — beyond any shift, so neither row borrows it.
        $this->assertNull($rows[self::N1]['logout_at']);
        $this->assertNull($rows[self::N1]['hours']);
        $this->assertSame(self::N2 . ' 17:00', self::asLocal($rows[self::N2]['logout_at']));
        $this->assertSame('absent', $rows[self::N2]['status']);
    }

    public function testALogoutWithNoShiftBeforeItIsStillItsOwnDay(): void
    {
        self::botAccount(2005, 'Gus');
        self::staffRow('Gus', ['attendance_user_id' => '2005']);
        self::botDay(2005, self::N2, null, '05:00', 'Gus');       // nothing at all on N1

        $rows = $this->days(self::N1, self::N2);
        $this->assertArrayHasKey(self::N2, $rows);
        $this->assertSame(self::N2 . ' 05:00', self::asLocal($rows[self::N2]['logout_at']));
        $this->assertNull($rows[self::N2]['login_at']);
    }

    // ─── Corrections ───────────────────────────────────────────────────────────

    public function testAKeyedInNightCountsAsSeventeenHoursNotMinusSeven(): void
    {
        $s = self::seedNina();
        // The supervisor keys the shift in by hand: in 12:00, out 05:00 — the only way two
        // clock cells on one date can say "the next morning".
        self::insert('staff_attendance', [
            'staff_id'  => $s['id'],
            'work_date' => self::N1,
            'login_at'  => '12:00',
            'logout_at' => '05:00',
            'break_min' => 60,
        ]);

        $rows = $this->days(self::N1, self::N1);
        $this->assertTrue($rows[self::N1]['edited']);
        $this->assertSame(self::N2 . ' 05:00', self::asLocal($rows[self::N1]['logout_at']));
        $this->assertEqualsWithDelta(17.0, $rows[self::N1]['hours'], 0.001);
        $this->assertEqualsWithDelta(16.0, $rows[self::N1]['net_hours'], 0.001);
    }

    public function testAKeyedInDayShiftIsUnchanged(): void
    {
        $s = self::staffRow('Pia');
        self::insert('staff_attendance', [
            'staff_id'  => $s['id'],
            'work_date' => self::N1,
            'login_at'  => '09:00',
            'logout_at' => '17:30',
            'break_min' => 30,
        ]);

        $rows = $this->days(self::N1, self::N1);
        $this->assertEqualsWithDelta(8.5, $rows[self::N1]['hours'], 0.001);
        $this->assertEqualsWithDelta(8.0, $rows[self::N1]['net_hours'], 0.001);
    }

    // ─── Schedule marks on a night shift ───────────────────────────────────────

    public function testANightScheduleIsJudgedOnItsOwnClock(): void
    {
        self::botAccount(2006, 'Remy');
        self::staffRow('Remy', [
            'attendance_user_id' => '2006',
            'expected_login'     => '12:00',
            'expected_logout'    => '05:00',
        ]);
        self::botDay(2006, self::N1, '12:20', null,    'Remy');   // 20 late in
        self::botDay(2006, self::N2, '12:00', '04:30', 'Remy');   // out 30 early, closing N1

        $rows = $this->days(self::N1, self::N2);
        $this->assertSame(20, $rows[self::N1]['late_min']);
        $this->assertSame(30, $rows[self::N1]['early_min']);
        $this->assertSame('12:00', $rows[self::N1]['expected_login']);
        $this->assertSame('05:00', $rows[self::N1]['expected_logout']);
    }

    public function testStayingPastMidnightIsNotCountedAsLeavingEarly(): void
    {
        self::botAccount(2007, 'Ivy');
        self::staffRow('Ivy', [
            'attendance_user_id' => '2007',
            'expected_login'     => '12:00',
            'expected_logout'    => '21:00',
        ]);
        self::botDay(2007, self::N1, '12:00', null,    'Ivy');
        self::botDay(2007, self::N2, '12:00', '05:00', 'Ivy');    // eight hours PAST the plan

        $rows = $this->days(self::N1, self::N2);
        $this->assertSame(0, $rows[self::N1]['late_min']);
        $this->assertSame(0, $rows[self::N1]['early_min'], 'a late finish is not an early one');
        $this->assertEqualsWithDelta(17.0, $rows[self::N1]['hours'], 0.001);
    }

    public function testTheLateReportReadsANightScheduleTheShortWayRound(): void
    {
        self::botAccount(2008, 'Kai');
        self::staffRow('Kai', [
            'attendance_user_id' => '2008',
            'expected_login'     => '21:00',
            'expected_logout'    => '06:00',
        ]);
        self::botDay(2008, self::N1, '21:25', null,    'Kai');    // 25 late
        self::botDay(2008, self::N2, '20:40', '06:00', 'Kai');    // 20 early — not late at all

        $r = $this->get('/attendance/exceptions?type=late&from=' . self::N1 . '&to=' . self::N2);
        $this->assertStatus(200, $r);
        $rows = array_column($r['json']['rows'], null, 'work_date');

        $this->assertSame([self::N1], array_keys($rows));
        $this->assertSame(25, (int) $rows[self::N1]['late_min']);
    }
}
