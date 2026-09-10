-- 028_relink_attendance_accounts.sql
--
-- Re-resolves every staff row that has NO check-in account against the bot's roster, using
-- the more tolerant name matching added alongside it in StaffController::linkSql().
--
-- Why it is needed: the two systems are joined on the person's NAME and nothing else, so a
-- name that reads identically to a human but differs by a byte leaves that person's fetched
-- attendance stranded — the days exist in attendance_days but no page can show them, and
-- their attendance has to be keyed in by hand for no reason. Three shapes of that turned up
-- on production:
--
--   * a |Department| tag the bot appends   — CRM "Zack Brown"  vs bot "Zack Brown |Audit|"
--   * punctuation                          — CRM "F.5"         vs bot "F 5"
--   * an invisible character               — a non-breaking space or a doubled space
--
-- All three are the same name; the matcher now folds them together. What it deliberately
-- does NOT do is correct spelling: "Denis Flavio" still will not match "Deniis Flavio",
-- because guessing at a letter risks hanging one person's attendance on another person's
-- record. Those are renamed by hand on the Staff page — see the report at the end.
--
-- SAFETY
--   * Only rows where attendance_user_id IS NULL are touched, so a link already made (or
--     made by hand) is never re-pointed.
--   * An account another staff row already holds is skipped, so a duplicate staff row can
--     never steal the days off the row that already has them.
--   * Nothing is written to the bot's tables, and no attendance row is created or changed —
--     only the pointer on `staff`.
--   * Guarded on the bot's tables existing, and idempotent: a second run links nothing new.

DO $$
DECLARE
    before_n int;
    after_n  int;
BEGIN
    IF to_regclass('public.attendance_staff') IS NULL THEN
        RAISE NOTICE 'attendance_staff not present - nothing to link, skipping';
        RETURN;
    END IF;

    SELECT count(*) INTO before_n FROM staff WHERE attendance_user_id IS NULL;

    UPDATE staff s
       SET attendance_user_id = (
               SELECT a.user_id::text
                 FROM attendance_staff a
                WHERE (lower(a.staff_name) = lower(btrim(s.name))
                    OR lower(a.username)   = lower(btrim(s.name))
                    OR a.user_id::text     = btrim(s.name)
                    OR (btrim(regexp_replace(lower(regexp_replace(s.name, '\|[^|]*\|', ' ', 'g')), '[^a-z0-9]+', ' ', 'g')) <> ''
                        AND (btrim(regexp_replace(lower(regexp_replace(a.staff_name, '\|[^|]*\|', ' ', 'g')), '[^a-z0-9]+', ' ', 'g'))
                             = btrim(regexp_replace(lower(regexp_replace(s.name, '\|[^|]*\|', ' ', 'g')), '[^a-z0-9]+', ' ', 'g'))
                          OR btrim(regexp_replace(lower(regexp_replace(a.username, '\|[^|]*\|', ' ', 'g')), '[^a-z0-9]+', ' ', 'g'))
                             = btrim(regexp_replace(lower(regexp_replace(s.name, '\|[^|]*\|', ' ', 'g')), '[^a-z0-9]+', ' ', 'g')))))
                  AND NOT EXISTS (
                      SELECT 1 FROM staff x
                       WHERE x.attendance_user_id = a.user_id::text AND x.id <> s.id
                  )
                ORDER BY (lower(a.staff_name) = lower(btrim(s.name))) DESC,
                         (lower(a.username)   = lower(btrim(s.name))) DESC,
                         a.user_id
                LIMIT 1
           ),
           updated_at = now()
     WHERE s.attendance_user_id IS NULL;

    SELECT count(*) INTO after_n FROM staff WHERE attendance_user_id IS NULL;

    RAISE NOTICE '% staff row(s) newly linked to a check-in account; % still without one',
                 before_n - after_n, after_n;
    RAISE NOTICE 'The report below says what to do about each one that is left.';
END $$;

-- The report. Everyone still without an account, and WHY — because the three causes need
-- three different fixes and they are easy to confuse:
--
--   SPELLING   the bot holds days under a name close to this one. Correct the name on the
--              Staff page to match the bot exactly; saving re-runs the link.
--   DUPLICATE  another staff row already holds this person's account. This row is a second
--              copy of them; delete it (check first that it carries no queue or leave rows).
--   NO ACCOUNT they simply do not clock in. Nothing to fix — their days are keyed in by hand.
SELECT s.name                                          AS "Still unlinked",
       CASE WHEN dup.name IS NOT NULL THEN 'DUPLICATE'
            WHEN n.staff_name IS NOT NULL THEN 'SPELLING'
            ELSE 'NO ACCOUNT' END                      AS "Why",
       COALESCE(dup.name, n.staff_name, '')            AS "The row/name that has it",
       COALESCE(n.days::text, '')                      AS "Days waiting"
  FROM staff s
  -- Another staff row whose name is the same once tags and punctuation are folded away.
  LEFT JOIN LATERAL (
       SELECT x.name FROM staff x
        WHERE x.id <> s.id AND x.attendance_user_id IS NOT NULL
          AND btrim(regexp_replace(lower(regexp_replace(x.name, '\|[^|]*\|', ' ', 'g')), '[^a-z0-9]+', ' ', 'g'))
            = btrim(regexp_replace(lower(regexp_replace(s.name, '\|[^|]*\|', ' ', 'g')), '[^a-z0-9]+', ' ', 'g'))
        LIMIT 1
  ) dup ON TRUE
  -- An unclaimed bot account whose name is close: same first three letters, length within
  -- two. Enough to surface a doubled or dropped letter without pretending to be fuzzy search.
  LEFT JOIN LATERAL (
       SELECT a.staff_name,
              (SELECT count(*) FROM attendance_days d WHERE d.user_id = a.user_id) AS days
         FROM attendance_staff a
        WHERE NOT EXISTS (SELECT 1 FROM staff x WHERE x.attendance_user_id = a.user_id::text)
          AND lower(left(btrim(a.staff_name), 3)) = lower(left(btrim(s.name), 3))
          AND abs(length(btrim(a.staff_name)) - length(btrim(s.name))) <= 2
        ORDER BY abs(length(btrim(a.staff_name)) - length(btrim(s.name)))
        LIMIT 1
  ) n ON TRUE
 WHERE s.attendance_user_id IS NULL
 ORDER BY (dup.name IS NULL AND n.staff_name IS NULL), lower(btrim(s.name));
