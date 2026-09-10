-- merge_staff.sql — fold one duplicate staff row into another, losing nothing.
--
-- The Staff page's delete button CASCADES: it takes the person's salaries, leaves, queue
-- row, departments and attendance overrides with them. That is right for a row created by
-- mistake, and wrong for a duplicate somebody has been filing real work against — which is
-- what the two |Department|-tagged pairs on production turned out to be.
--
-- So this MOVES everything onto the row you are keeping first, and only then removes the
-- shell. Reviews are repointed rather than moved: review_entries.staff_id is ON DELETE SET
-- NULL beside a stored person_name, so a review never disappears either way, but repointing
-- keeps it attached to the person.
--
-- USAGE — set the two ids, then run the whole file:
--     psql ... -v keep=49 -v absorb=48 -f merge_staff.sql
--
--   keep    the row that survives — normally the one holding attendance_user_id
--   absorb  the duplicate, deleted at the end
--
-- It runs in ONE transaction and prints, at the end, anything that could not be moved
-- because the keeper already had it (a salary for the same month, say). Read that list:
-- it is exactly what the final DELETE would destroy. Nothing is committed until you say so.

\set ON_ERROR_STOP on
BEGIN;

\echo ''
\echo '=== The two rows ==='
SELECT id, name, COALESCE(attendance_user_id, '(none)') AS account
  FROM staff WHERE id IN (:keep, :absorb) ORDER BY (id = :keep) DESC;

-- The check-in account, if the keeper hasn't got one. Cleared from the duplicate first:
-- attendance_user_id is unique, so the two rows may never hold it at the same instant.
SELECT COALESCE((SELECT attendance_user_id FROM staff WHERE id = :absorb), '') AS moved_account \gset
UPDATE staff SET attendance_user_id = NULL WHERE id = :absorb;
UPDATE staff SET attendance_user_id = NULLIF(:'moved_account', ''), updated_at = now()
 WHERE id = :keep AND attendance_user_id IS NULL;

-- Departments: add the ones the keeper lacks. PK is (staff_id, department_id).
INSERT INTO staff_departments (staff_id, department_id)
SELECT :keep, department_id FROM staff_departments WHERE staff_id = :absorb
ON CONFLICT DO NOTHING;

-- Reviews: no uniqueness, so every one moves.
UPDATE review_entries SET staff_id = :keep WHERE staff_id = :absorb;

-- Leaves: no uniqueness either.
UPDATE staff_leaves SET staff_id = :keep WHERE staff_id = :absorb;

-- Salaries: one row per person per month, so only months the keeper is missing can move.
UPDATE staff_salaries SET staff_id = :keep, updated_at = now()
 WHERE staff_id = :absorb
   AND month NOT IN (SELECT month FROM staff_salaries WHERE staff_id = :keep);

-- Attendance overrides: one per person per day, same rule.
UPDATE staff_attendance SET staff_id = :keep, updated_at = now()
 WHERE staff_id = :absorb
   AND work_date NOT IN (SELECT work_date FROM staff_attendance WHERE staff_id = :keep);

-- Queue rows: one per person per board, same rule. Their codes follow the row.
UPDATE queue_assignments SET person_id = :keep
 WHERE person_id = :absorb
   AND board NOT IN (SELECT board FROM queue_assignments WHERE person_id = :keep);

-- A login account, if the keeper hasn't one (users.staff_id is unique where not null).
UPDATE users SET staff_id = :keep
 WHERE staff_id = :absorb AND NOT EXISTS (SELECT 1 FROM users WHERE staff_id = :keep);

\echo ''
\echo '=== Could NOT be moved - the DELETE below would destroy these ==='
\echo '=== (no rows = everything moved, safe to COMMIT)             ==='
SELECT 'salary'             AS kind, to_char(month, 'YYYY-MM') AS detail FROM staff_salaries   WHERE staff_id  = :absorb
UNION ALL SELECT 'attendance day', work_date::text              FROM staff_attendance WHERE staff_id  = :absorb
UNION ALL SELECT 'queue row',      board                        FROM queue_assignments WHERE person_id = :absorb
UNION ALL SELECT 'login account',  username                     FROM users            WHERE staff_id  = :absorb
ORDER BY 1, 2;

DELETE FROM staff WHERE id = :absorb;

\echo ''
\echo '=== The surviving row ==='
SELECT s.id, s.name, COALESCE(s.attendance_user_id, '(none)') AS account,
       (SELECT count(*) FROM staff_departments d WHERE d.staff_id = s.id) AS departments,
       (SELECT count(*) FROM staff_salaries   p WHERE p.staff_id = s.id) AS salary_rows,
       (SELECT count(*) FROM staff_leaves     l WHERE l.staff_id = s.id) AS leave_rows,
       (SELECT count(*) FROM review_entries   r WHERE r.staff_id = s.id) AS reviews,
       (SELECT count(*) FROM queue_assignments q WHERE q.person_id = s.id) AS queue_rows
  FROM staff s WHERE s.id = :keep;

\echo ''
\echo '>>> Nothing is saved yet. Type  COMMIT;  to keep it, or  ROLLBACK;  to undo. <<<'
