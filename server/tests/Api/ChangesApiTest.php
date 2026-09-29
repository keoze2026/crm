<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

final class ChangesApiTest extends ApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('data_versions', 'queue_codes', 'users', 'sessions', 'audit_log');
    }

    /** @return array<string,int> */
    private function versions(): array
    {
        $r = $this->get('/changes');
        $this->assertStatus(200, $r);
        return $r['json']['versions'];
    }

    public function testAnswersTheCountersAndTheBotFingerprint(): void
    {
        $r = $this->get('/changes');
        $this->assertStatus(200, $r);
        $this->assertTrue($r['json']['tracking']);
        $this->assertSame([], $r['json']['versions']);
        $this->assertArrayHasKey('bot', $r['json']);
    }

    public function testASuccessfulWriteBumpsItsArea(): void
    {
        $this->assertStatus(201, $this->post('/queue-codes', ['codes' => ['BHS']]));
        $this->assertSame(['queues' => 1], $this->versions());

        $this->post('/queue-codes', ['codes' => ['BOP']]);
        $this->assertSame(['queues' => 2], $this->versions());
    }

    public function testARefusedWriteBumpsNothing(): void
    {
        $r = $this->put('/queue-codes/999999', ['code' => 'X']);
        $this->assertGreaterThanOrEqual(400, $r['status']);
        $this->assertSame([], $this->versions());
    }

    public function testReadsBumpNothing(): void
    {
        $this->get('/queue-codes');
        $this->assertSame([], $this->versions());
    }

    public function testTheBotFingerprintMovesWhenTheBotWrites(): void
    {
        self::resetTables('attendance_days', 'attendance_breaks');
        $before = $this->get('/changes')['json']['bot'];
        self::db()->exec(
            "INSERT INTO attendance_days (user_id, staff_name, work_date, login_at)
             VALUES (42, 'Anna', CURRENT_DATE, now())"
        );
        $this->assertNotSame($before, $this->get('/changes')['json']['bot']);
    }

    public function testNeedsASignedInUserWhenAuthIsOn(): void
    {
        $this->assertStatus(401, $this->get('/changes', true));
    }
}
