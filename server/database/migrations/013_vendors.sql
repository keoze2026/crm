-- 013_vendors.sql
-- Adds the two tables behind the Vendors page (/api/vendors + /api/vendor-payments):
-- a per-traffic-source payment ledger. Without them every request to those endpoints
-- fails with: relation "vendors" does not exist.
--
-- A "vendor" is a traffic source. The set of tabs on the page is the union of the
-- distinct campaign sources (call_records.source where record_type='campaign') and the
-- rows in `vendors` below. So `vendors` only needs rows for (a) manually-added vendors
-- that aren't in Campaigns, and (b) a hand-entered Due/Advance balance for any vendor.
-- Everything is keyed by NAME (matching the campaign `source` strings), not a foreign key.
--
-- `vendor_payments` holds the dated ledger rows (one page row = one entry). The "Payments"
-- column shown in the UI is NOT stored — it is always derived as converted_calls * price.
--
-- RETENTION: both are standalone reference tables with no call_records link, so the 40-day
-- cleanup job (database/cleanup.php) NEVER touches them — like `users`, `destinations` and
-- `portal_expenses`, their data is kept indefinitely.
--
-- Safe to run multiple times.

-- Vendor metadata: manual vendors + a hand-entered Due/Advance balance for any vendor.
CREATE TABLE IF NOT EXISTS vendors (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT           NOT NULL,
    is_manual   BOOLEAN        NOT NULL DEFAULT false,   -- true = added via the "+" tab (not in Campaigns)
    manual_due  NUMERIC(16, 2) NOT NULL DEFAULT 0,       -- signed balance: positive = Due (red), negative = Advance (green)
    sort_order  INTEGER        NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- One vendor row per name, case/space-insensitive, so a discovered source and its
-- Due/Advance balance reconcile regardless of capitalisation or padding.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_name_ci ON vendors (lower(btrim(name)));

-- Dated ledger rows. Multiple rows per (vendor, date) are allowed.
CREATE TABLE IF NOT EXISTS vendor_payments (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vendor          TEXT           NOT NULL,                 -- the traffic-source name (matches vendors.name)
    entry_date      DATE           NOT NULL,
    converted_calls INTEGER        NOT NULL DEFAULT 0 CHECK (converted_calls >= 0),
    price           NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (price           >= 0),  -- USD per converted call
    amount_paid     NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (amount_paid     >= 0),  -- USD actually paid
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_payments_vendor ON vendor_payments (vendor);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_date   ON vendor_payments (entry_date);
