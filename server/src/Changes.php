<?php

declare(strict_types=1);

namespace App;

/**
 * Live updates — the server half.
 *
 * The app is split into a handful of AREAS. Every successful write bumps its area's counter
 * in `data_versions` (flush(), a shutdown hook registered in public/index.php, so it reads
 * the final HTTP status the way Audit::flush() does). GET /changes hands the counters back,
 * and each open page re-reads only the data whose area moved.
 *
 * The client keeps the matching read-side table (client/src/lib/live.ts, READ_AREAS): which
 * areas each GET depends on. Add a segment here when you add a controller, and there too.
 *
 * The check-in bot writes its attendance tables directly, never through this API, so its
 * changes are fingerprinted from the tables themselves (the `bot` key) rather than counted.
 */
final class Changes
{
    /** First path segment → the area a write to it changes. Unlisted segments bump OTHER. */
    private const AREAS = [
        // Money: everything the Daily Sheet, the dashboards and the vendor ledgers add up.
        'records'            => 'calls',
        'buyers'             => 'calls',
        'campaigns'          => 'calls',
        'destinations'       => 'calls',
        'portal-expenses'    => 'calls',
        'vendors'            => 'calls',
        'vendor-payments'    => 'calls',
        // The roster and the Staff page's sheets.
        'staff'              => 'staff',
        'departments'        => 'staff',
        'staff-leaves'       => 'staff',
        'staff-salaries'     => 'staff',
        'staff-salary-holds' => 'staff',
        // Hand-keyed attendance overrides the bot everywhere attendance is shown.
        'staff-attendance'   => 'attendance',
        'queues'             => 'queues',
        'queue-codes'        => 'queues',
        'review-departments' => 'reviews',
        'review-entries'     => 'reviews',
        'top-performer'      => 'reviews',
        'annual-reviews'     => 'reviews',
        'admin'              => 'users',
        'audit-logs'         => 'logs',
    ];

    public const OTHER = 'other';

    /** Writes that change nothing another page shows: signing in and out. */
    private const IGNORED = ['auth', 'changes'];

    private static ?string $pending = null;

    /** The area a write to `$path` changes, or null when it changes nothing shown. */
    public static function areaFor(string $path): ?string
    {
        $segment = explode('/', trim($path, '/'))[0] ?? '';
        if ($segment === '' || in_array($segment, self::IGNORED, true)) {
            return null;
        }
        return self::AREAS[$segment] ?? self::OTHER;
    }

    /** Remember the request, so the shutdown hook knows what to bump. Reads are ignored. */
    public static function begin(string $method, string $path): void
    {
        self::$pending = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)
            ? self::areaFor($path)
            : null;
    }

    /** Shutdown hook: bump the area of a write that succeeded. */
    public static function flush(): void
    {
        $area = self::$pending;
        self::$pending = null;
        if ($area === null) {
            return;
        }
        $status = http_response_code();
        if (!is_int($status) || $status >= 400) {
            return;
        }
        self::bump($area);
    }

    /**
     * Never fails the request it follows: the write itself has already happened, and a
     * missing table (migration 033 not applied yet) only means pages fall back to a timer.
     */
    public static function bump(string $area): void
    {
        try {
            Database::connection()->prepare(
                'INSERT INTO data_versions (area, version, updated_at) VALUES (:area, 1, now())
                 ON CONFLICT (area) DO UPDATE SET version = data_versions.version + 1, updated_at = now()'
            )->execute([':area' => $area]);
        } catch (\Throwable) {
            // See above.
        }
    }

    /**
     * GET /changes.
     *
     * `tracking` is false when the counters can't be read (migration 033 missing); the client
     * then re-reads on a timer instead. `bot` is null when the bot's tables don't exist.
     *
     * @return array{tracking:bool,versions:object,bot:?string}
     */
    public static function snapshot(): array
    {
        $versions = [];
        $tracking = true;
        try {
            foreach (Database::connection()->query('SELECT area, version FROM data_versions') as $row) {
                $versions[$row['area']] = (int) $row['version'];
            }
        } catch (\Throwable) {
            $tracking = false;
        }
        // An object even when empty, so the client never receives a bare [] for a map.
        return ['tracking' => $tracking, 'versions' => (object) $versions, 'bot' => self::botFingerprint()];
    }

    /**
     * A fingerprint of the bot's recent rows. The bot's tables have no updated_at, so the
     * fingerprint adds up the columns it writes: a login, a logout, a break taken or returned
     * from all move at least one of these. Only the last few days are read — that is where
     * the bot writes, and it keeps the query cheap enough to answer every few seconds.
     */
    private static function botFingerprint(): ?string
    {
        try {
            $row = Database::connection()->query(
                "SELECT
                    (SELECT concat_ws(':', count(*),
                                      sum(extract(epoch FROM login_at))::bigint,
                                      sum(extract(epoch FROM logout_at))::bigint)
                       FROM attendance_days WHERE work_date >= CURRENT_DATE - 3) AS days,
                    (SELECT concat_ws(':', count(*), max(id),
                                      sum(extract(epoch FROM returned_at))::bigint,
                                      sum(duration_min))
                       FROM attendance_breaks WHERE work_date >= CURRENT_DATE - 3) AS breaks"
            )->fetch();
            return md5(($row['days'] ?? '') . '|' . ($row['breaks'] ?? ''));
        } catch (\Throwable) {
            return null;
        }
    }
}
