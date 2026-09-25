<?php

declare(strict_types=1);

/**
 * Router script for the `php -S` instances the API tests talk to.
 *
 * Pins the database to the test one BEFORE public/index.php loads .env. Dotenv is immutable,
 * so a value already in $_ENV wins — which is exactly what keeps these requests off `crm`.
 * (An exported DB_NAME alone would NOT do it: it lands in $_SERVER, Dotenv then skips the
 * key, and Database falls back to its 'crm' default.)
 */

$testDb = getenv('TEST_DB_NAME') ?: 'crm_test';
if (!str_ends_with($testDb, '_test')) {
    http_response_code(500);
    echo json_encode(['error' => "test server refuses database '{$testDb}'"]);
    return true;
}

$_ENV['DB_NAME']      = $testDb;
$_ENV['APP_ENV']      = 'development';
$_ENV['AUTH_ENABLED'] = getenv('TEST_AUTH_ENABLED') ?: 'false';
$_ENV['CORS_ORIGIN']  = 'http://localhost:5173';
$_ENV['CLIENT_URL']   = 'http://localhost:5173';

require __DIR__ . '/../public/index.php';
