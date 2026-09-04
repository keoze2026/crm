-- 019_staff_management.sql
-- The Staff Management page (/staff) and the restructure that makes ONE staff list serve
-- the Queues, Review and Staff pages instead of three separate ones.
--
-- WHAT MOVES (nothing is dropped before it has been copied):
--   queue_people       -> staff             renamed, so queue_assignments.person_id and
--                                           every name already keyed in survive untouched
--   review_departments -> departments       renamed, so review_entries.department_id keeps
--                                           pointing at the same rows
--   departments.performance / .percentage
--                      -> department_reviews  the Department tab is now month-wise like the
--                                           other two, so its score belongs to a month
--
-- WHAT IS NEW:
--   staff_departments   a staff member may belong to more than one department
--   staff_attendance    attendance keyed in BY HAND for someone the bot never saw. Rows
--                       fetched into attendance_days are NOT copied here — the page shows
--                       those read-only, so a fetched day can never be edited
--   staff_leaves        the leaves sheet (date / name / department / sick / break / half
--                       day / late login / AOB)
--   staff_salaries      the salary sheet: one row per person per month ("Received")
--
-- MONTH SEMANTICS: a review written in September is about August, so every review row now
-- carries the month it is ABOUT. Performance rows had no month at all; they are backfilled
-- to the month before the row was written, which is what they always meant.
--
-- RETENTION: none of these tables link to call_records, so the 40-day cleanup job
-- (database/cleanup.php) never touches them — the data is kept indefinitely.
--
-- Safe to run multiple times.

