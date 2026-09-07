-- 022_queue_boards.sql
-- Two changes to the Queues page:
--
--   1. QUEUE CHIPS CARRY THEIR OWN ORDER. `queue_assignment_codes.sort_order` is the
--      position of a queue inside one person's row, so the chips can be dragged into the
--      order the team actually works them rather than being stuck alphabetically. Existing
--      rows are backfilled in the alphabetical order they are showing today, so nothing
--      moves on the first load.
--
--   2. THE SHEET IS SPLIT IN TWO. `queue_assignments.board` separates the Forwarding
--      Queues sheet from the new Camp & Flow Queues sheet. Everything already keyed in is
--      Forwarding, which is what the page has always been.
--
--      A discriminator rather than a second pair of tables: the two sheets are the same
--      sheet with different rows, so one column keeps one code path — one controller, one
--      component, one migration — while the data stays completely separate. Nothing on one
--      board can appear on the other; every query is filtered by it.
--
--      The "one record per person" rule becomes per board, so the same person can hold a
--      row on both sheets.
--
-- The queue CODE catalogue stays shared: a code is a code, and both sheets pick from the
-- same list.
--
-- Safe to run multiple times.

-- ── 1. Per-row chip order ───────────────────────────────────────────────────────

-- Guarded on the column being new, so a re-run can never reset an order someone has
-- since dragged into place.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'queue_assignment_codes'
                      AND column_name = 'sort_order') THEN

        ALTER TABLE queue_assignment_codes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

        -- Freeze today's alphabetical order as the starting point.
        UPDATE queue_assignment_codes ac
           SET sort_order = ranked.position
          FROM (
              SELECT ac2.assignment_id,
                     ac2.code_id,
                     ROW_NUMBER() OVER (
                         PARTITION BY ac2.assignment_id
                         ORDER BY upper(btrim(c.code))
                     ) - 1 AS position
                FROM queue_assignment_codes ac2
                JOIN queue_codes c ON c.id = ac2.code_id
          ) AS ranked
         WHERE ranked.assignment_id = ac.assignment_id
           AND ranked.code_id = ac.code_id;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_queue_assignment_codes_order
    ON queue_assignment_codes (assignment_id, sort_order);

-- ── 2. Two boards ───────────────────────────────────────────────────────────────

ALTER TABLE queue_assignments
    ADD COLUMN IF NOT EXISTS board TEXT NOT NULL DEFAULT 'forwarding';

-- Anything unrecognised falls back to the original sheet rather than failing the check.
UPDATE queue_assignments SET board = 'forwarding' WHERE board NOT IN ('forwarding', 'camp_flow');

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'queue_assignments_board_check') THEN
        ALTER TABLE queue_assignments
            ADD CONSTRAINT queue_assignments_board_check
            CHECK (board IN ('forwarding', 'camp_flow'));
    END IF;
END $$;

-- One record per person PER BOARD — the same person may cover queues on both sheets.
DROP INDEX IF EXISTS idx_queue_assignments_person;
CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_assignments_board_person
    ON queue_assignments (board, person_id);

CREATE INDEX IF NOT EXISTS idx_queue_assignments_board ON queue_assignments (board);
