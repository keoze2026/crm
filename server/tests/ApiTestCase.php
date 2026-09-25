<?php

declare(strict_types=1);

namespace Tests;

use OTPHP\InternalClock;
use OTPHP\TOTP;
use PDO;
use PHPUnit\Framework\TestCase;

/**
 * Base class for tests that exercise a controller through real HTTP requests.
 *
 * Controllers answer through Http::json(), which exit()s, so they are driven end-to-end
 * against a `php -S` instance backed by the throwaway `crm_test` database. Two servers run:
 * auth OFF (the everyday mode — every data route open) and auth ON (the only mode in which
 * the /auth, /admin and /audit-logs routes exist and the page permissions are enforced).
 *
 * Tests own their data: call resetTables() in setUp() for every table the test touches.
 */
abstract class ApiTestCase extends TestCase
{
    /** @var array<int, resource> */
    private static array $servers = [];
    private static ?PDO $pdo = null;

    /** Cookie jar for the auth-on server (crm_session). */
    protected array $cookies = [];

    public static function setUpBeforeClass(): void
    {
        parent::setUpBeforeClass();
        self::startServer(self::port(false), false);
        self::startServer(self::port(true), true);
    }

    /** Ports come from TEST_PORT_BASE (default 8098): base = auth off, base + 1 = auth on. */
    private static function port(bool $auth): int
    {
        return (int) (getenv("TEST_PORT_BASE") ?: 8098) + ($auth ? 1 : 0);
    }

    private static function startServer(int $port, bool $auth): void
    {
        if (isset(self::$servers[$port])) {
            return;
        }
        $root = realpath(__DIR__ . '/..');
        $env  = getenv() + [];
        $env['TEST_DB_NAME']      = getenv('TEST_DB_NAME') ?: 'crm_test';
        $env['TEST_AUTH_ENABLED'] = $auth ? 'true' : 'false';
        $null = stripos(PHP_OS, 'WIN') === 0 ? 'NUL' : '/dev/null';
        $proc = proc_open(
            [PHP_BINARY, '-S', "127.0.0.1:{$port}", '-t', 'public', 'tests/server.php'],
            [0 => ['file', $null, 'r'], 1 => ['file', $null, 'w'], 2 => ['file', $null, 'w']],
            $pipes,
            $root,
            $env
        );
        if (!\is_resource($proc)) {
            self::fail("Could not start php -S on port {$port}");
        }
        self::$servers[$port] = $proc;

        $deadline = microtime(true) + 10;
        while (microtime(true) < $deadline) {
            $sock = @fsockopen('127.0.0.1', $port, $errno, $errstr, 0.2);
            if ($sock) {
                fclose($sock);
                break;
            }
            usleep(100_000);
        }

        static $registered = false;
        if (!$registered) {
            $registered = true;
            register_shutdown_function(static function (): void {
                foreach (self::$servers as $p) {
                    proc_terminate($p);
                    proc_close($p);
                }
            });
        }
    }

