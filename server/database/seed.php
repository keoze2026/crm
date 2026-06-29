<?php

declare(strict_types=1);

/**
 * Seeds the CRM with the data from the source screenshots (dated 2026-06-11)
 * plus ~3 months of generated daily history so trend charts are populated.
 *
 * Rates are definite: each buyer has one rate (revenue = buyers.rate * counted) and
 * each source/destination has one rate (cost = SUM over a campaign's sources of
 * destinations.rate * counted). This reproduces the screenshots exactly:
 * 2026-06-11 revenue $204,911, cost $193,255, profit $11,656.
 *
 * Run:  php database/seed.php
 */

use App\Database;
use Dotenv\Dotenv;

require __DIR__ . '/../vendor/autoload.php';
Dotenv::createImmutable(__DIR__ . '/..')->safeLoad();

$pdo = Database::connection();

echo "Clearing existing data...\n";
$pdo->exec('TRUNCATE call_records, buyers, campaigns RESTART IDENTITY CASCADE');

// --- Real data from the screenshots (2026-06-11) --------------------------------

// Buyer (revenue) rows: code => [answered, missed, counted, rate]
$buyerRows = [
    'RTG 04' => [382, 11, 393, 55.00],
    'RTG 24' => [186, 6, 192, 52.00],
    'RTG 50' => [71, 6, 77, 52.00],
    'RNY'    => [3, 0, 3, 51.00],
    'CDM'    => [228, 14, 228, 50.00],
    'CRM'    => [48, 2, 50, 50.00],
    'L48'    => [492, 49, 492, 50.00],
    'MXX'    => [153, 3, 156, 50.00],
    'RTG 02' => [5, 0, 5, 50.00],
    'RTG 06' => [69, 2, 71, 50.00],
    'RTG 08' => [243, 2, 245, 50.00],
    'RTG 15' => [119, 2, 119, 50.00],
    'RTG 39' => [44, 5, 49, 50.00],
    'RTG 17' => [38, 0, 38, 49.50],
    'ZZY'    => [59, 2, 59, 49.50],
    'A49'    => [274, 1, 274, 49.00],
    'AAT'    => [23, 7, 23, 49.00],
    'BHS'    => [221, 27, 221, 49.00],
    'BOP'    => [221, 6, 221, 49.00],
    'FDD'    => [99, 6, 99, 49.00],
    'HOZ'    => [450, 34, 450, 49.00],
    'JJR'    => [19, 0, 19, 49.00],
    'PIJ'    => [64, 1, 64, 49.00],
    'RTG 10' => [82, 4, 82, 49.00],
    'RTG 12' => [5, 0, 5, 49.00],
    'RTG 16' => [86, 6, 92, 49.00],
    'R48'    => [181, 12, 181, 49.00],
    'KBT'    => [51, 11, 62, 48.00],
    'N4K'    => [13, 1, 13, 48.00],
    'NB48'   => [98, 4, 98, 48.00],
    'SHN'    => [10, 1, 10, 48.00],
];

// Campaign (cost) rows: [camp, source, answered, missed, counted]. The rate is a
// definite property of the *campaign* (see $campaignRates below), not the source —
// so every source under a campaign bills at the same rate.
$campaignRows = [
    ['C-05', 'XXD', 1464, 37, 1464],
    ['C-02', '05', 162, 11, 162],
    ['C-03', 'PDSO', 30, 1, 30],
    ['C-03', 'Priority Y', 2235, 52, 2235],
    ['C-03', 'AdsTerra', 1, 0, 1],
    ['C-03', 'BBB', 23, 2, 23],
    ['C-03', 'RGR', 20, 0, 20],
    ['C-11', 'DXTST', 98, 0, 98],
];

// Definite per-source (destination) rates ($ per counted call). On the cost side the
// rate belongs to the source/destination, so each source bills at its own rate and
// campaign C-03's sources keep 48 / 48 / 47 / 46 / 46 (cost = SUM over sources).
$sourceRates = [
    'XXD'        => 50.00,
    '05'         => 49.00,
    'PDSO'       => 48.00,
    'Priority Y' => 48.00,
    'AdsTerra'   => 47.00,
    'BBB'        => 46.00,
    'RGR'        => 46.00,
    'DXTST'      => 14.00,
];

// --- Insert master data (buyers & campaigns) ------------------------------------

echo "Inserting buyers...\n";
$buyerIds = [];
$insBuyer = $pdo->prepare('INSERT INTO buyers (code, rate) VALUES (:code, :rate) RETURNING id');
foreach ($buyerRows as $code => [, , , $rate]) {
    $insBuyer->execute([':code' => $code, ':rate' => $rate]);
    $buyerIds[$code] = (int) $insBuyer->fetchColumn();
}

echo "Inserting campaigns...\n";
$campaignIds = [];
$insCampaign = $pdo->prepare('INSERT INTO campaigns (code) VALUES (:code) RETURNING id');
foreach (array_unique(array_column($campaignRows, 0)) as $code) {
    $insCampaign->execute([':code' => $code]);
    $campaignIds[$code] = (int) $insCampaign->fetchColumn();
}

