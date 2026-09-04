-- 021_break_override.sql
-- Lets the break minutes be corrected on ANY attendance day, including the ones the
-- check-in bot recorded, and makes that correction show up on the Attendance page too.
--
-- The bot's tables stay read-only. Instead, a `staff_attendance` row for a day the bot
-- already recorded becomes an OVERRIDE: its login/logout are ignored (those still come
-- from the bot) and only its `break_min` is used. That is why the column becomes
-- nullable — NULL now means "no override", which is different from an override of 0.
--
-- Everything that totals a break — the Staff page's attendance sheet, the Attendance
-- page's roster, its day list, its break detail and its over-break exceptions — reads
-- COALESCE(override, bot, 0), so one edit moves every one of them together.
--
-- Deleting the override row restores the bot's own figure, so nothing is ever lost.
--
-- Safe to run multiple times.

ALTER TABLE staff_attendance ALTER COLUMN break_min DROP NOT NULL;

COMMENT ON COLUMN staff_attendance.break_min IS
    'Break minutes. NULL = no override: use the check-in bot''s own total for the day.';

-- The Attendance page joins this from the bot's side (user id -> staff -> day), so both
-- halves of that lookup want an index.
CREATE INDEX IF NOT EXISTS idx_staff_attendance_staff_date
    ON staff_attendance (staff_id, work_date);
