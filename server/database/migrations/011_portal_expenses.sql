-- 011_portal_expenses.sql
-- Adds the "portal_expenses" table behind the Portal Expenses page
-- (/api/portal-expenses CRUD + the monthly expenses sheet/chart). Without it every
-- request to /api/portal-expenses fails with: relation "portal_expenses" does not exist.
--
-- Each row is one provider's expenses for one month. `month` is stored as the first
-- day of the month (e.g. 2026-03-01). `total_amount` is stored explicitly rather than
-- derived, because some rows (e.g. a flat BYOC fee) are a lump sum independent of the
-- three component columns — the UI defaults it to the component sum but allows an override.
--
-- RETENTION: this is a standalone reference table with no call_records link, so the
-- 40-day cleanup job (database/cleanup.php) NEVER touches it — like `users` and
-- `destinations`, its data is kept indefinitely.
--
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS portal_expenses (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    month          DATE           NOT NULL,                 -- first day of the month, e.g. 2026-03-01
    name           TEXT           NOT NULL,
    voice_minutes  NUMERIC(16, 4) NOT NULL DEFAULT 0 CHECK (voice_minutes  >= 0),
    rejected_calls NUMERIC(16, 4) NOT NULL DEFAULT 0 CHECK (rejected_calls >= 0),
    rent_values    NUMERIC(16, 4) NOT NULL DEFAULT 0 CHECK (rent_values    >= 0),
    total_amount   NUMERIC(16, 4) NOT NULL DEFAULT 0 CHECK (total_amount   >= 0),
    sort_order     INTEGER        NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_expenses_month ON portal_expenses (month);
