-- Migration 010: per-user page access control.
--
-- `permissions` is a JSONB array of page keys a NON-admin user may see, e.g.
-- ["dashboard","buyers","campaigns"]. NULL means "not customised" — the app falls back to
-- the standard non-admin page set. Admins ignore this column entirely (they see everything).
--
-- Apply with:
--   PGPASSWORD='<password>' psql -h localhost -U crm_user -d crm -f database/migrations/010_user_permissions.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB;
