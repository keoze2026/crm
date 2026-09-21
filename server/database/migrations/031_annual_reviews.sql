-- 031_annual_reviews.sql
-- The Review page's fifth tab, Annual Reviews: the half-yearly (6 month) and yearly
-- (12 month) roll-ups, and the top/lowest performer each period names.
--
-- Nothing that CAN be accumulated is stored here. A period's figures are added up from the
-- monthly review rows, the attendance/leaves sheets and the saved Top Performer ticks the
-- other tabs already hold, exactly the way the monthly tab scores a month — so a rating
-- corrected on the Performance tab moves the yearly roll-up too, with nothing to re-run.
--
-- What IS stored is only what a manager put there BY HAND, on top of the accumulation:
--
--   annual_review_sheets    one row per period: the cells typed in over a computed value,
--                           rows added for somebody the period's reviews don't produce, and
--                           the minimum months a person must have been reviewed in before
--                           the period will name them top or lowest.
--   annual_review_versions  append-only history of that same state, one row per save. This
--                           is what the sheet's Reset button reads: it restores the most
--                           recent version SAVED MORE THAN 24 HOURS AGO, so a day of edits
--                           can be dropped in one go while yesterday's agreed sheet stands.
--                           The restore is itself appended, so resetting is never a dead end.
--
-- A period is identified by its span and its LAST month — ('year', 2026-09-01) is the twelve
-- months to September 2026 — because that is how the page picks one: the month selector
-- chooses the month the window ends on. Stored as the first of that month, like every other
-- review date in this schema.
--
-- The JSONB documents are deliberately documents rather than tables: a sheet of typed-in
-- cells is edited as a whole, read as a whole, and versioned as a whole. Their shape is the
-- client's (client/src/lib/annualReview.ts) and the API validates it on the way in.
--
-- RETENTION: no call_records link, so the 40-day cleanup job (database/cleanup.php) NEVER
-- touches these. Sheets are kept indefinitely; the version history is pruned to the newest
-- 200 saves per period by the API, which is far more than 24 hours of editing.
--
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS annual_review_sheets (
    span        TEXT        NOT NULL CHECK (span IN ('half', 'year')),
    period_end  DATE        NOT NULL,                      -- first of the LAST month in the window
    overrides   JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- row key -> column id -> typed text
    extra_rows  JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- [{key, name}] added by hand
    settings    JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- {min_months}
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (span, period_end)
);

CREATE TABLE IF NOT EXISTS annual_review_versions (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    span        TEXT        NOT NULL,
    period_end  DATE        NOT NULL,
    overrides   JSONB       NOT NULL,
    extra_rows  JSONB       NOT NULL,
    settings    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- users.id when auth is on, NULL otherwise. Not a foreign key: the history must outlive
    -- the account that wrote it, the way review rows outlive a renamed staff member.
    saved_by    BIGINT,
    saved_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reset's one question — "the newest save older than 24 hours for this period" — answered
-- from the index rather than by scanning the history.
CREATE INDEX IF NOT EXISTS idx_annual_review_versions_period
    ON annual_review_versions (span, period_end, saved_at DESC);
