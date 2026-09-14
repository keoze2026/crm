-- 029_top_performer.sql
-- Server-side storage for the Review page's Top Performer tab, so a manager's confirmations
-- are the same from any browser or location instead of living in one machine's localStorage.
--
-- Two small tables, both keyed by the month being judged (first of the month, like every
-- review row):
--
--   top_performer_months  one row per month: which of the "if applicable" criteria (8–12)
--                         are switched on, and the performance % that counts as meeting
--                         Goal Achievement. A month with no row uses the defaults.
--   top_performer_ticks   one row per person per criterion the manager has confirmed
--                         (criteria the CRM can't read from its own data — documentation,
--                         participation, feedback…). Removing someone from the roster
--                         removes their ticks.
--
-- Criterion ids are the client's vocabulary (see client/src/lib/incentive.ts), stored as
-- text so the list can grow without a migration; the API validates them.
--
-- Without it, /api/top-performer 500s with: relation "top_performer_months" does not exist.
-- Run it after 019 (it references `staff`); idempotent.

CREATE TABLE IF NOT EXISTS top_performer_months (
    month           DATE        PRIMARY KEY,
    additional      JSONB       NOT NULL DEFAULT '["goals"]'::jsonb,  -- criterion ids in play beyond 1–7
    min_performance INTEGER     NOT NULL DEFAULT 80 CHECK (min_performance BETWEEN 0 AND 100),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS top_performer_ticks (
    month        DATE        NOT NULL,
    staff_id     BIGINT      NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
    criterion    TEXT        NOT NULL,
    confirmed_by BIGINT,                                   -- users.id when auth is on; NULL otherwise
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (month, staff_id, criterion)
);

CREATE INDEX IF NOT EXISTS idx_top_performer_ticks_month ON top_performer_ticks (month);
