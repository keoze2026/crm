<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Database;
use PDO;

/**
 * For unit tests that drive a class against the real test database through
 * App\Database::connection() (pinned to TEST_DB_NAME by tests/bootstrap.php).
 *
 * A Unit-only run does not rebuild the database, so these tests skip when it has not been
 * built yet — run `composer test:db` (or the full suite) once first.
 */
trait UsesDatabase
{
    protected static function pdo(): PDO
    {
        return Database::connection();
    }

    /** Skip unless the test database is reachable and has the given tables. */
    protected function requireTables(string ...$tables): void
    {
        try {
            $pdo = self::pdo();
            foreach ($tables as $t) {
                $pdo->query("SELECT 1 FROM {$t} LIMIT 0");
            }
        } catch (\PDOException $e) {
            $this->markTestSkipped('Test database not available (run `composer test:db`): ' . $e->getMessage());
        }
        self::pdo()->exec('TRUNCATE ' . implode(', ', $tables) . ' RESTART IDENTITY CASCADE');
    }

    /** @param array<string,mixed> $overrides */
    protected static function insertUser(string $username, array $overrides = []): array
    {
        $row = $overrides + [
            'email'     => "{$username}@example.test",
            'name'      => ucfirst($username),
            'username'  => $username,
            'role'      => 'member',
            'is_active' => true,
        ];
        $cols = array_keys($row);
        $stmt = self::pdo()->prepare(sprintf(
            'INSERT INTO users (%s) VALUES (%s) RETURNING *',
            implode(', ', $cols),
            implode(', ', array_map(static fn ($c) => ':' . $c, $cols))
        ));
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
     * Run code that calls setcookie(). PHPUnit has already written to stdout, so PHP warns
     * "headers already sent"; that one warning is expected here and swallowed.
     */
    protected static function withoutHeaderWarnings(callable $fn): mixed
    {
        set_error_handler(static function (int $no, string $msg): bool {
            return str_contains($msg, 'Cannot modify header information');
        }, E_WARNING);
        try {
            return $fn();
        } finally {
            restore_error_handler();
        }
    }
}
