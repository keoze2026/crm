-- 020_staff_status.sql
-- Two follow-ups to 019, both requested by the client:
--
--   1. A staff member is no longer just active/not. They are ACTIVE, INACTIVE or on LEAVE,
--      which the Staff page colour-codes. `is_active` becomes `status` — backfilled, then
--      dropped, so there is only ever one source of truth for it.
--   2. The department list is corrected: "Client Care" is called "Agents", and
--      "Internal software" is not a department at all.
--
-- Safe to run multiple times, and safe to run before 019's page ships.

-- ── 1. active / inactive / leave ────────────────────────────────────────────────

ALTER TABLE staff ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'staff'
                  AND column_name = 'is_active') THEN
        UPDATE staff SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END;
        ALTER TABLE staff DROP COLUMN is_active;
    END IF;
END $$;

-- Anything unrecognised falls back to 'active' rather than failing the constraint below.
UPDATE staff SET status = 'active' WHERE status NOT IN ('active', 'inactive', 'leave');

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_status_check') THEN
        ALTER TABLE staff
            ADD CONSTRAINT staff_status_check CHECK (status IN ('active', 'inactive', 'leave'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_staff_status ON staff (status);

-- ── 2. Department corrections ───────────────────────────────────────────────────
-- Renaming keeps the id, so everyone already filed under Client Care — and every review
-- written under that band — stays exactly where they are.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM departments WHERE lower(btrim(name)) = 'client care')
       AND NOT EXISTS (SELECT 1 FROM departments WHERE lower(btrim(name)) = 'agents') THEN
        UPDATE departments
           SET name = 'Agents', updated_at = now()
         WHERE lower(btrim(name)) = 'client care';
    END IF;
END $$;

-- Cascades its staff links and monthly scores; reviews written under it resurface under
-- "No department" rather than being deleted (review_entries.department_id is SET NULL).
DELETE FROM departments WHERE lower(btrim(name)) = 'internal software';
