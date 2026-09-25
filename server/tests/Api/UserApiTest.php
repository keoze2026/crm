<?php

declare(strict_types=1);

namespace Tests\Api;

use App\Auth\Pages;
use Tests\ApiTestCase;

final class UserApiTest extends ApiTestCase
{
    use AuthApiHelpers;

    private array $admin;

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('users', 'sessions', 'audit_log', 'access_presets', 'staff');
        $this->admin = $this->loginAsNewAdmin();
    }

    private function createUser(array $body): array
    {
        return $this->post('/admin/users', $body, true);
    }

    // ─── index ─────────────────────────────────────────────────────────────────

    public function testIndexListsAccountsNewestFirstWithoutSecrets(): void
    {
        $preset = self::insert('access_presets', ['name' => 'Desk', 'pages' => ['queues']]);
        $member = self::createEnrolledUser('member', 'member', ['staff']);
        self::db()->exec("UPDATE users SET preset_id = {$preset['id']} WHERE id = {$member['id']}");
        $pending = self::createPendingUser('pending');

        $r = $this->get('/admin/users', true);
        $this->assertStatus(200, $r);
        $rows = $r['json'];
        $this->assertSame([(int) $pending['id'], (int) $member['id'], (int) $this->admin['id']], array_column($rows, 'id'));

        foreach ($rows as $row) {
            $this->assertArrayNotHasKey('totp_secret', $row);
            $this->assertArrayNotHasKey('enroll_token_hash', $row);
        }

        $m = $rows[1];
        $this->assertSame(['queues'], $m['permissions']);
        $this->assertSame(['staff'], $m['own_permissions']);
        $this->assertSame((int) $preset['id'], $m['preset_id']);
        $this->assertSame('Desk', $m['preset_name']);
        $this->assertTrue($m['totp_enabled']);
        $this->assertFalse($m['enroll_link_active']);

        $p = $rows[0];
        $this->assertFalse($p['totp_enabled']);
        $this->assertTrue($p['enroll_link_active']);
        $this->assertNull($p['permissions']);
    }

    public function testIndexIsForbiddenToMembersWithoutUsersPage(): void
    {
        $this->loginAs(self::createEnrolledUser('plain'));
        $this->assertStatus(403, $this->get('/admin/users', true));
    }

    public function testMemberGrantedUsersPageCanManageAccounts(): void
    {
        $this->loginAs(self::createEnrolledUser('hr', 'member', ['users']));
        $this->assertStatus(200, $this->get('/admin/users', true));
        $this->assertStatus(201, $this->createUser(['username' => 'viahr']));
    }

    // ─── store ─────────────────────────────────────────────────────────────────

    public function testStoreRejectsUnknownRole(): void
    {
        $r = $this->createUser(['username' => 'x', 'role' => 'superuser']);
        $this->assertStatus(422, $r);
        $this->assertSame('Invalid role', $r['json']['error']);
    }

    public function testStoreRejectsMalformedEmail(): void
    {
        $r = $this->createUser(['email' => 'not-an-email']);
        $this->assertStatus(422, $r);
        $this->assertSame('That email address is not valid', $r['json']['error']);
    }

    public function testStoreNeedsAnEmailOrUsername(): void
    {
        $r = $this->createUser(['name' => 'Nobody', 'email' => '  ', 'username' => '']);
        $this->assertStatus(422, $r);
        $this->assertSame('An email or a username is required', $r['json']['error']);
        $this->assertSame(1, self::countRows('SELECT count(*) FROM users'));
    }

    public function testStoreWithEmailCreatesPendingMemberAndWorkingEnrolLink(): void
    {
        $r = $this->createUser(['email' => '  New.Person@Example.COM ', 'name' => 'New Person']);
        $this->assertStatus(201, $r);
        $u = $r['json'];

        $this->assertSame('new.person@example.com', $u['email']);
        $this->assertSame('New Person', $u['name']);
        $this->assertNull($u['username']);
        $this->assertSame('member', $u['role']);
        $this->assertTrue($u['is_active']);
        $this->assertFalse($u['totp_enabled']);
        $this->assertSame(Pages::DEFAULT_USER, $u['permissions']);
        $this->assertNull($u['preset_id']);

        $token = $u['enroll']['token'];
        $this->assertSame('/enroll?token=' . $token, $u['enroll']['path']);
        $expires = strtotime($u['enroll']['expires_at']);
        $this->assertEqualsWithDelta(time() + 24 * 3600, $expires, 60);

        $row = self::userRow($u['id']);
        $this->assertSame(hash('sha256', $token), $row['enroll_token_hash']);
        $this->assertNull($row['totp_secret']);

        $audit = self::auditRows('user.create');
        $this->assertCount(1, $audit);
        $this->assertSame((int) $this->admin['id'], (int) $audit[0]['user_id']);
        $this->assertSame($u['id'], (int) $audit[0]['entity_id']);
        $this->assertEquals(['email' => 'new.person@example.com', 'role' => 'member'], json_decode($audit[0]['details'], true));
        $this->assertStringNotContainsString($token, $audit[0]['details']);

        $this->cookies = [];
        $this->assertStatus(200, $this->post('/auth/enroll/start', ['token' => $token], true));
    }

    public function testStoreWithUsernameOnly(): void
    {
        $r = $this->createUser(['username' => 'nomail', 'role' => 'user']);
        $this->assertStatus(201, $r);
        $this->assertNull($r['json']['email']);
        $this->assertSame('nomail', $r['json']['username']);
        $this->assertSame('user', $r['json']['role']);
    }

    public function testStoreRejectsUsernameTakenCaseInsensitively(): void
    {
        self::createEnrolledUser('taken');
        $r = $this->createUser(['username' => 'TAKEN']);
        $this->assertStatus(409, $r);
        $this->assertSame('That username is already taken', $r['json']['error']);
    }

    public function testStoreRejectsDuplicateEmail(): void
    {
        self::createEnrolledUser('dupe');
        $r = $this->createUser(['email' => 'DUPE@example.test']);
        $this->assertStatus(409, $r);
        $this->assertSame(2, self::countRows('SELECT count(*) FROM users'));
    }

    public function testStoreFromStaffDerivesNameAndUsername(): void
    {
        $staff = self::insert('staff', ['name' => 'Ada Lovelace']);
        $r = $this->createUser(['staff_id' => $staff['id']]);

        $this->assertStatus(201, $r);
        $this->assertSame('Ada Lovelace', $r['json']['name']);
        $this->assertSame('ada.lovelace', $r['json']['username']);
        $this->assertSame((int) $staff['id'], $r['json']['staff_id']);
        $details = json_decode(self::auditRows('user.create')[0]['details'], true);
        $this->assertSame((int) $staff['id'], $details['staff_id']);
        $this->assertSame('ada.lovelace', $details['username']);
    }

    public function testStoreFromStaffSuffixesACollidingUsername(): void
    {
        self::createEnrolledUser('ada.lovelace');
        $staff = self::insert('staff', ['name' => 'Ada  Lovelace!']);
        $r = $this->createUser(['staff_id' => $staff['id']]);
        $this->assertStatus(201, $r);
        $this->assertSame('ada.lovelace2', $r['json']['username']);
    }

    public function testStoreFromStaffKeepsExplicitNameAndUsername(): void
    {
        $staff = self::insert('staff', ['name' => 'Grace Hopper']);
        $r = $this->createUser(['staff_id' => $staff['id'], 'username' => 'amazing', 'name' => 'Admiral']);
        $this->assertStatus(201, $r);
        $this->assertSame('amazing', $r['json']['username']);
        $this->assertSame('Admiral', $r['json']['name']);
    }

    public function testStoreRejectsUnknownStaff(): void
    {
        $r = $this->createUser(['staff_id' => 99999]);
        $this->assertStatus(422, $r);
        $this->assertSame('That staff member no longer exists', $r['json']['error']);
    }

    public function testStoreRejectsSecondAccountForSameStaff(): void
    {
        $staff = self::insert('staff', ['name' => 'Once Only']);
        $this->assertStatus(201, $this->createUser(['staff_id' => $staff['id']]));
        $r = $this->createUser(['staff_id' => $staff['id'], 'username' => 'another']);
        $this->assertStatus(409, $r);
        $this->assertSame('That staff member already has an account', $r['json']['error']);
    }

    public function testStoreSanitizesExplicitPermissions(): void
    {
        $r = $this->createUser(['username' => 'picky', 'permissions' => ['staff', 'bogus', 'dashboard', 'logs']]);
        $this->assertStatus(201, $r);
        $this->assertSame(['dashboard', 'staff', 'logs'], $r['json']['permissions']);
    }

    public function testStoreAttachesPresetWithoutCopyingItsPages(): void
    {
        $preset = self::insert('access_presets', ['name' => 'Agent', 'pages' => ['queues', 'reviews']]);
        $r = $this->createUser(['username' => 'agent1', 'preset_id' => $preset['id']]);

        $this->assertStatus(201, $r);
        $this->assertSame((int) $preset['id'], $r['json']['preset_id']);
        $this->assertSame(['queues', 'reviews'], $r['json']['permissions']);
        $row = self::userRow($r['json']['id']);
        $this->assertNull($row['permissions']);
        $this->assertSame('Agent', json_decode(self::auditRows('user.create')[0]['details'], true)['preset']);
    }

    public function testStoreRejectsUnknownPreset(): void
    {
        $r = $this->createUser(['username' => 'lost', 'preset_id' => 424242]);
        $this->assertStatus(422, $r);
        $this->assertSame('That access preset no longer exists', $r['json']['error']);
    }

    public function testStoreExplicitPermissionsWinOverPreset(): void
    {
        $preset = self::insert('access_presets', ['name' => 'Agent', 'pages' => ['queues']]);
        $r = $this->createUser(['username' => 'own', 'preset_id' => $preset['id'], 'permissions' => ['vendors']]);
        $this->assertStatus(201, $r);
        $this->assertNull($r['json']['preset_id']);
        $this->assertSame(['vendors'], $r['json']['permissions']);
    }

    public function testStoreAdminIgnoresPresetAndDefaultPages(): void
    {
        $preset = self::insert('access_presets', ['name' => 'Agent', 'pages' => ['queues']]);
        $r = $this->createUser(['username' => 'chief', 'role' => 'admin', 'preset_id' => $preset['id']]);
        $this->assertStatus(201, $r);
        $this->assertSame('admin', $r['json']['role']);
        $this->assertNull($r['json']['preset_id']);
        $this->assertNull($r['json']['permissions']);
    }

    // ─── update ────────────────────────────────────────────────────────────────

    public function testUpdateRejectsUnknownRole(): void
    {
        $u = self::createEnrolledUser('bob');
        $this->assertStatus(422, $this->patch("/admin/users/{$u['id']}", ['role' => 'god'], true));
        $this->assertSame('member', self::userRow((int) $u['id'])['role']);
    }

    public function testUpdateRejectsMalformedEmail(): void
    {
        $u = self::createEnrolledUser('bob');
        $this->assertStatus(422, $this->patch("/admin/users/{$u['id']}", ['email' => 'nope'], true));
    }

    public function testUpdateUnknownUserIs404(): void
    {
        $this->assertStatus(404, $this->patch('/admin/users/99999', ['name' => 'X'], true));
        $this->assertStatus(404, $this->patch('/admin/users/99999', ['username' => 'x'], true));
    }

    public function testUpdateChangesProfileFields(): void
    {
        $u = self::createEnrolledUser('bob');
        $r = $this->patch("/admin/users/{$u['id']}", [
            'name' => 'Robert', 'email' => 'ROBERT@Example.test', 'username' => 'rob', 'role' => 'user',
        ], true);

        $this->assertStatus(200, $r);
        $this->assertSame('Robert', $r['json']['name']);
        $this->assertSame('robert@example.test', $r['json']['email']);
        $this->assertSame('rob', $r['json']['username']);
        $this->assertSame('user', $r['json']['role']);

        $audit = self::auditRows('user.update');
        $this->assertCount(1, $audit);
        $this->assertSame((int) $u['id'], (int) $audit[0]['entity_id']);
        $this->assertSame('Robert', json_decode($audit[0]['details'], true)['name']);
    }

    public function testUpdateLeavesAbsentFieldsAlone(): void
    {
        $u = self::createEnrolledUser('bob', 'member', ['staff']);
        $r = $this->patch("/admin/users/{$u['id']}", ['name' => 'Bobby'], true);
        $this->assertStatus(200, $r);
        $this->assertSame('bob@example.test', $r['json']['email']);
        $this->assertSame('bob', $r['json']['username']);
        $this->assertSame(['staff'], $r['json']['permissions']);
    }

    public function testUpdateMayClearOneIdentifierButNotBoth(): void
    {
        $u = self::createEnrolledUser('bob');
        $r = $this->patch("/admin/users/{$u['id']}", ['email' => ''], true);
        $this->assertStatus(200, $r);
        $this->assertNull($r['json']['email']);

        $r = $this->patch("/admin/users/{$u['id']}", ['username' => ''], true);
        $this->assertStatus(422, $r);
        $this->assertSame('bob', self::userRow((int) $u['id'])['username']);
    }

    public function testUpdateRejectsUsernameOfAnotherAccount(): void
    {
        self::createEnrolledUser('alice');
        $u = self::createEnrolledUser('bob');
        $this->assertStatus(409, $this->patch("/admin/users/{$u['id']}", ['username' => 'ALICE'], true));
        $this->assertStatus(200, $this->patch("/admin/users/{$u['id']}", ['username' => 'BOB'], true));
    }

    public function testUpdateRejectsEmailOfAnotherAccount(): void
    {
        self::createEnrolledUser('alice');
        $u = self::createEnrolledUser('bob');
        $this->assertStatus(409, $this->patch("/admin/users/{$u['id']}", ['email' => 'alice@example.test'], true));
    }

    public function testUpdatePermissionsAreSanitizedAndDetachPreset(): void
    {
        $preset = self::insert('access_presets', ['name' => 'Agent', 'pages' => ['queues']]);
        $u = self::createEnrolledUser('bob');
        self::db()->exec("UPDATE users SET preset_id = {$preset['id']} WHERE id = {$u['id']}");

        $r = $this->patch("/admin/users/{$u['id']}", ['permissions' => ['users', 'nope', 'buyers']], true);
        $this->assertStatus(200, $r);
        $this->assertSame(['buyers', 'users'], $r['json']['permissions']);
        $this->assertNull($r['json']['preset_id']);
    }

    public function testUpdateAttachingPresetClearsOwnPermissions(): void
    {
        $preset = self::insert('access_presets', ['name' => 'Agent', 'pages' => ['queues']]);
        $u = self::createEnrolledUser('bob', 'member', ['staff']);

        $r = $this->patch("/admin/users/{$u['id']}", ['preset_id' => $preset['id']], true);
        $this->assertStatus(200, $r);
        $this->assertSame((int) $preset['id'], $r['json']['preset_id']);
        $this->assertSame(['queues'], $r['json']['permissions']);
        $this->assertNull(self::userRow((int) $u['id'])['permissions']);
    }

    public function testUpdateDetachingPresetLeavesNoList(): void
    {
        $preset = self::insert('access_presets', ['name' => 'Agent', 'pages' => ['queues']]);
        $u = self::createEnrolledUser('bob');
        self::db()->exec("UPDATE users SET preset_id = {$preset['id']} WHERE id = {$u['id']}");

        $r = $this->patch("/admin/users/{$u['id']}", ['preset_id' => null], true);
        $this->assertStatus(200, $r);
        $this->assertNull($r['json']['preset_id']);
    }

    public function testUpdateRejectsUnknownPreset(): void
    {
        $u = self::createEnrolledUser('bob');
        $this->assertStatus(422, $this->patch("/admin/users/{$u['id']}", ['preset_id' => 777], true));
    }

    public function testPromotingToAdminDropsPreset(): void
    {
        $preset = self::insert('access_presets', ['name' => 'Agent', 'pages' => ['queues']]);
        $u = self::createEnrolledUser('bob');
        self::db()->exec("UPDATE users SET preset_id = {$preset['id']} WHERE id = {$u['id']}");

        $r = $this->patch("/admin/users/{$u['id']}", ['role' => 'admin'], true);
        $this->assertStatus(200, $r);
        $this->assertSame('admin', $r['json']['role']);
        $this->assertNull($r['json']['preset_id']);
    }

    public function testDeactivatingKillsSessionsAndReactivatingRestoresLogin(): void
    {
        $u = self::createEnrolledUser('bob');
        self::insert('sessions', [
            'user_id' => (int) $u['id'], 'token_hash' => str_repeat('a', 64), 'mfa_pending' => false,
            'expires_at' => date('c', time() + 3600),
        ]);

        $r = $this->patch("/admin/users/{$u['id']}", ['is_active' => false], true);
        $this->assertStatus(200, $r);
        $this->assertFalse($r['json']['is_active']);
        $this->assertSame(0, self::countRows('SELECT count(*) FROM sessions WHERE user_id = :u', [':u' => $u['id']]));

        $this->assertStatus(200, $this->patch("/admin/users/{$u['id']}", ['is_active' => true], true));
        $this->assertTrue((bool) self::userRow((int) $u['id'])['is_active']);
    }

    public function testAdminCannotChangeOwnRole(): void
    {
        // MAINTENANCE.md §6b: "You can't delete or change the role of your own account."
        $r = $this->patch("/admin/users/{$this->admin['id']}", ['role' => 'member'], true);
        $this->assertGreaterThanOrEqual(400, $r['status'], "Self role change was accepted. Body: {$r['body']}");
        $this->assertSame('admin', self::userRow((int) $this->admin['id'])['role']);
    }

    public function testUsersPageMemberCannotPromoteThemselvesToAdmin(): void
    {
        $hr = self::createEnrolledUser('hr', 'member', ['users']);
        $this->loginAs($hr);

        $r = $this->patch("/admin/users/{$hr['id']}", ['role' => 'admin'], true);
        $this->assertGreaterThanOrEqual(400, $r['status'], "Self-promotion was accepted. Body: {$r['body']}");
        $this->assertSame('member', self::userRow((int) $hr['id'])['role']);
    }

    public function testUsersPageMemberCannotCreateAnAdmin(): void
    {
        $this->loginAs(self::createEnrolledUser('hr', 'member', ['users']));
        $this->assertStatus(403, $this->post('/admin/users', ['username' => 'sneaky', 'role' => 'admin'], true));
        $this->assertSame(0, self::countRows("SELECT count(*) FROM users WHERE username = 'sneaky'"));
    }

    public function testUsersPageMemberCannotPromoteSomeoneElse(): void
    {
        $other = self::createEnrolledUser('pal');
        $this->loginAs(self::createEnrolledUser('hr', 'member', ['users']));
        $this->assertStatus(403, $this->patch("/admin/users/{$other['id']}", ['role' => 'admin'], true));
        $this->assertSame('member', self::userRow((int) $other['id'])['role']);
    }

    public function testUsersPageMemberCanStillEditAMemberWhenThePageResendsTheSameRole(): void
    {
        $other = self::createEnrolledUser('pal');
        $this->loginAs(self::createEnrolledUser('hr', 'member', ['users']));
        $r = $this->patch("/admin/users/{$other['id']}", ['name' => 'Pal Renamed', 'role' => 'member', 'permissions' => ['queues']], true);
        $this->assertStatus(200, $r);
        $this->assertSame('Pal Renamed', self::userRow((int) $other['id'])['name']);
    }

    public function testUsersPageMemberCannotWidenTheirOwnAccess(): void
    {
        $hr = self::createEnrolledUser('hr', 'member', ['users']);
        $this->loginAs($hr);
        $this->assertStatus(409, $this->patch("/admin/users/{$hr['id']}", ['permissions' => ['users', 'logs', 'vendors']], true));
        $this->assertSame(['users'], json_decode((string) self::userRow((int) $hr['id'])['permissions'], true));
    }

    public function testUsersPageMemberCannotTakeOverAnAdminAccount(): void
    {
        $admin = self::createEnrolledUser('topadmin', 'admin');
        $this->loginAs(self::createEnrolledUser('hr', 'member', ['users']));

        // A reset would hand the admin's enrolment link to whoever asked for it.
        $this->assertStatus(403, $this->post("/admin/users/{$admin['id']}/reset-totp", [], true));
        $this->assertStatus(403, $this->patch("/admin/users/{$admin['id']}", ['is_active' => false], true));
        $this->assertStatus(403, $this->delete("/admin/users/{$admin['id']}", true));
        $row = self::userRow((int) $admin['id']);
        $this->assertNotNull($row['totp_confirmed_at']);
        $this->assertTrue((bool) $row['is_active']);
    }

    public function testBatchLinksIssuedByAMemberSkipPendingAdmins(): void
    {
        self::createPendingUser('newbie');
        self::db()->exec("INSERT INTO users (email, username, role, is_active) VALUES ('chief@example.test', 'chief', 'admin', true)");
        $this->loginAs(self::createEnrolledUser('hr', 'member', ['users']));

        $r = $this->post('/admin/users/enroll-links', [], true);
        $this->assertStatus(200, $r);
        $this->assertSame(['newbie'], array_column($r['json']['links'], 'username'));
    }

    // ─── reset-totp ────────────────────────────────────────────────────────────

    public function testResetTotpUnknownUserIs404(): void
    {
        $this->assertStatus(404, $this->post('/admin/users/99999/reset-totp', [], true));
    }

    public function testResetTotpWipesAuthenticatorAndSessions(): void
    {
        $u = self::createEnrolledUser('bob');
        self::db()->exec("UPDATE users SET failed_attempts = 4, locked_until = now() + interval '5 minutes' WHERE id = {$u['id']}");
        self::insert('sessions', [
            'user_id' => (int) $u['id'], 'token_hash' => str_repeat('b', 64), 'mfa_pending' => false,
            'expires_at' => date('c', time() + 3600),
        ]);

        $r = $this->post("/admin/users/{$u['id']}/reset-totp", [], true);
        $this->assertStatus(200, $r);
        $this->assertTrue($r['json']['reset']);
        $token = $r['json']['enroll']['token'];

        $row = self::userRow((int) $u['id']);
        $this->assertNull($row['totp_secret']);
        $this->assertNull($row['totp_confirmed_at']);
        $this->assertSame(hash('sha256', $token), $row['enroll_token_hash']);
        $this->assertSame(0, (int) $row['failed_attempts']);
        $this->assertNull($row['locked_until']);
        $this->assertSame(0, self::countRows('SELECT count(*) FROM sessions WHERE user_id = :u', [':u' => $u['id']]));

        $audit = self::auditRows('user.reset_totp');
        $this->assertCount(1, $audit);
        $this->assertEquals(['name' => 'Bob', 'username' => 'bob', 'email' => 'bob@example.test'], json_decode($audit[0]['details'], true));

        $this->cookies = [];
        $this->assertStatus(403, $this->post('/auth/login', ['identifier' => 'bob'], true));
        $this->assertStatus(200, $this->post('/auth/enroll/start', ['token' => $token], true));
    }

    // ─── enroll-link ───────────────────────────────────────────────────────────

    public function testRefreshEnrollLinkUnknownUserIs404(): void
    {
        $this->assertStatus(404, $this->post('/admin/users/99999/enroll-link', [], true));
    }

    public function testRefreshEnrollLinkRefusesEnrolledAccount(): void
    {
        $u = self::createEnrolledUser('bob');
        $r = $this->post("/admin/users/{$u['id']}/enroll-link", [], true);
        $this->assertStatus(409, $r);
        $this->assertStringContainsString('already set up', $r['json']['error']);
        $this->assertNotNull(self::userRow((int) $u['id'])['totp_secret']);
    }

    public function testRefreshEnrollLinkRefusesDeactivatedAccount(): void
    {
        $u = self::createPendingUser('asleep', '+1 day', false);
        $r = $this->post("/admin/users/{$u['id']}/enroll-link", [], true);
        $this->assertStatus(409, $r);
        $this->assertStringContainsString('deactivated', $r['json']['error']);
    }

    public function testRefreshEnrollLinkReplacesTokenAndClearsHalfStartedSetup(): void
    {
        $u = self::createPendingUser('pending', '-1 hour');
        self::db()->exec("UPDATE users SET totp_secret = 'JBSWY3DPEHPK3PXP' WHERE id = {$u['id']}");

        $r = $this->post("/admin/users/{$u['id']}/enroll-link", [], true);
        $this->assertStatus(200, $r);
        $new = $r['json']['enroll']['token'];

        $row = self::userRow((int) $u['id']);
        $this->assertNull($row['totp_secret']);
        $this->assertSame(hash('sha256', $new), $row['enroll_token_hash']);
        $this->assertGreaterThan(time() + 23 * 3600, strtotime($row['enroll_expires_at']));
        $this->assertCount(1, self::auditRows('user.refresh_enroll_link'));

        $this->cookies = [];
        $this->assertStatus(403, $this->post('/auth/enroll/start', ['token' => $u['token']], true));
        $this->assertStatus(200, $this->post('/auth/enroll/start', ['token' => $new], true));
    }

    public function testRefreshAllPendingLinksOnlyTouchesActivePendingAccounts(): void
    {
        $a = self::createPendingUser('anna');
        $z = self::createPendingUser('zed', '-1 day');
        $off = self::createPendingUser('off', '+1 day', false);
        $offHash = self::userRow((int) $off['id'])['enroll_token_hash'];

        $r = $this->post('/admin/users/enroll-links', [], true);
        $this->assertStatus(200, $r);
        $links = $r['json']['links'];

        $this->assertSame([(int) $a['id'], (int) $z['id']], array_column($links, 'id'));
        $this->assertSame('Anna', $links[0]['name']);
        $this->assertNotSame($links[0]['enroll']['token'], $links[1]['enroll']['token']);
        foreach ($links as $l) {
            $this->assertSame(hash('sha256', $l['enroll']['token']), self::userRow($l['id'])['enroll_token_hash']);
        }
        $this->assertSame($offHash, self::userRow((int) $off['id'])['enroll_token_hash']);
        $this->assertNotNull(self::userRow((int) $this->admin['id'])['totp_secret']);

        $audit = self::auditRows('user.refresh_enroll_links');
        $this->assertCount(1, $audit);
        $details = json_decode($audit[0]['details'], true);
        $this->assertSame(2, $details['count']);
        $this->assertSame(['Anna', 'Zed'], $details['users']);
    }

    public function testRefreshAllPendingLinksWithNonePendingReturnsEmpty(): void
    {
        $r = $this->post('/admin/users/enroll-links', [], true);
        $this->assertStatus(200, $r);
        $this->assertSame([], $r['json']['links']);
    }

    // ─── destroy ───────────────────────────────────────────────────────────────

    public function testCannotDeleteOwnAccount(): void
    {
        $r = $this->delete("/admin/users/{$this->admin['id']}", true);
        $this->assertStatus(409, $r);
        $this->assertNotNull(self::userRow((int) $this->admin['id']));
    }

    public function testDeleteUnknownUserIs404(): void
    {
        $this->assertStatus(404, $this->delete('/admin/users/99999', true));
    }

    public function testDeleteRemovesAccountAndSessionsButKeepsTrail(): void
    {
        $u = self::createEnrolledUser('bob');
        self::insert('sessions', [
            'user_id' => (int) $u['id'], 'token_hash' => str_repeat('c', 64), 'mfa_pending' => false,
            'expires_at' => date('c', time() + 3600),
        ]);
        self::insert('audit_log', ['user_id' => (int) $u['id'], 'user_email' => 'bob@example.test', 'action' => 'buyer.create']);

        $r = $this->delete("/admin/users/{$u['id']}", true);
        $this->assertStatus(200, $r);
        $this->assertSame(['deleted' => true], $r['json']);

        $this->assertNull(self::userRow((int) $u['id']));
        $this->assertSame(0, self::countRows('SELECT count(*) FROM sessions WHERE user_id = :u', [':u' => $u['id']]));

        $old = self::auditRows('buyer.create')[0];
        $this->assertNull($old['user_id']);
        $this->assertSame('bob@example.test', $old['user_email']);

        $del = self::auditRows('user.delete');
        $this->assertCount(1, $del);
        $this->assertEquals(['email' => 'bob@example.test', 'username' => 'bob'], json_decode($del[0]['details'], true));
    }
}
