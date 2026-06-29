-- 005_destination_campaign_link.sql
-- Makes a campaign's source rates persist independently of call history.
--
-- Until now, which sources belonged to which campaign was only recorded in
-- call_records, so clearing history orphaned the per-campaign rate view (the rates
-- themselves stayed on destinations, but you could no longer see/edit them per
-- campaign). This links each destination (source) to its campaign so the rates are
-- always visible and editable on the Campaigns tab, even with zero records.
--
-- Safe to run multiple times.
--
-- Apply with:
--   PGPASSWORD='<password>' psql -h localhost -U crm_user -d crm -f database/migrations/005_destination_campaign_link.sql

-- 1. The link column.
ALTER TABLE destinations ADD COLUMN IF NOT EXISTS campaign_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_destinations_campaign ON destinations (campaign_id);

-- 2. Backfill from history where it still exists (source -> campaign).
UPDATE destinations d SET campaign_id = sub.campaign_id
FROM (
    SELECT DISTINCT ON (source) source, campaign_id
    FROM call_records
    WHERE record_type = 'campaign' AND source IS NOT NULL AND campaign_id IS NOT NULL
    ORDER BY source, record_date DESC
) sub
WHERE d.name = sub.source AND d.campaign_id IS NULL;

-- 3. Fallback to the known screenshot mapping for any sources still unlinked
--    (e.g. after the history was cleared). Matches by source name -> campaign code.
UPDATE destinations d SET campaign_id = c.id
FROM campaigns c
WHERE d.campaign_id IS NULL AND (
       (d.name = 'XXD'   AND c.code = 'C-05')
    OR (d.name = '05'    AND c.code = 'C-02')
    OR (d.name IN ('PDSO', 'Priority Y', 'AdsTerra', 'BBB', 'RGR') AND c.code = 'C-03')
    OR (d.name = 'DXTST' AND c.code = 'C-11')
);
