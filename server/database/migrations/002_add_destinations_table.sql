-- 002_add_destinations_table.sql
-- Adds the standalone "destinations" table required by DestinationController
-- (the /api/destinations CRUD and the destination dropdowns). Without it every
-- request to /api/destinations fails with: relation "destinations" does not exist.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS destinations (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT        NOT NULL UNIQUE,
    status      TEXT        NOT NULL DEFAULT 'active', -- active | inactive
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
