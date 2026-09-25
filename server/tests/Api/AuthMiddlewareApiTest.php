<?php

declare(strict_types=1);

namespace Tests\Api;

use PHPUnit\Framework\Attributes\DataProvider;
use Tests\ApiTestCase;

final class AuthMiddlewareApiTest extends ApiTestCase
{
    use AuthApiHelpers;

    protected function setUp(): void
    {
        parent::setUp();
        self::resetTables('users', 'sessions', 'audit_log', 'access_presets');
        $this->cookies = [];
    }

    private function assertAllowed(string $path, array $res): void
    {
        $this->assertNotContains($res['status'], [401, 403], "{$path} should pass the gate. Body: {$res['body']}");
        $this->assertLessThan(500, $res['status'], "{$path} errored. Body: {$res['body']}");
    }

    private function assertForbidden(string $path, array $res): void
    {
        $this->assertSame(403, $res['status'], "{$path} should be forbidden. Body: {$res['body']}");
        $this->assertSame('Forbidden', $res['json']['error'] ?? null);
    }

    // ─── unauthenticated ───────────────────────────────────────────────────────

    public static function protectedPaths(): array
    {
        return [
            'ungated data'   => ['/buyers'],
            'gated staff'    => ['/staff'],
            'admin'          => ['/admin/users'],
            'audit'          => ['/audit-logs'],
            'me'             => ['/auth/me'],
            'unknown route'  => ['/no-such-route'],
        ];
    }

    #[DataProvider('protectedPaths')]
    public function testUnauthenticatedRequestIs401(string $path): void
    {
        $r = $this->get($path, true);
        $this->assertStatus(401, $r);
        $this->assertSame('Unauthorized', $r['json']['error']);
    }

    public function testUnauthenticatedWriteIs401AndChangesNothing(): void
    {
        self::resetTables('buyers');
        $this->assertStatus(401, $this->post('/buyers', ['code' => 'NOPE'], true));
        $this->assertSame(0, self::countRows('SELECT count(*) FROM buyers'));
        $this->assertSame([], self::auditRows());
    }

    public function testAllowlistedRoutesNeedNoSession(): void
    {
        $this->assertStatus(200, $this->get('/health', true));
        $this->assertStatus(200, $this->get('/auth/status', true));
        $this->assertStatus(204, $this->post('/auth/logout', [], true));
        $this->assertStatus(422, $this->post('/auth/login', [], true));
        $this->assertStatus(401, $this->post('/auth/verify-totp', [], true));
        $this->assertStatus(403, $this->post('/auth/enroll/start', [], true));
        $this->assertStatus(403, $this->post('/auth/enroll/confirm', [], true));
    }

    public function testAllowlistIsMethodSpecific(): void
    {
        $this->assertStatus(401, $this->get('/auth/login', true));
        $this->assertStatus(401, $this->post('/health', [], true));
    }

    public function testCorsPreflightIsAnsweredWithoutASession(): void
    {
        $r = $this->request('OPTIONS', '/admin/users', null, true);
        $this->assertStatus(204, $r);
    }

    public function testAuthOffServerIsCompletelyOpen(): void
    {
        $this->assertStatus(200, $this->get('/staff'));
        $this->assertStatus(200, $this->get('/buyers'));
    }

    // ─── permission matrix ─────────────────────────────────────────────────────

