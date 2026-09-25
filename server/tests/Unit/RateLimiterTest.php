<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Auth\RateLimiter;
use PHPUnit\Framework\TestCase;

final class RateLimiterTest extends TestCase
{
    use UsesDatabase;

    public function testNullLockIsNotLocked(): void
    {
        $this->assertFalse(RateLimiter::isLocked(null));
    }

    public function testFutureLockIsLocked(): void
    {
        $this->assertTrue(RateLimiter::isLocked(date('c', time() + 60)));
        $this->assertTrue(RateLimiter::isLocked(gmdate('Y-m-d H:i:s', time() + 900) . '+00'));
    }

    public function testPastOrCurrentLockIsNotLocked(): void
    {
        $this->assertFalse(RateLimiter::isLocked(date('c', time() - 1)));
        $this->assertFalse(RateLimiter::isLocked(date('c', time())));
    }

    public function testUnparseableLockIsNotLocked(): void
    {
        $this->assertFalse(RateLimiter::isLocked('not a date'));
    }

    private static function state(int $id): array
    {
        $stmt = self::pdo()->prepare('SELECT failed_attempts, locked_until FROM users WHERE id = :id');
        $stmt->execute([':id' => $id]);
        return $stmt->fetch();
    }

    public function testLocksOnTheFifthConsecutiveFailureForFifteenMinutes(): void
    {
        $this->requireTables('users');
        $id = (int) self::insertUser('ratelim')['id'];

        for ($i = 1; $i <= 4; $i++) {
            RateLimiter::recordFailure($id);
            $s = self::state($id);
            $this->assertSame($i, $s['failed_attempts']);
            $this->assertNull($s['locked_until'], "locked after {$i} failures");
        }

        RateLimiter::recordFailure($id);
        $s = self::state($id);
        $this->assertSame(5, $s['failed_attempts']);
        $this->assertTrue(RateLimiter::isLocked($s['locked_until']));
        $this->assertEqualsWithDelta(time() + 15 * 60, strtotime($s['locked_until']), 10);
    }

    public function testResetClearsCounterAndLock(): void
    {
        $this->requireTables('users');
        $id = (int) self::insertUser('ratelim')['id'];
        for ($i = 0; $i < 6; $i++) {
            RateLimiter::recordFailure($id);
        }

        RateLimiter::reset($id);

        $this->assertSame(['failed_attempts' => 0, 'locked_until' => null], self::state($id));
    }

    public function testOnlyTheGivenUserIsAffected(): void
    {
        $this->requireTables('users');
        $a = (int) self::insertUser('usera')['id'];
        $b = (int) self::insertUser('userb')['id'];

        RateLimiter::recordFailure($a);

        $this->assertSame(1, self::state($a)['failed_attempts']);
        $this->assertSame(0, self::state($b)['failed_attempts']);
    }
}
