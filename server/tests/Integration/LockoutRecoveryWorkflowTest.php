<?php

declare(strict_types=1);

namespace Tests\Integration;

use Tests\Api\AuthApiHelpers;
use Tests\ApiTestCase;

/**
 * The throttle as a user and an admin meet it: a run of bad codes locks the account across
 * both login steps, the admin sees it in System Logs, and the ways back in (waiting it out,
 * or an authenticator reset) each leave the account in a clean state.
 */
final class LockoutRecoveryWorkflowTest extends ApiTestCase
{
    use AuthApiHelpers;

    private array $adminJar = [];
    private array $admin;

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('users', 'sessions', 'audit_log');
        $this->admin    = $this->loginAsNewAdmin('boss');
        $this->adminJar = $this->cookies;
        $this->cookies  = [];
    }

    private function asAdmin(callable $fn): mixed
    {
        $mine          = $this->cookies;
        $this->cookies = $this->adminJar;
        try {
            return $fn();
        } finally {
            $this->adminJar = $this->cookies;
            $this->cookies  = $mine;
        }
    }

    private function startLogin(string $identifier): array
    {
        $this->cookies = [];
        return $this->post('/auth/login', ['identifier' => $identifier], true);
    }

    private function verify(string $code): array
    {
        return $this->post('/auth/verify-totp', ['code' => $code], true);
    }

    public function testRepeatedBadCodesLockTheAccountAndAnAuthenticatorResetRecoversIt(): void
    {
        $lee = self::createEnrolledUser('lee');

        $this->assertStatus(200, $this->startLogin('lee'));
        for ($i = 1; $i <= 5; $i++) {
            $this->assertStatus(401, $this->verify(self::wrongCode($lee['secret'])));
        }
        $this->assertSame(5, (int) self::userRow((int) $lee['id'])['failed_attempts']);

        // Locked on both steps: the pending session can't finish even with the right code,
        // and a fresh login is refused before a session is opened.
        $this->assertStatus(429, $this->verify(self::totpCode($lee['secret'])));
        $sessionsBefore = self::countRows('SELECT count(*) FROM sessions WHERE user_id = :id', [':id' => $lee['id']]);
        $this->assertStatus(429, $this->startLogin('lee'));
        $this->assertSame($sessionsBefore, self::countRows('SELECT count(*) FROM sessions WHERE user_id = :id', [':id' => $lee['id']]));
        $this->assertStatus(429, $this->startLogin('LEE@example.test'));

        // Other accounts — the admin included — are unaffected.
        $this->asAdmin(fn () => $this->assertStatus(200, $this->get('/auth/me', true)));
        $other = self::createEnrolledUser('other');
        $this->loginAs($other);

        // System Logs shows the five failures against Lee, and no successful login.
        $failed = $this->asAdmin(fn () => $this->get('/audit-logs?action=auth.login_failed', true));
        $this->assertStatus(200, $failed);
        $this->assertSame(5, $failed['json']['total']);
        foreach ($failed['json']['rows'] as $row) {
            $this->assertSame((int) $lee['id'], $row['entity_id']);
            $this->assertSame((int) $lee['id'], $row['user_id']);
            $this->assertSame(401, $row['status_code']);
            $this->assertSame('Lee', $row['entity_label']);
        }
        $logins = $this->asAdmin(fn () => $this->get('/audit-logs?action=auth.login&user_id=' . $lee['id'], true));
        $this->assertSame(0, $logins['json']['total']);

        // A new link is refused for an enrolled account; the reset is the way out.
        $this->asAdmin(fn () => $this->assertStatus(409, $this->post("/admin/users/{$lee['id']}/enroll-link", [], true)));
        $reset = $this->asAdmin(fn () => $this->post("/admin/users/{$lee['id']}/reset-totp", [], true));
        $this->assertStatus(200, $reset);
        $row = self::userRow((int) $lee['id']);
        $this->assertSame(0, (int) $row['failed_attempts']);
        $this->assertNull($row['locked_until']);

        // No longer locked, just not set up: the answer changes from 429 to NOT_ENROLLED.
        $r = $this->startLogin('lee');
        $this->assertStatus(403, $r);
        $this->assertSame('NOT_ENROLLED', $r['json']['code']);

        $token = $reset['json']['enroll']['token'];
        $start = $this->post('/auth/enroll/start', ['token' => $token], true);
        $this->assertStatus(200, $start);
        $this->assertStatus(200, $this->post('/auth/enroll/confirm', [
            'token' => $token, 'code' => self::totpCode($start['json']['secret']),
        ], true));
        $this->assertStatus(200, $this->get('/auth/me', true));

        // The old authenticator is dead for good; the new one logs in normally.
        $this->assertStatus(200, $this->startLogin('lee'));
        $this->assertStatus(401, $this->verify(self::totpCode($lee['secret'])));
        $this->assertStatus(200, $this->verify(self::totpCode($start['json']['secret'])));
        $this->assertSame(0, (int) self::userRow((int) $lee['id'])['failed_attempts']);

        $actions = array_column(self::auditRows(), 'action');
        $this->assertContains('user.reset_totp', $actions);
        $this->assertContains('auth.enrolled', $actions);
    }

    public function testASuccessfulLoginClearsTheCountSoFailuresMustBeConsecutive(): void
    {
        $sam = self::createEnrolledUser('sam');

        $this->startLogin('sam');
        for ($i = 0; $i < 4; $i++) {
            $this->assertStatus(401, $this->verify(self::wrongCode($sam['secret'])));
        }
        $this->assertStatus(200, $this->verify(self::totpCode($sam['secret'])));
        $this->assertStatus(204, $this->post('/auth/logout', [], true));

        $this->startLogin('sam');
        for ($i = 0; $i < 4; $i++) {
            $this->assertStatus(401, $this->verify(self::wrongCode($sam['secret'])));
        }
        $this->assertStatus(200, $this->verify(self::totpCode($sam['secret'])));
        $this->assertNull(self::userRow((int) $sam['id'])['locked_until']);
    }

    public function testWaitingOutTheLockLetsTheUserBackInAndClearsIt(): void
    {
        $kay = self::createEnrolledUser('kay');
        $this->startLogin('kay');
        for ($i = 0; $i < 5; $i++) {
            $this->verify(self::wrongCode($kay['secret']));
        }
        $this->assertStatus(429, $this->startLogin('kay'));

        self::db()->exec("UPDATE users SET locked_until = now() - interval '1 minute' WHERE id = {$kay['id']}");

        $this->assertStatus(200, $this->startLogin('kay'));
        $this->assertStatus(200, $this->verify(self::totpCode($kay['secret'])));
        $row = self::userRow((int) $kay['id']);
        $this->assertSame(0, (int) $row['failed_attempts']);
        $this->assertNull($row['locked_until']);
        $this->assertStatus(200, $this->get('/auth/me', true));
    }

    public function testALockoutFromAnotherDeviceDoesNotEndAnAlreadyOpenSession(): void
    {
        $max = self::createEnrolledUser('max', 'member', ['queues']);
        $this->loginAs($max);
        $desk = $this->cookies;

        // Someone else hammers the account from a second browser.
        $this->startLogin('max');
        for ($i = 0; $i < 5; $i++) {
            $this->verify(self::wrongCode($max['secret']));
        }
        $this->assertStatus(429, $this->startLogin('max'));

        // The throttle guards logging in; the desk session carries on, and the admin can end it.
        $this->cookies = $desk;
        $this->assertStatus(200, $this->get('/queues', true));
        $this->asAdmin(fn () => $this->assertStatus(200, $this->patch("/admin/users/{$max['id']}", ['is_active' => false], true)));
        $this->assertStatus(401, $this->get('/queues', true));
    }

    public function testDeactivatingALockedAccountThenResettingItIsAFullRecovery(): void
    {
        $ria = self::createEnrolledUser('ria');
        $this->startLogin('ria');
        for ($i = 0; $i < 5; $i++) {
            $this->verify(self::wrongCode($ria['secret']));
        }

        $this->asAdmin(function () use ($ria): void {
            $this->assertStatus(200, $this->patch("/admin/users/{$ria['id']}", ['is_active' => false], true));
        });
        // Deactivated beats locked: the generic failure, not a hint that the account exists.
        $this->assertStatus(401, $this->startLogin('ria'));

        // Reset refuses nothing for a deactivated account, but its link can't be used until
        // the account is switched back on.
        $reset = $this->asAdmin(fn () => $this->post("/admin/users/{$ria['id']}/reset-totp", [], true));
        $this->assertStatus(200, $reset);
        $token = $reset['json']['enroll']['token'];
        $this->assertStatus(403, $this->post('/auth/enroll/start', ['token' => $token], true));

        $this->asAdmin(fn () => $this->assertStatus(200, $this->patch("/admin/users/{$ria['id']}", ['is_active' => true], true)));
        $start = $this->post('/auth/enroll/start', ['token' => $token], true);
        $this->assertStatus(200, $start);
        $this->assertStatus(200, $this->post('/auth/enroll/confirm', [
            'token' => $token, 'code' => self::totpCode($start['json']['secret']),
        ], true));
        $this->assertStatus(200, $this->get('/auth/me', true));
    }
}
