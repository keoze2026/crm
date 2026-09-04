-- 017_reviews.sql
-- The two tables behind the Review page (/api/review-departments, /api/review-entries).
-- Without them those endpoints 500 with: relation "review_departments" does not exist.
--
--   review_departments — the department list: its own Good/Average rating and % score.
--                        Doubles as the catalogue the other two tabs group by, so a
--                        department typed once is pickable everywhere.
--   review_entries     — one row per person per tab. `kind` says which tab it belongs to:
--                        'performance' (rating + percentage) or 'behaviour' (rating +
--                        month). The columns the other tab doesn't use stay NULL.
--
-- Ratings are stored as the plain text shown in the dropdowns ("Good", "On Track"), not
-- as codes: the wording is the client's and can be extended without a migration.
--
-- `department_id` is ON DELETE SET NULL, not CASCADE — dropping a department must not
-- silently take a month of reviews with it; those rows resurface under "No department".
--
-- RETENTION: standalone tables with no call_records link, so the 40-day cleanup job
-- (database/cleanup.php) NEVER touches them — the data is kept indefinitely.
--
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS review_departments (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT          NOT NULL,
    performance TEXT          NOT NULL DEFAULT '',   -- Excellent / Good / Average / …
    percentage  NUMERIC(5, 2),                       -- NULL = never scored (blank cell)
    sort_order  INTEGER       NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_review_departments_name_ci
    ON review_departments (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS review_entries (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind            TEXT        NOT NULL CHECK (kind IN ('performance', 'behaviour')),
    department_id   BIGINT      REFERENCES review_departments (id) ON DELETE SET NULL,
    person_name     TEXT        NOT NULL,
    department_note TEXT        NOT NULL DEFAULT '',  -- the per-row DEPARTMENT cell ("Billing/Audits")
    rating          TEXT        NOT NULL DEFAULT '',  -- Performance or Behaviour analysis
    percentage      NUMERIC(5, 2),                    -- performance rows only
    month           DATE,                             -- behaviour rows only, first of the month
    sort_order      INTEGER     NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_entries_kind       ON review_entries (kind, month);
CREATE INDEX IF NOT EXISTS idx_review_entries_department ON review_entries (department_id);
