<?php

declare(strict_types=1);

namespace App\Auth;

use App\Http;

/**
 * Pre-dispatch authorization gate. Runs at the single router choke point in public/index.php
 * (only when AUTH_ENABLED is on). Allowlists the auth/enrol/health endpoints; every other
 * route requires a fully-authenticated session; audit + admin routes additionally require the
 * admin role. This is the authoritative check — the frontend guards are UX only.
 */
final class AuthMiddleware
{
    /**
     * Routes reachable without a completed login. The MFA/enrol endpoints authenticate
     * themselves (pending session or one-time enrol token) inside their controllers.
     *
     * @var array<int, array{0:string,1:string}>  [method, path]
     */
    private const PUBLIC_ROUTES = [
        ['POST', '/auth/login'],
        ['POST', '/auth/verify-totp'],
        ['POST', '/auth/enroll/start'],
        ['POST', '/auth/enroll/confirm'],
        ['POST', '/auth/logout'],
        ['GET',  '/auth/status'],
        ['GET',  '/health'],
    ];

    /** Path prefixes that require the admin role OR the mapped page permission. */
    private const GATED_PREFIXES = ['/audit-logs' => 'logs', '/admin/' => 'users'];

    public static function guard(string $method, string $path): void
    {
        foreach (self::PUBLIC_ROUTES as [$m, $p]) {
            if ($method === $m && $path === $p) {
                return; // allowlisted
            }
        }

        // Everything else needs a completed (non-pending) login.
        Auth::require();

        foreach (self::GATED_PREFIXES as $prefix => $page) {
            if (str_starts_with($path, $prefix)) {
                if (!Auth::hasPermission($page)) {
                    Http::error('Forbidden', 403);
                }
                return;
            }
        }
    }
}
