-- 006_editable_monthly_sheets.sql
-- Two related changes:
--   1. Adds a display-only "replacement" count to call records. It is keyed in like
--      "counted" but is NOT part of total_bill (counted * rate) — purely for display.
--   2. Monthly Sheets:
--      - Buyers: "Total Calls Bought" auto-derives from the leads records (SUM of
--        counted in the range) — no stored column, so it tracks the date range.
--      - Campaigns: directly editable — the answered/missed/counted totals and the
--        typed Total Bill (`cost`) are STORED on the campaign (backfilled once from the
--        current call-record aggregates so nothing zeroes out on first deploy).
--
-- Safe to run multiple times (idempotent). Back up first — the backfill overwrites
-- the new stored columns from current call_records.
--
-- Apply with:
--   PGPASSWORD='<password>' psql -h localhost -U crm_user -d crm -f database/migrations/006_editable_monthly_sheets.sql

-- 1. Replacement count on call records (display only; NOT included in total_bill).
ALTER TABLE call_records ADD COLUMN IF NOT EXISTS replacement INTEGER NOT NULL DEFAULT 0 CHECK (replacement >= 0);

-- 2. Buyers Monthly Sheet needs no new column: "Total Calls Bought" always
--    auto-derives from the leads records (SUM of counted in the selected date range),
--    so the total changes as the range changes. Nothing to alter on `buyers`.

-- 3. Stored monthly totals on campaigns (cost side). `cost` is the typed Total Bill;
--    Avg Rate is derived as cost / counted on the client (campaigns have no single rate).
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS answered INTEGER NOT NULL DEFAULT 0 CHECK (answered >= 0);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS missed   INTEGER NOT NULL DEFAULT 0 CHECK (missed   >= 0);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS counted  INTEGER NOT NULL DEFAULT 0 CHECK (counted  >= 0);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS cost     NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (cost >= 0);

-- 4. Backfill the campaign stored totals from existing call records (one-time;
--    re-running just re-syncs to the current aggregates). Buyers have no stored total
--    — their Total Calls Bought always auto-derives from the leads records.
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
