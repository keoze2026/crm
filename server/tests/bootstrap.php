<?php

declare(strict_types=1);

/**
 * PHPUnit bootstrap.
 *
 * Unit tests need only the autoloader. API tests additionally need the `crm_test` database
 * (rebuilt here once per run unless TEST_SKIP_DB_SETUP=1) and the two `php -S` servers,
 * which ApiTestCase starts lazily the first time an API test runs.
 */

require __DIR__ . '/../vendor/autoload.php';

$testDb = getenv('TEST_DB_NAME') ?: 'crm_test';
if (!str_ends_with($testDb, '_test')) {
    fwrite(STDERR, "Refusing to run: TEST_DB_NAME '{$testDb}' must end in _test.\n");
    exit(1);
}
putenv("TEST_DB_NAME={$testDb}");

// Unit tests that touch code reading $_ENV (e.g. Config) get the same safe defaults the test
// server uses, never the developer's real .env.
$_ENV['DB_NAME']      = $testDb;
$_ENV['APP_ENV']      = 'development';
$_ENV['AUTH_ENABLED'] = 'false';

// Load DB_HOST / DB_USER / DB_PASSWORD from .env for ApiTestCase's direct PDO connection.
// Immutable, so the DB_NAME pinned above is kept.
Dotenv\Dotenv::createImmutable(__DIR__ . '/..')->safeLoad();

$argvStr = implode(' ', $_SERVER['argv'] ?? []);
$unitOnly = str_contains($argvStr, '--testsuite=Unit') || str_contains($argvStr, '--testsuite Unit')
    || preg_match('#tests[/\\\\]Unit#', $argvStr);

if (!$unitOnly && !getenv('TEST_SKIP_DB_SETUP')) {
    passthru(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__DIR__ . '/setup_test_db.php'), $code);
    if ($code !== 0) {
        fwrite(STDERR, "Could not build the test database.\n");
        exit(1);
    }
}

require __DIR__ . '/ApiTestCase.php';
