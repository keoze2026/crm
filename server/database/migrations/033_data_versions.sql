-- 033_data_versions.sql
-- Live updates: one change counter per area of the app, so an open page can learn that
-- somebody else saved something without re-reading everything on a timer.
--
-- Every successful POST/PUT/PATCH/DELETE bumps the counter of the area its path belongs to
-- (App\Changes, from a shutdown hook in public/index.php — the same choke point the audit
-- trail uses, so a new controller can never forget to). Browsers poll GET /api/changes
-- every few seconds and re-read only the data whose area moved.
--
-- The check-in bot writes attendance_days / attendance_breaks directly, so no hook ever
-- sees its changes; /changes fingerprints those tables instead of counting them.
--
-- Without it the app still works: /changes answers `tracking: false` and the browser falls
-- back to re-reading the page every 30 seconds.
--
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS data_versions (
    area       TEXT        PRIMARY KEY,
    version    BIGINT      NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
