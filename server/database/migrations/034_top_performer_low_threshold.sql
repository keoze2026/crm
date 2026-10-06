-- 034_top_performer_low_threshold.sql
-- The Top Performer tab's Low performer threshold: the performance % (the Percentage on the
-- Review page's Performance tab) under which a reviewed person wears the red Low badge for
-- the month. It sits beside min_performance, the Goal Achievement target, and is set per
-- month the same way.
--
-- The manager's own Low marks need no column: they are kept with the month's ticks in
-- top_performer_ticks, as the ids 'low' (marked low) and 'not-low' (cleared of it).
--
-- Until this runs, /api/top-performer answers the default (40) and saves the month without
-- it — nothing breaks, the threshold just doesn't stick. Run it after 029; idempotent.

ALTER TABLE top_performer_months
    ADD COLUMN IF NOT EXISTS low_performance INTEGER NOT NULL DEFAULT 40
        CHECK (low_performance BETWEEN 0 AND 100);
