-- 030_leave_return_dates.sql
--
-- When a leave is expected to end and when the person actually came back, so the Leaves
-- sheet can flag someone who returned LATE (actual after expected), came back early, or
-- is still out past the date they were due.
--
-- Both are NULLABLE and both start NULL: a row on the sheet is often a single day
-- ("Half Day", "Late Login") with nothing to return from. The verdict is only computed
-- when BOTH dates are set — expected alone with no actual return means "not back yet",
-- which is flagged only once that expected date has passed.
--
-- Idempotent: safe to run twice.

DO $$
BEGIN
    IF to_regclass('public.staff_leaves') IS NULL THEN
        RAISE EXCEPTION 'staff_leaves table not found — apply 019_staff_management.sql first';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'staff_leaves'
           AND column_name = 'expected_return'
    ) THEN
        ALTER TABLE staff_leaves ADD COLUMN expected_return date;
        RAISE NOTICE 'staff_leaves.expected_return added';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'staff_leaves'
           AND column_name = 'actual_return'
    ) THEN
        ALTER TABLE staff_leaves ADD COLUMN actual_return date;
        RAISE NOTICE 'staff_leaves.actual_return added';
    END IF;
END $$;

COMMENT ON COLUMN staff_leaves.expected_return IS
    'The day the person was due back from this leave; NULL = not a leave with a return date.';
COMMENT ON COLUMN staff_leaves.actual_return IS
    'The day the person actually came back; NULL = not recorded (or not back yet).';
