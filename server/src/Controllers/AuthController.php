<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Audit;
use App\Auth\Auth;
use App\Auth\Config;
use App\Auth\RateLimiter;
use App\Auth\Session;
use App\Auth\Totp;
use App\Database;
use App\Http;

/**
 * Passwordless Google-Authenticator (TOTP) auth.
 *
 * Flow:
 *   - Admin creates a user (UserController) → a one-time enrolment link is issued.
 *   - First-time setup: enroll/start (with the token) → user scans the QR → enroll/confirm
 *     (token + live code) locks in the secret and opens a full session.
 *   - Returning users: login (identifier) → verify-totp (code).
 */
final class AuthController
{
    /** GET /auth/status — always reachable; tells the client whether auth is enforced. */
    public function status(): void
    {
        Http::json(['auth_enabled' => Config::enabled()]);
    }

    /** POST /auth/login {identifier} — start a login for an already-enrolled user. */
    public function login(): void
    {
        $identifier = trim((string) (Http::body()['identifier'] ?? ''));
        if ($identifier === '') {
            Http::error('Identifier is required', 422);
        }

        $user = $this->findByIdentifier($identifier);

        // Generic failure so a missing account is not distinguishable from a bad one.
        if ($user === null || !$user['is_active']) {
            Http::error('Invalid credentials', 401);
        }
        if (RateLimiter::isLocked($user['locked_until'])) {
            Http::error('Account temporarily locked. Try again later.', 429);
        }
        if ($user['totp_confirmed_at'] === null) {
            Http::error('Account not set up yet. Use the enrolment link from your admin.', 403, ['code' => 'NOT_ENROLLED']);
        }

        // Open a short-lived pending session; the TOTP step upgrades it.
        Session::create((int) $user['id'], true);
        Http::json(['mfa_required' => true]);
    }

    /** POST /auth/verify-totp {code} — complete login against the pending session. */
    public function verifyTotp(): void
    {
        if (!Auth::isPending() || Auth::rawUser() === null) {
            Http::error('No pending login', 401);
        }
        $userId = (int) Auth::rawUser()['id'];
        $code   = (string) (Http::body()['code'] ?? '');

        $row = $this->fetchAuthRow($userId);
        if ($row === null || !$row['is_active']) {
            Http::error('Invalid credentials', 401);
        }
        if (RateLimiter::isLocked($row['locked_until'])) {
            Http::error('Account temporarily locked. Try again later.', 429);
        }
        if ($row['totp_secret'] === null || $row['totp_confirmed_at'] === null) {
            Http::error('Account not set up yet.', 403, ['code' => 'NOT_ENROLLED']);
        }

        // Actor for audit — captured explicitly because the token rotation below leaves the
        // request's cookie stale, so Auth::user() can no longer re-resolve it this request.
        $actor = ['id' => $userId, 'email' => $row['email']];

        if (!Totp::verify($row['totp_secret'], $code)) {
            RateLimiter::recordFailure($userId);
            Audit::record('auth.login_failed', ['user' => $actor, 'entity_type' => 'user', 'entity_id' => $userId, 'status_code' => 401]);
            Http::error('Invalid code', 401);
        }

        Session::upgradeCurrent();
        RateLimiter::reset($userId);
        $this->markLoggedIn($userId);

        Audit::record('auth.login', ['user' => $actor, 'entity_type' => 'user', 'entity_id' => $userId, 'status_code' => 200]);
        Http::json(['user' => $this->publicUser($this->fetchAuthRow($userId))]);
    }

    /** POST /auth/enroll/start {token} — begin first-time TOTP setup via a one-time link. */
    public function enrollStart(): void
    {
        $token = (string) (Http::body()['token'] ?? '');
        $user  = $this->findByEnrollToken($token);
        if ($user === null) {
            Http::error('Invalid or expired enrolment link', 403);
        }

        $secret = Totp::newSecret();
        $stmt = Database::connection()->prepare(
            'UPDATE users SET totp_secret = :s, updated_at = now() WHERE id = :id'
        );
        $stmt->execute([':s' => $secret, ':id' => $user['id']]);

        Http::json([
            'otpauth_uri' => Totp::provisioningUri($secret, (string) $user['email']),
            'secret'      => $secret,
            'email'       => $user['email'],
        ]);
    }

