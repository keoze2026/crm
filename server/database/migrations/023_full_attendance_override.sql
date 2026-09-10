-- 023_full_attendance_override.sql
-- The Staff page's Complete Attendance sheet becomes fully editable, including on the days
-- the check-in bot recorded.
--
-- Until now a `staff_attendance` row sitting on a bot-recorded day was a BREAK-ONLY
-- override: its `break_min` was used and its clock times were ignored, because the times
-- were the bot's to set. From here that row is a COMPLETE override — login, logout, break
-- and status all come from it, and deleting it still restores the bot's day untouched.
-- The bot's own tables are still never written to.
--
-- One rule, one sentence: an override row, when present, replaces the bot's day entirely.
--
-- That rule would misread the break-only rows written by the older code, whose `login_at`
-- and `logout_at` are NULL because nothing could set them — under the new rule those days
-- would suddenly read as having no clock times at all. So every override that coincides
-- with a bot day is filled in from that day before the new code sees it.
--
-- Guarded on there being anything to fill, and only ever reads the bot's tables, so it is
-- safe to run on a database that has none.
--
-- Safe to run multiple times.

DO $$
DECLARE
    filled integer := 0;
BEGIN
    IF to_regclass('public.attendance_days') IS NULL THEN
        RAISE NOTICE 'No attendance_days table here — nothing to back-fill.';
        RETURN;
    END IF;

    -- Times are stored as the org-local clock times the sheet keys in, which is what
    -- `AT TIME ZONE` gives us from the bot's timestamptz.
    UPDATE staff_attendance o
       SET login_at   = COALESCE(o.login_at,  (d.login_at  AT TIME ZONE 'America/New_York')::time),
           logout_at  = COALESCE(o.logout_at, (d.logout_at AT TIME ZONE 'America/New_York')::time),
           status     = CASE
                            WHEN btrim(o.status) <> '' THEN o.status
                            WHEN d.login_at IS NULL     THEN 'absent'
                            WHEN d.logout_at IS NULL    THEN 'still in'
                            ELSE 'present'
                        END,
           break_min  = COALESCE(o.break_min, b.break_min, 0),
           updated_at = now()
      FROM staff s
      JOIN attendance_days d ON d.user_id::text = s.attendance_user_id
 LEFT JOIN (
           SELECT user_id, work_date, SUM(duration_min)::int AS break_min
             FROM attendance_breaks GROUP BY user_id, work_date
      ) b ON b.user_id = d.user_id AND b.work_date = d.work_date
     WHERE s.id = o.staff_id
       AND d.work_date = o.work_date
       -- Only rows that are still incomplete; a re-run finds none.
       AND (o.login_at IS NULL OR o.logout_at IS NULL OR btrim(o.status) = '' OR o.break_min IS NULL);

    GET DIAGNOSTICS filled = ROW_COUNT;
    RAISE NOTICE 'Completed % break-only override row(s) from the bot''s day.', filled;
END $$;
