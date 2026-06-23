-- CRM database schema (PostgreSQL)
-- Pay-per-call / call-forwarding CRM.
-- Run with: psql -U postgres -d crm -f database/schema.sql

-- Users / operators. This is the one table the 40-day data-retention job never
-- touches (see database/cleanup.php). Created but deliberately NOT dropped on
-- reseed so accounts survive a schema reload.
CREATE TABLE IF NOT EXISTS users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT        NOT NULL UNIQUE,
    name          TEXT,
    password_hash TEXT,
    role          TEXT        NOT NULL DEFAULT 'member',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Standalone destination directory (managed via DestinationController). Like
-- users, kept out of the reseed DROP block so the list survives a schema reload.
CREATE TABLE IF NOT EXISTS destinations (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT        NOT NULL UNIQUE,
    status      TEXT        NOT NULL DEFAULT 'active', -- active | inactive
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TABLE IF EXISTS call_records CASCADE;
DROP TABLE IF EXISTS buyers CASCADE;
DROP TABLE IF EXISTS campaigns CASCADE;

-- Buyers = customers who purchase forwarded calls (the "Destination" in the revenue table).
-- Each buyer has one definite `rate`; revenue = rate * counted (calls).
CREATE TABLE buyers (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        TEXT        NOT NULL UNIQUE,           -- e.g. "RTG 04"
    name        TEXT,                                  -- optional friendly name
    status      TEXT        NOT NULL DEFAULT 'active', -- active | inactive
    notes       TEXT,
    rate        NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (rate >= 0), -- $ per counted call
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Campaigns = media-buying campaigns that source the calls (the "Camp" in the cost table).
-- Each campaign has one definite `rate`; cost = rate * counted (calls).
CREATE TABLE campaigns (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        TEXT        NOT NULL UNIQUE,           -- e.g. "C-05"
    name        TEXT,
    status      TEXT        NOT NULL DEFAULT 'active',
    notes       TEXT,
    rate        NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (rate >= 0), -- $ per counted call
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A single daily call-volume record.
--   record_type = 'buyer'    -> revenue side  (buyer_id set, campaign_id/source null)
--   record_type = 'campaign' -> cost side     (campaign_id + source set, buyer_id null)
CREATE TABLE call_records (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    record_date  DATE        NOT NULL,
    record_type  TEXT        NOT NULL CHECK (record_type IN ('buyer', 'campaign')),
    buyer_id     BIGINT      REFERENCES buyers(id)    ON DELETE CASCADE,
    campaign_id  BIGINT      REFERENCES campaigns(id) ON DELETE CASCADE,
    source       TEXT,                                 -- traffic source for campaign rows (e.g. "AdsTerra")
    answered     INTEGER     NOT NULL DEFAULT 0 CHECK (answered >= 0),
    missed       INTEGER     NOT NULL DEFAULT 0 CHECK (missed   >= 0),
    counted      INTEGER     NOT NULL DEFAULT 0 CHECK (counted  >= 0),
    rate         NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (rate  >= 0), -- mirrors the parent buyer/campaign definite rate
    total_bill   NUMERIC(14, 2) GENERATED ALWAYS AS (counted * rate) STORED,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Enforce that the right foreign key is present for the record type.
    CONSTRAINT buyer_row_has_buyer
        CHECK (record_type <> 'buyer'    OR buyer_id    IS NOT NULL),
    CONSTRAINT campaign_row_has_campaign
        CHECK (record_type <> 'campaign' OR campaign_id IS NOT NULL)
);

CREATE INDEX idx_call_records_date        ON call_records (record_date);
CREATE INDEX idx_call_records_type        ON call_records (record_type);
CREATE INDEX idx_call_records_buyer       ON call_records (buyer_id);
CREATE INDEX idx_call_records_campaign    ON call_records (campaign_id);
CREATE INDEX idx_call_records_type_date   ON call_records (record_type, record_date);