    /** Direct connection to the test database, for arranging data and asserting on it. */
    protected static function db(): PDO
    {
        if (self::$pdo === null) {
            $host = $_ENV['DB_HOST'] ?? 'localhost';
            $port = $_ENV['DB_PORT'] ?? '5432';
            $name = getenv('TEST_DB_NAME') ?: 'crm_test';
            if (!str_ends_with($name, '_test')) {
                throw new \RuntimeException("Refusing to connect to non-test database {$name}");
            }
            self::$pdo = new PDO(
                "pgsql:host={$host};port={$port};dbname={$name}",
                $_ENV['DB_USER'] ?? 'postgres',
                $_ENV['DB_PASSWORD'] ?? '',
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                ]
            );
        }
        return self::$pdo;
    }

    /** Empty the given tables (identity reset, cascading to dependants). */
    protected static function resetTables(string ...$tables): void
    {
        if ($tables === []) {
            return;
        }
        self::db()->exec('TRUNCATE ' . implode(', ', $tables) . ' RESTART IDENTITY CASCADE');
    }

    /** Insert a row and return it (all columns). */
    protected static function insert(string $table, array $row): array
    {
        $cols = array_keys($row);
        $sql  = sprintf(
            'INSERT INTO %s (%s) VALUES (%s) RETURNING *',
            $table,
            implode(', ', $cols),
            implode(', ', array_map(fn ($c) => ':' . $c, $cols))
        );
        $stmt = self::db()->prepare($sql);
        foreach ($row as $k => $v) {
            $stmt->bindValue(':' . $k, \is_array($v) ? json_encode($v) : $v, match (true) {
                \is_bool($v) => PDO::PARAM_BOOL,
                \is_int($v)  => PDO::PARAM_INT,
                $v === null  => PDO::PARAM_NULL,
                default      => PDO::PARAM_STR,
            });
        }
        $stmt->execute();
        return $stmt->fetch();
    }

    /**
     * Send a request. Returns status, decoded JSON (null if not JSON), raw body and headers.
     *
     * @return array{status:int, json:mixed, body:string, headers:array<int,string>}
     */
    protected function request(string $method, string $path, ?array $body = null, bool $auth = false): array
    {
        $port = $auth ? self::port(true) : self::port(false);
        $headers = ['Accept: application/json'];
        if ($body !== null) {
            $headers[] = 'Content-Type: application/json';
        }
        if ($auth && $this->cookies !== []) {
            $pairs = [];
            foreach ($this->cookies as $k => $v) {
                $pairs[] = "{$k}={$v}";
            }
            $headers[] = 'Cookie: ' . implode('; ', $pairs);
        }
        $ctx = stream_context_create(['http' => [
            'method'        => $method,
            'header'        => implode("\r\n", $headers),
            'content'       => $body !== null ? json_encode($body) : '',
            'ignore_errors' => true,
            'timeout'       => 30,
        ]]);
        $raw = @file_get_contents("http://127.0.0.1:{$port}/api{$path}", false, $ctx);
        $responseHeaders = $http_response_header ?? [];
        preg_match('#HTTP/\S+\s+(\d{3})#', $responseHeaders[0] ?? '', $m);

        if ($auth) {
            foreach ($responseHeaders as $h) {
                if (preg_match('/^Set-Cookie:\s*([^=]+)=([^;]*)/i', $h, $c)) {
                    if ($c[2] === '' || $c[2] === 'deleted') {
                        unset($this->cookies[$c[1]]);
                    } else {
                        $this->cookies[$c[1]] = $c[2];
                    }
                }
            }
        }

        $raw = $raw === false ? '' : $raw;
        return [
            'status'  => (int) ($m[1] ?? 0),
            'json'    => json_decode($raw, true),
            'body'    => $raw,
            'headers' => $responseHeaders,
        ];
    }

    protected function get(string $path, bool $auth = false): array
    {
        return $this->request('GET', $path, null, $auth);
    }

    protected function post(string $path, array $body = [], bool $auth = false): array
    {
        return $this->request('POST', $path, $body, $auth);
    }

    protected function put(string $path, array $body = [], bool $auth = false): array
    {
        return $this->request('PUT', $path, $body, $auth);
    }

    protected function patch(string $path, array $body = [], bool $auth = false): array
    {
        return $this->request('PATCH', $path, $body, $auth);
    }

    protected function delete(string $path, bool $auth = false): array
    {
        return $this->request('DELETE', $path, null, $auth);
    }

    /** Assert the response status, showing the body on failure. */
    protected function assertStatus(int $expected, array $res): void
    {
        $this->assertSame($expected, $res['status'], "Unexpected status. Body: {$res['body']}");
    }

    /**
     * Create an enrolled user directly in the DB. Returns the row plus its TOTP secret.
     *
     * @param array<int,string>|null $permissions
     */
    protected static function createEnrolledUser(string $username, string $role = 'member', ?array $permissions = null): array
    {
        $secret = TOTP::generate(new InternalClock())->getSecret();
        $row = self::insert('users', [
            'email'             => "{$username}@example.test",
            'name'              => ucfirst($username),
            'username'          => $username,
            'role'              => $role,
            'totp_secret'       => $secret,
            'totp_confirmed_at' => date('c'),
            'is_active'         => true,
            'permissions'       => $permissions === null ? null : json_encode($permissions),
        ]);
        $row['secret'] = $secret;
        return $row;
    }

    /** The current 6-digit code for a secret. */
    protected static function totpCode(string $secret): string
    {
        return TOTP::createFromSecret($secret, new InternalClock())->now();
    }

    /** Log in on the auth-on server (login → verify-totp); cookies land in $this->cookies. */
    protected function loginAs(array $user): void
    {
        $this->cookies = [];
        $r = $this->post('/auth/login', ['identifier' => $user['username']], true);
        $this->assertStatus(200, $r);
        $r = $this->post('/auth/verify-totp', ['code' => self::totpCode($user['secret'])], true);
        $this->assertStatus(200, $r);
    }
}
