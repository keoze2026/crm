<?php

declare(strict_types=1);

/**
 * Rolling data-retention job for the CallFlow CRM.
 *
 * Keeps the database to a moving window of the most recent N days (default 40):
 *   1. Deletes call_records whose record_date is older than the cutoff.
 *   2. Deletes buyers/campaigns created before the cutoff that have no records
 *      left (so stale, inactive entities are cleaned up once their last record
 *      ages out — but anything created recently or still referenced is kept).
 *
 * The `users` table is never touched.
 *
 * Run daily from cron (see MAINTENANCE.md):
 *   php /var/www/crm_dash/crm/server/database/cleanup.php
 *
 * Optional: override the retention window in days:
 *   php database/cleanup.php 40
 */

use App\Database;
use Dotenv\Dotenv;

require __DIR__ . '/../vendor/autoload.php';

Dotenv::createImmutable(__DIR__ . '/..')->safeLoad();

$days   = max(1, (int) ($argv[1] ?? 40));
$cutoff = (new DateTimeImmutable("today -{$days} days"))->format('Y-m-d');

$pdo = Database::connection();
$pdo->beginTransaction();

try {
    $records = $pdo->prepare('DELETE FROM call_records WHERE record_date < :cutoff');
    $records->execute([':cutoff' => $cutoff]);

    $buyers = $pdo->prepare(
        'DELETE FROM buyers b
          WHERE b.created_at < :cutoff
            AND NOT EXISTS (SELECT 1 FROM call_records r WHERE r.buyer_id = b.id)'
    );
    $buyers->execute([':cutoff' => $cutoff]);

    $campaigns = $pdo->prepare(
        'DELETE FROM campaigns c
          WHERE c.created_at < :cutoff
            AND NOT EXISTS (SELECT 1 FROM call_records r WHERE r.campaign_id = c.id)'
    );
    $campaigns->execute([':cutoff' => $cutoff]);

    $pdo->commit();

    printf(
        "[%s] retention=%dd cutoff=%s  removed records=%d buyers=%d campaigns=%d\n",
        date('c'),
        $days,
        $cutoff,
        $records->rowCount(),
        $buyers->rowCount(),
        $campaigns->rowCount()
    );
} catch (\Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, '[cleanup] failed: ' . $e->getMessage() . "\n");
    exit(1);
}
