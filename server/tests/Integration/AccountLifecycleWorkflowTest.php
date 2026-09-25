<?php

declare(strict_types=1);

namespace Tests\Integration;

use OTPHP\InternalClock;
use OTPHP\TOTP;
use Tests\Api\AuthApiHelpers;
use Tests\ApiTestCase;

/**
 * An account from creation to deletion, driven the way an admin and the new user would drive
 * it from two browsers: the admin's session and the user's session are separate cookie jars,
 * and every access change is checked on the user's NEXT request without logging in again.
 */
final class AccountLifecycleWorkflowTest extends ApiTestCase
{
    use AuthApiHelpers;

    /** @var array<string, array<string,string>> */
    private array $jars = [];
    private ?string $current = null;
    private array $admin;

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables(
            'users', 'sessions', 'audit_log', 'access_presets', 'staff',
            'review_entries', 'queue_assignment_codes', 'queue_assignments', 'queue_codes'
        );
        $this->admin = $this->loginAsNewAdmin('boss');
        $this->jars  = ['admin' => $this->cookies];
        $this->current = 'admin';
    }

    /** Switch browsers: park the current cookie jar and pick up another (empty if new). */
    private function actingAs(string $who): void
    {
        if ($this->current !== null) {
            $this->jars[$this->current] = $this->cookies;
        }
        $this->cookies = $this->jars[$who] ?? [];
        $this->current = $who;
    }

    /** Enrol through the public endpoints with a link token; returns the new TOTP secret. */
    private function enrolWith(string $token): string
    {
        $r = $this->post('/auth/enroll/start', ['token' => $token], true);
        $this->assertStatus(200, $r);
        $secret = $r['json']['secret'];
        $r = $this->post('/auth/enroll/confirm', ['token' => $token, 'code' => self::totpCode($secret)], true);
        $this->assertStatus(200, $r);
        return $secret;
    }

    /** What the admin's user table says this account may open. */
    private function adminSeesPermissions(int $userId): ?array
    {
        $this->actingAs('admin');
        $r = $this->get('/admin/users', true);
        $this->assertStatus(200, $r);
        foreach ($r['json'] as $row) {
            if ($row['id'] === $userId) {
                return $row['permissions'];
            }
        }
        $this->fail("User {$userId} missing from /admin/users");
    }

    /** @param array<string,int> $expected path => status */
    private function assertAccess(array $expected): void
    {
        foreach ($expected as $path => $status) {
            $r = $this->get($path, true);
            $this->assertSame($status, $r['status'], "GET {$path}: {$r['body']}");
        }
    }

    public function testAccountLifecycleFromCreationToDeletion(): void
    {
        // Admin prepares a preset, then creates Jane with her own narrow list.
        $r = $this->post('/admin/access-presets', ['name' => 'Queue desk', 'pages' => ['queues']], true);
        $this->assertStatus(201, $r);
        $presetId = $r['json']['id'];

        $r = $this->post('/admin/users', ['username' => 'jane', 'name' => 'Jane', 'permissions' => ['reviews']], true);
        $this->assertStatus(201, $r);
        $janeId = $r['json']['id'];
        $token  = $r['json']['enroll']['token'];
        $this->assertFalse($r['json']['totp_enabled']);
        $this->assertStringContainsString($token, $r['json']['enroll']['path']);

        // A pending account cannot log in yet.
        $this->actingAs('jane');
        $r = $this->post('/auth/login', ['identifier' => 'jane'], true);
        $this->assertStatus(403, $r);
        $this->assertSame('NOT_ENROLLED', $r['json']['code']);

        // Jane enrols from the link and is logged straight in.
        $secret = $this->enrolWith($token);
        $me = $this->get('/auth/me', true);
        $this->assertStatus(200, $me);
        $this->assertSame(['reviews'], $me['json']['user']['permissions']);
        $this->assertTrue($me['json']['user']['totp_enabled']);

        // The link is single-use.
        $this->assertStatus(403, $this->post('/auth/enroll/start', ['token' => $token], true));

        // She sees only what `reviews` opens — including the shared roster behind it.
        $this->assertAccess([
            '/review-entries?kind=performance&month=2026-08' => 200,
            '/top-performer?month=2026-08'                   => 200,
            '/staff'                                         => 200,
            '/queues'                                        => 403,
            '/departments'                                   => 403,
            '/staff-salaries?month=2026-08'                  => 403,
            '/admin/users'                                   => 403,
            '/audit-logs'                                    => 403,
        ]);
        $r = $this->post('/review-entries', ['kind' => 'performance', 'person_name' => 'Zed', 'month' => '2026-08'], true);
        $this->assertStatus(201, $r);
        $this->assertStatus(403, $this->post('/queues', ['person_id' => 1], true));
        $this->assertSame(['reviews'], $this->adminSeesPermissions($janeId));

        // Admin attaches the preset: Jane's very next request follows it, no re-login.
        $this->actingAs('admin');
        $this->assertStatus(200, $this->patch("/admin/users/{$janeId}", ['preset_id' => $presetId], true));
        $this->actingAs('jane');
        $this->assertAccess(['/queues' => 200, '/review-entries?kind=performance&month=2026-08' => 403]);
        $this->assertSame(['queues'], $this->get('/auth/me', true)['json']['user']['permissions']);
        $this->assertSame(['queues'], $this->adminSeesPermissions($janeId));

        // Editing the preset reaches her live as well.
        $this->assertStatus(200, $this->put("/admin/access-presets/{$presetId}", ['pages' => ['queues', 'staff']], true));
        $this->actingAs('jane');
        $this->assertAccess(['/departments' => 200, '/staff-salaries?month=2026-08' => 200]);

        // An explicit list detaches her from the preset; later preset edits no longer reach her.
        $this->actingAs('admin');
        $r = $this->patch("/admin/users/{$janeId}", ['permissions' => ['attendance']], true);
        $this->assertStatus(200, $r);
        $this->assertNull($r['json']['preset_id']);
        $this->assertStatus(200, $this->put("/admin/access-presets/{$presetId}", ['pages' => ['queues', 'staff', 'reviews']], true));
        $this->actingAs('jane');
        $this->assertAccess([
            '/staff-attendance?from=2026-08-01&to=2026-08-31' => 200,
            '/attendance/roster?date=2026-08-03'              => 200,
            '/queues'                                         => 403,
            '/departments'                                    => 403,
            '/review-entries?kind=performance&month=2026-08'  => 403,
        ]);
        $this->assertSame(['attendance'], $this->adminSeesPermissions($janeId));

        // Deactivation kills her live session at once, and she cannot start a new one.
        $this->assertStatus(200, $this->patch("/admin/users/{$janeId}", ['is_active' => false], true));
        $this->assertSame(0, self::countRows('SELECT count(*) FROM sessions WHERE user_id = :id', [':id' => $janeId]));
        $this->actingAs('jane');
        $this->assertStatus(401, $this->get('/auth/me', true));
        $this->assertStatus(401, $this->get('/staff-attendance', true));
        $this->assertStatus(401, $this->post('/auth/login', ['identifier' => 'jane'], true));

        // Reactivated, the old session stays dead but a fresh login works.
        $this->actingAs('admin');
        $this->assertStatus(200, $this->patch("/admin/users/{$janeId}", ['is_active' => true], true));
        $this->actingAs('jane');
        $this->assertStatus(401, $this->get('/auth/me', true));
        $this->loginAs(['username' => 'jane', 'secret' => $secret]);
        $this->assertStatus(200, $this->get('/auth/me', true));

        // Lost phone: admin resets the authenticator. Her session dies and the old secret is useless.
        $this->actingAs('admin');
        $r = $this->post("/admin/users/{$janeId}/reset-totp", [], true);
        $this->assertStatus(200, $r);
        $newToken = $r['json']['enroll']['token'];
        $this->assertNotSame($token, $newToken);
        $this->actingAs('jane');
        $this->assertStatus(401, $this->get('/auth/me', true));
        $r = $this->post('/auth/login', ['identifier' => 'jane'], true);
        $this->assertStatus(403, $r);
        $this->assertSame('NOT_ENROLLED', $r['json']['code']);

        // Re-enrolment issues a different secret; her access survived the reset untouched.
        $this->cookies = [];
        $newSecret = $this->enrolWith($newToken);
        $this->assertNotSame($secret, $newSecret);
        $this->assertSame(['attendance'], $this->get('/auth/me', true)['json']['user']['permissions']);
        $this->assertStatus(204, $this->post('/auth/logout', [], true));
        $this->loginAs(['username' => 'jane', 'secret' => $newSecret]);
        $this->assertStatus(200, $this->get('/auth/me', true));

        // Admin deletes her: sessions go, the trail stays.
        $this->actingAs('admin');
        $r = $this->delete("/admin/users/{$janeId}", true);
        $this->assertStatus(200, $r);
        $this->actingAs('jane');
        $this->assertStatus(401, $this->get('/auth/me', true));
        $this->assertStatus(401, $this->post('/auth/login', ['identifier' => 'jane'], true));

        $adminId = (int) $this->admin['id'];
        // The admin's own login in setUp is not part of Jane's story.
        $byAction = [];
        foreach (self::auditRows() as $row) {
            if (str_starts_with($row['action'], 'auth.') && (int) $row['entity_id'] !== $janeId) {
                continue;
            }
            $byAction[$row['action']][] = $row;
        }

        // Admin actions: attributed to the admin, about Jane.
        foreach (['user.create' => 1, 'user.update' => 4, 'user.reset_totp' => 1, 'user.delete' => 1] as $action => $n) {
            $this->assertCount($n, $byAction[$action] ?? [], $action);
            foreach ($byAction[$action] as $row) {
                $this->assertSame($adminId, (int) $row['user_id'], $action);
                $this->assertSame('user', $row['entity_type'], $action);
                $this->assertSame($janeId, (int) $row['entity_id'], $action);
            }
        }
        $this->assertCount(2, $byAction['access-preset.update'] ?? []);
        $this->assertSame(['username' => 'jane'], json_decode($byAction['user.delete'][0]['details'], true));
        $updates = array_map(static fn ($r) => json_decode($r['details'], true), $byAction['user.update']);
        $this->assertSame(
            [['preset_id' => $presetId], ['permissions' => ['attendance']], ['is_active' => false], ['is_active' => true]],
            $updates
        );

        // Jane's own actions: two enrolments, one login, one logout, one review written. Her
        // account is gone, so user_id was SET NULL — the rows themselves remain.
        $this->assertCount(2, $byAction['auth.enrolled'] ?? []);
        $this->assertCount(2, $byAction['auth.login'] ?? [], 'the reactivation login and the post-reset login');
        $this->assertCount(1, $byAction['auth.logout'] ?? []);
        $this->assertCount(1, $byAction['review-entry.create'] ?? []);
        foreach (['auth.enrolled', 'auth.login', 'auth.logout', 'review-entry.create'] as $action) {
            foreach ($byAction[$action] as $row) {
                $this->assertNull($row['user_id'], "{$action} keeps no dangling user id");
                if ($row['entity_type'] === 'user') {
                    $this->assertSame($janeId, (int) $row['entity_id'], $action);
                }
            }
        }
        $this->assertSame('jane', $byAction['review-entry.create'][0]['user_email']);
        $this->assertSame('jane', $byAction['auth.logout'][0]['user_email']);

        // Forbidden attempts never reached the trail, nor the data.
        $this->assertArrayNotHasKey('queue-assignment.create', $byAction);
        $this->assertSame(0, self::countRows('SELECT count(*) FROM queue_assignments'));

        // System Logs still reads the entries, now without a live account to label them.
        $this->actingAs('admin');
        $r = $this->get('/audit-logs?limit=500', true);
        $this->assertStatus(200, $r);
        $this->assertSame(\count(self::auditRows()), $r['json']['total']);
        foreach ($r['json']['rows'] as $row) {
            if ($row['entity_type'] === 'user' && (int) $row['entity_id'] === $janeId) {
                $this->assertNull($row['entity_label']);
            }
        }
    }

    /**
     * Audit::write falls back to the username so username-only accounts are not shown as "—"
     * in System Logs. The login and enrolment entries build their actor from id + email only,
     * so for such an account those rows carry no name at all — and once the account is
     * deleted (user_id SET NULL) nothing says who logged in.
     */
    public function testUsernameOnlyAccountsLoginAndEnrolmentEntriesNameTheirActor(): void
    {
        $r = $this->post('/admin/users', ['username' => 'kim', 'name' => 'Kim'], true);
        $this->assertStatus(201, $r);
        $kimId = $r['json']['id'];

        $this->actingAs('kim');
        $secret = $this->enrolWith($r['json']['enroll']['token']);
        $this->post('/auth/logout', [], true);
        $this->cookies = [];
        $this->post('/auth/login', ['identifier' => 'kim'], true);
        $this->assertStatus(401, $this->post('/auth/verify-totp', ['code' => self::wrongCode($secret)], true));
        $this->assertStatus(200, $this->post('/auth/verify-totp', ['code' => self::totpCode($secret)], true));

        $this->actingAs('admin');
        $this->assertStatus(200, $this->delete("/admin/users/{$kimId}", true));

        foreach (['auth.enrolled', 'auth.logout', 'auth.login_failed', 'auth.login'] as $action) {
            // Kim's rows only: the admin logging back in above writes an auth.login of its own.
            $rows = array_values(array_filter(self::auditRows($action), static fn (array $r) => (int) $r['entity_id'] === $kimId));
            $this->assertCount(1, $rows, $action);
            $this->assertSame('kim', $rows[0]['user_email'], "{$action} must still name its actor after deletion");
        }
    }

    public function testAccountCreatedFromTheRosterSurvivesTheStaffMemberBeingRemoved(): void
    {
        $staffId = (int) self::insert('staff', ['name' => 'Ada Lovelace'])['id'];

        $r = $this->post('/admin/users', ['staff_id' => $staffId], true);
        $this->assertStatus(201, $r);
        $this->assertSame('ada.lovelace', $r['json']['username']);
        $this->assertSame('Ada Lovelace', $r['json']['name']);
        $userId = $r['json']['id'];

        // A second account for the same person is refused while the link stands…
        $this->assertStatus(409, $this->post('/admin/users', ['staff_id' => $staffId, 'username' => 'ada2'], true));

        $this->actingAs('ada');
        $secret = $this->enrolWith($r['json']['enroll']['token']);

        // …and removing her from the roster (through the Staff page) leaves the login working.
        $this->actingAs('admin');
        $this->assertStatus(200, $this->delete("/staff/{$staffId}", true));
        $row = self::userRow($userId);
        $this->assertNull($row['staff_id']);
        $this->assertTrue((bool) $row['is_active']);

        $this->actingAs('ada');
        $this->assertStatus(200, $this->get('/auth/me', true));
        $this->loginAs(['username' => 'ada.lovelace', 'secret' => $secret]);

        // The staff removal was audited under the admin, against the staff entity.
        $rows = self::auditRows('staff-member.delete');
        $this->assertCount(1, $rows);
        $this->assertSame((int) $this->admin['id'], (int) $rows[0]['user_id']);
        $this->assertSame($staffId, (int) $rows[0]['entity_id']);
    }

    public function testBatchLinkRefreshOnlyReissuesForPeopleWhoHaveNotEnrolled(): void
    {
        $a = $this->post('/admin/users', ['username' => 'pending1'], true)['json'];
        $b = $this->post('/admin/users', ['username' => 'pending2'], true)['json'];
        $c = $this->post('/admin/users', ['username' => 'done'], true)['json'];

        $this->actingAs('done');
        $this->enrolWith($c['enroll']['token']);

        $this->actingAs('admin');
        $r = $this->post('/admin/users/enroll-links', [], true);
        $this->assertStatus(200, $r);
        $links = array_column($r['json']['links'], 'enroll', 'username');
        $this->assertSame(['pending1', 'pending2'], array_keys($links));

        // Old links are dead, new ones work, and the enrolled account was not disturbed.
        $this->actingAs('pending1');
        $this->assertStatus(403, $this->post('/auth/enroll/start', ['token' => $a['enroll']['token']], true));
        $this->enrolWith($links['pending1']['token']);
        $this->assertStatus(200, $this->get('/auth/me', true));
        $this->actingAs('pending2');
        $this->assertStatus(403, $this->post('/auth/enroll/start', ['token' => $b['enroll']['token']], true));

        $this->actingAs('done');
        $this->assertStatus(200, $this->get('/auth/me', true));

        $rows = self::auditRows('user.refresh_enroll_links');
        $this->assertCount(1, $rows);
        $this->assertSame([$a['id'], $b['id']], json_decode($rows[0]['details'], true)['user_ids']);
    }

    public function testDeletingAnAttachedPresetKeepsItsMembersExactAccessLive(): void
    {
        $presetId = $this->post('/admin/access-presets', ['name' => 'Payroll', 'pages' => ['staff']], true)['json']['id'];
        $r = $this->post('/admin/users', ['username' => 'pat', 'preset_id' => $presetId], true);
        $this->assertStatus(201, $r);
        $this->assertSame(['staff'], $r['json']['permissions']);

        $this->actingAs('pat');
        $this->enrolWith($r['json']['enroll']['token']);
        $this->assertAccess(['/staff-salaries?month=2026-08' => 200, '/queues' => 403]);

        $this->actingAs('admin');
        $this->assertStatus(200, $this->delete("/admin/access-presets/{$presetId}", true));

        // Same session, same access — not the wider default list.
        $this->actingAs('pat');
        $this->assertAccess(['/staff-salaries?month=2026-08' => 200, '/queues' => 403]);
        $this->assertSame(['staff'], $this->get('/auth/me', true)['json']['user']['permissions']);
    }
}
