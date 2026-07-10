<?php

declare(strict_types=1);

namespace App\Auth;

use App\Database;

/**
 * Per-account login/TOTP throttle, backed by users.failed_attempts / users.locked_until.
 * After MAX_ATTEMPTS consecutive failures the account is locked for LOCK_MINUTES.
 */
final class RateLimiter
{
    private const MAX_ATTEMPTS = 5;
    private const LOCK_MINUTES  = 15;

    /** True if the account is currently locked out. */
    public static function isLocked(?string $lockedUntilIso): bool
    {
        if ($lockedUntilIso === null) {
            return false;
        }
        return strtotime($lockedUntilIso) > time();
    }

    /** Record a failed attempt; lock the account once the threshold is reached. */
    public static function recordFailure(int $userId): void
    {
        $stmt = Database::connection()->prepare(
            'UPDATE users
                SET failed_attempts = failed_attempts + 1,
                    locked_until = CASE
                        WHEN failed_attempts + 1 >= :max
                        THEN now() + (:lock || \' minutes\')::interval
                        ELSE locked_until
                    END,
                    updated_at = now()
              WHERE id = :id'
        );
        $stmt->execute([
            ':max'  => self::MAX_ATTEMPTS,
            ':lock' => self::LOCK_MINUTES,
            ':id'   => $userId,
        ]);
    }

    /** Clear the failure counter after a successful login. */
    public static function reset(int $userId): void
    {
        $stmt = Database::connection()->prepare(
            'UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = :id'
        );
        $stmt->execute([':id' => $userId]);
    }
}
