<?php

declare(strict_types=1);

/**
 * LOCAL DEVELOPMENT ONLY — plausible sample data for the Staff, Queues and Review pages.
 *
 * A fresh local database has a roster of two or three and a single review, which is enough
 * to test a query and useless for looking at: the sheets these pages draw only read
 * properly with a roster on them. This fills in a team of twelve across the real department
 * bands, gives them queue coverage on both boards, a month of reviews, and a few leaves and
 * salaries — the state the screenshots in the user manual are taken from.
 *
 *   php database/seed_staff_dev.php           # add the sample rows (idempotent)
 *   php database/seed_staff_dev.php --drop    # remove exactly what it added
 *
 * It refuses to run against a production database, and it only ever touches rows whose
 * names are in its own list, so it can never disturb real data if it is pointed somewhere
 * unexpected. Run seed_attendance_dev.php alongside it for the attendance side.
 */

require __DIR__ . '/../vendor/autoload.php';

use App\Database;
use Dotenv\Dotenv;

Dotenv::createImmutable(__DIR__ . '/..')->safeLoad();

if (($_ENV['APP_ENV'] ?? 'production') !== 'development') {
    fwrite(STDERR, "Refusing to run: APP_ENV is not 'development'.\n");
    exit(1);
}

$db   = Database::connection();
$drop = \in_array('--drop', $argv, true);

/** The sample team. Names are obviously fictional so nobody mistakes them for the roster. */
const TEAM = [
    ['Amara Oduya',      'Forwarding',   'active',   '09:00', '18:00'],
    ['Benicio Sarto',    'Forwarding',   'active',   '09:00', '18:00'],
    ['Corin Whitlock',   'Forwarding',   'active',   '08:30', '17:30'],
    ['Dalia Fenn',       'Camps & Flow', 'active',   '09:00', '18:00'],
    ['Emeka Nwosu',      'Camps & Flow', 'active',   '10:00', '19:00'],
    ['Farrah Idris',     'Camps & Flow', 'leave',    '09:00', '18:00'],
    ['Goran Milic',      'Audits',       'active',   '08:00', '17:00'],
    ['Hana Petrova',     'Audits',       'active',   '09:00', '18:00'],
    ['Ivo Bergström',    'Agents',       'active',   '09:00', '18:00'],
    ['Juno Castellanos', 'Agents',       'active',   '09:30', '18:30'],
    ['Kwame Boateng',    'Agents',       'inactive', null,    null],
    ['Lior Ashkenazi',   'Agents',       'active',   null,    null],
];

/** Queue codes per board, so both Queues tabs have something to show. */
const QUEUES = [
    'forwarding' => [
        'Amara Oduya'    => ['FWD-101', 'FWD-102', 'FWD-118'],
        'Benicio Sarto'  => ['FWD-103', 'FWD-104'],
        'Corin Whitlock' => ['FWD-105', 'FWD-106', 'FWD-107', 'FWD-119'],
        'Hana Petrova'   => ['FWD-108'],
    ],
    'camp_flow' => [
        'Dalia Fenn'  => ['CMP-21', 'CMP-22'],
        'Emeka Nwosu' => ['CMP-23', 'CMP-24', 'CMP-25'],
        'Farrah Idris' => ['CMP-26'],
        'Amara Oduya' => ['CMP-27'],
    ],
];

/**
 * Ratings are stored as the exact wording the page's dropdown offers — anything else renders
 * as an unselected "Select". These two lists must match PERFORMANCE_RATINGS and
 * BEHAVIOUR_RATINGS in client/src/lib/review.ts.
 */
const RATINGS = ['Excellent', 'Good', 'Average', 'Below Average', 'Poor'];
const BEHAVIOUR = [
    'Consistent Performance', 'Good Standing', 'Meets Expectations',
    'On Track', 'Satisfactory', 'Low Performer',
];
const NOTES   = [
    'Consistently clears the queue before close.',
    'Handled the campaign spike without escalation.',
    '',
    'Two late logins this month; spoken to.',
    '',
];

