<?php

declare(strict_types=1);

/**
 * Seeds the Vendors page with demo ledgers — ~3 months of weekday entries for five
 * traffic sources, plus the opening advance each one starts from.
 *
 * The data is shaped to exercise every state the page can show:
 *   • DXTST       — opens $1,200 in Advance and overpays slightly  -> Advance, growing
 *   • XXD         — opens $450 in Due and underpays                -> Due (red), deepening
 *   • RGR         — opens flat and settles each day exactly        -> Settled, hovering at 0
 *   • AdsTerra    — pays nothing for days, then clears the balance -> includes 0-call
 *                                                                     settlement rows, so
 *                                                                     "days worked" (which
 *                                                                     only counts days with
 *                                                                     converted calls) is
 *                                                                     visibly < rows shown
 *   • Zeeko Media — a MANUAL vendor (not a campaign source), so the "+"-tab path is covered
 *
 * Because it spans three months, switching the date range demonstrates the carry-forward:
 * each period's Initial Advance is the previous period's closing balance.
 *
 * Deterministic (fixed mt_srand seed) and idempotent — re-running replaces exactly the
 * vendors below and touches nothing else (no call_records, buyers or campaigns).
 *
 * Run:  php database/seed_vendors.php
 */

use App\Database;
use Dotenv\Dotenv;

require __DIR__ . '/../vendor/autoload.php';
Dotenv::createImmutable(__DIR__ . '/..')->safeLoad();

$pdo = Database::connection();
mt_srand(20260721);

/**
 * style: how the vendor settles each day's bill.
 *   ahead  = pays a little over        behind = pays a little under
 *   exact  = pays the day's bill       lump   = pays nothing, then clears the lot
 */
$vendors = [
    ['name' => 'DXTST',       'price' => 5.00, 'calls' => [30, 70],  'style' => 'ahead',  'opening' => 1200.00],
    ['name' => 'XXD',         'price' => 4.50, 'calls' => [40, 90],  'style' => 'behind', 'opening' => -450.00],
    ['name' => 'RGR',         'price' => 6.00, 'calls' => [10, 35],  'style' => 'exact',  'opening' => 0.00],
    ['name' => 'AdsTerra',    'price' => 3.75, 'calls' => [50, 120], 'style' => 'lump',   'opening' => 250.00],
    ['name' => 'Zeeko Media', 'price' => 5.50, 'calls' => [15, 40],  'style' => 'ahead',  'opening' => 0.00, 'manual' => true],
];

// Three months back to today, so the default "1st of this month -> today" range always
// has entries and at least two earlier periods to carry a balance forward from.
$end   = new DateTimeImmutable('today');
$start = $end->modify('first day of -2 months');

$insert = $pdo->prepare(
    'INSERT INTO vendor_payments (vendor, entry_date, converted_calls, price, amount_paid)
     VALUES (:vendor, :date, :calls, :price, :paid)'
);
$meta = $pdo->prepare(
    'INSERT INTO vendors (name, is_manual, opening_advance)
     VALUES (:name, :manual, :opening)
     ON CONFLICT (lower(btrim(name))) DO UPDATE SET
        is_manual       = vendors.is_manual OR EXCLUDED.is_manual,
        opening_advance = EXCLUDED.opening_advance,
        updated_at      = now()'
);

echo "Seeding vendor ledgers {$start->format('Y-m-d')} -> {$end->format('Y-m-d')}\n\n";
printf("%-14s %6s %6s %12s %12s %12s  %s\n",
    'VENDOR', 'ROWS', 'DAYS', 'PAYMENTS', 'PAID', 'BALANCE', 'READS AS');
echo str_repeat('-', 82) . "\n";