    /** POST /auth/enroll/confirm {token, code} — verify the first code and open a session. */
    public function enrollConfirm(): void
    {
        $body  = Http::body();
        $token = (string) ($body['token'] ?? '');
        $code  = (string) ($body['code'] ?? '');

        $user = $this->findByEnrollToken($token);
        if ($user === null) {
            Http::error('Invalid or expired enrolment link', 403);
        }
        if ($user['totp_secret'] === null) {
            Http::error('Start enrolment first', 409);
        }
        if (!Totp::verify($user['totp_secret'], $code)) {
            Http::error('Invalid code', 401);
        }

        // Confirm enrolment and consume the one-time token.
        $stmt = Database::connection()->prepare(
            'UPDATE users
                SET totp_confirmed_at = now(), enroll_token_hash = NULL, enroll_expires_at = NULL,
                    failed_attempts = 0, locked_until = NULL, updated_at = now()
              WHERE id = :id'
        );
        $stmt->execute([':id' => $user['id']]);

        Session::create((int) $user['id'], false);
        $this->markLoggedIn((int) $user['id']);

        $actor = ['id' => (int) $user['id'], 'email' => $user['email']];
        Audit::record('auth.enrolled', ['user' => $actor, 'entity_type' => 'user', 'entity_id' => (int) $user['id'], 'status_code' => 200]);
        Http::json(['user' => $this->publicUser($this->fetchAuthRow((int) $user['id']))]);
    }

    /** POST /auth/logout — destroy the current session. */
    public function logout(): void
    {
        $user = Auth::user() ?? Auth::rawUser();
        if ($user !== null) {
            Audit::record('auth.logout', ['user' => $user, 'entity_type' => 'user', 'entity_id' => (int) $user['id'], 'status_code' => 204]);
        }
        Session::destroyCurrent();
        http_response_code(204);
    }

    /** GET /auth/me — the current user (used by the frontend AuthProvider). */
    public function me(): void
    {
        $user = Auth::require();
        Http::json(['user' => $this->publicUser($this->fetchAuthRow((int) $user['id']))]);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    private function findByIdentifier(string $identifier): ?array
    {
        $stmt = Database::connection()->prepare(
            'SELECT id, email, name, role, username, is_active, totp_confirmed_at, locked_until
             FROM users
             WHERE lower(email) = lower(:id) OR lower(username) = lower(:id)
             LIMIT 1'
        );
        $stmt->execute([':id' => $identifier]);
        return $stmt->fetch() ?: null;
    }

    private function findByEnrollToken(string $token): ?array
    {
        if ($token === '') {
            return null;
        }
        $stmt = Database::connection()->prepare(
            'SELECT id, email, name, role, username, totp_secret
             FROM users
             WHERE enroll_token_hash = :h
               AND enroll_expires_at > now()
               AND totp_confirmed_at IS NULL
               AND is_active
             LIMIT 1'
        );
        $stmt->execute([':h' => hash('sha256', $token)]);
        return $stmt->fetch() ?: null;
    }

    private function fetchAuthRow(int $userId): ?array
    {
        $stmt = Database::connection()->prepare(
            'SELECT id, email, name, role, username, is_active, permissions,
                    totp_secret, totp_confirmed_at, locked_until
             FROM users WHERE id = :id'
        );
        $stmt->execute([':id' => $userId]);
        return $stmt->fetch() ?: null;
    }

    private function markLoggedIn(int $userId): void
    {
        $stmt = Database::connection()->prepare('UPDATE users SET last_login_at = now() WHERE id = :id');
        $stmt->execute([':id' => $userId]);
    }

    private function publicUser(array $u): array
    {
        $perms = $u['permissions'] ?? null;
        if (is_string($perms)) {
            $perms = json_decode($perms, true);
        }
        return [
            'id'           => (int) $u['id'],
            'email'        => $u['email'],
            'name'         => $u['name'],
            'role'         => $u['role'],
            'username'     => $u['username'] ?? null,
            'totp_enabled' => ($u['totp_confirmed_at'] ?? null) !== null,
            'permissions'  => is_array($perms) ? $perms : null,
        ];
    }
}
