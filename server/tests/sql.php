<?php

declare(strict_types=1);

/**
 * Run one SQL statement against the test database and print the rows as JSON.
 *
 * Used by the client integration tests (Node has no Postgres driver here) to seed tables the
 * API never writes — the check-in bot's attendance_* tables, enrolled users — and to assert
 * on stored state. Reads {"sql": "...", "params": [...]} from stdin.
 *
 *   echo '{"sql":"SELECT 1 AS x"}' | TEST_DB_NAME=crm_int_test php tests/sql.php
 */

require __DIR__ . '/../vendor/autoload.php';

Dotenv\Dotenv::createImmutable(__DIR__ . '/..')->safeLoad();

$db = getenv('TEST_DB_NAME') ?: 'crm_test';
if (!str_ends_with($db, '_test')) {
    fwrite(STDERR, "Refusing to run: database '{$db}' must end in _test.\n");
    exit(1);
}

$input = json_decode((string) stream_get_contents(STDIN), true);
if (!is_array($input) || !isset($input['sql'])) {
    fwrite(STDERR, "Expected {\"sql\": ..., \"params\": [...]} on stdin.\n");
    exit(1);
}

$pdo = new PDO(
    sprintf('pgsql:host=%s;port=%s;dbname=%s', $_ENV['DB_HOST'] ?? 'localhost', $_ENV['DB_PORT'] ?? '5432', $db),
    $_ENV['DB_USER'] ?? 'postgres',
    $_ENV['DB_PASSWORD'] ?? '',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);

try {
    $stmt = $pdo->prepare($input['sql']);
    $stmt->execute(array_values($input['params'] ?? []));
    echo json_encode($stmt->columnCount() > 0 ? $stmt->fetchAll() : []);
} catch (PDOException $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(2);
}
