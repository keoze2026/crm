<?php

declare(strict_types=1);

namespace App\Auth;

use App\Database;

/**
 * Server-side opaque-token sessions.
 *
 * The raw token lives only in the httpOnly `crm_session` cookie; the database stores only its
 * SHA-256 hash. A session begins with mfa_pending=true (identifier accepted, TOTP not yet
 * verified) and is upgraded — with a rotated token — once the code checks out.
 */
final class Session
{
    public const COOKIE = 'crm_session';

    /** Full session lifetime once the TOTP step is complete. */
    private const TTL_SECONDS = 12 * 60 * 60;

    /** Short window to finish the MFA/enrolment step after the identifier is accepted. */
    private const PENDING_TTL_SECONDS = 10 * 60;

    /**
     * Create a new session row for a user, set the cookie, and return the raw token.
     * Callers never persist the raw token — it goes to the browser only.
     */
    public static function create(int $userId, bool $mfaPending): string
    {
        $token = bin2hex(random_bytes(32));
        $ttl   = $mfaPending ? self::PENDING_TTL_SECONDS : self::TTL_SECONDS;

        $stmt = Database::connection()->prepare(
            'INSERT INTO sessions (user_id, token_hash, mfa_pending, expires_at, ip, user_agent)
             VALUES (:uid, :hash, :pending, now() + (:ttl || \' seconds\')::interval, :ip, :ua)'
        );
        $stmt->execute([
            ':uid'     => $userId,
            ':hash'    => self::hash($token),
            ':pending' => $mfaPending ? 't' : 'f',
            ':ttl'     => $ttl,
            ':ip'      => self::ip(),
            ':ua'      => $_SERVER['HTTP_USER_AGENT'] ?? null,
        ]);

        self::setCookie($token, $ttl);

        return $token;
    }

    /**
     * Resolve the current request's session + user from the cookie.
     *
     * @return array{session: array<string,mixed>, user: array<string,mixed>}|null
     */
    public static function resolve(): ?array
    {
        $token = $_COOKIE[self::COOKIE] ?? '';
        if ($token === '') {
            return null;
        }

        $stmt = Database::connection()->prepare(
            'SELECT s.id AS session_id, s.mfa_pending, s.expires_at,
                    u.id, u.email, u.name, u.role, u.username, u.is_active, u.permissions,
                    (u.totp_confirmed_at IS NOT NULL) AS totp_enabled
             FROM sessions s
             JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = :hash AND s.expires_at > now()'
        );
        $stmt->execute([':hash' => self::hash($token)]);
        $row = $stmt->fetch();

        if (!$row || !$row['is_active']) {
            return null;
        }

        // Touch last-seen (best effort; ignore races).
        $touch = Database::connection()->prepare('UPDATE sessions SET last_seen_at = now() WHERE id = :id');
        $touch->execute([':id' => $row['session_id']]);

        return [
            'session' => [
                'id'          => (int) $row['session_id'],
                'mfa_pending' => (bool) $row['mfa_pending'],
            ],
            'user' => [
                'id'           => (int) $row['id'],
                'email'        => $row['email'],
                'name'         => $row['name'],
                'role'         => $row['role'],
                'username'     => $row['username'],
                'totp_enabled' => (bool) $row['totp_enabled'],
                'permissions'  => $row['permissions'] !== null ? json_decode((string) $row['permissions'], true) : null,
            ],
        ];
    }

    /**
     * Rotate the current session's token (new value + refreshed expiry) and optionally
     * clear the mfa_pending flag. Called on privilege transition (after TOTP / enrolment).
     */
    public static function upgradeCurrent(): void
    {
        $old = $_COOKIE[self::COOKIE] ?? '';
        if ($old === '') {
            return;
        }
        $new = bin2hex(random_bytes(32));

        $stmt = Database::connection()->prepare(
            'UPDATE sessions
                SET token_hash = :new, mfa_pending = false,
                    expires_at = now() + (:ttl || \' seconds\')::interval
              WHERE token_hash = :old'
        );
        $stmt->execute([
            ':new' => self::hash($new),
            ':old' => self::hash($old),
            ':ttl' => self::TTL_SECONDS,
        ]);

        self::setCookie($new, self::TTL_SECONDS);
    }

    /** Delete the current session row and clear the cookie. */
    public static function destroyCurrent(): void
    {
        $token = $_COOKIE[self::COOKIE] ?? '';
        if ($token !== '') {
            $stmt = Database::connection()->prepare('DELETE FROM sessions WHERE token_hash = :hash');
            $stmt->execute([':hash' => self::hash($token)]);
        }
        self::clearCookie();
    }

    /** Remove all sessions for a user (e.g. on deactivate / reset-totp). */
    public static function destroyForUser(int $userId): void
    {
        $stmt = Database::connection()->prepare('DELETE FROM sessions WHERE user_id = :uid');
        $stmt->execute([':uid' => $userId]);
    }

    private static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    private static function setCookie(string $token, int $ttl): void
    {
        setcookie(self::COOKIE, $token, [
            'expires'  => time() + $ttl,
            'path'     => '/',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure'   => self::secure(),
        ]);
    }

    private static function clearCookie(): void
    {
        setcookie(self::COOKIE, '', [
            'expires'  => time() - 3600,
            'path'     => '/',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure'   => self::secure(),
        ]);
    }

    private static function secure(): bool
    {
        return ($_ENV['APP_ENV'] ?? 'production') !== 'development';
    }

    private static function ip(): ?string
    {
        return $_SERVER['REMOTE_ADDR'] ?? null;
    }
}
