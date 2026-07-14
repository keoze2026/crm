<?php

declare(strict_types=1);

/**
 * One-off data fix: normalize existing campaign codes to the "C-03" house format
 * (see App\CampaignCode) and merge campaigns whose codes collapse to the same
 * canonical value — e.g. "C 03", "c-03" and "C03" all fold into one "C-03".
 *
 * ONLY campaign codes change. call_records.source (the traffic source) is never
 * touched, and every record is re-pointed 1:1 onto the surviving campaign — so no
 * traffic sources are merged or mixed; each source keeps its own separate rows.
 *
 * Transactional and idempotent (a second run is a no-op). Dry-run by default:
 *   php database/normalize_campaign_codes.php            # preview only, no writes
 *   php database/normalize_campaign_codes.php --apply    # commit the changes
 *
 * BACK UP FIRST — see the pg_dump command in the deployment notes.
 */

use App\CampaignCode;
use App\Database;
use Dotenv\Dotenv;

require __DIR__ . '/../vendor/autoload.php';
Dotenv::createImmutable(__DIR__ . '/..')->safeLoad();

$apply = in_array('--apply', $argv, true);
$pdo   = Database::connection();

$campaigns = $pdo->query("
    SELECT c.id, c.code,
           (SELECT COUNT(*) FROM call_records r WHERE r.campaign_id = c.id) AS records,
           (SELECT COUNT(*) FROM destinations  d WHERE d.campaign_id = c.id) AS dests
    FROM campaigns c
    ORDER BY c.id
")->fetchAll(PDO::FETCH_ASSOC);

// Group campaigns by their canonical code.
$groups = [];
foreach ($campaigns as $c) {
    $groups[CampaignCode::standardize($c['code'])][] = $c;
}

$actions = [];
$stats = ['records' => 0, 'dests' => 0, 'merged' => 0, 'renamed' => 0];

if ($apply) {
    $pdo->beginTransaction();
}

try {
    foreach ($groups as $canon => $members) {
        // Prefer a member already at the canonical code as the survivor; otherwise
        // keep the lowest id (rows are ordered by id).
        $keeper = null;
        foreach ($members as $m) {
            if ($m['code'] === $canon) {
                $keeper = $m;
                break;
            }
        }
        $keeper ??= $members[0];
        $dupes  = array_values(array_filter($members, fn ($m) => $m['id'] !== $keeper['id']));
        $rename = $keeper['code'] !== $canon;

        if (!$dupes && !$rename) {
            continue; // already canonical
        }

        $dupeIds = array_map(fn ($d) => (int) $d['id'], $dupes);
        foreach ($dupes as $d) {
            $stats['records'] += (int) $d['records'];
            $stats['dests']   += (int) $d['dests'];
        }
        $stats['merged']  += count($dupes);
        $stats['renamed'] += $rename ? 1 : 0;

        // Human-readable description of what this group will do.
        $desc = [];
        if ($dupes) {
            $desc[] = sprintf('keep #%d "%s"', $keeper['id'], $keeper['code']);
            foreach ($dupes as $d) {
                $desc[] = sprintf('merge #%d "%s" (%d rec, %d dest)', $d['id'], $d['code'], $d['records'], $d['dests']);
            }
        }
        if ($rename) {
            $desc[] = sprintf('rename "%s"→"%s"', $keeper['code'], $canon);
        }
        $actions[] = sprintf('  %-10s <= %s', $canon, implode('; ', $desc));

        if (!$apply) {
            continue;
        }

        if ($dupeIds) {
            $ph = implode(',', array_fill(0, count($dupeIds), '?'));
            // Move records (the source column is left exactly as-is) and destinations
            // onto the survivor, then drop the now-empty duplicate campaigns.
            $pdo->prepare("UPDATE call_records SET campaign_id = ? WHERE campaign_id IN ($ph)")
                ->execute([$keeper['id'], ...$dupeIds]);
            $pdo->prepare("UPDATE destinations SET campaign_id = ? WHERE campaign_id IN ($ph)")
                ->execute([$keeper['id'], ...$dupeIds]);
            $pdo->prepare("DELETE FROM campaigns WHERE id IN ($ph)")->execute($dupeIds);
        }
        if ($rename) {
            $pdo->prepare('UPDATE campaigns SET code = ? WHERE id = ?')->execute([$canon, $keeper['id']]);
        }
    }

    if ($apply) {
        $pdo->commit();
    }
} catch (\Throwable $e) {
    if ($apply && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, "FAILED (rolled back): {$e->getMessage()}\n");
    exit(1);
}

// Report.
echo ($apply ? "APPLIED" : "DRY RUN (no changes written)") . "\n";
echo count($campaigns) . " campaigns scanned; " . count($groups) . " distinct after normalization.\n";
if (!$actions) {
    echo "Everything is already canonical — nothing to do.\n";
    exit(0);
}
echo "\nActions:\n" . implode("\n", $actions) . "\n";
echo sprintf(
    "\n%s: %d campaign(s) merged away, %d code(s) reformatted, %d record(s) re-pointed, %d destination(s) re-pointed.\n",
    $apply ? 'Done' : 'Would change',
    $stats['merged'],
    $stats['renamed'],
    $stats['records'],
    $stats['dests']
);
echo "Traffic sources (call_records.source) were left untouched.\n";
if (!$apply) {
    echo "\nRe-run with --apply to commit.\n";
}
