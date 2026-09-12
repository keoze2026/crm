<?php

declare(strict_types=1);

/**
 * Make enrolment links that were already handed out work again.
 *
 * The app only keeps the sha256 of a link's token, so a link stops working when it expires
 * or when a newer link replaces it — but the link itself is still perfectly good if the hash
 * is put back. This reads the links you sent (one person per line: a name and the link, in
 * any layout — "Name<TAB>https://…/enroll?token=…" from a Word table saved as plain text is
 * fine) and, for each one:
 *
 *   EXTEND   the token is still that person's current link, only expired  -> new expiry
 *   RESTORE  the token was replaced by a newer link; the name on the line   -> put it back
 *            matches exactly one pending account
 *   SKIP     account already set up, deactivated, name matches nobody or several people,
 *            or the same token / person appears twice in the file
 *
 * Restoring a person's old link cancels whatever newer link they may hold. Accounts that have
 * finished setup are never touched.
 *
 *   php database/restore_enroll_links.php links.txt              # dry run: report only
 *   php database/restore_enroll_links.php links.txt --apply      # write the changes
 *   php database/restore_enroll_links.php links.txt --apply --hours=48
 *
 * Tokens are never printed — only the last 6 characters, to tell lines apart.
 */

require __DIR__ . '/../vendor/autoload.php';

use App\Database;
use Dotenv\Dotenv;

Dotenv::createImmutable(__DIR__ . '/..')->safeLoad();

$args  = array_slice($argv, 1);
$apply = in_array('--apply', $args, true);
$hours = 24;
$file  = null;
foreach ($args as $arg) {
    if (preg_match('/^--hours=(\d+)$/', $arg, $m)) {
        $hours = max(1, min(168, (int) $m[1]));
    } elseif ($arg[0] !== '-') {
        $file = $arg;
    }
}
if ($file === null || !is_readable($file)) {
    fwrite(STDERR, "Usage: php database/restore_enroll_links.php <links.txt> [--apply] [--hours=24]\n");
    exit(1);
}

/** Lowercase, punctuation and runs of space folded to one space — how names are compared. */
$fold = static fn (?string $s): string =>
    trim((string) preg_replace('/[^a-z0-9]+/', ' ', strtolower((string) $s)));

// ─── Read the file ────────────────────────────────────────────────────────────
$entries = [];
foreach (preg_split('/\R/', (string) file_get_contents($file)) as $n => $line) {
    if (!preg_match('/token=([0-9a-fA-F]{64})(?![0-9a-fA-F])/', $line, $m)) {
        continue; // headings, blank lines, anything without a link
    }
    $token = strtolower($m[1]);
    // The name is whatever is left once the URL is taken out.
    $name = trim((string) preg_replace('~\S*enroll\?token=[0-9a-fA-F]{64}\S*~', ' ', $line), " \t-–—:|,;");
    $entries[] = ['line' => $n + 1, 'token' => $token, 'name' => $name, 'hash' => hash('sha256', $token)];
}
if ($entries === []) {
    fwrite(STDERR, "No enrolment links found in {$file}. Each link must contain enroll?token=<64 hex characters>.\n");
    exit(1);
}

// ─── Plan ─────────────────────────────────────────────────────────────────────
$db    = Database::connection();
$users = $db->query(
    'SELECT id, email, name, username, is_active,
            totp_confirmed_at IS NOT NULL AS set_up,
            enroll_token_hash,
            enroll_expires_at > now() AS link_valid
       FROM users'
)->fetchAll();

$byHash = [];
foreach ($users as $u) {
    if ($u['enroll_token_hash'] !== null) {
        $byHash[$u['enroll_token_hash']] = $u;
    }
}

$tokenSeen = array_count_values(array_column($entries, 'token'));
$plan      = [];
$claimed   = []; // user id => line, so one person can't be given two links

