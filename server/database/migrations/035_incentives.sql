-- 035_incentives.sql
-- The Monthly Incentives page: one row per person per incentive, for a month.
--
--   SR. NO. · STAFF · AMOUNT · STATUS
--
-- A person may hold several rows in a month (two separate incentives), and several people
-- may be given the same amount at once — the page's add row creates one row for each person
-- picked. STATUS is exactly 'Pending', 'Cancelled' or 'Fulfilled', stored as the wording
-- shown, like every other status in the app. Nothing is derived from the Top Performer tab.
--
-- Without it, /api/incentives 500s with: relation "incentives" does not exist.
--
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS incentives (
    id         BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    staff_id   BIGINT        NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
    month      DATE          NOT NULL,                  -- first of the month it is for
    amount     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
    status     TEXT          NOT NULL DEFAULT 'Pending'
                             CHECK (status IN ('Pending', 'Cancelled', 'Fulfilled')),
    sort_order INTEGER       NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incentives_month ON incentives (month);
CREATE INDEX IF NOT EXISTS idx_incentives_staff ON incentives (staff_id);
