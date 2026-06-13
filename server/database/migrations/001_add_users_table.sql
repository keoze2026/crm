-- Migration 001: add the users table for future authentication.
--
-- Safe to run on the live database (does not touch existing data). The 40-day
-- data-retention job (database/cleanup.php) deliberately never deletes from this
-- table, so anything stored here survives the rolling cleanup.
--
-- Apply with:
--   PGPASSWORD='<password>' psql -h localhost -U crm_user -d crm -f database/migrations/001_add_users_table.sql

CREATE TABLE IF NOT EXISTS users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT        NOT NULL UNIQUE,
    name          TEXT,
    password_hash TEXT,
    role          TEXT        NOT NULL DEFAULT 'member',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