-- ================================================================================
--  1. Departments — the one catalogue Staff, Review and the sheets all read
-- ================================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'review_departments')
       AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                        WHERE table_schema = 'public' AND table_name = 'departments') THEN
        ALTER TABLE review_departments RENAME TO departments;
        ALTER INDEX IF EXISTS idx_review_departments_name_ci RENAME TO idx_departments_name_ci;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS departments (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       TEXT        NOT NULL,
    sort_order INTEGER     NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_name_ci ON departments (lower(btrim(name)));

-- The Department tab's score, one row per department per month.
CREATE TABLE IF NOT EXISTS department_reviews (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    department_id BIGINT      NOT NULL REFERENCES departments (id) ON DELETE CASCADE,
    month         DATE        NOT NULL,   -- first of the month being reviewed
    performance   TEXT        NOT NULL DEFAULT '',
    percentage    NUMERIC(5, 2),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_department_reviews_month
    ON department_reviews (department_id, month);

-- Carry each department's single stored score into the month it was really about — the
-- month before it was last edited — then retire the columns.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'departments'
                  AND column_name = 'performance') THEN
        INSERT INTO department_reviews (department_id, month, performance, percentage)
        SELECT d.id,
               (date_trunc('month', d.updated_at AT TIME ZONE 'UTC') - INTERVAL '1 month')::date,
               d.performance,
               d.percentage
          FROM departments d
         WHERE btrim(d.performance) <> '' OR d.percentage IS NOT NULL
        ON CONFLICT DO NOTHING;

        ALTER TABLE departments DROP COLUMN performance;
        ALTER TABLE departments DROP COLUMN percentage;
    END IF;
END $$;

-- ================================================================================
--  2. Staff — the single roster the Queues, Review and Staff pages all pick from
-- ================================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'queue_people')
       AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                        WHERE table_schema = 'public' AND table_name = 'staff') THEN
        ALTER TABLE queue_people RENAME TO staff;
        ALTER INDEX IF EXISTS idx_queue_people_name_ci RENAME TO idx_staff_name_ci;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS staff (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_name_ci ON staff (lower(btrim(name)));

ALTER TABLE staff ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS is_active  BOOLEAN NOT NULL DEFAULT TRUE;
-- The attendance account this person checks in with. NULL = no bot account, so their
-- attendance is whatever is keyed in by hand on the Staff page.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS attendance_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_attendance_user
    ON staff (attendance_user_id) WHERE attendance_user_id IS NOT NULL;

-- A person may sit in more than one department (the client's sheet lists people twice).
CREATE TABLE IF NOT EXISTS staff_departments (
    staff_id      BIGINT NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
    department_id BIGINT NOT NULL REFERENCES departments (id) ON DELETE CASCADE,
    PRIMARY KEY (staff_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_departments_department
    ON staff_departments (department_id);

-- Seed the roster and its departments from the reviews already written.
--
-- The old `queue_people` list only ever held the people who cover a queue. Most of the
-- names on the Review page were typed straight into a row and exist nowhere else, so
-- without this the Staff page would open holding a fraction of the team and every one of
-- those reviews would point at nobody. Both steps are guarded on review_entries existing,
-- so this file still applies cleanly where 017 was never run.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'review_entries') THEN

        -- Everyone who has been reviewed but was never on the queue list.
        INSERT INTO staff (name)
        SELECT DISTINCT ON (lower(btrim(e.person_name))) btrim(e.person_name)
          FROM review_entries e
         WHERE btrim(e.person_name) <> ''
           AND NOT EXISTS (
               SELECT 1 FROM staff s WHERE lower(btrim(s.name)) = lower(btrim(e.person_name))
           )
         ORDER BY lower(btrim(e.person_name))
        ON CONFLICT DO NOTHING;

        -- The bands they were reviewed under become their departments. A person reviewed
        -- under two bands (Camp Billing on one tab, Forwarding on another) gets both,
        -- which is exactly what the many-to-many table is for.
        INSERT INTO staff_departments (staff_id, department_id)
        SELECT DISTINCT s.id, e.department_id
          FROM review_entries e
          JOIN staff s ON lower(btrim(s.name)) = lower(btrim(e.person_name))
         WHERE e.department_id IS NOT NULL
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- ================================================================================
--  3. Link the roster to the attendance accounts the bot already writes
-- ================================================================================
-- attendance_staff / attendance_days / attendance_breaks are written by the attendance bot,
-- not by this app, so everything here is guarded on them existing and only ever reads.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'attendance_staff') THEN

        -- Same person, same spelling -> link them.
        UPDATE staff s
           SET attendance_user_id = a.user_id::text,
               updated_at = now()
          FROM attendance_staff a
         WHERE s.attendance_user_id IS NULL
           AND lower(btrim(a.staff_name)) = lower(btrim(s.name))
           AND NOT EXISTS (SELECT 1 FROM staff x WHERE x.attendance_user_id = a.user_id::text);

        -- An attendance account with nobody on the roster becomes a staff member, so the
        -- Complete Attendance tab has a row to hang their fetched days on.
        INSERT INTO staff (name, attendance_user_id)
        SELECT DISTINCT ON (lower(btrim(COALESCE(NULLIF(btrim(a.staff_name), ''), NULLIF(btrim(a.username), ''), a.user_id::text))))
               btrim(COALESCE(NULLIF(btrim(a.staff_name), ''), NULLIF(btrim(a.username), ''), a.user_id::text)),
               a.user_id::text
          FROM attendance_staff a
         WHERE NOT EXISTS (SELECT 1 FROM staff s WHERE s.attendance_user_id = a.user_id::text)
           AND NOT EXISTS (
               SELECT 1 FROM staff s
                WHERE lower(btrim(s.name)) = lower(btrim(COALESCE(NULLIF(btrim(a.staff_name), ''), NULLIF(btrim(a.username), ''), a.user_id::text)))
           )
         ORDER BY lower(btrim(COALESCE(NULLIF(btrim(a.staff_name), ''), NULLIF(btrim(a.username), ''), a.user_id::text))),
                  a.user_id
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- ================================================================================
--  4. Reviews — one staff link, and a month on every row
-- ================================================================================

-- `month` changes meaning here, so this whole block must run EXACTLY ONCE — shifting a
-- month twice would silently move a year of reviews. It is guarded on `staff_id` not yet
-- existing, which is true only on the first run, rather than on the individual statements.
-- Also guarded on review_entries existing at all, so the file still applies where 017 was
-- never run.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'review_entries')
       OR EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'review_entries'
                     AND column_name = 'staff_id') THEN
        RETURN;
    END IF;

    -- person_name stays: it is the name as written on the day, and must not change when
    -- someone is renamed or taken off the roster. staff_id is the live link beside it.
    ALTER TABLE review_entries
        ADD COLUMN staff_id BIGINT REFERENCES staff (id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_review_entries_staff ON review_entries (staff_id);

    UPDATE review_entries e
       SET staff_id = s.id
      FROM staff s
     WHERE lower(btrim(s.name)) = lower(btrim(e.person_name));

    -- ── `month` now means the month being JUDGED, not the month worked in ──────────
    --
    -- Behaviour rows already carried a month, but under the old page it was simply
    -- whichever month the sheet was filled in — the picker opened on the current one. A
    -- sheet stamped SEPTEMBER was worked on in September and therefore judges August, so
    -- every existing row shifts back one month to say what it always meant.
    --
    -- IF YOUR BEHAVIOUR SHEET WAS STAMPED WITH THE MONTH IT JUDGES rather than the month
    -- it was written in, delete this one statement before running the file — nothing else
    -- depends on it.
    UPDATE review_entries
       SET month = (month - INTERVAL '1 month')::date
     WHERE kind = 'behaviour' AND month IS NOT NULL;

    -- Performance rows never carried a month at all. Same rule, measured from the day the
    -- row was written, which lands them alongside the behaviour rows for the same cycle.
    UPDATE review_entries
       SET month = (date_trunc('month', created_at AT TIME ZONE 'UTC') - INTERVAL '1 month')::date
     WHERE kind = 'performance' AND month IS NULL;
END $$;

-- ================================================================================
--  5. Attendance keyed in by hand
-- ================================================================================
-- Only for staff the bot never recorded. The page merges these with attendance_days and
-- marks the fetched ones read-only, so a fetched day is never editable and never copied.
-- Times are org-local clock times (America/New_York), which is how they are keyed in.

CREATE TABLE IF NOT EXISTS staff_attendance (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    staff_id   BIGINT      NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
    work_date  DATE        NOT NULL,
    login_at   TIME,                                -- NULL = absent / not recorded
    logout_at  TIME,
    break_min  INTEGER     NOT NULL DEFAULT 0,
    status     TEXT        NOT NULL DEFAULT 'present',
    note       TEXT        NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One hand-keyed row per person per day.
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_attendance_day  ON staff_attendance (staff_id, work_date);
CREATE INDEX        IF NOT EXISTS idx_staff_attendance_date ON staff_attendance (work_date);

-- ================================================================================
--  6. Leaves sheet
-- ================================================================================
-- Every column but the date and the person is free text ("Approved", "Half", a reason),
-- because that is what the client's sheet holds — statuses, not counts.

CREATE TABLE IF NOT EXISTS staff_leaves (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    staff_id      BIGINT      NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
    -- Which of the person's departments this row is filed under; NULL = unfiled.
    department_id BIGINT      REFERENCES departments (id) ON DELETE SET NULL,
    leave_date    DATE        NOT NULL,
    sick_leave    TEXT        NOT NULL DEFAULT '',
    break_leave   TEXT        NOT NULL DEFAULT '',
    half_day      TEXT        NOT NULL DEFAULT '',
    late_login    TEXT        NOT NULL DEFAULT '',
    aob           TEXT        NOT NULL DEFAULT '',   -- "any other business"
    sort_order    INTEGER     NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_leaves_date  ON staff_leaves (leave_date);
CREATE INDEX IF NOT EXISTS idx_staff_leaves_staff ON staff_leaves (staff_id);

-- ================================================================================
--  7. Salary sheet
-- ================================================================================
-- One row per person per month. SALARY is the status the sheet shows ("Received"), with an
-- optional amount beside it for the months the client wants the figure recorded.

CREATE TABLE IF NOT EXISTS staff_salaries (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    staff_id      BIGINT      NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
    department_id BIGINT      REFERENCES departments (id) ON DELETE SET NULL,
    month         DATE        NOT NULL,             -- first of the month being paid
    status        TEXT        NOT NULL DEFAULT '',  -- Received / Pending / Not Paid / ...
    amount        NUMERIC(12, 2),
    note          TEXT        NOT NULL DEFAULT '',
    sort_order    INTEGER     NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_salaries_month ON staff_salaries (staff_id, month);