foreach ($entries as $e) {
    $tail  = '…' . substr($e['token'], -6);
    $label = $e['name'] !== '' ? $e['name'] : '(no name on line)';
    $row   = ['line' => $e['line'], 'label' => $label, 'tail' => $tail, 'action' => 'SKIP', 'why' => '', 'user' => null, 'hash' => $e['hash']];

    if ($tokenSeen[$e['token']] > 1) {
        $row['why'] = 'the same link appears more than once in the file';
        $plan[] = $row;
        continue;
    }

    $user = $byHash[$e['hash']] ?? null;
    if ($user !== null) {
        $row['action'] = 'EXTEND';
        $row['why']    = $user['link_valid'] ? 'still their current link (already valid — expiry reset)' : 'their current link, expired';
    } else {
        $wanted  = $fold($e['name']);
        $matches = $wanted === '' ? [] : array_values(array_filter($users, static fn ($u) =>
            in_array($wanted, [$fold($u['name']), $fold($u['username']), $fold($u['email'])], true)
        ));
        if ($wanted === '') {
            $row['why'] = 'link was replaced and the line has no name to match it to';
            $plan[] = $row;
            continue;
        }
        if (count($matches) === 0) {
            $row['why'] = 'link was replaced and no account has this name';
            $plan[] = $row;
            continue;
        }
        if (count($matches) > 1) {
            $row['why'] = 'link was replaced and ' . count($matches) . ' accounts share this name';
            $plan[] = $row;
            continue;
        }
        $user          = $matches[0];
        $row['action'] = 'RESTORE';
        $row['why']    = 'a newer link had replaced it';
    }

    $row['user'] = $user;
    if ($user['set_up']) {
        [$row['action'], $row['why']] = ['SKIP', 'already set up their authenticator'];
    } elseif (!$user['is_active']) {
        [$row['action'], $row['why']] = ['SKIP', 'account is deactivated'];
    } elseif (isset($claimed[$user['id']])) {
        [$row['action'], $row['why']] = ['SKIP', "same person as line {$claimed[$user['id']]}"];
    } else {
        $claimed[$user['id']] = $e['line'];
    }
    $plan[] = $row;
}

// ─── Report ───────────────────────────────────────────────────────────────────
$counts = ['EXTEND' => 0, 'RESTORE' => 0, 'SKIP' => 0];
foreach ($plan as $p) {
    $counts[$p['action']]++;
    $who = $p['user'] ? ' -> ' . ($p['user']['name'] ?? $p['user']['username'] ?? $p['user']['email']) . " (#{$p['user']['id']})" : '';
    printf("line %-4d %-8s %-28s %s%s — %s\n", $p['line'], $p['action'], mb_strimwidth($p['label'], 0, 28, '…'), $p['tail'], $who, $p['why']);
}
printf("\n%d link(s) read: %d extend, %d restore, %d skip. New expiry: %d hours from now.\n",
    count($plan), $counts['EXTEND'], $counts['RESTORE'], $counts['SKIP'], $hours);

if (!$apply) {
    echo "Dry run — nothing changed. Re-run with --apply to write.\n";
    exit(0);
}

// ─── Apply ────────────────────────────────────────────────────────────────────
// The WHERE repeats the safety checks, so an account that finished setup or was deactivated
// since the report above is still left alone.
$update = $db->prepare(
    "UPDATE users
        SET enroll_token_hash = :hash,
            enroll_expires_at = now() + make_interval(hours => :hours),
            totp_secret = NULL, failed_attempts = 0, locked_until = NULL, updated_at = now()
      WHERE id = :id AND totp_confirmed_at IS NULL AND is_active"
);

$written = 0;
$db->beginTransaction();
foreach ($plan as $p) {
    if ($p['action'] === 'SKIP') {
        continue;
    }
    $update->execute([':hash' => $p['hash'], ':hours' => $hours, ':id' => $p['user']['id']]);
    $written += $update->rowCount();
}
$db->commit();

printf("Done: %d link(s) now work for %d hours.\n", $written, $hours);
