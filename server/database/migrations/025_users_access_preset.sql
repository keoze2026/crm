-- 025_users_access_preset.sql
-- Turn access presets from templates into LIVE links.
--
-- Until now (024) a preset was copied onto an account at creation and the copy was the end of
-- it. An account may now be *attached* to a preset instead: the preset's page list is what it
-- can open, so adding a page to the preset grants it to everyone on that preset the next time
-- they load the app — no per-user edit, no re-issued link.
--
-- HOW ACCESS RESOLVES, in order:
--   1. role = 'admin'         every page, always — a preset never applies
--   2. users.preset_id set    the preset's pages (its own users.permissions is ignored)
--   3. users.permissions set  that list, as before
--   4. neither                Pages::DEFAULT_USER
-- Every query that loads a user resolves this with COALESCE(preset.pages, users.permissions),
-- so the backend gate and the sidebar can never disagree about what somebody can open.
--
-- ATTACHING clears users.permissions, so there is exactly one answer to "where does this
-- account's access come from" rather than a stale list shadowing the live one.
--
-- DELETING a preset copies its pages back onto its members' users.permissions first (see
-- AccessPresetController::destroy) — the FK below would otherwise null the link and silently
-- promote them to DEFAULT_USER, which grants MORE than the preset did.
--
-- REQUIRES: 024_access_presets.sql.
-- Safe to run multiple times.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'access_presets'
    ) THEN
        RAISE EXCEPTION 'Migration 025 needs table "access_presets" — apply 024_access_presets.sql first.';
    END IF;
END$$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS preset_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_preset_id_fkey') THEN
        ALTER TABLE users
            ADD CONSTRAINT users_preset_id_fkey
            FOREIGN KEY (preset_id) REFERENCES access_presets(id) ON DELETE SET NULL;
    END IF;
END$$;

-- Used to list a preset's members when it is edited or deleted.
CREATE INDEX IF NOT EXISTS idx_users_preset_id ON users (preset_id) WHERE preset_id IS NOT NULL;
