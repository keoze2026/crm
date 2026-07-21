-- 014_vendor_opening_advance.sql
-- Turns the Vendors page's hand-entered Due/Advance balance into a CARRIED-FORWARD one.
--
-- Before: `vendors.manual_due` was a free-typed signed figure the user set per vendor
--         (positive = Due, negative = Advance) with a Due/Advance toggle in the UI.
-- After:  `vendors.opening_advance` is the vendor's OPENING balance — the figure the
--         ledger starts from, before any `vendor_payments` row exists. Everything after
--         it is derived, so the Due/Advance label is never typed again:
--
--           Initial Advance (for a period) = opening_advance
--                                          + Σ(amount_paid − converted_calls × price)
--                                            over every row BEFORE the period start
--           Final balance                  = Initial Advance + Σ amount_paid − Σ payments
--           positive ⇒ Advance (the vendor holds our money) · negative ⇒ Due (we owe them)
--
--         That "Σ over earlier rows" is what carries a balance into the next date range,
--         so switching viewing periods can never desync the figure — it is recomputed
--         from the ledger every time (VendorController::payments).
--
-- NOTE THE SIGN FLIP: `manual_due` was positive-for-Due; `opening_advance` is
-- positive-for-Advance. Existing values are negated so their meaning is preserved.
--
-- Run it AFTER 013_vendors.sql. Safe to run multiple times (no-op once applied).

DO $$
BEGIN
    -- Path A — 013 is already applied: rename the old column and flip its sign.
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'vendors' AND column_name = 'manual_due'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'vendors' AND column_name = 'opening_advance'
    ) THEN
        ALTER TABLE vendors RENAME COLUMN manual_due TO opening_advance;
        UPDATE vendors SET opening_advance = -opening_advance WHERE opening_advance <> 0;
    END IF;
END $$;

-- Path B — a DB that never had `manual_due` (or a partially-applied run): just ensure
-- the column exists.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS opening_advance NUMERIC(16, 2) NOT NULL DEFAULT 0;

-- Path C — both columns present (013 re-run after this migration recreated `manual_due`
-- via CREATE TABLE on a fresh DB is impossible, but a hand-edited DB could get here):
-- fold any leftover `manual_due` into `opening_advance` and drop it.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'vendors' AND column_name = 'manual_due'
    ) THEN
        UPDATE vendors SET opening_advance = -manual_due
         WHERE opening_advance = 0 AND manual_due <> 0;
        ALTER TABLE vendors DROP COLUMN manual_due;
    END IF;
END $$;
