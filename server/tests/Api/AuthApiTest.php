<?php

declare(strict_types=1);

namespace Tests\Api;

use Tests\ApiTestCase;

final class AuthApiTest extends ApiTestCase
{
    use AuthApiHelpers;

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('users', 'sessions', 'audit_log', 'access_presets', 'staff');
        $this->cookies = [];
    }

    // ─── status / toggle ───────────────────────────────────────────────────────

    public function testStatusIsReachableOnBothServers(): void
    {
        $off = $this->get('/auth/status');
        $on  = $this->get('/auth/status', true);
        $this->assertStatus(200, $off);
        $this->assertStatus(200, $on);
        $this->assertSame(['auth_enabled' => false], $off['json']);
        $this->assertSame(['auth_enabled' => true], $on['json']);
    }

    public function testAuthRoutesDoNotExistWhenAuthIsOff(): void
    {
        $this->assertStatus(404, $this->post('/auth/login', ['identifier' => 'x']));
        $this->assertStatus(404, $this->get('/auth/me'));
        $this->assertStatus(404, $this->post('/auth/logout'));
    }

    // ─── login ─────────────────────────────────────────────────────────────────

    public function testLoginRequiresAnIdentifier(): void
    {
        $r = $this->post('/auth/login', ['identifier' => '   '], true);
        $this->assertStatus(422, $r);
        $this->assertSame('Identifier is required', $r['json']['error']);
    }

    public function testLoginWithUnknownIdentifierIsGenericFailure(): void
    {
        $r = $this->post('/auth/login', ['identifier' => 'ghost'], true);
        $this->assertStatus(401, $r);
        $this->assertSame('Invalid credentials', $r['json']['error']);
        $this->assertSame(0, self::countRows('SELECT count(*) FROM sessions'));
    }

    public function testLoginWithDeactivatedAccountIsGenericFailure(): void
    {
        $u = self::createEnrolledUser('sleepy');
        self::db()->exec("UPDATE users SET is_active = false WHERE id = {$u['id']}");

        $r = $this->post('/auth/login', ['identifier' => 'sleepy'], true);
        $this->assertStatus(401, $r);
        $this->assertSame('Invalid credentials', $r['json']['error']);
    }

    public function testLoginForNotYetEnrolledAccountIsRefused(): void
    {
        self::createPendingUser('newbie');
        $r = $this->post('/auth/login', ['identifier' => 'newbie'], true);
        $this->assertStatus(403, $r);
        $this->assertSame('NOT_ENROLLED', $r['json']['code']);
        $this->assertSame(0, self::countRows('SELECT count(*) FROM sessions'));
    }

    public function testLoginForLockedAccountIs429(): void
    {
        $u = self::createEnrolledUser('locked');
        self::db()->exec("UPDATE users SET locked_until = now() + interval '10 minutes' WHERE id = {$u['id']}");

        $r = $this->post('/auth/login', ['identifier' => 'locked'], true);
        $this->assertStatus(429, $r);
    }

    public function testLoginAfterLockExpiredIsAllowed(): void
    {
        $u = self::createEnrolledUser('unlocked');
        self::db()->exec("UPDATE users SET locked_until = now() - interval '1 minute' WHERE id = {$u['id']}");

        $this->assertStatus(200, $this->post('/auth/login', ['identifier' => 'unlocked'], true));
    }

    public function testLoginOpensPendingSessionAndSetsCookie(): void
    {
        $u = self::createEnrolledUser('alice');
        $r = $this->post('/auth/login', ['identifier' => 'alice'], true);

        $this->assertStatus(200, $r);
        $this->assertSame(['mfa_required' => true], $r['json']);
        $this->assertArrayHasKey('crm_session', $this->cookies);

        $s = self::db()->query('SELECT * FROM sessions')->fetchAll();
        $this->assertCount(1, $s);
        $this->assertSame((int) $u['id'], (int) $s[0]['user_id']);
        $this->assertTrue((bool) $s[0]['mfa_pending']);
        $this->assertSame(hash('sha256', $this->cookies['crm_session']), $s[0]['token_hash']);
    }

    public function testLoginAcceptsEmailCaseInsensitively(): void
    {
        self::createEnrolledUser('bob');
        $this->assertStatus(200, $this->post('/auth/login', ['identifier' => 'BOB@Example.TEST'], true));
        $this->cookies = [];
        $this->assertStatus(200, $this->post('/auth/login', ['identifier' => 'BoB'], true));
    }

    public function testPendingSessionCannotReachProtectedRoutes(): void
    {
        self::createEnrolledUser('carol');
        $this->post('/auth/login', ['identifier' => 'carol'], true);

        $this->assertStatus(401, $this->get('/auth/me', true));
        $this->assertStatus(401, $this->get('/buyers', true));
    }

    // ─── verify-totp ───────────────────────────────────────────────────────────

    public function testVerifyWithoutPendingLoginIs401(): void
    {
        $r = $this->post('/auth/verify-totp', ['code' => '123456'], true);
        $this->assertStatus(401, $r);
        $this->assertSame('No pending login', $r['json']['error']);
    }

    public function testVerifyWithFullSessionIsNotAPendingLogin(): void
    {
        $u = self::createEnrolledUser('dave');
        $this->loginAs($u);

        $r = $this->post('/auth/verify-totp', ['code' => self::totpCode($u['secret'])], true);
        $this->assertStatus(401, $r);
        $this->assertSame('No pending login', $r['json']['error']);
    }

    public function testVerifyWithWrongCodeRecordsFailure(): void
    {
        $u = self::createEnrolledUser('erin');
        $this->post('/auth/login', ['identifier' => 'erin'], true);

        $r = $this->post('/auth/verify-totp', ['code' => self::wrongCode($u['secret'])], true);
        $this->assertStatus(401, $r);
        $this->assertSame('Invalid code', $r['json']['error']);

        $row = self::userRow((int) $u['id']);
        $this->assertSame(1, (int) $row['failed_attempts']);
        $this->assertNull($row['locked_until']);

        $audit = self::auditRows('auth.login_failed');
        $this->assertCount(1, $audit);
        $this->assertSame((int) $u['id'], (int) $audit[0]['user_id']);
        $this->assertSame(401, (int) $audit[0]['status_code']);

        $this->assertStatus(401, $this->get('/auth/me', true));
    }

    public function testVerifyWithNonNumericCodeIsRejected(): void
    {
        $u = self::createEnrolledUser('frank');
        $this->post('/auth/login', ['identifier' => 'frank'], true);
        $this->assertStatus(401, $this->post('/auth/verify-totp', ['code' => 'abcdef'], true));
    }

    public function testVerifyWithCorrectCodeCompletesLoginAndRotatesToken(): void
    {
        $u = self::createEnrolledUser('grace');
        self::db()->exec("UPDATE users SET failed_attempts = 3 WHERE id = {$u['id']}");
        $this->post('/auth/login', ['identifier' => 'grace'], true);
        $pendingToken = $this->cookies['crm_session'];

        $r = $this->post('/auth/verify-totp', ['code' => self::totpCode($u['secret'])], true);
        $this->assertStatus(200, $r);
        $this->assertSame([
            'id'           => (int) $u['id'],
            'email'        => 'grace@example.test',
            'name'         => 'Grace',
            'role'         => 'member',
            'username'     => 'grace',
            'totp_enabled' => true,
            'permissions'  => null,
        ], $r['json']['user']);

        $this->assertNotSame($pendingToken, $this->cookies['crm_session']);
        $s = self::db()->query('SELECT * FROM sessions')->fetchAll();
        $this->assertCount(1, $s);
        $this->assertFalse((bool) $s[0]['mfa_pending']);
        $this->assertSame(hash('sha256', $this->cookies['crm_session']), $s[0]['token_hash']);

        $row = self::userRow((int) $u['id']);
        $this->assertSame(0, (int) $row['failed_attempts']);
        $this->assertNotNull($row['last_login_at']);

        $this->assertCount(1, self::auditRows('auth.login'));
        $this->assertStatus(200, $this->get('/auth/me', true));
    }

    public function testOldPendingTokenIsUselessAfterUpgrade(): void
    {
        $u = self::createEnrolledUser('heidi');
        $this->post('/auth/login', ['identifier' => 'heidi'], true);
        $pendingToken = $this->cookies['crm_session'];
        $this->post('/auth/verify-totp', ['code' => self::totpCode($u['secret'])], true);

        $this->cookies = ['crm_session' => $pendingToken];
        $this->assertStatus(401, $this->get('/auth/me', true));
    }

    public function testFiveWrongCodesLockTheAccount(): void
    {
        $u = self::createEnrolledUser('ivan');
        $this->post('/auth/login', ['identifier' => 'ivan'], true);

        for ($i = 0; $i < 5; $i++) {
            $this->assertStatus(401, $this->post('/auth/verify-totp', ['code' => self::wrongCode($u['secret'])], true));
        }

        $row = self::userRow((int) $u['id']);
        $this->assertSame(5, (int) $row['failed_attempts']);
        $this->assertNotNull($row['locked_until']);
        $this->assertGreaterThan(time() + 14 * 60, strtotime($row['locked_until']));

        // Even the right code is refused while locked.
        $r = $this->post('/auth/verify-totp', ['code' => self::totpCode($u['secret'])], true);
        $this->assertStatus(429, $r);

        $this->cookies = [];
        $this->assertStatus(429, $this->post('/auth/login', ['identifier' => 'ivan'], true));
    }

    public function testFourWrongCodesDoNotLock(): void
    {
        $u = self::createEnrolledUser('judy');
        $this->post('/auth/login', ['identifier' => 'judy'], true);
        for ($i = 0; $i < 4; $i++) {
            $this->post('/auth/verify-totp', ['code' => self::wrongCode($u['secret'])], true);
        }
        $this->assertNull(self::userRow((int) $u['id'])['locked_until']);
        $this->assertStatus(200, $this->post('/auth/verify-totp', ['code' => self::totpCode($u['secret'])], true));
        $this->assertSame(0, (int) self::userRow((int) $u['id'])['failed_attempts']);
    }

    public function testVerifyRefusedWhenAccountDeactivatedMidLogin(): void
    {
        $u = self::createEnrolledUser('ken');
        $this->post('/auth/login', ['identifier' => 'ken'], true);
        self::db()->exec("UPDATE users SET is_active = false WHERE id = {$u['id']}");

        $this->assertStatus(401, $this->post('/auth/verify-totp', ['code' => self::totpCode($u['secret'])], true));
    }

    // ─── enrolment ─────────────────────────────────────────────────────────────

    public function testEnrollStartRejectsMissingOrUnknownToken(): void
    {
        $this->assertStatus(403, $this->post('/auth/enroll/start', [], true));
        $r = $this->post('/auth/enroll/start', ['token' => 'nope'], true);
        $this->assertStatus(403, $r);
        $this->assertSame('Invalid or expired enrolment link', $r['json']['error']);
    }

    public function testEnrollStartRejectsExpiredToken(): void
    {
        $u = self::createPendingUser('late', '-1 hour');
        $this->assertStatus(403, $this->post('/auth/enroll/start', ['token' => $u['token']], true));
    }

    public function testEnrollStartRejectsDeactivatedAccount(): void
    {
        $u = self::createPendingUser('gone', '+1 day', false);
        $this->assertStatus(403, $this->post('/auth/enroll/start', ['token' => $u['token']], true));
    }

    public function testEnrollStartRejectsAlreadyEnrolledAccount(): void
    {
        $u = self::createPendingUser('done');
        self::db()->exec("UPDATE users SET totp_secret = 'JBSWY3DPEHPK3PXP', totp_confirmed_at = now() WHERE id = {$u['id']}");
        $this->assertStatus(403, $this->post('/auth/enroll/start', ['token' => $u['token']], true));
    }

    public function testEnrollStartIssuesSecretAndProvisioningUri(): void
    {
        $u = self::createPendingUser('lena');
        $r = $this->post('/auth/enroll/start', ['token' => $u['token']], true);

        $this->assertStatus(200, $r);
        $secret = $r['json']['secret'];
        $this->assertMatchesRegularExpression('/^[A-Z2-7]+=*$/', $secret);
        $this->assertSame('lena@example.test', $r['json']['email']);
        $this->assertSame('lena@example.test', $r['json']['label']);
        $this->assertStringStartsWith('otpauth://totp/Platform-CRM:lena%40example.test?', $r['json']['otpauth_uri']);
        $this->assertStringContainsString("secret={$secret}", $r['json']['otpauth_uri']);

        $row = self::userRow((int) $u['id']);
        $this->assertSame($secret, $row['totp_secret']);
        $this->assertNull($row['totp_confirmed_at']);
        $this->assertSame(0, self::countRows('SELECT count(*) FROM sessions'));
    }

    public function testEnrollStartLabelFallsBackToUsernameWithoutEmail(): void
    {
        $u = self::createPendingUser('noemail');
        self::db()->exec("UPDATE users SET email = NULL WHERE id = {$u['id']}");

        $r = $this->post('/auth/enroll/start', ['token' => $u['token']], true);
        $this->assertStatus(200, $r);
        $this->assertNull($r['json']['email']);
        $this->assertSame('noemail', $r['json']['label']);
    }

    public function testEnrollConfirmBeforeStartIs409(): void
    {
        $u = self::createPendingUser('eager');
        $r = $this->post('/auth/enroll/confirm', ['token' => $u['token'], 'code' => '123456'], true);
        $this->assertStatus(409, $r);
        $this->assertSame('Start enrolment first', $r['json']['error']);
    }

    public function testEnrollConfirmWithBadTokenIs403(): void
    {
        $this->assertStatus(403, $this->post('/auth/enroll/confirm', ['token' => 'bad', 'code' => '123456'], true));
    }

    public function testEnrollConfirmWithWrongCodeIs401AndKeepsTokenUsable(): void
    {
        $u = self::createPendingUser('mike');
        $secret = $this->post('/auth/enroll/start', ['token' => $u['token']], true)['json']['secret'];

        $r = $this->post('/auth/enroll/confirm', ['token' => $u['token'], 'code' => self::wrongCode($secret)], true);
        $this->assertStatus(401, $r);
        $this->assertNull(self::userRow((int) $u['id'])['totp_confirmed_at']);

        $this->assertStatus(200, $this->post('/auth/enroll/confirm', ['token' => $u['token'], 'code' => self::totpCode($secret)], true));
    }

    public function testEnrollConfirmCompletesSetupAndOpensFullSession(): void
    {
        $u = self::createPendingUser('nina');
        self::db()->exec("UPDATE users SET failed_attempts = 2 WHERE id = {$u['id']}");
        $secret = $this->post('/auth/enroll/start', ['token' => $u['token']], true)['json']['secret'];

        $r = $this->post('/auth/enroll/confirm', ['token' => $u['token'], 'code' => self::totpCode($secret)], true);
        $this->assertStatus(200, $r);
        $this->assertSame((int) $u['id'], $r['json']['user']['id']);
        $this->assertTrue($r['json']['user']['totp_enabled']);

        $row = self::userRow((int) $u['id']);
        $this->assertNotNull($row['totp_confirmed_at']);
        $this->assertNull($row['enroll_token_hash']);
        $this->assertNull($row['enroll_expires_at']);
        $this->assertSame(0, (int) $row['failed_attempts']);
        $this->assertNotNull($row['last_login_at']);

        $s = self::db()->query('SELECT * FROM sessions')->fetchAll();
        $this->assertCount(1, $s);
        $this->assertFalse((bool) $s[0]['mfa_pending']);

        $this->assertCount(1, self::auditRows('auth.enrolled'));
        $this->assertStatus(200, $this->get('/auth/me', true));

        // One-time token: cannot be replayed.
        $this->cookies = [];
        $this->assertStatus(403, $this->post('/auth/enroll/start', ['token' => $u['token']], true));
        $this->assertStatus(403, $this->post('/auth/enroll/confirm', ['token' => $u['token'], 'code' => self::totpCode($secret)], true));

        // And the normal login now works.
        $this->loginAs(['username' => 'nina', 'secret' => $secret]);
        $this->assertStatus(200, $this->get('/auth/me', true));
    }

    // ─── logout / me ───────────────────────────────────────────────────────────

    public function testLogoutDestroysSessionAndClearsCookie(): void
    {
        $u = self::createEnrolledUser('oscar');
        $this->loginAs($u);
        $token = $this->cookies['crm_session'];

        $r = $this->post('/auth/logout', [], true);
        $this->assertStatus(204, $r);
        $this->assertSame('', $r['body']);
        $this->assertArrayNotHasKey('crm_session', $this->cookies);
        $this->assertSame(0, self::countRows('SELECT count(*) FROM sessions'));

        $logout = self::auditRows('auth.logout');
        $this->assertCount(1, $logout);
        $this->assertSame((int) $u['id'], (int) $logout[0]['user_id']);

        $this->cookies = ['crm_session' => $token];
        $this->assertStatus(401, $this->get('/auth/me', true));
    }

    public function testLogoutWithoutSessionIsStill204(): void
    {
        $this->assertStatus(204, $this->post('/auth/logout', [], true));
        $this->assertSame([], self::auditRows());
    }

    public function testLogoutOnlyEndsTheCurrentSession(): void
    {
        $u = self::createEnrolledUser('pat');
        $this->loginAs($u);
        $first = $this->cookies;
        $this->loginAs($u);

        $this->assertStatus(204, $this->post('/auth/logout', [], true));
        $this->cookies = $first;
        $this->assertStatus(200, $this->get('/auth/me', true));
    }

    public function testMeRequiresLogin(): void
    {
        $r = $this->get('/auth/me', true);
        $this->assertStatus(401, $r);
        $this->assertSame('Unauthorized', $r['json']['error']);
    }

    public function testMeReturnsOwnPermissions(): void
    {
        $u = self::createEnrolledUser('quinn', 'member', ['staff', 'queues']);
        $this->loginAs($u);

        $me = $this->get('/auth/me', true)['json']['user'];
        $this->assertSame('quinn', $me['username']);
        $this->assertSame('member', $me['role']);
        $this->assertSame(['staff', 'queues'], $me['permissions']);
        $this->assertArrayNotHasKey('totp_secret', $me);
    }

    public function testMeReturnsPresetPagesWhileAttached(): void
    {
        $preset = self::insert('access_presets', ['name' => 'Finance', 'pages' => ['vendors', 'portal-expenses']]);
        $u = self::createEnrolledUser('rita', 'member', ['staff']);
        self::db()->exec("UPDATE users SET preset_id = {$preset['id']} WHERE id = {$u['id']}");
        $this->loginAs($u);

        $this->assertSame(['vendors', 'portal-expenses'], $this->get('/auth/me', true)['json']['user']['permissions']);
    }

    public function testExpiredSessionIsRejected(): void
    {
        $u = self::createEnrolledUser('sam');
        $this->loginAs($u);
        self::db()->exec("UPDATE sessions SET expires_at = now() - interval '1 second'");

        $this->assertStatus(401, $this->get('/auth/me', true));
    }

    public function testDeactivatedUsersLiveSessionIsRejected(): void
    {
        $u = self::createEnrolledUser('tina');
        $this->loginAs($u);
        self::db()->exec("UPDATE users SET is_active = false WHERE id = {$u['id']}");

        $this->assertStatus(401, $this->get('/auth/me', true));
    }

    public function testForgedCookieIsRejected(): void
    {
        $this->cookies = ['crm_session' => bin2hex(random_bytes(32))];
        $this->assertStatus(401, $this->get('/auth/me', true));
    }
}