foreach ($vendors as $v) {
    // Idempotent: clear only this vendor's rows before re-seeding.
    $wipe = $pdo->prepare('DELETE FROM vendor_payments WHERE lower(btrim(vendor)) = lower(btrim(:name))');
    $wipe->execute([':name' => $v['name']]);

    // PDO::PARAM_BOOL, not the array form — with emulated prepares off, a plain PHP
    // false binds as '' and Postgres rejects it as a boolean.
    $meta->bindValue(':name', $v['name']);
    $meta->bindValue(':manual', !empty($v['manual']), PDO::PARAM_BOOL);
    $meta->bindValue(':opening', $v['opening']);
    $meta->execute();

    $rows = 0;
    $daysWorked = 0;
    $totalPayments = 0.0;
    $totalPaid = 0.0;
    $outstanding = 0.0;   // for the "lump" style: what has piled up unpaid
    $sinceSettled = 0;

    for ($d = $start; $d <= $end; $d = $d->modify('+1 day')) {
        $dow = (int) $d->format('N');            // 1 = Mon .. 7 = Sun
        if ($dow >= 6) {
            continue;                            // weekends off
        }
        if (mt_rand(1, 100) <= 12) {
            continue;                            // the odd quiet day with no delivery
        }

        $calls = mt_rand($v['calls'][0], $v['calls'][1]);
        $bill  = round($calls * $v['price'], 2);

        $paid = match ($v['style']) {
            'ahead'  => round($bill * mt_rand(100, 108) / 100, 2),
            'behind' => round($bill * mt_rand(92, 99) / 100, 2),
            'exact'  => $bill,
            'lump'   => 0.0,
        };

        if ($v['style'] === 'lump') {
            $outstanding += $bill;
            if (++$sinceSettled >= 9) {          // settle roughly every other week
                $paid = round($outstanding, 2);
                $outstanding = 0.0;
                $sinceSettled = 0;
            }
        }

        $insert->execute([
            ':vendor' => $v['name'],
            ':date'   => $d->format('Y-m-d'),
            ':calls'  => $calls,
            ':price'  => $v['price'],
            ':paid'   => $paid,
        ]);
        $rows++;
        $daysWorked++;
        $totalPayments += $bill;
        $totalPaid += $paid;

        // A lump payer also drops the occasional pure settlement row — no calls, just
        // money moving. These must NOT count toward "days worked".
        if ($v['style'] === 'lump' && $sinceSettled === 4 && $outstanding > 0) {
            $chunk = round($outstanding / 2, 2);
            $insert->execute([
                ':vendor' => $v['name'],
                ':date'   => $d->modify('+1 day')->format('Y-m-d'),
                ':calls'  => 0,
                ':price'  => $v['price'],
                ':paid'   => $chunk,
            ]);
            $outstanding -= $chunk;
            $totalPaid += $chunk;
            $rows++;
        }
    }

    $balance = $v['opening'] + $totalPaid - $totalPayments;
    $reads   = abs($balance) < 0.005 ? 'Settled' : ($balance > 0 ? 'Advance' : 'Due');
    printf("%-14s %6d %6d %12s %12s %12s  %s\n",
        $v['name'], $rows, $daysWorked,
        number_format($totalPayments, 2), number_format($totalPaid, 2),
        number_format($balance, 2), $reads);
}

// Show the carry-forward in action: what each month's view opens with.
echo "\nCarried-forward Initial Advance, by month (each = the prior month's closing balance):\n";
$months = [];
for ($m = $start; $m <= $end; $m = $m->modify('+1 month')) {
    $months[] = $m->format('Y-m-01');
}
$carry = $pdo->prepare(
    'SELECT COALESCE(SUM(p.amount_paid - p.converted_calls * p.price), 0) + v.opening_advance
       FROM vendors v
       LEFT JOIN vendor_payments p
              ON lower(btrim(p.vendor)) = lower(btrim(v.name)) AND p.entry_date < :from
      WHERE lower(btrim(v.name)) = lower(btrim(:name))
      GROUP BY v.opening_advance'
);
printf("%-14s %s\n", 'VENDOR', implode('  ', array_map(fn ($m) => str_pad(substr($m, 0, 7), 12), $months)));
foreach ($vendors as $v) {
    $cells = [];
    foreach ($months as $m) {
        $carry->execute([':name' => $v['name'], ':from' => $m]);
        $cells[] = str_pad(number_format((float) $carry->fetchColumn(), 2), 12);
    }
    printf("%-14s %s\n", $v['name'], implode('  ', $cells));
}

echo "\nDone. Open the Vendors page and switch the date range between months.\n";
