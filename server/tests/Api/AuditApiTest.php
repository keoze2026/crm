<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

final class AuditApiTest extends ApiTestCase
{
    use AuthApiHelpers;

    private array $admin;

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('users', 'sessions', 'audit_log', 'access_presets', 'buyers');
        $this->admin = $this->loginAsNewAdmin();
        self::resetTables('audit_log'); // drop the auth.login row from the helper
    }

    private static function log(string $action, array $extra = []): array
    {
        return self::insert('audit_log', ['action' => $action] + $extra);
    }

    // ─── index ─────────────────────────────────────────────────────────────────

    public function testIndexIsNewestFirstWithTotal(): void
    {
        $a = self::log('buyer.create', ['created_at' => '2026-09-01 10:00:00+00']);
        $b = self::log('buyer.update', ['created_at' => '2026-09-03 10:00:00+00']);
        $c = self::log('buyer.delete', ['created_at' => '2026-09-02 10:00:00+00']);

        $r = $this->get('/audit-logs', true);
        $this->assertStatus(200, $r);
        $this->assertSame(3, $r['json']['total']);
        $this->assertSame(50, $r['json']['limit']);
        $this->assertSame(0, $r['json']['offset']);
        $this->assertSame([(int) $b['id'], (int) $c['id'], (int) $a['id']], array_column($r['json']['rows'], 'id'));
    }

    public function testIndexPaginatesAndClampsLimit(): void
    {
        for ($i = 0; $i < 5; $i++) {
            self::log("a.{$i}");
        }

        $r = $this->get('/audit-logs?limit=2&offset=1', true)['json'];
        $this->assertSame(5, $r['total']);
        $this->assertSame(['a.3', 'a.2'], array_column($r['rows'], 'action'));

        $this->assertSame(1, $this->get('/audit-logs?limit=0', true)['json']['limit']);
        $this->assertSame(500, $this->get('/audit-logs?limit=100000', true)['json']['limit']);
        $this->assertSame(0, $this->get('/audit-logs?offset=-5', true)['json']['offset']);
    }

    public function testIndexCastsAndDecodesRow(): void
    {
        $bob = self::createEnrolledUser('bob');
        self::log('user.update', [
            'user_id' => (int) $this->admin['id'], 'user_email' => 'boss@example.test', 'method' => 'PATCH',
            'path' => "/admin/users/{$bob['id']}", 'entity_type' => 'user', 'entity_id' => (int) $bob['id'],
            'details' => ['name' => 'Bobby'], 'status_code' => 200,
        ]);

        $row = $this->get('/audit-logs', true)['json']['rows'][0];
        $this->assertSame((int) $this->admin['id'], $row['user_id']);
        $this->assertSame((int) $bob['id'], $row['entity_id']);
        $this->assertSame(200, $row['status_code']);
        $this->assertSame(['name' => 'Bobby'], $row['details']);
        $this->assertSame('Bob', $row['entity_label']);
    }

    public function testEntityLabelOnlyResolvesForUserEntities(): void
    {
        $bob = self::createEnrolledUser('bob');
        self::log('buyer.update', ['entity_type' => 'buyer', 'entity_id' => (int) $bob['id']]);
        $this->assertNull($this->get('/audit-logs', true)['json']['rows'][0]['entity_label']);
    }

    public function testIndexFilters(): void
    {
        $bob = self::createEnrolledUser('bob');
        self::log('buyer.create', ['user_id' => (int) $bob['id'], 'user_email' => 'bob@example.test', 'entity_type' => 'buyer', 'path' => '/buyers', 'created_at' => '2026-08-10 12:00:00+00']);
        self::log('staff-member.update', ['user_id' => (int) $this->admin['id'], 'user_email' => 'boss@example.test', 'entity_type' => 'staff-member', 'path' => '/staff/4', 'created_at' => '2026-08-20 12:00:00+00']);
        self::log('buyer.delete', ['user_id' => (int) $this->admin['id'], 'user_email' => 'boss@example.test', 'entity_type' => 'buyer', 'path' => '/buyers/9', 'created_at' => '2026-08-31 12:00:00+00']);

        $actions = fn (string $qs) => array_column($this->get("/audit-logs?{$qs}", true)['json']['rows'], 'action');

        $this->assertSame(['buyer.create'], $actions("user_id={$bob['id']}"));
        $this->assertSame(['buyer.delete'], $actions('action=buyer.delete'));
        $this->assertSame(['buyer.delete', 'buyer.create'], $actions('entity_type=buyer'));
        $this->assertSame(['buyer.delete', 'staff-member.update'], $actions('from=2026-08-15'));
        $this->assertSame(['staff-member.update', 'buyer.create'], $actions('to=2026-08-20'));
        $this->assertSame(['staff-member.update'], $actions('from=2026-08-15&to=2026-08-25'));
        $this->assertSame(['buyer.create'], $actions('q=BOB@'));
        $this->assertSame(['staff-member.update'], $actions('q=staff/4'));
        $this->assertSame(1, $this->get('/audit-logs?entity_type=buyer&user_id=' . $this->admin['id'], true)['json']['total']);
    }

    public function testIndexForbiddenWithoutLogsPage(): void
    {
        $this->loginAs(self::createEnrolledUser('peek', 'member', ['users']));
        $this->assertStatus(403, $this->get('/audit-logs', true));
    }

    public function testMemberWithLogsPageCanRead(): void
    {
        $this->loginAs(self::createEnrolledUser('auditor', 'member', ['logs']));
        $this->assertStatus(200, $this->get('/audit-logs', true));
    }

    // ─── actions ───────────────────────────────────────────────────────────────

    public function testActionsAreDistinctAndSorted(): void
    {
        self::log('buyer.update');
        self::log('auth.login');
        self::log('buyer.update');
        $r = $this->get('/audit-logs/actions', true);
        $this->assertStatus(200, $r);
        $this->assertSame(['auth.login', 'buyer.update'], $r['json']);
    }

    // ─── export ────────────────────────────────────────────────────────────────

    public function testExportStreamsFilteredCsvAndRecordsItself(): void
    {
        self::log('buyer.create', ['user_email' => 'x@example.test', 'method' => 'POST', 'path' => '/buyers', 'entity_type' => 'buyer', 'entity_id' => 7, 'status_code' => 201]);
        self::log('staff-member.update', ['entity_type' => 'staff-member']);

        $r = $this->get('/audit-logs/export?entity_type=buyer', true);
        $this->assertStatus(200, $r);
        $headers = implode("\n", $r['headers']);
        $this->assertStringContainsStringIgnoringCase('Content-Type: text/csv', $headers);
        $this->assertMatchesRegularExpression('/filename="system-logs-\d{4}-\d{2}-\d{2}\.csv"/', $headers);

        $lines = array_values(array_filter(explode("\n", trim($r['body']))));
        $this->assertSame('Time,User,Action,Method,Path,Entity,"Entity ID",Status,IP,Details', $lines[0]);
        $this->assertCount(2, $lines);
        $this->assertStringContainsString('x@example.test,buyer.create,POST,/buyers,buyer,7,201', $lines[1]);

        $export = self::auditRows('audit-log.export');
        $this->assertCount(1, $export);
        $this->assertSame((int) $this->admin['id'], (int) $export[0]['user_id']);
        $this->assertEquals(['scope' => ['entity_type' => 'buyer']], json_decode($export[0]['details'], true));
    }

    // ─── destroy / clear ───────────────────────────────────────────────────────

    public function testDestroyDeletesOneEntryAndRecordsIt(): void
    {
        $keep = self::log('keep.me');
        $drop = self::log('drop.me');

        $r = $this->delete("/audit-logs/{$drop['id']}", true);
        $this->assertStatus(200, $r);
        $this->assertSame(['deleted' => true], $r['json']);

        $this->assertSame(['keep.me', 'audit-log.delete'], array_column(self::auditRows(), 'action'));
        $entry = self::auditRows('audit-log.delete')[0];
        $this->assertSame((int) $drop['id'], (int) $entry['entity_id']);
        $this->assertSame((int) $this->admin['id'], (int) $entry['user_id']);
        $this->assertNotNull($keep);
    }

    public function testDestroyMissingEntryReportsFalse(): void
    {
        $r = $this->delete('/audit-logs/999999', true);
        $this->assertStatus(200, $r);
        $this->assertSame(['deleted' => false], $r['json']);
        $this->assertEquals(['deleted' => false], json_decode(self::auditRows('audit-log.delete')[0]['details'], true));
    }

    public function testClearDeletesOnlyFilteredEntries(): void
    {
        self::log('buyer.create', ['entity_type' => 'buyer']);
        self::log('buyer.update', ['entity_type' => 'buyer']);
        self::log('staff-member.update', ['entity_type' => 'staff-member']);

        $r = $this->delete('/audit-logs?entity_type=buyer', true);
        $this->assertStatus(200, $r);
        $this->assertSame(['deleted' => 2], $r['json']);

        $this->assertSame(['staff-member.update', 'audit-log.clear'], array_column(self::auditRows(), 'action'));
        $this->assertEquals(
            ['deleted' => 2, 'scope' => ['entity_type' => 'buyer']],
            json_decode(self::auditRows('audit-log.clear')[0]['details'], true)
        );
    }

    public function testClearWithoutFiltersLeavesOnlyTheRecordOfWhoCleared(): void
    {
        self::log('a');
        self::log('b');
        $r = $this->delete('/audit-logs', true);
        $this->assertSame(['deleted' => 2], $r['json']);

        $rows = self::auditRows();
        $this->assertCount(1, $rows);
        $this->assertSame('audit-log.clear', $rows[0]['action']);
        $this->assertSame((int) $this->admin['id'], (int) $rows[0]['user_id']);
    }

    public function testDeleteIsForbiddenWithoutLogsPage(): void
    {
        $e = self::log('precious');
        $this->loginAs(self::createEnrolledUser('vandal', 'member', null));
        $this->assertStatus(403, $this->delete("/audit-logs/{$e['id']}", true));
        $this->assertStatus(403, $this->delete('/audit-logs', true));
        $this->assertCount(1, self::auditRows('precious'));
    }

    // ─── Audit::flush for ordinary mutating requests ───────────────────────────

    public function testMutatingRequestsAreRecordedWithEntityAndStatus(): void
    {
        $created = $this->post('/buyers', ['code' => 'ACME', 'name' => 'Acme'], true);
        $this->assertStatus(201, $created);
        $id = $created['json']['id'];
        $this->assertStatus(200, $this->put("/buyers/{$id}", ['name' => 'Acme 2'], true));
        $this->assertStatus(200, $this->delete("/buyers/{$id}", true));

        $rows = self::auditRows();
        $this->assertSame(['buyer.create', 'buyer.update', 'buyer.delete'], array_column($rows, 'action'));

        $this->assertSame('POST', $rows[0]['method']);
        $this->assertSame('/buyers', $rows[0]['path']);
        $this->assertSame('buyer', $rows[0]['entity_type']);
        $this->assertNull($rows[0]['entity_id']);
        $this->assertSame(201, (int) $rows[0]['status_code']);
        $this->assertSame((int) $this->admin['id'], (int) $rows[0]['user_id']);
        $this->assertSame('boss@example.test', $rows[0]['user_email']);
        $this->assertEquals(['code' => 'ACME', 'name' => 'Acme'], json_decode($rows[0]['details'], true));

        $this->assertSame('PUT', $rows[1]['method']);
        $this->assertSame((int) $id, (int) $rows[1]['entity_id']);
        $this->assertSame("/buyers/{$id}", $rows[1]['path']);
        $this->assertSame((int) $id, (int) $rows[2]['entity_id']);
        $this->assertNull($rows[2]['details']);
    }

    public function testFailedMutationIsRecordedWithItsFinalStatus(): void
    {
        $this->assertStatus(422, $this->post('/buyers', ['name' => 'No code'], true));
        $rows = self::auditRows('buyer.create');
        $this->assertCount(1, $rows);
        $this->assertSame(422, (int) $rows[0]['status_code']);
    }

    public function testReadsAreNotRecorded(): void
    {
        $this->get('/buyers', true);
        $this->get('/audit-logs', true);
        $this->get('/admin/users', true);
        $this->assertSame([], self::auditRows());
    }

    public function testSecretsAreStrippedFromDetails(): void
    {
        $this->post('/buyers', ['code' => 'SEC', 'password' => 'hunter2', 'token' => 'abc', 'secret' => 's', 'totp_secret' => 't', 'enroll_token' => 'e'], true);
        $row = self::auditRows('buyer.create')[0];
        $this->assertStringNotContainsString('hunter2', $row['details']);
        $this->assertEquals(
            ['code' => 'SEC', 'password' => '***', 'token' => '***', 'secret' => '***', 'totp_secret' => '***', 'enroll_token' => '***'],
            json_decode($row['details'], true)
        );
    }

    public function testUsernameOnlyAccountIsAttributedByUsername(): void
    {
        $u = self::createEnrolledUser('nomail');
        self::db()->exec("UPDATE users SET email = NULL WHERE id = {$u['id']}");
        $this->loginAs($u);
        self::resetTables('audit_log');

        $this->post('/buyers', ['code' => 'U1'], true);
        $this->assertSame('nomail', self::auditRows('buyer.create')[0]['user_email']);
    }

    public function testNothingIsRecordedWhenAuthIsOff(): void
    {
        $this->assertStatus(201, $this->post('/buyers', ['code' => 'OFF']));
        $this->assertSame([], self::auditRows());
    }
}
