-- 015_portal_expense_columns.sql
-- Two more currency (USD) component columns on portal_expenses — "Call Recording" and
-- "Voip Shield" — and renames payout_expenses -> other_expenses, which is now the
-- catch-all bucket for everything left over (payout, fixed float, …) and sits last in
-- the sheet. Like the other components they feed the auto-computed Total Amount
-- (which stays overridable for flat fees).
--
-- Without this, /api/portal-expenses 500s with: column "call_recording" does not exist.
--
-- Safe to run multiple times.

ALTER TABLE portal_expenses
    ADD COLUMN IF NOT EXISTS call_recording NUMERIC(16, 4) NOT NULL DEFAULT 0
        CHECK (call_recording >= 0);

ALTER TABLE portal_expenses
    ADD COLUMN IF NOT EXISTS voip_shield NUMERIC(16, 4) NOT NULL DEFAULT 0
        CHECK (voip_shield >= 0);

-- Rename only when the old column is still there and the new one isn't (RENAME COLUMN
-- has no IF EXISTS of its own), so a re-run is a no-op. Values are preserved.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'portal_expenses' AND column_name = 'payout_expenses'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'portal_expenses' AND column_name = 'other_expenses'
    ) THEN
        ALTER TABLE portal_expenses RENAME COLUMN payout_expenses TO other_expenses;
    END IF;
END $$;

-- Fresh databases created from schema.sql already have other_expenses; make sure one
-- exists either way.
ALTER TABLE portal_expenses
    ADD COLUMN IF NOT EXISTS other_expenses NUMERIC(16, 4) NOT NULL DEFAULT 0
        CHECK (other_expenses >= 0);
