<?php

declare(strict_types=1);

/**
 * LOCAL DEVELOPMENT ONLY — stand-ins for the check-in bot's tables.
 *
 * `attendance_staff`, `attendance_days` and `attendance_breaks` are written by the external
 * check-in bot and exist only on the VPS. This app never creates them in a migration and
 * only ever READS them, which is why a local database has none and every /api/attendance
 * route answers `relation "attendance_days" does not exist`.
 *
 * This script creates them locally and fills a fortnight of plausible days, so the
 * Attendance page and the Staff page's Complete Attendance tab can actually be worked on
 * without a copy of production. It refuses to run against a production database.
 *
 *   php database/seed_attendance_dev.php          # create + seed
 *   php database/seed_attendance_dev.php --drop   # remove the stand-ins again
 *
 * Days are generated around today in the org timezone, weekends skipped, with a couple of
 * deliberate oddities to exercise the page: one missing logout, and one person over the
 * 60-minute break allowance so the over-break exception and the break correction have
 * something to act on.
 */

require __DIR__ . '/../vendor/autoload.php';

use App\Database;
use Dotenv\Dotenv;

Dotenv::createImmutable(__DIR__ . '/..')->safeLoad();

if (($_ENV['APP_ENV'] ?? 'production') !== 'development') {
    fwrite(STDERR, "Refusing to run: APP_ENV is not 'development'.\n");
    fwrite(STDERR, "These tables belong to the check-in bot and must never be created on the VPS.\n");
    exit(1);
}

$db   = Database::connection();
$drop = \in_array('--drop', $argv, true);

if ($drop) {
    $db->exec('DROP TABLE IF EXISTS attendance_breaks, attendance_days, attendance_staff');
    // Leave no staff row pointing at an account that no longer exists.
    $db->exec('UPDATE staff SET attendance_user_id = NULL WHERE attendance_user_id IS NOT NULL');
    echo "Removed the local attendance stand-ins and unlinked the roster.\n";
    exit(0);
}

$db->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS attendance_staff (
    user_id    BIGINT PRIMARY KEY,
    username   TEXT,
    staff_name TEXT,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS attendance_days (
    user_id       BIGINT NOT NULL,
    staff_name    TEXT,
    username      TEXT,
    work_date     DATE   NOT NULL,
    login_at      TIMESTAMPTZ,
    login_stated  TEXT,
    logout_at     TIMESTAMPTZ,
    logout_stated TEXT
);
CREATE TABLE IF NOT EXISTS attendance_breaks (
    user_id      BIGINT NOT NULL,
    work_date    DATE   NOT NULL,
    taken_at     TIMESTAMPTZ,
    duration_min INTEGER NOT NULL DEFAULT 0,
    urgent       BOOLEAN NOT NULL DEFAULT false,
    raw          TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_days_dev ON attendance_days (user_id, work_date);
SQL);

// Give bot accounts to the first few people already on the roster, so the names line up
// with the rest of the app instead of inventing a second set.
$roster = $db->query('SELECT id, name FROM staff ORDER BY lower(btrim(name)) LIMIT 4')->fetchAll();
if ($roster === []) {
    fwrite(STDERR, "No staff on the roster yet — add a few on /staff first.\n");
    exit(1);
}

$db->exec('TRUNCATE attendance_breaks, attendance_days, attendance_staff');

$account = $db->prepare(
    'INSERT INTO attendance_staff (user_id, username, staff_name) VALUES (:id, :username, :name)'
);
// The link the app normally resolves from the name on create/rename. Setting it here means
// these people's days arrive FETCHED (read-only clock times, correctable break), which is
// the half of the Complete Attendance sheet that needs a bot to exercise at all.
$link = $db->prepare('UPDATE staff SET attendance_user_id = :account WHERE id = :id');
$day = $db->prepare(
    'INSERT INTO attendance_days (user_id, staff_name, username, work_date, login_at, logout_at)
     VALUES (:id, :name, :username, :date, :login, :logout)'
);
$break = $db->prepare(
    'INSERT INTO attendance_breaks (user_id, work_date, taken_at, duration_min, urgent, raw)
     VALUES (:id, :date, :taken, :mins, false, :raw)'
);

$tz    = new DateTimeZone('America/New_York');
$today = new DateTimeImmutable('now', $tz);
$days  = 0;

foreach ($roster as $i => $person) {
    $userId = 900 + $i;                       // a range no real account will collide with
    $account->execute([
        ':id'       => $userId,
        ':username' => strtolower(preg_replace('/[^a-z0-9]+/i', '', $person['name']) ?: "user{$userId}"),
        ':name'     => $person['name'],
    ]);
    $link->execute([':account' => (string) $userId, ':id' => $person['id']]);

    for ($back = 13; $back >= 0; $back--) {
        $date = $today->sub(new DateInterval("P{$back}D"));
        if ((int) $date->format('N') >= 6) {
            continue;                          // weekends off
        }

        $login = $date->setTime(9, ($i * 7) % 40);           // staggered starts
        // One person is still checked in today — the roster's "still in" state.
        $stillIn = $back === 0 && $i === 0;
        $logout  = $stillIn ? null : $login->add(new DateInterval('PT8H30M'));

        $day->execute([
            ':id'       => $userId,
            ':name'     => $person['name'],
            ':username' => null,
            ':date'     => $date->format('Y-m-d'),
            ':login'    => $login->format(DateTimeInterface::ATOM),
            ':logout'   => $logout?->format(DateTimeInterface::ATOM),
        ]);
        $days++;

        // Two breaks a day; one person runs over the 60-minute allowance so the
        // over-break exception and the Staff page's break correction have a subject.
        $over  = $i === 1;
        $mins  = $over ? [45, 45] : [30, 15];
        $taken = $login->add(new DateInterval('PT3H'));
        foreach ($mins as $n => $duration) {
            $break->execute([
                ':id'    => $userId,
                ':date'  => $date->format('Y-m-d'),
                ':taken' => $taken->add(new DateInterval('PT' . ($n * 3) . 'H'))->format(DateTimeInterface::ATOM),
                ':mins'  => $duration,
                ':raw'   => $n === 0 ? 'lunch' : 'tea',
            ]);
        }
    }
}

printf(
    "Seeded %d accounts and %d days (with breaks) into the local attendance stand-ins.\n",
    \count($roster),
    $days
);
echo "Re-run any time to reset; `--drop` removes the tables again.\n";
