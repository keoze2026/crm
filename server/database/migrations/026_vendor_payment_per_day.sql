-- 026_vendor_payment_per_day.sql
-- One manual payment row per traffic source per day.
--
-- WHY: the Traffic Source sheet no longer holds hand-typed Converted Lead / Price. Those are
-- read live from the campaign records (call_records where record_type = 'campaign'), keyed by
-- source and date, so the sheet's Payments column equals what the Campaigns side charged.
-- vendor_payments is therefore reduced to one thing: the Amount paid on a given day. With the
-- sheet now driven by DATES, two rows for the same vendor and date have no way to be shown or
-- edited unambiguously, so this collapses them and stops new ones appearing.
--
-- The existing converted_calls and price columns are deliberately LEFT IN PLACE with their
-- values intact. They are simply no longer read. Nothing is destroyed, so reverting to
-- hand-typed figures is a code change rather than a restore.
--
-- Duplicates are merged by SUMMING amount_paid onto the earliest row, so no money moves —
-- three vendor/date pairs are affected in the current data.
--
-- Safe to run multiple times.

-- 1. Fold duplicate (vendor, day) rows into the earliest row of each group.
WITH grouped AS (
    SELECT id,
           SUM(amount_paid) OVER (PARTITION BY lower(btrim(vendor)), entry_date) AS total_paid,
           MIN(id)          OVER (PARTITION BY lower(btrim(vendor)), entry_date) AS keep_id
      FROM vendor_payments
)
UPDATE vendor_payments v
   SET amount_paid = g.total_paid,
       updated_at  = now()
  FROM grouped g
 WHERE v.id = g.keep_id
   AND g.id = g.keep_id
   AND v.amount_paid <> g.total_paid;

DELETE FROM vendor_payments v
 USING (
    SELECT id, MIN(id) OVER (PARTITION BY lower(btrim(vendor)), entry_date) AS keep_id
      FROM vendor_payments
 ) g
 WHERE v.id = g.id
   AND g.id <> g.keep_id;

-- 2. Keep it that way. Matched case-insensitively on a trimmed name, the same way every
--    vendor lookup in VendorController resolves a source.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_payments_vendor_day
    ON vendor_payments (lower(btrim(vendor)), entry_date);
