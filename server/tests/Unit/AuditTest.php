<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Audit;
use App\Auth\Auth;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class AuditTest extends TestCase
{
    use UsesDatabase;

    private mixed $savedAuth;
    private array $savedServer;

    protected function setUp(): void
    {
        $this->savedAuth   = $_ENV['AUTH_ENABLED'] ?? null;
        $this->savedServer = $_SERVER;
    }

    protected function tearDown(): void
    {
        $_ENV['AUTH_ENABLED'] = $this->savedAuth;
        $_SERVER = $this->savedServer;
        (new \ReflectionProperty(Audit::class, 'context'))->setValue(null, null);
        (new \ReflectionProperty(Auth::class, 'resolved'))->setValue(null, null);
    }

    private static function call(string $method, mixed ...$args): mixed
    {
        return (new \ReflectionMethod(Audit::class, $method))->invoke(null, ...$args);
    }

    /** @return array<string, array{0:string,1:?string,2:?int}> */
    public static function paths(): array
    {
        return [
            'collection'            => ['/buyers', 'buyer', null],
            'item'                  => ['/buyers/12', 'buyer', 12],
            'mapped multi-word'     => ['/queues/3', 'queue-assignment', 3],
            'nested takes first id' => ['/staff/4/leaves/9', 'staff-member', 4],
            'id not first segment'  => ['/records/export/7', 'record', 7],
            'unmapped falls back'   => ['/widgets/5', 'widgets', 5],
            'not an id'             => ['/buyers/12abc', 'buyer', null],
            'negative not an id'    => ['/buyers/-3', 'buyer', null],
            'trailing slash'        => ['/vendor-payments/8/', 'vendor-payment', 8],
            'root'                  => ['/', null, null],
            'empty'                 => ['', null, null],
        ];
    }

    #[DataProvider('paths')]
    public function testEntityIsDerivedFromThePath(string $path, ?string $type, ?int $id): void
    {
        $this->assertSame([$type, $id], self::call('entity', $path));
    }

    public function testVerbMapping(): void
    {
        $this->assertSame('create', self::call('verb', 'POST'));
        $this->assertSame('update', self::call('verb', 'PUT'));
        $this->assertSame('update', self::call('verb', 'PATCH'));
        $this->assertSame('delete', self::call('verb', 'DELETE'));
        $this->assertSame('get', self::call('verb', 'GET'));
    }

    public function testSanitizeMasksEverySecretKeyAndKeepsTheRest(): void
    {
        $this->assertSame(
            [
                'name' => 'Bob', 'password' => '***', 'totp_secret' => '***', 'secret' => '***',
                'token' => '***', 'enroll_token' => '***', 'code' => '123456',
            ],
            self::call('sanitize', [
                'name' => 'Bob', 'password' => 'hunter2', 'totp_secret' => 'ABC', 'secret' => 's',
                'token' => 't', 'enroll_token' => 'e', 'code' => '123456',
            ])
        );
    }

    public function testSanitizeMasksSecretsEvenWhenNull(): void
    {
        $this->assertSame(['password' => '***'], self::call('sanitize', ['password' => null]));
    }

    public function testSanitizeLeavesDataWithoutSecretsUntouched(): void
    {
        $data = ['amount' => 12.5, 'items' => [1, 2]];
        $this->assertSame($data, self::call('sanitize', $data));
    }

    // --- writes against the test database -------------------------------------------------

    private function authOn(): array
    {
        $this->requireTables('users', 'audit_log');
        $_ENV['AUTH_ENABLED'] = 'true';
        $user = self::insertUser('auditor');
        $user = ['id' => (int) $user['id'], 'email' => $user['email'], 'username' => 'auditor', 'role' => 'member'];
        (new \ReflectionProperty(Auth::class, 'resolved'))->setValue(null, [
            'session' => ['id' => 1, 'mfa_pending' => false],
            'user'    => $user,
        ]);
        return $user;
    }

    /** @return list<array<string,mixed>> */
    private static function logRows(): array
    {
        return self::pdo()->query(
            'SELECT user_id, user_email, action, method, path, entity_type, entity_id, details, status_code, ip, user_agent
               FROM audit_log ORDER BY id'
        )->fetchAll();
    }

    public function testFlushWritesOneSanitisedRowForAMutatingRequest(): void
    {
        $user = $this->authOn();
        $_SERVER['REMOTE_ADDR'] = '10.1.2.3';
        $_SERVER['HTTP_USER_AGENT'] = 'UnitTest';

        Audit::begin('PUT', '/buyers/12', ['name' => 'Acme', 'password' => 'x']);
        Audit::flush();

        $rows = self::logRows();
        $this->assertCount(1, $rows);
        $this->assertSame($user['id'], $rows[0]['user_id']);
        $this->assertSame('auditor@example.test', $rows[0]['user_email']);
        $this->assertSame('buyer.update', $rows[0]['action']);
        $this->assertSame('PUT', $rows[0]['method']);
        $this->assertSame('/buyers/12', $rows[0]['path']);
        $this->assertSame('buyer', $rows[0]['entity_type']);
        $this->assertSame(12, $rows[0]['entity_id']);
        $this->assertEquals(['name' => 'Acme', 'password' => '***'], json_decode($rows[0]['details'], true));
        $this->assertSame('10.1.2.3', $rows[0]['ip']);
        $this->assertSame('UnitTest', $rows[0]['user_agent']);
    }

    public function testFlushOnAnUnmappedRootPathLogsARequestAction(): void
    {
        $this->authOn();
        Audit::begin('POST', '/', []);
        Audit::flush();

        $rows = self::logRows();
        $this->assertSame('request.create', $rows[0]['action']);
        $this->assertNull($rows[0]['entity_type']);
        $this->assertNull($rows[0]['details'], 'empty body stored as NULL');
    }

    /** @return array<string, array{0:string,1:string}> */
    public static function skippedRequests(): array
    {
        return [
            'read'           => ['GET', '/buyers/1'],
            'head'           => ['HEAD', '/buyers'],
            'options'        => ['OPTIONS', '/buyers'],
            'auth endpoint'  => ['POST', '/auth/login'],
            'admin endpoint' => ['PATCH', '/admin/users/3'],
            'audit log'      => ['DELETE', '/audit-logs'],
        ];
    }

    #[DataProvider('skippedRequests')]
    public function testFlushSkips(string $method, string $path): void
    {
        $this->authOn();
        Audit::begin($method, $path, ['a' => 1]);
        Audit::flush();

        $this->assertSame([], self::logRows());
    }

    public function testFlushSkipsWithoutAnAuthenticatedUser(): void
    {
        $this->authOn();
        (new \ReflectionProperty(Auth::class, 'resolved'))->setValue(null, [
            'session' => ['id' => 1, 'mfa_pending' => true],
            'user'    => ['id' => 1, 'role' => 'admin'],
        ]);
        Audit::begin('POST', '/buyers', []);
        Audit::flush();

        $this->assertSame([], self::logRows());
    }

    public function testFlushWithoutBeginDoesNothing(): void
    {
        $this->authOn();
        Audit::flush();

        $this->assertSame([], self::logRows());
    }

    public function testNothingIsWrittenWhileAuthIsDisabled(): void
    {
        $this->authOn();
        $_ENV['AUTH_ENABLED'] = 'false';

        Audit::begin('POST', '/buyers', []);
        Audit::flush();
        Audit::record('records.export', ['method' => 'GET', 'path' => '/records/export']);

        $this->assertSame([], self::logRows());
    }

    public function testRecordWritesImmediatelyWithExplicitContext(): void
    {
        $this->authOn();
        Audit::record('auth.login', [
            'method'      => 'POST',
            'path'        => '/auth/login',
            'entity_type' => 'user',
            'entity_id'   => 7,
            'details'     => ['identifier' => 'bob', 'token' => 'raw'],
            'status_code' => 200,
            'user'        => ['id' => null, 'username' => 'bob'],
        ]);

        [$row] = self::logRows();
        $this->assertNull($row['user_id']);
        $this->assertSame('bob', $row['user_email'], 'username used when there is no email');
        $this->assertSame('auth.login', $row['action']);
        $this->assertSame('user', $row['entity_type']);
        $this->assertSame(7, $row['entity_id']);
        $this->assertSame(200, $row['status_code']);
        $this->assertEquals(['identifier' => 'bob', 'token' => '***'], json_decode($row['details'], true));
    }

    public function testRecordFallsBackToTheCurrentUserThenThePendingUser(): void
    {
        $user = $this->authOn();
        Audit::record('user.update');

        (new \ReflectionProperty(Auth::class, 'resolved'))->setValue(null, [
            'session' => ['id' => 1, 'mfa_pending' => true],
            'user'    => $user,
        ]);
        $_SERVER['REQUEST_METHOD'] = 'POST';
        Audit::record('auth.totp_failed');

        $rows = self::logRows();
        $this->assertSame([$user['id'], $user['id']], array_column($rows, 'user_id'));
        $this->assertSame([null, 'POST'], array_column($rows, 'method'));
    }

    public function testWriteFailuresAreSwallowed(): void
    {
        $this->authOn();
        Audit::record('bad.fk', ['user' => ['id' => 999999, 'email' => 'ghost@example.test']]);

        $this->assertSame([], self::logRows());
    }
}
