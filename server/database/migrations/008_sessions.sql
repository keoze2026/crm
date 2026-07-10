-- Migration 008: server-side session store for the auth system.
--
-- Opaque token sessions: only a SHA-256 hash of the cookie token is stored, never the raw
-- token. A row starts with mfa_pending=true after the identifier step and is upgraded (the
-- token is rotated) once the TOTP code is verified. Safe to run on the live database.
--
-- Apply with:
--   PGPASSWORD='<password>' psql -h localhost -U crm_user -d crm -f database/migrations/008_sessions.sql

CREATE TABLE IF NOT EXISTS sessions (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT        NOT NULL UNIQUE,        -- sha256 hex of the raw cookie token
    mfa_pending  BOOLEAN     NOT NULL DEFAULT true,  -- true after identifier step, before TOTP
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    ip           TEXT,
    user_agent   TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