$names = array_column(TEAM, 0);
$list  = implode(',', array_map(static fn ($n) => $db->quote($n), $names));

if ($drop) {
    // staff cascades their departments, queue rows, leaves and salaries; reviews are
    // deleted explicitly because review_entries.staff_id is ON DELETE SET NULL.
    $db->exec("DELETE FROM review_entries WHERE staff_id IN (SELECT id FROM staff WHERE name IN ({$list}))");
    $db->exec("DELETE FROM review_entries WHERE person_name IN ({$list})");
    $n = $db->exec("DELETE FROM staff WHERE name IN ({$list})");
    $db->exec("DELETE FROM queue_codes WHERE code LIKE 'FWD-1%' OR code LIKE 'CMP-2%'");
    echo "Removed {$n} sample staff and their rows.\n";
    exit(0);
}

$db->beginTransaction();

// ─── Departments ───────────────────────────────────────────────────────────────
$depIds = [];
$dep = $db->prepare(
    'INSERT INTO departments (name, sort_order)
     VALUES (:name, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM departments))
     ON CONFLICT DO NOTHING'
);
$find = $db->prepare('SELECT id FROM departments WHERE lower(btrim(name)) = lower(btrim(:name))');
foreach (array_unique(array_column(TEAM, 1)) as $name) {
    $dep->execute([':name' => $name]);
    $find->execute([':name' => $name]);
    $depIds[$name] = (int) $find->fetchColumn();
}

// ─── Staff ─────────────────────────────────────────────────────────────────────
$staffIds = [];
$ins = $db->prepare(
    'INSERT INTO staff (name, status, expected_login, expected_logout)
     VALUES (:name, :status, :login, :logout)
     ON CONFLICT (lower(btrim(name))) DO UPDATE SET
        status = EXCLUDED.status,
        expected_login = EXCLUDED.expected_login,
        expected_logout = EXCLUDED.expected_logout,
        updated_at = now()
     RETURNING id'
);
$link = $db->prepare('INSERT INTO staff_departments (staff_id, department_id) VALUES (:s, :d) ON CONFLICT DO NOTHING');
foreach (TEAM as [$name, $department, $status, $login, $logout]) {
    $ins->execute([':name' => $name, ':status' => $status, ':login' => $login, ':logout' => $logout]);
    $id = (int) $ins->fetchColumn();
    $staffIds[$name] = $id;
    $link->execute([':s' => $id, ':d' => $depIds[$department]]);
}
// One person in two departments — the many-to-many is the whole reason that table exists.
$link->execute([':s' => $staffIds['Amara Oduya'], ':d' => $depIds['Camps & Flow']]);

// ─── Queues, on both boards ────────────────────────────────────────────────────
$code = $db->prepare('INSERT INTO queue_codes (code) VALUES (:code) ON CONFLICT DO NOTHING');
$codeId = $db->prepare('SELECT id FROM queue_codes WHERE lower(btrim(code)) = lower(btrim(:code))');
$assign = $db->prepare(
    'INSERT INTO queue_assignments (person_id, board) VALUES (:p, :b)
     ON CONFLICT (board, person_id) DO UPDATE SET person_id = EXCLUDED.person_id RETURNING id'
);
$attach = $db->prepare(
    'INSERT INTO queue_assignment_codes (assignment_id, code_id, sort_order)
     VALUES (:a, :c, :o) ON CONFLICT DO NOTHING'
);
foreach (QUEUES as $board => $people) {
    foreach ($people as $person => $codes) {
        $assign->execute([':p' => $staffIds[$person], ':b' => $board]);
        $assignmentId = (int) $assign->fetchColumn();
        foreach (array_values($codes) as $i => $c) {
            $code->execute([':code' => $c]);
            $codeId->execute([':code' => $c]);
            $attach->execute([':a' => $assignmentId, ':c' => (int) $codeId->fetchColumn(), ':o' => $i]);
        }
    }
}

