<?php

declare(strict_types=1);

/**
 * Rebuild the throwaway `crm_test` database the API tests run against:
 * schema.sql, then every migration in order, then empty stand-ins for the check-in bot's
 * tables (which the app only reads and never migrates — see seed_attendance_dev.php).
 *
 * Uses the credentials from server/.env but always targets TEST_DB_NAME (default crm_test),
 * and refuses any name that does not end in `_test`, so it can never drop the real `crm`.
 *
 *   php tests/setup_test_db.php
 */

require __DIR__ . '/../vendor/autoload.php';

use Dotenv\Dotenv;

Dotenv::createImmutable(__DIR__ . '/..')->safeLoad();

$testDb = getenv('TEST_DB_NAME') ?: 'crm_test';
if (!str_ends_with($testDb, '_test')) {
    fwrite(STDERR, "Refusing to run: test database name '{$testDb}' must end in _test.\n");
    exit(1);
}

$host = $_ENV['DB_HOST'] ?? 'localhost';
$port = $_ENV['DB_PORT'] ?? '5432';
$user = $_ENV['DB_USER'] ?? 'postgres';
$pass = $_ENV['DB_PASSWORD'] ?? '';

$admin = new PDO("pgsql:host={$host};port={$port};dbname=postgres", $user, $pass, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
]);
$admin->exec("DROP DATABASE IF EXISTS \"{$testDb}\" WITH (FORCE)");
$admin->exec("CREATE DATABASE \"{$testDb}\"");
$admin = null;

/** Locate psql: PSQL env var, PATH, then the usual Windows install folders. */
function findPsql(): string
{
    if ($env = getenv('PSQL')) {
        return $env;
    }
    $probe = stripos(PHP_OS, 'WIN') === 0 ? 'where psql 2>NUL' : 'command -v psql 2>/dev/null';
    $found = trim((string) shell_exec($probe));
    if ($found !== '') {
        return strtok($found, "\r\n");
    }
    $candidates = glob('C:/Program Files/PostgreSQL/*/bin/psql.exe') ?: [];
    rsort($candidates, SORT_NATURAL);
    if ($candidates !== []) {
        return $candidates[0];
    }
    fwrite(STDERR, "psql not found; set the PSQL env var to its path.\n");
    exit(1);
}

$psql = findPsql();

/**
 * Run one SQL file through psql. schema.sql has a couple of statements that reference
 * tables only a later migration creates, so errors are reported but do not stop the build.
 */
function runSqlFile(string $psql, string $file, array $conn): void
{
    [$host, $port, $user, $pass, $db] = $conn;
    $cmd = [$psql, '-h', $host, '-p', $port, '-U', $user, '-d', $db, '-q', '-X', '-f', $file];
    $env = getenv() + ['PGPASSWORD' => $pass, 'PGCLIENTENCODING' => 'UTF8'];
    $env['PGPASSWORD'] = $pass;
    $proc = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $env);
    stream_get_contents($pipes[1]);
    $err = stream_get_contents($pipes[2]);
    proc_close($proc);
    foreach (preg_split('/\R/', $err) as $line) {
        if (stripos($line, 'ERROR') !== false && getenv('TEST_DB_VERBOSE')) {
            fwrite(STDERR, basename($file) . ': ' . $line . "\n");
        }
    }
}

$conn = [$host, $port, $user, $pass, $testDb];
$dir  = __DIR__ . '/../database';

runSqlFile($psql, "{$dir}/schema.sql", $conn);

// The check-in bot's tables, empty. Created before the migrations because 028 relinks
// against attendance_staff.
$standIns = tempnam(sys_get_temp_dir(), 'crm') . '.sql';
file_put_contents($standIns, <<<'SQL'
CREATE TABLE IF NOT EXISTS attendance_staff (
    user_id    BIGINT PRIMARY KEY,
    username   TEXT,
    staff_name TEXT,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS attendance_days (
    user_id       BIGINT NOT NULL,
    staff_name    TEXT,
    username      TEXT,
    work_date     DATE   NOT NULL,
    login_at      TIMESTAMPTZ,
    login_stated  TEXT,
    logout_at     TIMESTAMPTZ,
    logout_stated TEXT
);
CREATE TABLE IF NOT EXISTS attendance_breaks (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT NOT NULL,
    work_date    DATE   NOT NULL,
    staff_name   TEXT,
    taken_at     TIMESTAMPTZ NOT NULL,
    returned_at  TIMESTAMPTZ,
    duration_min INTEGER NOT NULL DEFAULT 0,
    urgent       BOOLEAN NOT NULL DEFAULT false,
    raw          TEXT,
    group_id     TEXT,
    message_id   BIGINT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_days_dev ON attendance_days (user_id, work_date);
SQL);
runSqlFile($psql, $standIns, $conn);
@unlink($standIns);

$migrations = glob("{$dir}/migrations/*.sql") ?: [];
sort($migrations, SORT_NATURAL);
foreach ($migrations as $m) {
    runSqlFile($psql, $m, $conn);
}

echo "Built {$testDb} (schema + " . count($migrations) . " migrations + bot stand-ins).\n";
