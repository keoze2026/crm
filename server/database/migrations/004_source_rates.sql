-- 004_source_rates.sql
-- Moves the COST-side rate from the campaign to the SOURCE/DESTINATION, matching the
-- screenshots where each (camp, destination) row has its own rate (e.g. C-03 spans
-- 48/48/47/46/46). Revenue (buyers) is unchanged — each buyer keeps its definite rate.
--
-- After this migration:
--   * destinations.rate  -> the source's definite rate
--   * campaign cost       = SUM(call_records.total_bill) across the campaign's sources
--   * campaigns.rate      -> removed (a campaign is just a grouping)
--
-- This supersedes the campaign-rate part of 003 (which had collapsed every source in a
-- campaign to a single rate). Run it AFTER 003. Safe to run multiple times.
--
-- Apply with:
--   PGPASSWORD='<password>' psql -h localhost -U crm_user -d crm -f database/migrations/004_source_rates.sql

-- 1. Destination rate column --------------------------------------------------
ALTER TABLE destinations ADD COLUMN IF NOT EXISTS rate NUMERIC(10, 2) NOT NULL DEFAULT 0;

-- 2. Make sure every source that appears in cost records exists as a destination.
INSERT INTO destinations (name)
SELECT DISTINCT source
FROM call_records
WHERE record_type = 'campaign' AND source IS NOT NULL AND source <> ''
ON CONFLICT (name) DO NOTHING;

-- 3. Backfill the definite source rates from the 2026-06-11 screenshots.
UPDATE destinations d SET rate = v.rate FROM (VALUES
    ('XXD', 50.00), ('05', 49.00), ('PDSO', 48.00), ('Priority Y', 48.00),
    ('AdsTerra', 47.00), ('BBB', 46.00), ('RGR', 46.00), ('DXTST', 14.00)
) AS v(name, rate) WHERE d.name = v.name;

-- 4. Fallback for any source not in the list above: use the rate from its
--    highest-volume cost record so nothing is left at 0 by accident.
UPDATE destinations d SET rate = sub.rate FROM (
    SELECT DISTINCT ON (source) source, rate
    FROM call_records
    WHERE record_type = 'campaign' AND source IS NOT NULL AND source <> ''
    ORDER BY source, counted DESC, record_date DESC
) sub WHERE sub.source = d.name AND d.rate = 0;

-- 5. Re-stamp every campaign cost record with its source's definite rate. This
--    undoes 003's single-rate collapse. total_bill (counted * rate) recomputes.
UPDATE call_records r SET rate = d.rate, updated_at = now()
    FROM destinations d
    WHERE r.record_type = 'campaign' AND r.source = d.name AND r.rate <> d.rate;

-- 6. The campaign no longer carries a rate (cost is summed from its sources).
ALTER TABLE campaigns DROP COLUMN IF EXISTS rate;
