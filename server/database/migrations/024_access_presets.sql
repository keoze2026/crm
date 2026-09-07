-- 024_access_presets.sql
-- Named page-access presets ("Agent", "Team lead", "Finance", …) that an admin picks when
-- creating a user, instead of ticking the same boxes by hand every time.
--
-- SUPERSEDED BY 025: this migration originally shipped presets as one-shot templates (copied
-- onto an account at creation). 025 adds users.preset_id and makes them live, so editing a
-- preset changes what its members can open. The table below is unchanged either way — only
-- the meaning of "applying" a preset moved. Apply 025 straight after this one.
--
-- `pages` holds page keys from App\Auth\Pages::ALL. It is sanitised against that list on
-- every write, so a preset can never grant a page the app doesn't know about, and a key
-- retired from the app simply stops appearing.
--
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS access_presets (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       TEXT        NOT NULL,
    pages      JSONB       NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One preset per name, compared the way a person would read it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_presets_name_ci
    ON access_presets (lower(btrim(name)));
