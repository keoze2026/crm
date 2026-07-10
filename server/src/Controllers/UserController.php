<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Audit;
use App\Auth\Auth;
use App\Auth\Pages;
use App\Auth\Session;
use App\Database;
use App\Http;

/**
 * Admin-only user management. Admins create accounts and hand out one-time enrolment links;
 * the user links their Google Authenticator on first use (see AuthController::enrollStart).
 * Admin-only access is enforced by the router middleware on the /admin/ prefix.
 */
final class UserController
{
    private const ROLES = ['admin', 'member', 'user'];
    private const ENROLL_TTL_HOURS = 24;

    /** GET /admin/users — list all accounts (no secrets). */
    public function index(): void
    {
        $stmt = Database::connection()->query(
            'SELECT id, email, name, username, role, is_active, permissions,
                    (totp_confirmed_at IS NOT NULL) AS totp_enabled,
                    last_login_at, created_at
             FROM users ORDER BY created_at DESC, id DESC'
        );
        Http::json(array_map([$this, 'cast'], $stmt->fetchAll()));
    }

    /** POST /admin/users {email, name?, username?, role?} — create + issue an enrolment link. */
    public function store(): void
    {
        $body  = Http::body();
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        $role  = (string) ($body['role'] ?? 'member');

        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            Http::error('A valid email is required', 422);
        }
        if (!in_array($role, self::ROLES, true)) {
            Http::error('Invalid role', 422);
        }

        [$token, $hash, $expires] = $this->newEnrollToken();

        // A new non-admin starts with the standard page set; admins ignore permissions.
        $perms = isset($body['permissions']) && is_array($body['permissions'])
            ? Pages::sanitize($body['permissions'])
            : ($role === 'admin' ? null : Pages::DEFAULT_USER);

        $stmt = Database::connection()->prepare(
            'INSERT INTO users (email, name, username, role, permissions, enroll_token_hash, enroll_expires_at)
             VALUES (:email, :name, :username, :role, :perms::jsonb, :hash, :expires)
             RETURNING id, email, name, username, role, is_active, permissions,
                       (totp_confirmed_at IS NOT NULL) AS totp_enabled, last_login_at, created_at'
        );
        try {
            $stmt->execute([
                ':email'    => $email,
                ':name'     => $body['name'] ?? null,
                ':username' => ($body['username'] ?? null) ?: null,
                ':role'     => $role,
                ':perms'    => $perms !== null ? json_encode($perms) : null,
                ':hash'     => $hash,
                ':expires'  => $expires,
            ]);
        } catch (\PDOException) {
            Http::error('A user with that email or username already exists', 409);
        }

        $user = $this->cast($stmt->fetch());
        Audit::record('user.create', [
            'entity_type' => 'user',
            'entity_id'   => $user['id'],
            'details'     => ['email' => $email, 'role' => $role],
            'status_code' => 201,
        ]);

