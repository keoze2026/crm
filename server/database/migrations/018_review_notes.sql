-- 018_review_notes.sql
-- Adds the per-person `notes` column to review_entries — the free-text remark that goes
-- with an individual's performance review ("covering two queues while X is on leave").
-- It is deliberately separate from `rating`: the rating is a dropdown value that gets
-- compared and counted, the note is prose that never does.
--
-- Without it, /api/review-entries 500s with: column "notes" does not exist.
--
-- The column exists for both kinds so a behaviour note can be turned on later without
-- another migration; today only the Performance tab shows it.
--
-- Safe to run multiple times.

ALTER TABLE review_entries
    ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
