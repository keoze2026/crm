-- CRM database schema (PostgreSQL)
-- Pay-per-call / call-forwarding CRM.
-- Run with: psql -U postgres -d crm -f database/schema.sql

-- Users / operators. This is the one table the 40-day data-retention job never
-- touches (see database/cleanup.php). Created but deliberately NOT dropped on
-- reseed so accounts survive a schema reload.
--
-- The auth-related columns (username .. updated_at) are added by migration
-- 007_auth_totp_users.sql and power the passwordless Google-Authenticator (TOTP)
-- login. They sit dormant until the AUTH_ENABLED env flag is turned on. password_hash
-- is retained but unused by the current passwordless flow.
CREATE TABLE IF NOT EXISTS users (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email             TEXT        NOT NULL UNIQUE,
    name              TEXT,
    password_hash     TEXT,
    role              TEXT        NOT NULL DEFAULT 'member',
    username          TEXT UNIQUE,
    totp_secret       TEXT,          -- base32; NULL until enrolled
    totp_confirmed_at TIMESTAMPTZ,   -- non-null => enrolled
    enroll_token_hash TEXT,          -- sha256 of the one-time enrol token
    enroll_expires_at TIMESTAMPTZ,
    is_active         BOOLEAN     NOT NULL DEFAULT true,
    failed_attempts   INTEGER     NOT NULL DEFAULT 0,
    locked_until      TIMESTAMPTZ,
    last_login_at     TIMESTAMPTZ,
    permissions       JSONB,         -- non-admin page allowlist (migration 010); NULL => default set
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_role_chk CHECK (role IN ('admin','member','user'))
);

-- Server-side session store (migration 008). Only a hash of the cookie token is stored.
-- Like users, kept out of the reseed DROP block so sessions/accounts survive a reload.
CREATE TABLE IF NOT EXISTS sessions (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT        NOT NULL UNIQUE,
    mfa_pending  BOOLEAN     NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    ip           TEXT,
    user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- Audit trail (migration 009): who did what, when. Never pruned by the 40-day job.
CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    user_email  TEXT,
    action      TEXT        NOT NULL,
    method      TEXT,
    path        TEXT,
    entity_type TEXT,
    entity_id   BIGINT,
    details     JSONB,
    status_code INTEGER,
    ip          TEXT,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log (action);

-- Standalone destination directory (managed via DestinationController). Like
-- users, kept out of the reseed DROP block so the list survives a schema reload.
-- A destination = a traffic source on the cost side; it carries its own definite
-- `rate`, so campaign cost = SUM over its sources of (rate * counted).
CREATE TABLE IF NOT EXISTS destinations (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT        NOT NULL UNIQUE,
    status      TEXT        NOT NULL DEFAULT 'active', -- active | inactive
    rate        NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (rate >= 0), -- $ per counted call
    campaign_id BIGINT,                                -- the campaign this source belongs to
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_destinations_campaign ON destinations (campaign_id);

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
    -- Monthly Sheet "Total Calls Bought" auto-derives from call_records (SUM of counted
    -- in the selected range), so there is no stored total column on buyers.
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Campaigns = media-buying campaigns that source the calls (the "Camp" in the cost table).
-- A campaign is just a grouping of cost records; the rate lives on the destination
-- (source), not the campaign, so cost = SUM(total_bill) across the campaign's sources.
CREATE TABLE campaigns (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        TEXT        NOT NULL UNIQUE,           -- e.g. "C-05"
    name        TEXT,
    status      TEXT        NOT NULL DEFAULT 'active',
    notes       TEXT,
    -- Monthly Sheet totals, keyed in directly (independent of call_records).
    -- `cost` is the typed Total Bill; Avg Rate is derived as cost / counted.
    answered    INTEGER     NOT NULL DEFAULT 0 CHECK (answered >= 0),
    missed      INTEGER     NOT NULL DEFAULT 0 CHECK (missed   >= 0),
    counted     INTEGER     NOT NULL DEFAULT 0 CHECK (counted  >= 0),
    cost        NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
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
    replacement  INTEGER     NOT NULL DEFAULT 0 CHECK (replacement >= 0), -- display only; NOT part of total_bill
    counted      INTEGER     NOT NULL DEFAULT 0 CHECK (counted  >= 0),
    rate         NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (rate  >= 0), -- buyer rows: the buyer's rate; campaign rows: the source/destination's rate
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

-- Monthly portal (provider) expenses — powers the Portal Expenses page. Each row is
-- one provider's expenses for one month. Standalone: no call_records link, so the
-- 40-day retention job (database/cleanup.php) never touches it — data is kept
-- indefinitely (like users / destinations). `month` = first day of the month.
-- `total_amount` is stored, not derived: a row can be a flat lump sum (e.g. BYOC)
-- independent of the three component columns.
CREATE TABLE IF NOT EXISTS portal_expenses (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    month          DATE           NOT NULL,                 -- first day of the month, e.g. 2026-03-01
    name           TEXT           NOT NULL,
    voice_minutes   NUMERIC(16, 4) NOT NULL DEFAULT 0 CHECK (voice_minutes   >= 0),
    rejected_calls  NUMERIC(16, 4) NOT NULL DEFAULT 0 CHECK (rejected_calls  >= 0),
    rent_values     NUMERIC(16, 4) NOT NULL DEFAULT 0 CHECK (rent_values     >= 0),
    payout_expenses NUMERIC(16, 4) NOT NULL DEFAULT 0 CHECK (payout_expenses >= 0),  -- USD
    total_amount    NUMERIC(16, 4) NOT NULL DEFAULT 0 CHECK (total_amount    >= 0),
    sort_order     INTEGER        NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_expenses_month ON portal_expenses (month);
