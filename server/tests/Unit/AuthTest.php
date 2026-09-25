<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Auth\Auth;
use App\Auth\Pages;
use App\Auth\Session;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** require()/requireAdmin() failure paths exit() and are left to the API tests. */
final class AuthTest extends TestCase
{
    use UsesDatabase;

    protected function tearDown(): void
    {
        self::resolveAs(null);
    }

    /** Put Auth into the state Session::resolve() would have produced. */
    private static function resolveAs(?array $resolved): void
    {
        (new \ReflectionProperty(Auth::class, 'resolved'))->setValue(null, $resolved);
    }

    private static function state(string $role = 'member', bool $pending = false, ?array $permissions = null): array
    {
        return [
            'session' => ['id' => 1, 'mfa_pending' => $pending],
            'user'    => ['id' => 42, 'email' => 'a@example.test', 'role' => $role, 'permissions' => $permissions],
        ];
    }

    public function testNothingResolved(): void
    {
        $this->assertNull(Auth::user());
        $this->assertNull(Auth::rawUser());
        $this->assertNull(Auth::session());
        $this->assertNull(Auth::id());
        $this->assertFalse(Auth::isPending());
        $this->assertFalse(Auth::isAdmin());
        $this->assertFalse(Auth::hasPermission('dashboard'));
    }

    public function testFullyAuthenticatedUser(): void
    {
        $s = self::state();
        self::resolveAs($s);

        $this->assertSame($s['user'], Auth::user());
        $this->assertSame($s['user'], Auth::rawUser());
        $this->assertSame($s['session'], Auth::session());
        $this->assertSame(42, Auth::id());
        $this->assertFalse(Auth::isPending());
        $this->assertFalse(Auth::isAdmin());
        $this->assertSame($s['user'], Auth::require());
    }

    public function testPendingMfaHidesTheUserButKeepsRawUser(): void
    {
        $s = self::state('admin', true);
        self::resolveAs($s);

        $this->assertTrue(Auth::isPending());
        $this->assertNull(Auth::user());
        $this->assertNull(Auth::id());
        $this->assertFalse(Auth::isAdmin());
        $this->assertFalse(Auth::hasPermission('dashboard'));
        $this->assertSame($s['user'], Auth::rawUser());
    }

    public function testAdminHasEveryPageRegardlessOfPermissions(): void
    {
        self::resolveAs(self::state('admin', false, []));

        $this->assertTrue(Auth::isAdmin());
        $this->assertSame(42, Auth::requireAdmin()['id']);
        foreach ([...Pages::ALL, 'anything'] as $page) {
            $this->assertTrue(Auth::hasPermission($page), $page);
        }
    }

    /** @return array<string, array{0:string}> */
    public static function nonAdminRoles(): array
    {
        return ['member' => ['member'], 'user' => ['user']];
    }

    #[DataProvider('nonAdminRoles')]
    public function testNonAdminWithoutCustomPermissionsGetsTheDefaultPages(string $role): void
    {
        self::resolveAs(self::state($role));

        foreach (Pages::ALL as $page) {
            $this->assertSame(\in_array($page, Pages::DEFAULT_USER, true), Auth::hasPermission($page), $page);
        }
    }

    public function testNonAdminWithCustomPermissionsGetsExactlyThose(): void
    {
        self::resolveAs(self::state('member', false, ['buyers', 'logs']));

        $this->assertTrue(Auth::hasPermission('buyers'));
        $this->assertTrue(Auth::hasPermission('logs'));
        $this->assertFalse(Auth::hasPermission('dashboard'));
        $this->assertFalse(Auth::hasPermission('Buyers'));
    }

    public function testEmptyPermissionListMeansNoPages(): void
    {
        self::resolveAs(self::state('member', false, []));

        foreach (Pages::ALL as $page) {
            $this->assertFalse(Auth::hasPermission($page), $page);
        }
    }

    public function testAttemptResolvesFromTheSessionCookie(): void
    {
        $this->requireTables('users', 'sessions');
        $user  = self::insertUser('authme', ['role' => 'admin']);
        $saved = $_COOKIE;
        try {
            $_COOKIE[Session::COOKIE] = self::withoutHeaderWarnings(
                static fn () => Session::create((int) $user['id'], false)
            );
            Auth::attempt();
            $this->assertSame((int) $user['id'], Auth::id());
            $this->assertTrue(Auth::isAdmin());

            $_COOKIE = [];
            Auth::attempt();
            $this->assertNull(Auth::user());
        } finally {
            $_COOKIE = $saved;
        }
    }
}