    /** @return array<string, array{0: ?array, 1: string, 2: bool}> */
    public static function permissionMatrix(): array
    {
        return [
            // NULL permissions fall back to Pages::DEFAULT_USER (no users/logs).
            'default → staff'              => [null, '/staff', true],
            'default → queues'             => [null, '/queues', true],
            'default → review-entries'     => [null, '/review-entries', true],
            'default → staff-attendance'   => [null, '/staff-attendance', true],
            'default → departments'        => [null, '/departments', true],
            'default → staff-salaries'     => [null, '/staff-salaries', true],
            'default → admin users'        => [null, '/admin/users', false],
            'default → access presets'     => [null, '/admin/access-presets', false],
            'default → audit-logs'         => [null, '/audit-logs', false],

            // /staff is shared by staff|queues|reviews|attendance.
            'queues → queues'              => [['queues'], '/queues', true],
            'queues → queue-codes'         => [['queues'], '/queue-codes', true],
            'queues → staff'               => [['queues'], '/staff', true],
            'queues → staff-attendance'    => [['queues'], '/staff-attendance', false],
            'queues → staff-leaves'        => [['queues'], '/staff-leaves', false],
            'queues → departments'         => [['queues'], '/departments', false],
            'queues → review-entries'      => [['queues'], '/review-entries', false],
            'queues → admin'               => [['queues'], '/admin/users', false],

            'reviews → review-departments' => [['reviews'], '/review-departments', true],
            'reviews → review-entries'     => [['reviews'], '/review-entries', true],
            'reviews → top-performer'      => [['reviews'], '/top-performer', true],
            'reviews → annual-reviews'     => [['reviews'], '/annual-reviews', true],
            'reviews → staff'              => [['reviews'], '/staff', true],
            'reviews → staff-attendance'   => [['reviews'], '/staff-attendance', false],
            'reviews → queues'             => [['reviews'], '/queues', false],

            // /staff-attendance is shared by staff|attendance.
            'attendance → staff'           => [['attendance'], '/staff', true],
            'attendance → staff-attendance' => [['attendance'], '/staff-attendance', true],
            'attendance → staff-leaves'    => [['attendance'], '/staff-leaves', false],
            'attendance → staff-salaries'  => [['attendance'], '/staff-salaries', false],
            'attendance → salary-holds'    => [['attendance'], '/staff-salary-holds', false],
            'attendance → departments'     => [['attendance'], '/departments', false],

            'staff → staff'                => [['staff'], '/staff', true],
            'staff → departments'          => [['staff'], '/departments', true],
            'staff → staff-attendance'     => [['staff'], '/staff-attendance', true],
            'staff → staff-leaves'         => [['staff'], '/staff-leaves', true],
            'staff → staff-salaries'       => [['staff'], '/staff-salaries', true],
            'staff → salary-holds'         => [['staff'], '/staff-salary-holds', true],
            'staff → queues'               => [['staff'], '/queues', false],
            // Read-only grant: the Staff overview previews Top Performer from the review rows.
            'staff → review-entries'       => [['staff'], '/review-entries', true],

            'users → admin users'          => [['users'], '/admin/users', true],
            'users → access presets'       => [['users'], '/admin/access-presets', true],
            // Read-only grant: the Users page's "pick from the roster" list.
            'users → staff'                => [['users'], '/staff', true],
            'users → audit-logs'           => [['users'], '/audit-logs', false],
            'logs → audit-logs'            => [['logs'], '/audit-logs', true],
            'logs → audit actions'         => [['logs'], '/audit-logs/actions', true],
            'logs → admin users'           => [['logs'], '/admin/users', false],

            // Segments not listed in GATED_SEGMENTS only need a login.
            'none → staff'                 => [[], '/staff', false],
            'none → buyers (ungated)'      => [[], '/buyers', true],

            // Money and attendance surfaces belong to their pages.
            'none → analytics'             => [[], '/analytics/summary', false],
            'dashboard → analytics'        => [['dashboard'], '/analytics/summary', true],
            'complete-report → analytics'  => [['complete-report'], '/analytics/complete-report', true],
            'queues → vendors'             => [['queues'], '/vendors', false],
            'vendors → vendors'            => [['vendors'], '/vendors', true],
            'vendors → vendor-payments'    => [['vendors'], '/vendor-payments?vendor=X&from=2026-08-01&to=2026-08-31', true],
            'queues → vendor-payments'     => [['queues'], '/vendor-payments', false],
            'queues → portal-expenses'     => [['queues'], '/portal-expenses', false],
            'portal-expenses → own'        => [['portal-expenses'], '/portal-expenses', true],
            'queues → attendance'          => [['queues'], '/attendance/roster', false],
            'attendance → attendance'      => [['attendance'], '/attendance/roster', true],
            'dashboard → attendance'       => [['dashboard'], '/attendance/roster', false],
        ];
    }

    #[DataProvider('permissionMatrix')]
    public function testMemberPermissionGate(?array $permissions, string $path, bool $allowed): void
    {
        $member = self::createEnrolledUser('member', 'member', $permissions);
        $this->loginAs($member);

        $r = $this->get($path, true);
        $allowed ? $this->assertAllowed($path, $r) : $this->assertForbidden($path, $r);
    }

