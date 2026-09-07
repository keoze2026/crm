-- 023_users_optional_email.sql
-- Let an account be created without an email address.
--
-- WHY: not everyone on the roster has a work email, but everyone needs a way in. An account
-- can now be identified by an email, by a username, or by both — and a username-only account
-- is created either by typing the username or by picking someone off the Staff page roster.
-- Login already accepted either form (AuthController::findByIdentifier matches email OR
-- username), so this only opens up account *creation*.
--
-- WHAT CHANGES:
--   users.email        loses NOT NULL — it is now optional, not absent
--   users.staff_id     new, nullable FK to the Staff roster. Set when the account was made
--                      by picking a staff member, so the Users page can show who already has
--                      one and refuse to make a second. ON DELETE SET NULL: removing someone
--                      from the roster must not silently delete their login
--   idx_users_username_ci   usernames are compared case-insensitively at login, so they have
--                      to be unique that way too — without this, "Bob" and "bob" can both
--                      exist and the login lookup (LIMIT 1) picks one arbitrarily
--   users_identifier_chk    an account with neither email nor username could never log in
--
-- REQUIRES: 019_staff_management.sql (the staff table).
-- Safe to run multiple times.

-- Fail with something readable rather than a bare FK error if the roster isn't there yet.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'staff'
    ) THEN
        RAISE EXCEPTION 'Migration 023 needs table "staff" — apply 019_staff_management.sql first.';
    END IF;
END$$;

ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_staff_id_fkey') THEN
        ALTER TABLE users
            ADD CONSTRAINT users_staff_id_fkey
            FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE SET NULL;
    END IF;
END$$;

-- One login per person on the roster.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_staff_id
    ON users (staff_id) WHERE staff_id IS NOT NULL;

-- Case-insensitive username uniqueness, to match how login resolves an identifier.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_ci
    ON users (lower(username)) WHERE username IS NOT NULL;

-- Every account must keep at least one usable identifier. NOT VALID so it governs new and
-- updated rows without failing on anything already stored.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_identifier_chk') THEN
        ALTER TABLE users
            ADD CONSTRAINT users_identifier_chk
            CHECK (email IS NOT NULL OR username IS NOT NULL) NOT VALID;
    END IF;
END$$;
