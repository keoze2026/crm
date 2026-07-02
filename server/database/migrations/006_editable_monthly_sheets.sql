-- 006_editable_monthly_sheets.sql
-- Two related changes:
--   1. Adds a display-only "replacement" count to call records. It is keyed in like
--      "counted" but is NOT part of total_bill (counted * rate) — purely for display.
--   2. Makes the buyer/campaign "Monthly Sheet" directly editable by STORING the
--      answered/missed/counted totals on the buyer/campaign itself (and, for
--      campaigns, the typed Total Bill as `cost`). Previously these were summed live
--      from call_records; now the sheet is its own source of truth, independent of
--      the Leads Records page. Existing values are backfilled from the current
--      call-record aggregates so nothing zeroes out on first deploy.
--
-- Safe to run multiple times (idempotent). Back up first — the backfill overwrites
-- the new stored columns from current call_records.
--
-- Apply with:
--   PGPASSWORD='<password>' psql -h localhost -U crm_user -d crm -f database/migrations/006_editable_monthly_sheets.sql

-- 1. Replacement count on call records (display only; NOT included in total_bill).
ALTER TABLE call_records ADD COLUMN IF NOT EXISTS replacement INTEGER NOT NULL DEFAULT 0 CHECK (replacement >= 0);

-- 2. Stored monthly totals on buyers (revenue side). Total Bill = rate * counted.
ALTER TABLE buyers ADD COLUMN IF NOT EXISTS answered INTEGER NOT NULL DEFAULT 0 CHECK (answered >= 0);
ALTER TABLE buyers ADD COLUMN IF NOT EXISTS missed   INTEGER NOT NULL DEFAULT 0 CHECK (missed   >= 0);
ALTER TABLE buyers ADD COLUMN IF NOT EXISTS counted  INTEGER NOT NULL DEFAULT 0 CHECK (counted  >= 0);

-- 3. Stored monthly totals on campaigns (cost side). `cost` is the typed Total Bill;
--    Avg Rate is derived as cost / counted on the client (campaigns have no single rate).
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS answered INTEGER NOT NULL DEFAULT 0 CHECK (answered >= 0);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS missed   INTEGER NOT NULL DEFAULT 0 CHECK (missed   >= 0);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS counted  INTEGER NOT NULL DEFAULT 0 CHECK (counted  >= 0);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS cost     NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (cost >= 0);

-- 4. Backfill the stored totals from existing call records (one-time; re-running
--    just re-syncs to the current aggregates).
UPDATE buyers b SET
    answered = COALESCE(agg.answered, 0),
    missed   = COALESCE(agg.missed,   0),
    counted  = COALESCE(agg.counted,  0)
FROM (
    SELECT buyer_id,
           SUM(answered) AS answered,
           SUM(missed)   AS missed,
           SUM(counted)  AS counted
    FROM call_records
    WHERE record_type = 'buyer' AND buyer_id IS NOT NULL
    GROUP BY buyer_id
) agg
WHERE agg.buyer_id = b.id;

UPDATE campaigns c SET
    answered = COALESCE(agg.answered, 0),
    missed   = COALESCE(agg.missed,   0),
    counted  = COALESCE(agg.counted,  0),
    cost     = COALESCE(agg.cost,     0)
FROM (
    SELECT campaign_id,
           SUM(answered)   AS answered,
           SUM(missed)     AS missed,
           SUM(counted)    AS counted,
           SUM(total_bill) AS cost
    FROM call_records
    WHERE record_type = 'campaign' AND campaign_id IS NOT NULL
    GROUP BY campaign_id
) agg
WHERE agg.campaign_id = c.id;
