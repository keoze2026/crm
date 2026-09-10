-- 027_staff_expected_hours.sql
--
-- The hours a staff member is expected to keep, so "late" and "early" stop being one
-- number for the whole company. Both attendance pages read these and mark a login after
-- expected_login and a logout before expected_logout.
--
-- Both are NULLABLE and both start NULL, and that is the point: NULL means "no schedule
-- set for this person", and nothing about their days is flagged. Nobody is marked late
-- against an expectation that was never agreed with them — the marks appear as the
-- schedules are filled in on the Staff page.
--
-- The one exception is the Attendance page's "late arrivals" report, which has always
-- used a flat 9:00 AM. It now reads COALESCE(expected_login, 09:00), so it keeps working
-- exactly as before for anyone without a schedule and gets sharper for everyone with one.
--
-- Idempotent: safe to run twice.

DO $$
BEGIN
    IF to_regclass('public.staff') IS NULL THEN
        RAISE EXCEPTION 'staff table not found — apply 019_staff_management.sql first';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'staff'
           AND column_name = 'expected_login'
    ) THEN
        ALTER TABLE staff ADD COLUMN expected_login time;
        RAISE NOTICE 'staff.expected_login added';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'staff'
           AND column_name = 'expected_logout'
    ) THEN
        ALTER TABLE staff ADD COLUMN expected_logout time;
        RAISE NOTICE 'staff.expected_logout added';
    END IF;
END $$;

COMMENT ON COLUMN staff.expected_login IS
    'Org-local clock time this person is expected to log in by; NULL = no schedule, nothing flagged.';
COMMENT ON COLUMN staff.expected_logout IS
    'Org-local clock time this person is expected to work until; NULL = no schedule, nothing flagged.';
