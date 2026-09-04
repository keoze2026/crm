<?php

declare(strict_types=1);

namespace App\Auth;

/**
 * Catalogue of access-controlled pages. A non-admin user's `permissions` column is a subset
 * of ALL; admins implicitly have every page. When a user's permissions are NULL (never
 * customised) the app falls back to DEFAULT_USER.
 */
final class Pages
{
    /** Every gateable page key. */
    public const ALL = ['dashboard', 'buyers', 'campaigns', 'vendors', 'portal-expenses', 'queues', 'reviews', 'attendance', 'complete-report', 'users', 'logs'];

    /** Default pages a freshly created non-admin user can see (admin pages excluded). */
    public const DEFAULT_USER = ['dashboard', 'buyers', 'campaigns', 'vendors', 'portal-expenses', 'queues', 'reviews', 'attendance', 'complete-report'];

    /** Keep only recognised page keys, in canonical order. */
    public static function sanitize(array $keys): array
    {
        return array_values(array_intersect(self::ALL, $keys));
    }
}
