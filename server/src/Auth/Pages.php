<?php

declare(strict_types=1);

namespace App\Auth;

/**
 * Catalogue of access-controlled pages. A non-admin user's `permissions` column is a subset
 * of ALL; admins implicitly have every page. When a user's permissions are NULL (never
 * customised) the app falls back to DEFAULT_USER.
 *
 * Both lists mirror `PAGES` / `DEFAULT_USER_PAGES` in client/src/auth/pages.ts and must be
 * kept in step with them. sanitize() drops anything missing from ALL, so a key the client
 * offers but this list omits is silently discarded on save — the tick-box appears to work
 * and the permission never persists.
 */
final class Pages
{
    /** Every gateable page key. */
    public const ALL = ['dashboard', 'buyers', 'campaigns', 'vendors', 'portal-expenses', 'queues', 'reviews', 'staff', 'attendance', 'complete-report', 'users', 'logs'];

    /** Default pages a freshly created non-admin user can see (admin pages excluded). */
    public const DEFAULT_USER = ['dashboard', 'buyers', 'campaigns', 'vendors', 'portal-expenses', 'queues', 'reviews', 'staff', 'attendance', 'complete-report'];

    /** Keep only recognised page keys, in canonical order. */
    public static function sanitize(array $keys): array
    {
        return array_values(array_intersect(self::ALL, $keys));
    }
}
