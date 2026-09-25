<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Auth\Session;
use PHPUnit\Framework\TestCase;

final class SessionTest extends TestCase
{
    use UsesDatabase;

    private array $savedCookie;
    private array $savedServer;

    protected function setUp(): void
    {
        $this->savedCookie = $_COOKIE;
        $this->savedServer = $_SERVER;
        $_COOKIE = [];
        $this->requireTables('users', 'sessions', 'access_presets');
    }

    protected function tearDown(): void
    {
        $_COOKIE = $this->savedCookie;
        $_SERVER = $this->savedServer;
    }

    private static function create(int $userId, bool $pending): string
    {
        return self::withoutHeaderWarnings(static fn () => Session::create($userId, $pending));
    }

    /** @return list<array<string,mixed>> */
    private static function rows(): array
    {
        return self::pdo()->query(
            'SELECT user_id, token_hash, mfa_pending, ip, user_agent,
                    extract(epoch FROM expires_at - now())::int AS ttl
               FROM sessions ORDER BY id'
        )->fetchAll();
    }

    public function testCreateStoresOnlyTheTokenHash(): void
    {
        $uid = (int) self::insertUser('sess')['id'];
        $_SERVER['REMOTE_ADDR'] = '10.0.0.9';
        $_SERVER['HTTP_USER_AGENT'] = 'UnitTest/1.0';

        $token = self::create($uid, false);

        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $token);
        $rows = self::rows();
        $this->assertCount(1, $rows);
        $this->assertSame($uid, $rows[0]['user_id']);
        $this->assertSame(hash('sha256', $token), $rows[0]['token_hash']);
        $this->assertFalse($rows[0]['mfa_pending']);
        $this->assertSame('10.0.0.9', $rows[0]['ip']);
        $this->assertSame('UnitTest/1.0', $rows[0]['user_agent']);
    }

    public function testFullSessionLastsTwelveHoursAndPendingTenMinutes(): void
    {
        $uid = (int) self::insertUser('sess')['id'];
        self::create($uid, false);
        self::create($uid, true);

        [$full, $pending] = self::rows();
        $this->assertEqualsWithDelta(12 * 3600, $full['ttl'], 5);
        $this->assertTrue($pending['mfa_pending']);
        $this->assertEqualsWithDelta(600, $pending['ttl'], 5);
    }

    public function testTokensAreUnique(): void
    {
        $uid = (int) self::insertUser('sess')['id'];
        $this->assertNotSame(self::create($uid, true), self::create($uid, true));
    }

    public function testResolveWithoutCookieIsNull(): void
    {
        $this->assertNull(Session::resolve());
        $_COOKIE[Session::COOKIE] = '';
        $this->assertNull(Session::resolve());
    }

    public function testResolveWithUnknownTokenIsNull(): void
    {
        $_COOKIE[Session::COOKIE] = str_repeat('a', 64);
        $this->assertNull(Session::resolve());
    }

    public function testResolveReturnsSessionAndUser(): void
    {
        $user = self::insertUser('sess', ['role' => 'admin', 'totp_confirmed_at' => date('c')]);
        $_COOKIE[Session::COOKIE] = self::create((int) $user['id'], true);

        $r = Session::resolve();

        $this->assertIsInt($r['session']['id']);
        $this->assertTrue($r['session']['mfa_pending']);
        $this->assertSame([
            'id'           => (int) $user['id'],
            'email'        => 'sess@example.test',
            'name'         => 'Sess',
            'role'         => 'admin',
            'username'     => 'sess',
            'totp_enabled' => true,
            'permissions'  => null,
        ], $r['user']);
    }

    public function testResolveReportsNotEnrolledAndDecodesPermissions(): void
    {
        $user = self::insertUser('sess', ['permissions' => ['buyers', 'queues']]);
        $_COOKIE[Session::COOKIE] = self::create((int) $user['id'], false);

        $r = Session::resolve();

        $this->assertFalse($r['session']['mfa_pending']);
        $this->assertFalse($r['user']['totp_enabled']);
        $this->assertSame(['buyers', 'queues'], $r['user']['permissions']);
    }

    public function testAttachedPresetOverridesOwnPermissions(): void
    {
        $preset = self::pdo()->query(
            "INSERT INTO access_presets (name, pages) VALUES ('Finance', '[\"vendors\"]') RETURNING id"
        )->fetchColumn();
        $user = self::insertUser('sess', ['permissions' => ['buyers'], 'preset_id' => (int) $preset]);
        $_COOKIE[Session::COOKIE] = self::create((int) $user['id'], false);

        $this->assertSame(['vendors'], Session::resolve()['user']['permissions']);
    }

    public function testResolveIgnoresInactiveUsers(): void
    {
        $user = self::insertUser('sess', ['is_active' => false]);
        $_COOKIE[Session::COOKIE] = self::create((int) $user['id'], false);

        $this->assertNull(Session::resolve());
    }

    public function testResolveIgnoresExpiredSessions(): void
    {
        $user = self::insertUser('sess');
        $_COOKIE[Session::COOKIE] = self::create((int) $user['id'], false);
        self::pdo()->exec("UPDATE sessions SET expires_at = now() - interval '1 second'");

        $this->assertNull(Session::resolve());
    }

    public function testResolveTouchesLastSeen(): void
    {
        $user = self::insertUser('sess');
        $_COOKIE[Session::COOKIE] = self::create((int) $user['id'], false);
        self::pdo()->exec("UPDATE sessions SET last_seen_at = now() - interval '1 hour'");

        Session::resolve();

        $age = (int) self::pdo()->query('SELECT extract(epoch FROM now() - last_seen_at)::int FROM sessions')->fetchColumn();
        $this->assertLessThan(60, $age);
    }

    public function testUpgradeRotatesTokenClearsPendingAndExtendsExpiry(): void
    {
        $user = self::insertUser('sess');
        $old  = self::create((int) $user['id'], true);
        $_COOKIE[Session::COOKIE] = $old;

        self::withoutHeaderWarnings(static fn () => Session::upgradeCurrent());

        [$row] = self::rows();
        $this->assertNotSame(hash('sha256', $old), $row['token_hash']);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $row['token_hash']);
        $this->assertFalse($row['mfa_pending']);
        $this->assertEqualsWithDelta(12 * 3600, $row['ttl'], 5);
        $this->assertNull(Session::resolve(), 'old token must stop working');
    }

    public function testUpgradeWithoutCookieDoesNothing(): void
    {
        $user = self::insertUser('sess');
        self::create((int) $user['id'], true);
        $before = self::rows();

        Session::upgradeCurrent();

        $this->assertSame($before, self::rows());
    }

    public function testDestroyCurrentDeletesOnlyThatSession(): void
    {
        $uid  = (int) self::insertUser('sess')['id'];
        $keep = self::create($uid, false);
        $_COOKIE[Session::COOKIE] = self::create($uid, false);

        self::withoutHeaderWarnings(static fn () => Session::destroyCurrent());

        $this->assertSame([hash('sha256', $keep)], array_column(self::rows(), 'token_hash'));
    }

    public function testDestroyForUserDeletesAllOfThatUsersSessions(): void
    {
        $a = (int) self::insertUser('usera')['id'];
        $b = (int) self::insertUser('userb')['id'];
        self::create($a, false);
        self::create($a, true);
        self::create($b, false);

        Session::destroyForUser($a);

        $this->assertSame([$b], array_column(self::rows(), 'user_id'));
    }
}
