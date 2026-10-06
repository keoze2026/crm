<?php

declare(strict_types=1);

namespace App;

/**
 * Which days a staff member was ON LEAVE, read off the Leaves sheet — the one rule every
 * attendance figure uses to stop a leave reading as a missed or late login.
 *
 * A Leaves row is a leave when its SICK LEAVES or BREAK LEAVES cell holds anything but
 * "Not Approved" (or nothing). Half Day and Late Login rows are not: the person still
 * works that day and is still judged on it, and those markers are counted against them
 * separately.
 *
 * The leave runs from its DATE up to the day before the person came back:
 *
 *   - ACTUAL RETURN when it has been recorded — back early ends the leave early, and an
 *     overstay is already judged once, as a late return on the Leaves sheet;
 *   - otherwise EXPECTED RETURN — a return nobody has recorded never stretches a leave
 *     past the day it was due, or a forgotten cell would excuse every late login after it;
 *   - otherwise the DATE alone.
 *
 * A day whose attendance status is set to "leave" by hand is a leave day too; the
 * controllers add that half, since it lives on the attendance row rather than here.
 */
final class Leaves
{
    /** The row `$l` is a leave at all: a sick or break leave that wasn't refused. */
    private static function counts(string $l): string
    {
        $blank = "'^\\s*(not\\s*approved)?\\s*$'";
        return "({$l}.sick_leave !~* {$blank} OR {$l}.break_leave !~* {$blank})";
    }

    /** The first day the person is back at work — the leave's end, exclusive. */
    private static function end(string $l): string
    {
        return "GREATEST(COALESCE({$l}.actual_return, {$l}.expected_return, {$l}.leave_date + 1), {$l}.leave_date + 1)";
    }

    /** SQL: true when staff member `$staff` was on leave on `$date` (both SQL expressions). */
    public static function covers(string $staff, string $date): string
    {
        return "EXISTS (SELECT 1 FROM staff_leaves lv
                         WHERE lv.staff_id = {$staff}
                           AND lv.leave_date <= {$date}
                           AND {$date} < " . self::end('lv') . "
                           AND " . self::counts('lv') . ')';
    }

    /**
     * Every day in [$from, $to] somebody was on leave, one row per person per day — for the
     * pages that list people with NO attendance row at all, who would otherwise read as
     * absent. `user_id` is the same identity the attendance rows carry: the bot account
     * where there is one, the "staff-12" stand-in where there isn't.
     *
     * @return list<array{staff_id:int,user_id:string,work_date:string}>
     */
    public static function days(string $from, string $to): array
    {
        $stmt = Database::connection()->prepare(
            "SELECT DISTINCT lv.staff_id,
                    COALESCE(NULLIF(btrim(s.attendance_user_id), ''), 'staff-' || s.id::text) AS user_id,
                    g.day::date::text AS work_date
               FROM staff_leaves lv
               JOIN staff s ON s.id = lv.staff_id
              CROSS JOIN LATERAL generate_series(
                        GREATEST(lv.leave_date, CAST(:from AS date))::timestamp,
                        LEAST(" . self::end('lv') . " - 1, CAST(:to AS date))::timestamp,
                        INTERVAL '1 day') AS g(day)
              WHERE " . self::counts('lv') . "
              ORDER BY work_date, lv.staff_id"
        );
        $stmt->execute([':from' => $from, ':to' => $to]);
        return array_map(static fn (array $r): array => [
            'staff_id'  => (int) $r['staff_id'],
            'user_id'   => (string) $r['user_id'],
            'work_date' => $r['work_date'],
        ], $stmt->fetchAll());
    }
}
