-- 012_add_payout_expenses.sql
-- Adds a "payout_expenses" currency column (USD) to portal_expenses, alongside the
-- existing voice_minutes / rejected_calls / rent_values component columns. Like them,
-- it feeds the auto-computed Total Amount (which stays overridable for flat fees).
--
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS).

ALTER TABLE portal_expenses
    ADD COLUMN IF NOT EXISTS payout_expenses NUMERIC(16, 4) NOT NULL DEFAULT 0
        CHECK (payout_expenses >= 0);
