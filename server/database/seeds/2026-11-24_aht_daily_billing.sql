-- AHT Daily Billing — the sheet of 24 Nov 2026 as the boss printed it, keyed in as real
-- records so the team opens the page, renames what needs renaming and carries on.
--
--   31 clients  → buyers + one buyer record each        Client Billing      $64,315.50
--    8 lines    → campaigns, sources + one cost record   Traffic Source Cost $51,888.00
--                                                        Final Profit        $12,427.50
--
-- What it does, and nothing else:
--   * a client that does not exist yet is created (name = code); every listed client's
--     definite rate is set to the sheet's rate — earlier records keep their own rate;
--   * a camp or traffic source that does not exist yet is created; every listed source's
--     definite rate is set to the sheet's rate and it is linked to its camp if unlinked;
--   * a record for 24 Nov 2026 is inserted only where that client (or camp + source) has
--     none that day, so the file is safe to run twice and never doubles a figure.
--
-- Apply on the server (back up first, as for a migration):
--   PGPASSWORD='<password>' psql -h localhost -U crm_user -d crm -f database/seeds/2026-11-24_aht_daily_billing.sql

BEGIN;

-- ── Client Billing ────────────────────────────────────────────────────────────

CREATE TEMP TABLE seed_clients (
    code TEXT, rate NUMERIC(10, 2), answered INT, missed INT, replaced INT, counted INT
) ON COMMIT DROP;

INSERT INTO seed_clients VALUES
    ('RTG 04', 55.00, 292, 9, 0, 301),
    ('RTG 50', 52.00,  47, 4, 0,  51),
    ('M_US',   52.00,  21, 0, 0,  21),
    ('RTG 28', 52.00,   8, 1, 0,   9),
    ('RNY',    51.00,   3, 0, 0,   3),
    ('PWL',    51.00,   1, 0, 0,   1),
    ('RTG 08', 50.00, 234, 4, 0, 238),
    ('RTG 15', 50.00, 100, 8, 0, 100),
    ('25C',    50.00,  78, 9, 0,  87),
    ('RTG 06', 50.00,  34, 8, 0,  42),
    ('MXX',    50.00,  18, 1, 0,  19),
    ('RBC',    50.00,  16, 0, 0,  16),
    ('AAT',    50.00,   9, 0, 0,   9),
    ('VKS',    50.00,   7, 0, 0,   7),
    ('EKU',    50.00,   5, 0, 0,   5),
    ('RTG 32', 50.00,   5, 0, 0,   5),
    ('RTG 21', 50.00,   2, 0, 0,   2),
    ('11H',    50.00,   1, 0, 0,   1),
    ('DEE',    50.00,   1, 0, 0,   1),
    ('RTG 07', 50.00,   0, 1, 0,   1),
    ('RTG 17', 49.50,   5, 0, 0,   5),
    ('A49',    49.00, 153, 2, 0, 153),
    ('BHS',    49.00,  49, 1, 0,  49),
    ('R48',    49.00,  32, 4, 0,  32),
    ('BOP',    49.00,   5, 0, 0,   5),
    ('NEO',    49.00,   5, 0, 0,   5),
    ('RTG 10', 49.00,   1, 0, 0,   1),
    ('CDM',    48.50,  52, 2, 0,  52),
    ('RTG 24', 48.00,  24, 6, 0,  30),
    ('HOZ',    48.00,   5, 0, 0,   5),
    ('RTG 35', 48.00,   5, 0, 0,   5);

-- A code names one buyer whatever its case (the API matches LOWER(code)), so match that way.
INSERT INTO buyers (code, name, rate)
SELECT s.code, s.code, s.rate
FROM seed_clients s
WHERE NOT EXISTS (SELECT 1 FROM buyers b WHERE lower(b.code) = lower(s.code));

-- Where an older database still holds two spellings of one code ("RTG 04" and "rtg 04"),
-- the lowest id is the buyer, exactly as the API resolves a typed code.
CREATE TEMP TABLE seed_buyer_ids ON COMMIT DROP AS
SELECT DISTINCT ON (lower(b.code)) lower(b.code) AS lcode, b.id
FROM buyers b
WHERE lower(b.code) IN (SELECT lower(code) FROM seed_clients)
ORDER BY lower(b.code), b.id;

UPDATE buyers b SET rate = s.rate
FROM seed_clients s JOIN seed_buyer_ids i ON i.lcode = lower(s.code)
WHERE b.id = i.id AND b.rate <> s.rate;

INSERT INTO call_records (record_date, record_type, buyer_id, answered, missed, replacement, counted, rate)
SELECT DATE '2026-11-24', 'buyer', b.id, s.answered, s.missed, s.replaced, s.counted, s.rate
FROM seed_clients s
JOIN seed_buyer_ids i ON i.lcode = lower(s.code)
JOIN buyers b ON b.id = i.id
WHERE NOT EXISTS (
    SELECT 1 FROM call_records r
    WHERE r.record_date = DATE '2026-11-24' AND r.record_type = 'buyer' AND r.buyer_id = b.id
);

-- ── Traffic Source Cost ───────────────────────────────────────────────────────

CREATE TEMP TABLE seed_traffic (
    camp TEXT, source TEXT, rate NUMERIC(10, 2), answered INT, missed INT, replaced INT, counted INT
) ON COMMIT DROP;

-- Replaced is 0 on every line, and Final Count = Answered − Replaced, as the sheet shows.
INSERT INTO seed_traffic VALUES
    ('L-10',              'MT-00',              49.00, 128,  6, 0, 128),
    ('L-13',              'GG-00',              49.00,   7,  0, 0,   7),
    ('L-11',              'TB-00',              48.00, 294,  4, 0, 294),
    ('H-02 & 03',         'PD-02 & AA',         48.00, 228, 17, 0, 228),
    ('M-01',              'MK-00',              48.00,  50,  4, 0,  50),
    ('H-04, 05, 06 & 07', 'DS-01, 02, 03 & 04', 47.00, 339, 15, 0, 339),
    ('H-08 & 09',         'YY-01 & 02',         46.00,  16,  3, 0,  16),
    ('Z-00',              'DD-00',              14.00,  82,  1, 0,  82);

INSERT INTO campaigns (code)
SELECT DISTINCT s.camp FROM seed_traffic s
WHERE NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.code = s.camp);

INSERT INTO destinations (name, rate, campaign_id)
SELECT s.source, s.rate, c.id
FROM seed_traffic s JOIN campaigns c ON c.code = s.camp
ON CONFLICT (name) DO UPDATE
    SET rate = EXCLUDED.rate,
        campaign_id = COALESCE(destinations.campaign_id, EXCLUDED.campaign_id);

INSERT INTO call_records (record_date, record_type, campaign_id, source, answered, missed, replacement, counted, rate)
SELECT DATE '2026-11-24', 'campaign', c.id, s.source, s.answered, s.missed, s.replaced, s.counted, s.rate
FROM seed_traffic s
JOIN campaigns c ON c.code = s.camp
WHERE NOT EXISTS (
    SELECT 1 FROM call_records r
    WHERE r.record_date = DATE '2026-11-24' AND r.record_type = 'campaign'
      AND r.campaign_id = c.id AND r.source = s.source
);

COMMIT;

-- Check (should read 31 | 64315.50 and 8 | 51888.00):
--   SELECT record_type, count(*), sum(total_bill) FROM call_records
--   WHERE record_date = '2026-11-24' GROUP BY record_type;
