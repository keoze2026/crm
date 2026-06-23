-- 003_add_buyer_campaign_rates.sql
-- Gives every buyer and campaign a single *definite* rate.
--   * buyers.rate    -> revenue = rate * counted (calls)
--   * campaigns.rate -> cost    = rate * counted (calls)
--
-- Previously the rate lived only on each call_record (and was jittered across the
-- generated history). This migration:
--   1. adds the rate column to buyers and campaigns,
--   2. backfills the definite rates from the source screenshots (2026-06-11),
--   3. re-stamps every call_record with its entity's definite rate so the stored
--      total_bill (= counted * rate) stays exactly rate * counted everywhere.
--
-- Safe to run multiple times.
--
-- Apply with:
--   PGPASSWORD='<password>' psql -h localhost -U crm_user -d crm -f database/migrations/003_add_buyer_campaign_rates.sql

-- 1. Columns ------------------------------------------------------------------
ALTER TABLE buyers    ADD COLUMN IF NOT EXISTS rate NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS rate NUMERIC(10, 2) NOT NULL DEFAULT 0;

-- 2. Backfill the known definite rates from the 2026-06-11 screenshots --------
UPDATE buyers b SET rate = v.rate FROM (VALUES
    ('RTG 04', 55.00), ('RTG 24', 52.00), ('RTG 50', 52.00), ('RNY', 51.00),
    ('CDM', 50.00), ('CRM', 50.00), ('L48', 50.00), ('MXX', 50.00),
    ('RTG 02', 50.00), ('RTG 06', 50.00), ('RTG 08', 50.00), ('RTG 15', 50.00),
    ('RTG 39', 50.00),
    ('RTG 17', 49.50), ('ZZY', 49.50),
    ('A49', 49.00), ('AAT', 49.00), ('BHS', 49.00), ('BOP', 49.00),
    ('FDD', 49.00), ('HOZ', 49.00), ('JJR', 49.00), ('PIJ', 49.00),
    ('RTG 10', 49.00), ('RTG 12', 49.00), ('RTG 16', 49.00), ('R48', 49.00),
    ('KBT', 48.00), ('N4K', 48.00), ('NB48', 48.00), ('SHN', 48.00)
) AS v(code, rate) WHERE b.code = v.code;

-- Campaign C-03 spans several sources (48/48/47/46/46); it collapses to its
-- single definite rate of 48.00.
UPDATE campaigns c SET rate = v.rate FROM (VALUES
    ('C-05', 50.00), ('C-02', 49.00), ('C-03', 48.00), ('C-11', 14.00)
) AS v(code, rate) WHERE c.code = v.code;

-- 3. Fallback for any entity not in the lists above: use the rate from its
--    highest-volume record so nothing is left at 0 by accident.
UPDATE buyers b SET rate = sub.rate FROM (
    SELECT DISTINCT ON (buyer_id) buyer_id, rate
    FROM call_records
    WHERE record_type = 'buyer' AND buyer_id IS NOT NULL
    ORDER BY buyer_id, counted DESC, record_date DESC
) sub WHERE sub.buyer_id = b.id AND b.rate = 0;

UPDATE campaigns c SET rate = sub.rate FROM (
    SELECT DISTINCT ON (campaign_id) campaign_id, rate
    FROM call_records
    WHERE record_type = 'campaign' AND campaign_id IS NOT NULL
    ORDER BY campaign_id, counted DESC, record_date DESC
) sub WHERE sub.campaign_id = c.id AND c.rate = 0;

-- 4. Re-stamp every call record with its entity's definite rate. total_bill is
--    a generated column (counted * rate), so it recomputes automatically.
UPDATE call_records r SET rate = b.rate, updated_at = now()
    FROM buyers b
    WHERE r.buyer_id = b.id AND r.record_type = 'buyer' AND r.rate <> b.rate;

UPDATE call_records r SET rate = c.rate, updated_at = now()
    FROM campaigns c
    WHERE r.campaign_id = c.id AND r.record_type = 'campaign' AND r.rate <> c.rate;
