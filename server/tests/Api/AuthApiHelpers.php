<?php

declare(strict_types=1);

namespace Tests\Api;

use OTPHP\InternalClock;
use OTPHP\TOTP;

/**
 * Shared helpers for the auth / admin / audit API tests. Used by ApiTestCase subclasses only.
 */
trait AuthApiHelpers
{
    /** A 6-digit code outside the verifier's ±1 step window for this secret. */
    protected static function wrongCode(string $secret): string
    {
        $totp  = TOTP::createFromSecret($secret, new InternalClock());
        $now   = time();
        $valid = [];
        for ($step = -2; $step <= 2; $step++) {
            $valid[] = $totp->at($now + $step * 30);
        }
        for ($i = 0; $i < 1000; $i++) {
            $candidate = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            if (!\in_array($candidate, $valid, true)) {
                return $candidate;
            }
        }
        throw new \RuntimeException('Could not pick a wrong TOTP code');
    }

    /** Create an enrolled admin and log in as them. */
    protected function loginAsNewAdmin(string $username = 'boss'): array
    {
        $admin = self::createEnrolledUser($username, 'admin');
        $this->loginAs($admin);
        return $admin;
    }

    /** A fresh DB read of one user row. */
    protected static function userRow(int $id): ?array
    {
        $stmt = self::db()->prepare('SELECT * FROM users WHERE id = :id');
        $stmt->execute([':id' => $id]);
        return $stmt->fetch() ?: null;
    }

    /** @return array<int, array<string,mixed>> audit rows, oldest first */
    protected static function auditRows(?string $action = null): array
    {
        if ($action === null) {
            return self::db()->query('SELECT * FROM audit_log ORDER BY id')->fetchAll();
        }
        $stmt = self::db()->prepare('SELECT * FROM audit_log WHERE action = :a ORDER BY id');
        $stmt->execute([':a' => $action]);
        return $stmt->fetchAll();
    }

    protected static function countRows(string $sql, array $params = []): int
    {
        $stmt = self::db()->prepare($sql);
        $stmt->execute($params);
        return (int) $stmt->fetchColumn();
    }

    /** Insert a user who has been created but has not finished enrolment; returns row + raw token. */
    protected static function createPendingUser(string $username, ?string $expires = '+1 day', bool $active = true): array
    {
        $token = bin2hex(random_bytes(16));
        $row = self::insert('users', [
            'email'             => "{$username}@example.test",
            'name'              => ucfirst($username),
            'username'          => $username,
            'role'              => 'member',
            'is_active'         => $active,
            'enroll_token_hash' => hash('sha256', $token),
            'enroll_expires_at' => $expires === null ? null : date('c', strtotime($expires)),
        ]);
        $row['token'] = $token;
        return $row;
    }
}
