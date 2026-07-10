-- Migration 007: extend the users table for passwordless Google-Authenticator (TOTP) auth.
--
-- Adds TOTP enrolment, one-time enrolment tokens, activation, login rate-limiting and
-- audit timestamps. Safe to run on the live database (only ADD COLUMN IF NOT EXISTS, no
-- data touched). Like the base users table, nothing here is ever removed by the 40-day
-- retention job (database/cleanup.php).
--
-- The whole auth system is gated behind the AUTH_ENABLED env flag; these columns sit
-- dormant until that flag is turned on.
--
-- Apply with:
--   PGPASSWORD='<password>' psql -h localhost -U crm_user -d crm -f database/migrations/007_auth_totp_users.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS username          TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret       TEXT;          -- base32; NULL until enrolled
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_confirmed_at TIMESTAMPTZ;   -- non-null => enrolled
ALTER TABLE users ADD COLUMN IF NOT EXISTS enroll_token_hash TEXT;          -- sha256 of the one-time enrol token
ALTER TABLE users ADD COLUMN IF NOT EXISTS enroll_expires_at TIMESTAMPTZ;   -- enrol token expiry
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active         BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until      TIMESTAMPTZ;   -- login rate-limit lock
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at     TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT now();

-- Constrain role to the values the app understands. NOT VALID so it applies to new/updated
-- rows without failing on any pre-existing data.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_role_chk'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_role_chk CHECK (role IN ('admin','member','user')) NOT VALID;
    END IF;
END$$;