    public static function everyGatedPath(): array
    {
        $paths = ['/audit-logs', '/admin/users', '/admin/access-presets', '/queues', '/queue-codes',
            '/review-departments', '/review-entries', '/top-performer', '/annual-reviews', '/staff',
            '/departments', '/staff-attendance', '/staff-leaves', '/staff-salaries', '/staff-salary-holds',
            '/analytics/summary', '/vendors', '/portal-expenses', '/attendance/roster'];
        return array_combine($paths, array_map(static fn ($p) => [$p], $paths));
    }

    #[DataProvider('everyGatedPath')]
    public function testAdminPassesEveryGateEvenWithEmptyPermissions(string $path): void
    {
        $admin = self::createEnrolledUser('root', 'admin', []);
        $this->loginAs($admin);
        $this->assertAllowed($path, $this->get($path, true));
    }

    public function testGateAppliesToNestedPathsAndWrites(): void
    {
        $target = self::createEnrolledUser('target');
        $member = self::createEnrolledUser('member', 'member', ['staff']);
        $this->loginAs($member);

        $this->assertForbidden('/admin/users/{id}/reset-totp', $this->post("/admin/users/{$target['id']}/reset-totp", [], true));
        $this->assertForbidden('/admin/users/{id}', $this->delete("/admin/users/{$target['id']}", true));
        $this->assertForbidden('/queues', $this->post('/queues', [], true));
        $this->assertNotNull(self::userRow((int) $target['id']));
        $this->assertNotNull(self::userRow((int) $target['id'])['totp_confirmed_at']);
        $this->assertSame([], self::auditRows('user.reset_totp'));
    }

    public function testReadGrantsNeverOpenWrites(): void
    {
        $staffOnly = self::createEnrolledUser('staffer', 'member', ['staff']);
        $this->loginAs($staffOnly);
        $this->assertForbidden('POST /review-entries', $this->post('/review-entries', ['kind' => 'performance', 'month' => '2026-08', 'person_name' => 'X'], true));

        $usersOnly = self::createEnrolledUser('admin-helper', 'member', ['users']);
        $this->loginAs($usersOnly);
        $this->assertForbidden('POST /staff', $this->post('/staff', ['name' => 'Mallory'], true));
    }

    public function testForbiddenRequestIsNotAudited(): void
    {
        $member = self::createEnrolledUser('member', 'member', []);
        $this->loginAs($member);
        self::resetTables('audit_log');

        $this->assertForbidden('/staff', $this->post('/staff', ['name' => 'X'], true));
        $this->assertSame([], self::auditRows());
    }

    public function testPresetPagesReplaceTheAccountsOwnList(): void
    {
        $preset = self::insert('access_presets', ['name' => 'Queue desk', 'pages' => ['queues']]);
        $member = self::createEnrolledUser('member', 'member', ['staff']);
        self::db()->exec("UPDATE users SET preset_id = {$preset['id']} WHERE id = {$member['id']}");
        $this->loginAs($member);

        $this->assertAllowed('/queues', $this->get('/queues', true));
        $this->assertForbidden('/staff-leaves', $this->get('/staff-leaves', true));
    }

    public function testEditingAPresetTakesEffectOnTheNextRequest(): void
    {
        $preset = self::insert('access_presets', ['name' => 'Growing', 'pages' => ['queues']]);
        $member = self::createEnrolledUser('member', 'member', null);
        self::db()->exec("UPDATE users SET preset_id = {$preset['id']} WHERE id = {$member['id']}");
        $this->loginAs($member);
        $this->assertForbidden('/staff-leaves', $this->get('/staff-leaves', true));

        self::db()->exec("UPDATE access_presets SET pages = '[\"queues\",\"staff\"]' WHERE id = {$preset['id']}");
        $this->assertAllowed('/staff-leaves', $this->get('/staff-leaves', true));
    }

    public function testPermissionChangesApplyToLiveSessions(): void
    {
        $member = self::createEnrolledUser('member', 'member', ['staff']);
        $this->loginAs($member);
        $this->assertAllowed('/departments', $this->get('/departments', true));

        self::db()->exec("UPDATE users SET permissions = '[\"queues\"]' WHERE id = {$member['id']}");
        $this->assertForbidden('/departments', $this->get('/departments', true));
    }

    public function testRoleUserIsTreatedLikeMember(): void
    {
        $u = self::createEnrolledUser('plain', 'user', null);
        $this->loginAs($u);
        $this->assertAllowed('/staff', $this->get('/staff', true));
        $this->assertForbidden('/admin/users', $this->get('/admin/users', true));
    }
}
