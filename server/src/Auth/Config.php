<?php

declare(strict_types=1);

namespace App\Auth;

/**
 * Single source of truth for the master auth toggle. When AUTH_ENABLED is false (the
 * default), the whole auth/roles/audit layer is bypassed and the app behaves exactly as it
 * did before auth existed.
 */
final class Config
{
    public static function enabled(): bool
    {
        return filter_var($_ENV['AUTH_ENABLED'] ?? false, FILTER_VALIDATE_BOOLEAN);
    }
}
