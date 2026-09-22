-- 032_staff_salary_holds.sql
-- The Staff Management page's fourth tab, Salary Hold: a running log of salaries held back
-- and why, kept separate from the Salaries sheet (which is a one-row-per-person-per-month
-- payment record) because a hold is a note about a PROBLEM, not a payment, and needs to
-- stay visible across months until it is resolved.
--
-- Unlike Leaves and Salaries, this tab is NOT scoped to one month at a time: a manager wants
-- to see every current hold at a glance, so the list shows every row, newest month first,
-- and each row carries its own month rather than inheriting the page's month selector.
--
-- Without it, /api/staff-salary-holds 500s with:
-- relation "staff_salary_holds" does not exist.
--
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS staff_salary_holds (
    id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    staff_id   BIGINT      NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
    month      DATE        NOT NULL,                     -- first of the month the hold is about
    reason     TEXT        NOT NULL DEFAULT '',           -- free text, like the Review page's Notes
    status     TEXT        NOT NULL DEFAULT 'On Hold' CHECK (status IN ('On Hold', 'Disbursed')),
    sort_order INTEGER     NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_salary_holds_staff ON staff_salary_holds (staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_salary_holds_month ON staff_salary_holds (month DESC);
