<?php

declare(strict_types=1);

namespace Tests\Integration;

use Tests\ApiTestCase;

/**
 * Auth ON: a member's data-entry session on the call-flow pages leaves exactly the audit
 * trail an admin later reads on System Logs, and page permissions gate the staff/queue/review
 * surfaces while the ungated call-flow ones keep working — including after an admin changes
 * the member's access mid-session.
 */
final class CallFlowAuditTrailIntegrationTest extends ApiTestCase
{
    private array $admin;
    private array $adminCookies;

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables(
            'users', 'sessions', 'audit_log', 'access_presets',
            'call_records', 'buyers', 'campaigns', 'destinations', 'vendors', 'vendor_payments', 'portal_expenses',
            'queue_assignment_codes', 'queue_assignments', 'queue_codes', 'staff'
        );
        $this->admin = self::createEnrolledUser('boss', 'admin');
        $this->loginAs($this->admin);
        $this->adminCookies = $this->cookies;
    }

    /** Log a member in on their own cookie jar and clear the trail of the logins. */
    private function memberSession(string $username, ?array $permissions): array
    {
        $member = self::createEnrolledUser($username, 'member', $permissions);
        $this->loginAs($member);
        self::resetTables('audit_log');
        return $member;
    }

    private function asAdmin(callable $fn): mixed
    {
        $mine = $this->cookies;
        $this->cookies = $this->adminCookies;
        try {
            return $fn();
        } finally {
            $this->adminCookies = $this->cookies;
            $this->cookies = $mine;
        }
    }

    /** @return array<int, array<string,mixed>> the trail as System Logs shows it, oldest first */
    private function trail(string $query = ''): array
    {
        $r = $this->asAdmin(fn () => $this->get('/audit-logs?limit=500' . ($query !== '' ? "&{$query}" : ''), true));
        $this->assertStatus(200, $r);
        return array_reverse($r['json']['rows']);
    }

    public function testADataEntrySessionLeavesAMatchingAuditTrail(): void
    {
        $member = $this->memberSession('clerk', null);

        $buyer = $this->post('/buyers', ['code' => 'RTG 04', 'name' => 'RTG 04', 'rate' => 30], true);
        $this->assertStatus(201, $buyer);
        $buyerId = $buyer['json']['id'];
        $this->assertStatus(200, $this->put("/buyers/{$buyerId}", ['code' => 'RTG 04', 'name' => 'RTG 04', 'rate' => 35], true));
        $rev = $this->post('/records', ['record_type' => 'buyer', 'record_date' => '2026-08-03', 'buyer_code' => 'RTG 04', 'counted' => 10], true);
        $this->assertStatus(201, $rev);
        $cost = $this->post('/records', ['record_type' => 'campaign', 'record_date' => '2026-08-03', 'campaign_code' => 'c3', 'source' => 'AdsTerra', 'rate' => 12, 'counted' => 5], true);
        $this->assertStatus(201, $cost);
        $this->assertStatus(422, $this->post('/records', ['record_type' => 'buyer', 'record_date' => '2026-08-03'], true));
        $this->assertStatus(200, $this->put("/records/{$rev['json']['id']}", ['counted' => 12], true));
        $this->assertStatus(201, $this->post('/vendor-payments', ['vendor' => 'AdsTerra', 'entry_date' => '2026-08-03', 'amount_paid' => 40], true));

        // Reads are not logged — except an export, which takes the data off the system.
        $summary = $this->get('/analytics/summary?from=2026-08-01&to=2026-08-31', true);
        $this->assertStatus(200, $summary);
        $this->assertEquals([420, 60], [$summary['json']['revenue'], $summary['json']['cost']]);
        $this->assertStatus(200, $this->get('/records?from=2026-08-01&to=2026-08-31', true));
        $export = $this->get('/records/export?from=2026-08-01&to=2026-08-31&type=', true);
        $this->assertStatus(200, $export);
        $this->assertStringContainsString('420.00', $export['body']);

        $this->assertStatus(200, $this->delete("/records/{$cost['json']['id']}", true));
        $this->assertStatus(200, $this->delete("/buyers/{$buyerId}", true));
        $this->assertSame(0, $this->get('/records', true)['json']['meta']['total']);

        $trail = $this->trail();
        $this->assertSame([
            ['buyer.create', 'POST', '/buyers', null, 201],
            ['buyer.update', 'PUT', "/buyers/{$buyerId}", $buyerId, 200],
            ['record.create', 'POST', '/records', null, 201],
            ['record.create', 'POST', '/records', null, 201],
            ['record.create', 'POST', '/records', null, 422],
            ['record.update', 'PUT', "/records/{$rev['json']['id']}", $rev['json']['id'], 200],
            ['vendor-payment.create', 'POST', '/vendor-payments', null, 201],
            ['record.export', 'GET', null, null, 200],
            ['record.delete', 'DELETE', "/records/{$cost['json']['id']}", $cost['json']['id'], 200],
            ['buyer.delete', 'DELETE', "/buyers/{$buyerId}", $buyerId, 200],
        ], array_map(static fn ($r) => [$r['action'], $r['method'], $r['path'], $r['entity_id'], $r['status_code']], $trail));

        foreach ($trail as $row) {
            $this->assertSame((int) $member['id'], $row['user_id']);
            $this->assertSame('clerk@example.test', $row['user_email']);
        }
        $this->assertEquals(['rate' => 35, 'code' => 'RTG 04', 'name' => 'RTG 04'], array_intersect_key($trail[1]['details'], ['rate' => 0, 'code' => 0, 'name' => 0]));
        $this->assertSame('c3', $trail[3]['details']['campaign_code']);
        $this->assertSame(['counted' => 12], $trail[5]['details']);
        $this->assertEquals(['scope' => ['from' => '2026-08-01', 'to' => '2026-08-31']], $trail[7]['details']);

        // The System Logs filters slice the same trail.
        $this->assertCount(6, $this->trail('entity_type=record'));
        $this->assertCount(3, $this->trail('action=record.create'));
        $this->assertCount(10, $this->trail('user_id=' . $member['id']));
        $this->assertCount(0, $this->trail('user_id=' . $this->admin['id']));
        $this->assertCount(2, $this->trail('q=buyers/' . $buyerId));
    }

    public function testPageGatesFollowTheMembersPermissionsWhileCallFlowStaysOpen(): void
    {
        $this->memberSession('analyst', ['dashboard', 'buyers', 'campaigns']);

        foreach (['/queues', '/queue-codes', '/staff', '/departments', '/staff-leaves', '/staff-salaries',
                  '/staff-attendance?from=2026-08-01&to=2026-08-31', '/review-entries?kind=performance&month=2026-08',
                  '/top-performer?month=2026-08', '/audit-logs', '/admin/users',
                  '/vendors', '/portal-expenses', '/attendance/roster'] as $path) {
            $this->assertStatus(403, $this->get($path, true));
        }
        $this->assertStatus(403, $this->post('/queue-codes', ['code' => 'BHS'], true));
        $this->assertStatus(403, $this->post('/staff', ['name' => 'Mallory'], true));

        // The Dashboard page grants the analytics surface, Complete Report included.
        foreach (['/records', '/buyers', '/campaigns', '/destinations',
                  '/analytics/summary', '/analytics/top-sources', '/analytics/complete-report'] as $path) {
            $this->assertStatus(200, $this->get($path, true));
        }
        $this->assertStatus(201, $this->post('/buyers', ['code' => 'OPEN'], true));

        // Refused requests change nothing and leave no trail; the allowed write does.
        $this->assertSame(0, (int) self::db()->query('SELECT count(*) FROM queue_codes')->fetchColumn());
        $this->assertSame(0, (int) self::db()->query('SELECT count(*) FROM staff')->fetchColumn());
        $this->assertSame(['buyer.create'], array_column($this->trail(), 'action'));
    }

    public function testSharedRosterIsReachableFromAnyPageThatPicksNamesFromIt(): void
    {
        $this->memberSession('supervisor', ['attendance']);

        $this->assertStatus(201, $this->post('/staff', ['name' => 'Zack'], true));
        $this->assertStatus(200, $this->get('/staff', true));
        $this->assertStatus(200, $this->get('/staff-attendance?from=2026-08-01&to=2026-08-31', true));
        $this->assertStatus(403, $this->get('/staff-leaves', true));
        $this->assertStatus(403, $this->get('/departments', true));
        $this->assertStatus(403, $this->get('/queues', true));
        $this->assertSame(['staff-member.create'], array_column($this->trail(), 'action'));
    }

    public function testAnAdminGrantingAPageOpensItOnTheMembersLiveSession(): void
    {
        $member = $this->memberSession('rota', ['dashboard']);
        $staff  = self::insert('staff', ['name' => 'Ann']);

        $this->assertStatus(403, $this->post('/queue-codes', ['code' => 'BHS'], true));

        $grant = $this->asAdmin(fn () => $this->patch("/admin/users/{$member['id']}", ['permissions' => ['dashboard', 'queues']], true));
        $this->assertStatus(200, $grant);

        $codes = $this->post('/queue-codes', ['code' => 'BHS'], true);
        $this->assertStatus(201, $codes);
        $row = $this->post('/queues', ['board' => 'camp_flow', 'person_id' => $staff['id'], 'code_ids' => [$codes['json']['created'][0]['id']]], true);
        $this->assertStatus(201, $row);
        // The queues page reads the roster through /staff, which the queues permission opens.
        $this->assertSame(['Ann'], array_column($this->get('/staff', true)['json'], 'name'));

        $this->asAdmin(fn () => $this->patch("/admin/users/{$member['id']}", ['permissions' => ['dashboard']], true));
        $this->assertStatus(403, $this->get('/queues?board=camp_flow', true));
        $this->assertStatus(403, $this->delete("/queues/{$row['json']['id']}", true));
        $this->assertSame(1, (int) self::db()->query('SELECT count(*) FROM queue_assignments')->fetchColumn());

        $trail = $this->trail();
        $this->assertSame(
            [['user.update', (int) $this->admin['id']], ['queue-code.create', (int) $member['id']],
             ['queue-assignment.create', (int) $member['id']], ['user.update', (int) $this->admin['id']]],
            array_map(static fn ($r) => [$r['action'], $r['user_id']], $trail)
        );
        $this->assertSame(['permissions' => ['dashboard', 'queues']], $trail[0]['details']);
        $this->assertSame((int) $member['id'], $trail[0]['entity_id']);
    }
}