echo "Inserting destinations (sources) with their rates...\n";
// Map each source to the campaign it belongs to (source => campaign code).
$sourceCampaign = [];
foreach ($campaignRows as [$camp, $src]) {
    $sourceCampaign[$src] = $camp;
}
// destinations is kept out of the TRUNCATE above, so upsert to set/refresh rates + link.
$insDest = $pdo->prepare(
    'INSERT INTO destinations (name, rate, campaign_id) VALUES (:name, :rate, :cid)
     ON CONFLICT (name) DO UPDATE SET rate = EXCLUDED.rate, campaign_id = EXCLUDED.campaign_id'
);
foreach ($sourceRates as $name => $rate) {
    $camp = $sourceCampaign[$name] ?? null;
    $insDest->execute([
        ':name' => $name,
        ':rate' => $rate,
        ':cid'  => $camp !== null ? $campaignIds[$camp] : null,
    ]);
}

// --- Insert call records --------------------------------------------------------

$insRecord = $pdo->prepare(
    'INSERT INTO call_records
        (record_date, record_type, buyer_id, campaign_id, source, answered, missed, counted, rate)
     VALUES
        (:d, :t, :bid, :cid, :src, :a, :m, :c, :r)'
);

$realDate = '2026-06-11';

echo "Inserting real data for {$realDate}...\n";
foreach ($buyerRows as $code => [$a, $m, $c, $r]) {
    $insRecord->execute([
        ':d' => $realDate, ':t' => 'buyer', ':bid' => $buyerIds[$code], ':cid' => null,
        ':src' => null, ':a' => $a, ':m' => $m, ':c' => $c, ':r' => $r,
    ]);
}
foreach ($campaignRows as [$camp, $src, $a, $m, $c]) {
    $insRecord->execute([
        ':d' => $realDate, ':t' => 'campaign', ':bid' => null, ':cid' => $campaignIds[$camp],
        ':src' => $src, ':a' => $a, ':m' => $m, ':c' => $c, ':r' => $sourceRates[$src],
    ]);
}

// --- Generate ~3 months of daily history (everything except the real day) -------

echo "Generating sample history...\n";

/** Deterministic-ish jitter helper. */
function vary(float $base, float $spread): float
{
    $factor = 1 + (mt_rand(-1000, 1000) / 1000) * $spread;
    return max(0, $base * $factor);
}

$start = new DateTimeImmutable('2026-03-15');
$end   = new DateTimeImmutable('2026-06-13');
$pdo->beginTransaction();
$rowCount = 0;

for ($day = $start; $day <= $end; $day = $day->modify('+1 day')) {
    $date = $day->format('Y-m-d');
    if ($date === $realDate) {
        continue; // keep the exact real figures for this date
    }

    $dow = (int) $day->format('N');           // 1 (Mon) .. 7 (Sun)
    $weekend = ($dow >= 6) ? 0.55 : 1.0;       // lower volume on weekends
    // Gentle growth over the period (0.8 -> 1.15).
    $progress = ($day->getTimestamp() - $start->getTimestamp())
        / max(1, $end->getTimestamp() - $start->getTimestamp());
    $trend = 0.8 + 0.35 * $progress;

    foreach ($buyerRows as $code => [$a, $m, $c, $r]) {
        if (mt_rand(0, 100) < 18) {
            continue; // buyer inactive that day
        }
        $counted  = (int) round(vary($c, 0.45) * $weekend * $trend);
        $answered = (int) round($counted * (mt_rand(90, 100) / 100));
        $missed   = (int) round(vary($m, 0.6) * $weekend);
        $rate     = $r; // definite buyer rate (no jitter) -> revenue = rate * counted
        if ($counted === 0 && $answered === 0) {
            continue;
        }
        $insRecord->execute([
            ':d' => $date, ':t' => 'buyer', ':bid' => $buyerIds[$code], ':cid' => null,
            ':src' => null, ':a' => $answered, ':m' => $missed, ':c' => $counted, ':r' => $rate,
        ]);
        $rowCount++;
    }

    foreach ($campaignRows as [$camp, $src, $a, $m, $c]) {
        if (mt_rand(0, 100) < 15) {
            continue;
        }
        $counted  = (int) round(vary($c, 0.5) * $weekend * $trend);
        $answered = (int) round($counted * (mt_rand(92, 100) / 100));
        $missed   = (int) round(vary($m, 0.7) * $weekend);
        $rate     = $sourceRates[$src]; // definite per-source rate (no jitter) -> cost = rate * counted
        if ($counted === 0 && $answered === 0) {
            continue;
        }
        $insRecord->execute([
            ':d' => $date, ':t' => 'campaign', ':bid' => null, ':cid' => $campaignIds[$camp],
            ':src' => $src, ':a' => $answered, ':m' => $missed, ':c' => $counted, ':r' => $rate,
        ]);
        $rowCount++;
    }
}

$pdo->commit();

$total = (int) $pdo->query('SELECT count(*) FROM call_records')->fetchColumn();
echo "Done. Inserted {$rowCount} generated rows. Total call_records: {$total}.\n";
