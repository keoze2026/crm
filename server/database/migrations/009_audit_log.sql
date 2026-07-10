-- Migration 009: audit trail — "who did what, when" for accountability.
--
-- One row per authenticated mutating request (POST/PUT/PATCH/DELETE) plus auth events
-- (login, logout, enrol). Written centrally from the router choke point in public/index.php.
-- user_email is a denormalized snapshot so the trail survives a user being deleted.
--
-- Retention: deliberately NOT pruned by the 40-day job (database/cleanup.php) — audit
-- trails should outlive operational data.
--
-- Apply with:
--   PGPASSWORD='<password>' psql -h localhost -U crm_user -d crm -f database/migrations/009_audit_log.sql

CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT      REFERENCES users(id) ON DELETE SET NULL,  -- NULL for anon/failed attempts
    user_email  TEXT,                                 -- denormalized snapshot (survives user delete)
    action      TEXT        NOT NULL,                 -- 'buyer.update','auth.login','record.delete'
    method      TEXT,
    path        TEXT,
    entity_type TEXT,                                 -- 'buyer' | 'campaign' | 'record' | ...
    entity_id   BIGINT,                               -- parsed from the route param when present
    details     JSONB,                                -- request body with secrets stripped
    status_code INTEGER,                              -- HTTP status actually sent
    ip          TEXT,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log (action);
