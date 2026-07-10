<?php

declare(strict_types=1);

namespace App\Auth;

use App\Http;

/**
 * Request-scoped current-user state, resolved once from the session cookie at the top of
 * the request. `user()` only returns a fully-authenticated user (TOTP complete); endpoints
 * still mid-MFA read `rawUser()` / `isPending()`.
 */
final class Auth
{
    /** @var array{session: array<string,mixed>, user: array<string,mixed>}|null */
    private static ?array $resolved = null;
    private static bool $attempted = false;

    /** Resolve the session from the cookie. Safe to call once per request. */
    public static function attempt(): void
    {
        self::$resolved  = Session::resolve();
        self::$attempted = true;
    }

    /** The fully-authenticated user, or null if none / still mid-MFA. */
    public static function user(): ?array
    {
        if (self::$resolved === null || self::isPending()) {
            return null;
        }
        return self::$resolved['user'];
    }

    /** The user attached to the session even if MFA is still pending (for verify/enroll). */
    public static function rawUser(): ?array
    {
        return self::$resolved['user'] ?? null;
    }

    public static function session(): ?array
    {
        return self::$resolved['session'] ?? null;
    }

    public static function isPending(): bool
    {
        return (bool) (self::$resolved['session']['mfa_pending'] ?? false);
    }

    public static function id(): ?int
    {
        $u = self::user();
        return $u ? (int) $u['id'] : null;
    }

    public static function isAdmin(): bool
    {
        $u = self::user();
        return $u !== null && $u['role'] === 'admin';
    }

    /** Whether the current user may access a given page (admins may access everything). */
    public static function hasPermission(string $page): bool
    {
        $u = self::user();
        if ($u === null) {
            return false;
        }
        if ($u['role'] === 'admin') {
            return true;
        }
        $perms = is_array($u['permissions'] ?? null) ? $u['permissions'] : Pages::DEFAULT_USER;
        return in_array($page, $perms, true);
    }

    /** 401 unless a fully-authenticated user is present. */
    public static function require(): array
    {
        $u = self::user();
        if ($u === null) {
            Http::error('Unauthorized', 401);
        }
        return $u;
    }

    /** 401 if not logged in, 403 if not an admin. */
    public static function requireAdmin(): array
    {
        $u = self::require();
        if ($u['role'] !== 'admin') {
            Http::error('Forbidden — admin only', 403);
        }
        return $u;
    }
}