        Http::json($user + ['enroll' => $this->enrollPayload($token, $expires)], 201);
    }

    /** PATCH /admin/users/{id} {name?, email?, username?, role?, is_active?} — update an account. */
    public function update(array $params): void
    {
        $id   = (int) $params['id'];
        $body = Http::body();

        if (isset($body['role']) && !in_array($body['role'], self::ROLES, true)) {
            Http::error('Invalid role', 422);
        }

        // Email: validate only when the caller is changing it.
        $email = null;
        if (array_key_exists('email', $body)) {
            $email = strtolower(trim((string) $body['email']));
            if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                Http::error('A valid email is required', 422);
            }
        }

        // Username: present key => set it (blank clears it); absent => leave unchanged.
        $hasUsername = array_key_exists('username', $body);
        $username    = $hasUsername ? (trim((string) $body['username']) ?: null) : null;

        // Permissions: present array => replace the page allowlist; absent => leave unchanged.
        $hasPerms = array_key_exists('permissions', $body) && is_array($body['permissions']);
        $perms    = $hasPerms ? Pages::sanitize($body['permissions']) : null;

        $stmt = Database::connection()->prepare(
            'UPDATE users SET
                name        = COALESCE(:name, name),
                email       = COALESCE(:email, email),
                username    = CASE WHEN :has_username::boolean THEN :username ELSE username END,
                role        = COALESCE(:role, role),
                permissions = CASE WHEN :has_perms::boolean THEN :perms::jsonb ELSE permissions END,
                is_active   = COALESCE(:active, is_active),
                updated_at  = now()
             WHERE id = :id
             RETURNING id, email, name, username, role, is_active, permissions,
                       (totp_confirmed_at IS NOT NULL) AS totp_enabled, last_login_at, created_at'
        );
        try {
            $stmt->execute([
                ':id'           => $id,
                ':name'         => $body['name'] ?? null,
                ':email'        => $email,
                ':has_username' => $hasUsername ? 't' : 'f',
                ':username'     => $username,
                ':role'         => $body['role'] ?? null,
                ':has_perms'    => $hasPerms ? 't' : 'f',
                ':perms'        => $perms !== null ? json_encode($perms) : null,
                ':active'       => array_key_exists('is_active', $body) ? ($body['is_active'] ? 't' : 'f') : null,
            ]);
        } catch (\PDOException) {
            Http::error('A user with that email or username already exists', 409);
        }
        $row = $stmt->fetch();
        if (!$row) {
            Http::error('User not found', 404);
        }

        // If the account was deactivated, kill its live sessions.
        if (array_key_exists('is_active', $body) && !$body['is_active']) {
            Session::destroyForUser($id);
        }

        $user = $this->cast($row);
        Audit::record('user.update', [
            'entity_type' => 'user',
            'entity_id'   => $id,
            'details'     => array_intersect_key($body, array_flip(['name', 'email', 'username', 'role', 'permissions', 'is_active'])),
            'status_code' => 200,
        ]);
        Http::json($user);
    }

    /** POST /admin/users/{id}/reset-totp — clear enrolment + issue a fresh link (lost device). */
    public function resetTotp(array $params): void
    {
        $id = (int) $params['id'];
        [$token, $hash, $expires] = $this->newEnrollToken();

        $stmt = Database::connection()->prepare(
            'UPDATE users
                SET totp_secret = NULL, totp_confirmed_at = NULL,
                    enroll_token_hash = :hash, enroll_expires_at = :expires,
                    failed_attempts = 0, locked_until = NULL, updated_at = now()
              WHERE id = :id
              RETURNING id'
        );
        $stmt->execute([':hash' => $hash, ':expires' => $expires, ':id' => $id]);
        if (!$stmt->fetch()) {
            Http::error('User not found', 404);
        }
        Session::destroyForUser($id);

        Audit::record('user.reset_totp', ['entity_type' => 'user', 'entity_id' => $id, 'status_code' => 200]);
        Http::json(['reset' => true, 'enroll' => $this->enrollPayload($token, $expires)]);
    }

    /** DELETE /admin/users/{id} — permanently delete the account (sessions cascade). */
    public function destroy(array $params): void
    {
        $id = (int) $params['id'];
        if (Auth::id() === $id) {
            Http::error('You cannot delete your own account', 409);
        }

        // ON DELETE CASCADE clears sessions; audit_log rows keep their email snapshot (SET NULL).
        $stmt = Database::connection()->prepare('DELETE FROM users WHERE id = :id RETURNING email');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            Http::error('User not found', 404);
        }

        Audit::record('user.delete', [
            'entity_type' => 'user',
            'entity_id'   => $id,
            'details'     => ['email' => $row['email']],
            'status_code' => 200,
        ]);
        Http::json(['deleted' => true]);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    /** @return array{0:string,1:string,2:string} [rawToken, sha256hash, expiresIso] */
    private function newEnrollToken(): array
    {
        $token   = bin2hex(random_bytes(32));
        $expires = (new \DateTimeImmutable('+' . self::ENROLL_TTL_HOURS . ' hours'))->format('c');
        return [$token, hash('sha256', $token), $expires];
    }

    private function enrollPayload(string $token, string $expires): array
    {
        return [
            'token'      => $token,
            'path'       => '/enroll?token=' . $token,   // client composes the full URL
            'expires_at' => $expires,
        ];
    }

    private function cast(array $r): array
    {
        $r['id']           = (int) $r['id'];
        $r['is_active']    = (bool) $r['is_active'];
        $r['totp_enabled'] = (bool) $r['totp_enabled'];
        $r['permissions']  = isset($r['permissions']) && $r['permissions'] !== null
            ? json_decode((string) $r['permissions'], true)
            : null;
        return $r;
    }
}
