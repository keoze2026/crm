<?php

declare(strict_types=1);

/**
 * Bootstrap the first admin account for the passwordless auth system.
 *
 * Creates (or promotes) an admin user with no TOTP secret and issues a one-time enrolment
 * link. Open that link in the browser to scan the QR into Google Authenticator — nobody but
 * the admin ever holds the secret. Idempotent and non-interactive (reads env, no stdin).
 *
 * Run:
 *   ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" php database/seed_admin.php
 *
 * Optional env: ADMIN_USERNAME, CLIENT_URL (defaults to http://localhost:5173).
 */

use App\Database;
use Dotenv\Dotenv;

require __DIR__ . '/../vendor/autoload.php';
Dotenv::createImmutable(__DIR__ . '/..')->safeLoad();

$email    = strtolower(trim((string) ($_ENV['ADMIN_EMAIL'] ?? getenv('ADMIN_EMAIL') ?: '')));
$name     = (string) ($_ENV['ADMIN_NAME'] ?? getenv('ADMIN_NAME') ?: 'Administrator');
$username = ($_ENV['ADMIN_USERNAME'] ?? getenv('ADMIN_USERNAME') ?: null) ?: null;
$clientUrl = rtrim((string) ($_ENV['CLIENT_URL'] ?? getenv('CLIENT_URL') ?: 'http://localhost:5173'), '/');

if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    fwrite(STDERR, "ADMIN_EMAIL must be a valid email.\n");
    exit(1);
}

$pdo = Database::connection();

$existing = $pdo->prepare('SELECT id, totp_confirmed_at FROM users WHERE lower(email) = :email');
$existing->execute([':email' => $email]);
$row = $existing->fetch();

if ($row && $row['totp_confirmed_at'] !== null) {
    // Already enrolled — just make sure they are an active admin. Don't clobber their TOTP.
    $pdo->prepare('UPDATE users SET role = \'admin\', is_active = true, updated_at = now() WHERE id = :id')
        ->execute([':id' => $row['id']]);
    echo "User {$email} already enrolled; ensured role=admin, is_active=true.\n";
    echo "To re-enrol (lost device), use the admin 'Reset TOTP' action instead.\n";
    exit(0);
}

// Issue a one-time enrolment token (72h window for the bootstrap).
$token   = bin2hex(random_bytes(32));
$hash    = hash('sha256', $token);
$expires = (new DateTimeImmutable('+72 hours'))->format('c');

$pdo->prepare(
    'INSERT INTO users (email, name, username, role, is_active, enroll_token_hash, enroll_expires_at)
     VALUES (:email, :name, :username, \'admin\', true, :hash, :expires)
     ON CONFLICT (email) DO UPDATE
        SET role = \'admin\', is_active = true, name = COALESCE(EXCLUDED.name, users.name),
            enroll_token_hash = EXCLUDED.enroll_token_hash,
            enroll_expires_at = EXCLUDED.enroll_expires_at,
            totp_secret = NULL, totp_confirmed_at = NULL, updated_at = now()'
)->execute([
    ':email'    => $email,
    ':name'     => $name,
    ':username' => $username,
    ':hash'     => $hash,
    ':expires'  => $expires,
]);

echo "Admin ready: {$email}\n";
echo "Open this enrolment link to set up Google Authenticator (valid 72h):\n\n";
echo "  {$clientUrl}/enroll?token={$token}\n\n";
echo "Make sure AUTH_ENABLED=true in server/.env before logging in.\n";