// ─── Reviews for last month (a review judges the month before it is written) ───
$month  = (new DateTimeImmutable('first day of last month'))->format('Y-m-01');
$review = $db->prepare(
    'INSERT INTO review_entries (staff_id, person_name, department_id, kind, month, rating, percentage, notes)
     VALUES (:s, :name, :d, :kind, :month, :rating, :pct, :notes)'
);
$db->prepare('DELETE FROM review_entries WHERE month = :m AND person_name IN (' . $list . ')')
   ->execute([':m' => $month]);
foreach (array_values(TEAM) as $i => [$name, $department]) {
    foreach (['performance', 'behaviour'] as $kind) {
        $offset = $kind === 'performance' ? $i : $i + 2;
        $words  = $kind === 'performance' ? RATINGS : BEHAVIOUR;
        $review->execute([
            ':s'      => $staffIds[$name],
            ':name'   => $name,
            ':d'      => $depIds[$department],
            ':kind'   => $kind,
            ':month'  => $month,
            ':rating' => $words[$offset % \count($words)],
            // Behaviour carries no percentage on the sheet, only a rating.
            ':pct'    => $kind === 'performance' ? 95 - ($offset % 5) * 7 : null,
            ':notes'  => $kind === 'performance' ? NOTES[$i % \count(NOTES)] : '',
        ]);
    }
}

// ─── A few leaves and salaries for the same month ──────────────────────────────
$leave = $db->prepare(
    'INSERT INTO staff_leaves (staff_id, department_id, leave_date, sick_leave, break_leave, half_day, late_login, aob, sort_order)
     VALUES (:s, :d, :date, :sick, :break, :half, :late, :aob, :o)'
);
$db->prepare('DELETE FROM staff_leaves WHERE staff_id IN (SELECT id FROM staff WHERE name IN (' . $list . '))')->execute();
$leaves = [
    ['Farrah Idris',   '+2 days', 'Approved', '',         '',          '',          'Family leave'],
    ['Emeka Nwosu',    '+5 days', '',         '',         'Approved',  '',          ''],
    ['Juno Castellanos', '+8 days', '',       '',         '',          'Not Approved', '12 minutes'],
];
foreach ($leaves as $o => [$name, $when, $sick, $brk, $half, $late, $aob]) {
    $leave->execute([
        ':s' => $staffIds[$name], ':d' => $depIds[array_column(TEAM, 1, 0)[$name]],
        ':date' => (new DateTimeImmutable($month))->modify($when)->format('Y-m-d'),
        ':sick' => $sick, ':break' => $brk, ':half' => $half, ':late' => $late, ':aob' => $aob, ':o' => $o,
    ]);
}

$salary = $db->prepare(
    'INSERT INTO staff_salaries (staff_id, department_id, month, status, amount, note, sort_order)
     VALUES (:s, :d, :month, :status, :amount, :note, :o)
     ON CONFLICT (staff_id, month) DO UPDATE SET
        status = EXCLUDED.status, amount = EXCLUDED.amount, updated_at = now()'
);
$statuses = ['Received', 'Received', 'Received', 'Pending', 'Received', 'On Hold'];
foreach (array_values(TEAM) as $i => [$name, $department, $status]) {
    if ($status === 'inactive') {
        continue;
    }
    $salary->execute([
        ':s' => $staffIds[$name], ':d' => $depIds[$department], ':month' => $month,
        ':status' => $statuses[$i % \count($statuses)],
        ':amount' => 900 + ($i % 6) * 125,
        ':note'   => '', ':o' => $i,
    ]);
}

$db->commit();

printf(
    "Seeded %d staff across %d departments, queues on both boards, and %s reviews/leaves/salaries.\n",
    \count(TEAM),
    \count($depIds),
    (new DateTimeImmutable($month))->format('F Y')
);
echo "Run with --drop to remove them again.\n";
