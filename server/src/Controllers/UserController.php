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

    /**
     * Swap a still-pending account's enrolment token for a new one. The WHERE is the guard:
     * an enrolled or deactivated account matches nothing, so it is never touched.
     */
    private const REFRESH_PENDING_LINK_SQL =
        'UPDATE users
            SET totp_secret = NULL, enroll_token_hash = :hash, enroll_expires_at = :expires,
                failed_attempts = 0, locked_until = NULL, updated_at = now()
          WHERE id = :id AND totp_confirmed_at IS NULL AND is_active';

    /** GET /admin/users — list all accounts (no secrets). */
    public function index(): void
    {
        $stmt = Database::connection()->query(
            // `permissions` is the EFFECTIVE list (preset pages while one is attached), so the
            // admin table shows what each account can really open. `own_permissions` is the
            // account's own list, kept so detaching from a preset can restore it in the editor.
            'SELECT u.id, u.email, u.name, u.username, u.staff_id, u.role, u.is_active,
                    COALESCE(ap.pages, u.permissions) AS permissions,
                    u.permissions AS own_permissions,
                    u.preset_id, ap.name AS preset_name,
                    (u.totp_confirmed_at IS NOT NULL) AS totp_enabled,
                    u.enroll_expires_at,
                    (u.enroll_token_hash IS NOT NULL AND u.enroll_expires_at > now()) AS enroll_link_active,
                    u.last_login_at, u.created_at
             FROM users u
             LEFT JOIN access_presets ap ON ap.id = u.preset_id
             ORDER BY u.created_at DESC, u.id DESC'
        );
        Http::json(array_map([$this, 'cast'], $stmt->fetchAll()));
    }

    /**
     * POST /admin/users {email?, username?, staff_id?, name?, role?, preset_id?} — create the
     * account and issue an enrolment link.
     *
     * An account needs at least one identifier, and may be created three ways:
     *   email      the classic form
     *   username   for someone with no work email — login already accepts either
     *   staff_id   pick someone off the Staff roster; their name comes across, and a
     *              username is derived from it when one isn't supplied
     *
     * Whichever route, the response carries a fresh one-time enrolment link so the admin can
     * hand over the QR code straight away.
     */
    public function store(): void
    {
        $body = Http::body();
        $role = (string) ($body['role'] ?? 'member');

        if (!in_array($role, self::ROLES, true)) {
            Http::error('Invalid role', 422);
        }

        // Email is optional now, but still has to be an email when it is given.
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        if ($email === '') {
            $email = null;
        } elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            Http::error('That email address is not valid', 422);
        }

        $username = trim((string) ($body['username'] ?? '')) ?: null;
        $name     = trim((string) ($body['name'] ?? '')) ?: null;

        // Picking a staff member fills in whatever the admin left blank.
        $staffId = isset($body['staff_id']) && $body['staff_id'] !== '' ? (int) $body['staff_id'] : null;
        if ($staffId !== null) {
            $staff = $this->findStaff($staffId);
            if ($staff === null) {
                Http::error('That staff member no longer exists', 422);
            }
            if ($this->staffHasAccount($staffId)) {
                Http::error('That staff member already has an account', 409);
            }
            $name     ??= $staff['name'];
            $username ??= $this->usernameFromName($staff['name']);
        }

        if ($email === null && $username === null) {
            Http::error('An email or a username is required', 422);
        }
        if ($username !== null && $this->usernameTaken($username)) {
            Http::error('That username is already taken', 409);
        }

        [$token, $hash, $expires] = $this->newEnrollToken();

        // Page access. A preset is ATTACHED, not copied: the account's own permissions column
        // is left NULL and the preset's pages are read live on every request, so adding a page
        // to the preset reaches everyone on it. An explicit permissions list still wins, and
        // admins ignore all of it.
        $presetId = isset($body['preset_id']) && $body['preset_id'] !== '' ? (int) $body['preset_id'] : null;
        $preset   = null;
        if ($presetId !== null) {
            $preset = $this->findPreset($presetId);
            if ($preset === null) {
                Http::error('That access preset no longer exists', 422);
            }
        }

        $perms = match (true) {
            isset($body['permissions']) && is_array($body['permissions']) => Pages::sanitize($body['permissions']),
            $role === 'admin'                                            => null,
            $preset !== null                                             => null, // preset supplies them
            default                                                      => Pages::DEFAULT_USER,
        };

        // An explicit list means the admin wants this account's own access, not a preset's.
        if ($presetId !== null && $perms !== null) {
            $presetId = null;
            $preset   = null;
        }
        // Admins see every page, so an attached preset would be meaningless noise.
        if ($role === 'admin') {
            $presetId = null;
            $preset   = null;
        }

        $stmt = Database::connection()->prepare(
            'INSERT INTO users (email, name, username, staff_id, preset_id, role, permissions, enroll_token_hash, enroll_expires_at)
             VALUES (:email, :name, :username, :staff_id, :preset_id, :role, :perms::jsonb, :hash, :expires)
             RETURNING id, email, name, username, staff_id, preset_id, role, is_active,
                       COALESCE((SELECT pages FROM access_presets WHERE id = preset_id), permissions) AS permissions,
                       (totp_confirmed_at IS NOT NULL) AS totp_enabled, last_login_at, created_at'
        );
        try {
            $stmt->execute([
                ':email'     => $email,
                ':name'      => $name,
                ':username'  => $username,
                ':staff_id'  => $staffId,
                ':preset_id' => $presetId,
                ':role'      => $role,
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
            'details'     => array_filter([
                'email'    => $email,
                'username' => $username,
                'staff_id' => $staffId,
                'role'     => $role,
                'preset'   => $preset['name'] ?? null,
            ], static fn ($v) => $v !== null),
            'status_code' => 201,
        ]);

        Http::json($user + ['enroll' => $this->enrollPayload($token, $expires)], 201);
    }

    /**
     * PATCH /admin/users/{id} {name?, email?, username?, role?, preset_id?, permissions?,
     * is_active?} — update an account.
     *
     * `preset_id` attaches the account to an access preset (null detaches it). Attaching and
     * sending an explicit `permissions` list are mutually exclusive: whichever the caller
     * sends is the one that decides access, and the other is cleared.
     */
    public function update(array $params): void
    {
        $id   = (int) $params['id'];
        $body = Http::body();

        if (isset($body['role']) && !in_array($body['role'], self::ROLES, true)) {
            Http::error('Invalid role', 422);
        }

        // Email: present key => set it (blank clears it, now that email is optional); absent
        // => leave unchanged. Still has to look like an email when one is actually given.
        $hasEmail = array_key_exists('email', $body);
        $email    = $hasEmail ? (strtolower(trim((string) $body['email'])) ?: null) : null;
        if ($email !== null && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            Http::error('That email address is not valid', 422);
        }

        // Username: present key => set it (blank clears it); absent => leave unchanged.
        $hasUsername = array_key_exists('username', $body);
        $username    = $hasUsername ? (trim((string) $body['username']) ?: null) : null;

        if ($username !== null && $this->usernameTaken($username, $id)) {
            Http::error('That username is already taken', 409);
        }

        // An account with neither identifier could never log in again. Check against what the
        // row will actually hold once this patch lands, not just what the patch carries.
        if ($hasEmail || $hasUsername) {
            $current = $this->findUser($id);
            if ($current === null) {
                Http::error('User not found', 404);
            }
            $finalEmail    = $hasEmail ? $email : $current['email'];
            $finalUsername = $hasUsername ? $username : $current['username'];
            if ($finalEmail === null && $finalUsername === null) {
                Http::error('An account needs an email or a username — it cannot have neither', 422);
            }
        }

        // Permissions: present array => replace the page allowlist; absent => leave unchanged.
        $hasPerms = array_key_exists('permissions', $body) && is_array($body['permissions']);
        $perms    = $hasPerms ? Pages::sanitize($body['permissions']) : null;

        // Preset: present key => attach (id) or detach (null); absent => leave as it is.
        // Attaching clears the account's own list so there is one source of access, and an
        // explicit permissions list means "this account's own access", which detaches it.
        $hasPreset = array_key_exists('preset_id', $body);
        $presetId  = $hasPreset && $body['preset_id'] !== null && $body['preset_id'] !== ''
            ? (int) $body['preset_id']
            : null;

        if ($presetId !== null && $this->findPreset($presetId) === null) {
            Http::error('That access preset no longer exists', 422);
        }
        if ($hasPerms) {
            $hasPreset = true;
            $presetId  = null;
        }
        if ($presetId !== null) {
            $hasPerms = true;
            $perms    = null;   // the preset answers for this account now
        }
        // An admin sees everything, so a preset attached to them would be dead weight.
        if (($body['role'] ?? null) === 'admin') {
            $hasPreset = true;
            $presetId  = null;
        }

        $stmt = Database::connection()->prepare(
            'UPDATE users SET
                name        = COALESCE(:name, name),
                email       = CASE WHEN :has_email::boolean THEN :email ELSE email END,
                username    = CASE WHEN :has_username::boolean THEN :username ELSE username END,
                role        = COALESCE(:role, role),
                permissions = CASE WHEN :has_perms::boolean THEN :perms::jsonb ELSE permissions END,
                preset_id   = CASE WHEN :has_preset::boolean THEN :preset_id ELSE preset_id END,
                is_active   = COALESCE(:active, is_active),
                updated_at  = now()
             WHERE id = :id
             RETURNING id, email, name, username, staff_id, preset_id, role, is_active,
                       COALESCE((SELECT pages FROM access_presets WHERE id = preset_id), permissions) AS permissions,
                       (totp_confirmed_at IS NOT NULL) AS totp_enabled, last_login_at, created_at'
        );
        try {
            $stmt->execute([
                ':id'           => $id,
                ':name'         => $body['name'] ?? null,
                ':has_email'    => $hasEmail ? 't' : 'f',
                ':email'        => $email,
                ':has_username' => $hasUsername ? 't' : 'f',
                ':username'     => $username,
                ':role'         => $body['role'] ?? null,
                ':has_perms'    => $hasPerms ? 't' : 'f',
                ':perms'        => $perms !== null ? json_encode($perms) : null,
                ':has_preset'   => $hasPreset ? 't' : 'f',
                ':preset_id'    => $presetId,
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
            'details'     => array_intersect_key($body, array_flip(['name', 'email', 'username', 'role', 'permissions', 'preset_id', 'is_active'])),
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

    /**
     * POST /admin/users/{id}/enroll-link — a fresh enrolment link for an account that hasn't
     * finished setup: the old link expired, went astray, or was never sent.
     *
     * Unlike reset-totp this refuses an account that has already enrolled, so refreshing a link
     * can never wipe someone's working authenticator. The previous link stops working, and any
     * setup half-started from it is cleared so that QR can't be confirmed afterwards.
     */
    public function refreshEnrollLink(array $params): void
    {
        $id = (int) $params['id'];
        [$token, $hash, $expires] = $this->newEnrollToken();

        $stmt = Database::connection()->prepare(self::REFRESH_PENDING_LINK_SQL);
        $stmt->execute([':hash' => $hash, ':expires' => $expires, ':id' => $id]);
        if ($stmt->rowCount() === 0) {
            $check = Database::connection()->prepare('SELECT is_active FROM users WHERE id = :id');
            $check->execute([':id' => $id]);
            $row = $check->fetch();
            if (!$row) {
                Http::error('User not found', 404);
            }
            if (!$row['is_active']) {
                Http::error('This account is deactivated. Activate it before issuing a link.', 409);
            }
            Http::error('This user has already set up their authenticator. Use Reset authenticator instead.', 409);
        }

        Audit::record('user.refresh_enroll_link', ['entity_type' => 'user', 'entity_id' => $id, 'status_code' => 200]);
        Http::json(['enroll' => $this->enrollPayload($token, $expires)]);
    }

    /**
     * POST /admin/users/enroll-links — a fresh link for EVERY active account still pending
     * setup, for handing a batch out together. Each person gets their own token; every pending
     * link issued before this stops working. Enrolled and deactivated accounts are untouched.
     */
    public function refreshPendingEnrollLinks(): void
    {
        $db      = Database::connection();
        $pending = $db->query(
            'SELECT id, email, name, username FROM users
              WHERE totp_confirmed_at IS NULL AND is_active
              ORDER BY lower(COALESCE(name, username, email)), id'
        )->fetchAll();
        $update  = $db->prepare(self::REFRESH_PENDING_LINK_SQL);

        $links = [];
        $db->beginTransaction();
        foreach ($pending as $u) {
            [$token, $hash, $expires] = $this->newEnrollToken();
            $update->execute([':hash' => $hash, ':expires' => $expires, ':id' => $u['id']]);
            if ($update->rowCount() === 0) {
                continue; // finished enrolling between the read and the write
            }
            $links[] = [
                'id'       => (int) $u['id'],
                'email'    => $u['email'],
                'name'     => $u['name'],
                'username' => $u['username'],
                'enroll'   => $this->enrollPayload($token, $expires),
            ];
        }
        $db->commit();

        Audit::record('user.refresh_enroll_links', [
            'entity_type' => 'user',
            'details'     => ['count' => \count($links), 'user_ids' => array_column($links, 'id')],
            'status_code' => 200,
        ]);
        Http::json(['links' => $links]);
    }

    /** DELETE /admin/users/{id} — permanently delete the account (sessions cascade). */
    public function destroy(array $params): void
    {
        $id = (int) $params['id'];
        if (Auth::id() === $id) {
            Http::error('You cannot delete your own account', 409);
        }

        // ON DELETE CASCADE clears sessions; audit_log rows keep their email snapshot (SET NULL).
        $stmt = Database::connection()->prepare('DELETE FROM users WHERE id = :id RETURNING email, username');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            Http::error('User not found', 404);
        }

        Audit::record('user.delete', [
            'entity_type' => 'user',
            'entity_id'   => $id,
            // Whichever identifier the account actually had — email is optional now.
            'details'     => array_filter([
                'email'    => $row['email'],
                'username' => $row['username'],
            ], static fn ($v) => $v !== null),
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

    /**
     * A named access preset and the pages it grants, re-sanitised on read so a preset stored
     * before a page was retired can't hand out a key the app no longer knows.
     *
     * @return array{id:int,name:string,pages:array<int,string>}|null
     */
    private function findPreset(int $id): ?array
    {
        $stmt = Database::connection()->prepare('SELECT id, name, pages FROM access_presets WHERE id = :id');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            return null;
        }
        $pages = is_string($row['pages']) ? json_decode($row['pages'], true) : $row['pages'];
        return [
            'id'    => (int) $row['id'],
            'name'  => (string) $row['name'],
            'pages' => Pages::sanitize(is_array($pages) ? $pages : []),
        ];
    }

    /** The identifiers an account currently holds, for validating a partial update. */
    private function findUser(int $id): ?array
    {
        $stmt = Database::connection()->prepare('SELECT id, email, username FROM users WHERE id = :id');
        $stmt->execute([':id' => $id]);
        return $stmt->fetch() ?: null;
    }

    /** @return array{id:int,name:string}|null */
    private function findStaff(int $id): ?array
    {
        $stmt = Database::connection()->prepare('SELECT id, name FROM staff WHERE id = :id');
        $stmt->execute([':id' => $id]);
        return $stmt->fetch() ?: null;
    }

    /** One login per person on the roster — checked here so the error is readable. */
    private function staffHasAccount(int $staffId, ?int $exceptUserId = null): bool
    {
        $stmt = Database::connection()->prepare(
            'SELECT 1 FROM users WHERE staff_id = :sid AND (:except::bigint IS NULL OR id <> :except) LIMIT 1'
        );
        $stmt->execute([':sid' => $staffId, ':except' => $exceptUserId]);
        return (bool) $stmt->fetchColumn();
    }

    /** Case-insensitive, because that is how login resolves an identifier. */
    private function usernameTaken(string $username, ?int $exceptUserId = null): bool
    {
        $stmt = Database::connection()->prepare(
            'SELECT 1 FROM users
              WHERE lower(username) = lower(:u) AND (:except::bigint IS NULL OR id <> :except)
              LIMIT 1'
        );
        $stmt->execute([':u' => $username, ':except' => $exceptUserId]);
        return (bool) $stmt->fetchColumn();
    }

    /**
     * A login name derived from a roster name: "Ada Lovelace" -> "ada.lovelace", with a
     * numeric suffix if that is already spoken for. The admin can always overtype it.
     */
    private function usernameFromName(string $name): string
    {
        $base = strtolower(trim((string) preg_replace('/[^a-z0-9]+/i', '.', $name), '.'));
        if ($base === '') {
            $base = 'user';
        }

        $candidate = $base;
        for ($n = 2; $this->usernameTaken($candidate); $n++) {
            $candidate = $base . $n;
        }
        return $candidate;
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
        if (array_key_exists('enroll_link_active', $r)) {
            $r['enroll_link_active'] = (bool) $r['enroll_link_active'];
        }
        $r['staff_id']     = isset($r['staff_id']) && $r['staff_id'] !== null ? (int) $r['staff_id'] : null;
        $r['preset_id']    = isset($r['preset_id']) && $r['preset_id'] !== null ? (int) $r['preset_id'] : null;
        if (array_key_exists('own_permissions', $r)) {
            $r['own_permissions'] = $r['own_permissions'] !== null
                ? json_decode((string) $r['own_permissions'], true)
                : null;
        }
        $r['permissions']  = isset($r['permissions']) && $r['permissions'] !== null
            ? json_decode((string) $r['permissions'], true)
            : null;
        return $r;
    }
}
