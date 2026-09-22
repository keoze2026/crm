<?php

declare(strict_types=1);

namespace App\Auth;

use App\Http;

/**
 * Pre-dispatch authorization gate. Runs at the single router choke point in public/index.php
 * (only when AUTH_ENABLED is on). Allowlists the auth/enrol/health endpoints; every other
 * route requires a fully-authenticated session; the surfaces listed in GATED_SEGMENTS
 * additionally require the page permission behind them (admins pass everything). This is the
 * authoritative check — the frontend guards are UX only.
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

    /**
     * First path segment → the page permissions that grant access to it. Holding ANY one of
     * them is enough, because several endpoints are shared between pages:
     *
     *  - /staff is the single roster the Queues, Review and Staff pages all pick names from,
     *    and the Review sheet's name picker creates and deletes people through it.
     *  - /departments is the catalogue behind the Staff bands.
     *
     * Matched on the whole first segment rather than as a string prefix, so /staff and
     * /staff-attendance can carry different rules without depending on declaration order —
     * a plain str_starts_with('/staff') would swallow all three staff sheets.
     *
     * @var array<string, array<int, string>>
     */
    private const GATED_SEGMENTS = [
        'audit-logs'         => ['logs'],
        'admin'              => ['users'],
        'queues'             => ['queues'],
        'queue-codes'        => ['queues'],
        'review-departments' => ['reviews'],
        'review-entries'     => ['reviews'],
        'top-performer'      => ['reviews'],
        'annual-reviews'     => ['reviews'],
        'staff'              => ['staff', 'queues', 'reviews', 'attendance'],
        'departments'        => ['staff'],
        // The attendance sheet moved to the Attendance page, so that page's own permission
        // grants it — otherwise a supervisor who may see attendance couldn't correct a day.
        'staff-attendance'   => ['staff', 'attendance'],
        'staff-leaves'       => ['staff'],
        'staff-salaries'     => ['staff'],
        'staff-salary-holds' => ['staff'],
    ];

    public static function guard(string $method, string $path): void
    {
        foreach (self::PUBLIC_ROUTES as [$m, $p]) {
            if ($method === $m && $path === $p) {
                return; // allowlisted
            }
        }

        // Everything else needs a completed (non-pending) login.
        Auth::require();

        $segment = explode('/', trim($path, '/'))[0] ?? '';
        $pages   = self::GATED_SEGMENTS[$segment] ?? null;
        if ($pages === null) {
            return; // not a page-gated surface
        }

        foreach ($pages as $page) {
            if (Auth::hasPermission($page)) {
                return;
            }
        }
        Http::error('Forbidden', 403);
    }
}
