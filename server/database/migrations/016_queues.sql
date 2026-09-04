-- 016_queues.sql
-- The tables behind the Queues page (/api/queues, /api/queue-people, /api/queue-codes).
-- Without them every request to those endpoints fails with:
-- relation "queue_people" does not exist.
--
-- Four tables, because the page keeps two reusable catalogues and joins them:
--   queue_people           — the NAMES catalogue you pick from (CRUD in the page's Names panel)
--   queue_codes            — the QUEUES catalogue you tick (CRUD in the page's Queues panel)
--   queue_assignments      — one record per person (a person can have at most one, hence the
--                            unique index); `created_at` is the "keyed in" date the History
--                            section groups by
--   queue_assignment_codes — which queues that record covers (the multi-select)
--
-- The sheet's TOTAL column is NOT stored: it is how many rows a record has in
-- queue_assignment_codes, so a total can never disagree with the queues shown beside it.
-- Sr. No. is likewise positional, not stored.
--
-- Renames therefore cost nothing (one row in a catalogue) and deletes clean up after
-- themselves: dropping a person removes their record (ON DELETE CASCADE), dropping a queue
-- removes it from every record that used it.
--
-- RETENTION: standalone reference tables with no call_records link, so the 40-day cleanup
-- job (database/cleanup.php) NEVER touches them — like `users` and `destinations`, their
-- data is kept indefinitely.
--
-- Safe to run multiple times. If you applied the FIRST draft of this migration (a single
-- queue_assignments table holding `name` + free-text `queues`), the DO block below upgrades
-- it in place — the names and codes you keyed in are carried across, not dropped.

CREATE TABLE IF NOT EXISTS queue_people (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per person, case-insensitively: "Camp Team" and "camp team" are the same name.
CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_people_name_ci ON queue_people (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS queue_codes (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Queue codes are identifiers ("Q04", "NB48"), so they are unique case-insensitively too.
CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_codes_code_ci ON queue_codes (upper(btrim(code)));

-- ── Upgrade path from the first draft (queue_assignments.name + .queues as free text) ──
-- Splits the old text cell on commas / spaces into catalogue rows and links, then reshapes
-- the table. Guarded on the old column, so it is a no-op on a fresh database and on re-runs.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'queue_assignments' AND column_name = 'queues'
    ) THEN
        -- Names -> catalogue.
        INSERT INTO queue_people (name)
        SELECT DISTINCT ON (lower(btrim(a.name))) btrim(a.name)
          FROM queue_assignments a
         WHERE btrim(a.name) <> ''
         ORDER BY lower(btrim(a.name))
        ON CONFLICT DO NOTHING;

        -- Codes -> catalogue (same split the page uses: commas, semicolons, slashes, spaces).
        INSERT INTO queue_codes (code)
        SELECT DISTINCT ON (upper(btrim(t.code))) btrim(t.code)
          FROM queue_assignments a,
               LATERAL regexp_split_to_table(a.queues, '[,;/|[:space:]]+') AS t(code)
         WHERE btrim(t.code) <> ''
         ORDER BY upper(btrim(t.code))
        ON CONFLICT DO NOTHING;

        ALTER TABLE queue_assignments ADD COLUMN IF NOT EXISTS person_id BIGINT;
        UPDATE queue_assignments a
           SET person_id = p.id
          FROM queue_people p
         WHERE lower(btrim(p.name)) = lower(btrim(a.name));
        DELETE FROM queue_assignments WHERE person_id IS NULL;  -- rows with a blank name

        CREATE TABLE IF NOT EXISTS queue_assignment_codes (
            assignment_id BIGINT NOT NULL REFERENCES queue_assignments (id) ON DELETE CASCADE,
            code_id       BIGINT NOT NULL REFERENCES queue_codes (id) ON DELETE CASCADE,
            PRIMARY KEY (assignment_id, code_id)
        );

        INSERT INTO queue_assignment_codes (assignment_id, code_id)
        SELECT a.id, c.id
          FROM queue_assignments a,
               LATERAL regexp_split_to_table(a.queues, '[,;/|[:space:]]+') AS t(code)
          JOIN queue_codes c ON upper(btrim(c.code)) = upper(btrim(t.code))
        ON CONFLICT DO NOTHING;

        -- A person may hold only one record from here on: merge any duplicates into the
        -- earliest row (keeping the union of their queues) before the unique index lands.
        INSERT INTO queue_assignment_codes (assignment_id, code_id)
        SELECT keep.id, ac.code_id
          FROM queue_assignment_codes ac
          JOIN queue_assignments dup  ON dup.id = ac.assignment_id
          JOIN queue_assignments keep ON keep.person_id = dup.person_id AND keep.id < dup.id
        ON CONFLICT DO NOTHING;

        DELETE FROM queue_assignments a
         USING queue_assignments b
         WHERE a.person_id = b.person_id AND a.id > b.id;

        ALTER TABLE queue_assignments DROP COLUMN IF EXISTS queues;
        ALTER TABLE queue_assignments DROP COLUMN IF EXISTS name;
        ALTER TABLE queue_assignments ALTER COLUMN person_id SET NOT NULL;
        ALTER TABLE queue_assignments
            ADD CONSTRAINT queue_assignments_person_id_fkey
            FOREIGN KEY (person_id) REFERENCES queue_people (id) ON DELETE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS queue_assignments (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    person_id  BIGINT      NOT NULL REFERENCES queue_people (id) ON DELETE CASCADE,
    sort_order INTEGER     NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- the day it was keyed in (the History date)
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_assignments_person  ON queue_assignments (person_id);
CREATE INDEX        IF NOT EXISTS idx_queue_assignments_created ON queue_assignments (created_at);

CREATE TABLE IF NOT EXISTS queue_assignment_codes (
    assignment_id BIGINT NOT NULL REFERENCES queue_assignments (id) ON DELETE CASCADE,
    code_id       BIGINT NOT NULL REFERENCES queue_codes (id) ON DELETE CASCADE,
    PRIMARY KEY (assignment_id, code_id)
);

CREATE INDEX IF NOT EXISTS idx_queue_assignment_codes_code ON queue_assignment_codes (code_id);
