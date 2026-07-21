# CallFlow CRM

A pay-per-call / call-forwarding CRM. Team members enter daily call volumes for
**buyers** (the revenue side — calls sold/forwarded to customers) and
**campaigns** (the cost side — media-buying campaigns that source the calls).
The difference between the two is the **gross margin**.

- **client/** — React + TypeScript + Tailwind CSS + Recharts (Vite)
- **server/** — PHP REST API + PostgreSQL (PDO)
- Theme: blue-600 / white
- **Auth (optional):** passwordless Google-Authenticator (TOTP) login, admin/user
  roles, per-user page access, and an audit log — all behind the `AUTH_ENABLED`
  flag (off by default). See [Authentication](#authentication-optional).

## Features

- **Dashboard** — KPI cards (revenue, cost, margin, counted calls) with
  period-over-period deltas; revenue/cost/margin trend (day / month / year);
  most-active-buyers chart; answered-vs-missed trend; top traffic sources.
- **Call Records** — fast data entry for both record types, inline computed
  total bill, filters (type, date range, buyer, campaign, source search),
  sortable columns, pagination, and CSV export of the filtered set.
- **Buyers / Campaigns** — card views with per-entity revenue/cost, answer
  rate, record counts and last activity; create / edit / delete.
- **Vendors** — per-traffic-source payment sheets, one tab per traffic source
  (auto-discovered from campaigns, plus a **+** tab to add vendors by hand). Each
  tab is a manual dated ledger — Date · Traffic Source (auto) · Converted call ·
  Price · **Payments** (auto = calls × price) · Amount paid — with auto totals, an
  **Average calls a day** (Σ converted ÷ weekdays in range), and a hand-entered,
  colour-coded **Due / Advance** balance (red = due, green = advance). One
  top-level date-range filter drives every tab.
- **Portal Expenses** — monthly per-provider expense sheet (voice minutes,
  rejected calls, rent values, payout expenses) with an auto-or-override Total
  Amount and per-provider charts.
- **Reports** — monthly breakdown, top buyers / campaigns / sources, and
  downloadable CSV reports.
- **Authentication & access control (optional)** — passwordless login via the
  Google Authenticator app (TOTP), httpOnly cookie sessions, `admin` / `user`
  roles, admin-managed accounts with QR enrolment links, per-user page
  visibility, and a filterable/exportable **audit log** of who did what and when.
  Entirely gated by `AUTH_ENABLED` (default off).

## Data model

| Table             | Purpose                                                            |
| ----------------- | ----------------------------------------------------------------- |
| `buyers`          | Customers who buy forwarded calls (revenue). e.g. `RTG 04`.       |
| `campaigns`       | Media-buying campaigns that source calls (cost). e.g. `C-05`.     |
| `call_records`    | One daily row: date, type, answered/missed/counted, rate.         |
| `portal_expenses` | Monthly per-provider expenses (Portal Expenses page). Standalone. |
| `vendors`         | Traffic-source metadata: manual vendors + Due/Advance balance.    |
| `vendor_payments` | Dated per-vendor ledger rows (Vendors page). Standalone.          |

`call_records.total_bill` is a generated column (`counted * rate`).
A `record_type` of `buyer` links to a buyer (revenue); `campaign` links to a
campaign + traffic `source` (cost).

`vendors` / `vendor_payments` and `portal_expenses` are standalone reference tables
(no `call_records` link), so the 40-day cleanup never touches them — their data is
kept indefinitely. The Vendors "Payments" figure is derived (`converted_calls × price`),
not stored.

## Prerequisites

- Node.js 18+ and npm
- PHP 8.1+ with the `pdo_pgsql` extension
- Composer
- PostgreSQL 13+

## Setup

### 0. Clone the repo

```bash
git clone https://github.com/keoze2026/crm.git
cd crm
```

### 1. Database

```bash
createdb crm     # or: psql -U postgres -c "CREATE DATABASE crm"
cd server
cp .env.example .env        # edit DB_PASSWORD etc. to match your Postgres
composer install
```

Then load the data. **To get the exact shared dataset** (recommended for
collaborators), load the committed snapshot:

```bash
psql -U postgres -d crm -f database/dump.sql
```

Or, to start from a fresh schema and regenerate *random* sample history
instead:

```bash
psql -U postgres -d crm -f database/schema.sql
php database/seed.php
```

> `database/dump.sql` is a full `pg_dump` (schema + data) and is the source of
> truth for shared data. After changing data you want others to have, refresh it:
>
> ```bash
> pg_dump --no-owner --no-privileges --clean --if-exists crm > database/dump.sql
> ```
>
> then commit the file. Collaborators re-run the `psql ... -f database/dump.sql`
> step to sync.

### 2. Server (PHP API)

```bash
cd server
composer start             # serves http://localhost:8000
```

Health check: http://localhost:8000/api/health

### 3. Client (React)

```bash
cd client
npm install
npm run dev                # serves http://localhost:5173
```

The Vite dev server proxies `/api/*` to the PHP server on port 8000.

## Authentication (optional)

Off by default. To turn it on:

1. **Apply the auth migrations** (idempotent; safe on an existing DB):
   ```bash
   cd server
   for m in 007_auth_totp_users 008_sessions 009_audit_log 010_user_permissions; do
     psql -U postgres -d crm -f database/migrations/${m}.sql
   done
   ```
   A fresh `schema.sql` load already includes these tables/columns; you only need the
   migrations when adding auth to a database created from an older `dump.sql`.

2. **Set env keys** in `server/.env`:
   ```ini
   APP_ENV=production        # or development locally — controls the Secure cookie flag
   AUTH_ENABLED=true
   CORS_ORIGIN=http://localhost:5173     # your frontend origin (exact, no *)
   CLIENT_URL=http://localhost:5173      # base URL used to build enrolment links
   ```

3. **Create the first admin** and enrol:
   ```bash
   ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" php database/seed_admin.php
   ```
   Open the printed `…/enroll?token=…` link, scan the QR into **Google Authenticator**,
   enter the 6-digit code. Thereafter sign in with email + code.

**How it works:** admins manage accounts under **Users** (create → QR enrolment link,
edit, promote/demote, per-page access, reset authenticator, deactivate/delete). Every
mutation and login is recorded in **System Logs** (admin-only). Sessions are opaque
tokens in an httpOnly cookie; only their hash is stored. Full ops guide: `MAINTENANCE.md`
§6b. Kill switch: set `AUTH_ENABLED=false` and reload PHP — the app reverts to fully open.

Dependencies (`spomky-labs/otphp` server-side, `qrcode.react` client-side) install
automatically with `composer install` / `npm install`.

## API reference

```
GET    /api/health
GET    /api/analytics/summary?from&to
GET    /api/analytics/trends?from&to&granularity=day|month|year
GET    /api/analytics/top-buyers?from&to&limit&metric=revenue|counted|answered
GET    /api/analytics/top-campaigns?from&to&limit
GET    /api/analytics/top-sources?from&to&limit
GET    /api/analytics/report?from&to            -> CSV (buyer performance)

GET    /api/buyers?search        POST /api/buyers
PUT    /api/buyers/{id}          DELETE /api/buyers/{id}

GET    /api/campaigns?search     POST /api/campaigns
PUT    /api/campaigns/{id}       DELETE /api/campaigns/{id}

GET    /api/records?from&to&type&buyer_id&campaign_id&search&sort&dir&page&per_page
GET    /api/records/export?...   -> CSV (filtered records)
POST   /api/records              PUT /api/records/{id}   DELETE /api/records/{id}

GET    /api/portal-expenses?month        POST /api/portal-expenses
PUT    /api/portal-expenses/{id}         DELETE /api/portal-expenses/{id}

GET    /api/vendors                       # tab list: campaign sources ∪ manual vendors
POST   /api/vendors {name}                # add a manual vendor
PUT    /api/vendors {name, manual_due}    # upsert a vendor's Due/Advance balance
DELETE /api/vendors/{id}                  # delete a manual vendor (+ its ledger rows)
GET    /api/vendor-payments?vendor&from&to
POST   /api/vendor-payments   PUT /api/vendor-payments/{id}   DELETE /api/vendor-payments/{id}
```

### Auth endpoints (only when `AUTH_ENABLED=true`)

```
GET    /api/auth/status                       -> { auth_enabled } (always available)
POST   /api/auth/login {identifier}           -> { mfa_required }  (start login)
POST   /api/auth/verify-totp {code}           -> { user }          (complete login)
POST   /api/auth/enroll/start {token}         -> { otpauth_uri, secret }
POST   /api/auth/enroll/confirm {token, code} -> { user }
POST   /api/auth/logout            GET /api/auth/me

# admin only (or a user granted the matching page)
GET    /api/audit-logs?user_id&action&entity_type&from&to&q&limit&offset
GET    /api/audit-logs/export?...  -> CSV       GET /api/audit-logs/actions
DELETE /api/audit-logs/{id}        DELETE /api/audit-logs        (clear filtered)

GET    /api/admin/users            POST /api/admin/users         (-> enrolment link)
PATCH  /api/admin/users/{id}       DELETE /api/admin/users/{id}  (hard delete)
POST   /api/admin/users/{id}/reset-totp
```

## Project layout

```
CRM/
├── client/
│   └── src/
│       ├── api/client.ts        # typed API wrapper
│       ├── auth/                # AuthContext, RequireAuth/RequirePage, pages.ts
│       ├── components/          # Layout, ui kit, DateRange
│       ├── lib/                 # format helpers, useAsync hook
│       ├── pages/               # Dashboard, Records, Buyers, Campaigns, Vendors,
│       │                        #   PortalExpenses, Reports, CompleteReport, Attendance,
│       │                        #   Login, Enroll, Users, SystemLogs
│       └── types.ts
└── server/
    ├── public/index.php         # entry point + router wiring + auth guard/audit hook
    ├── src/
    │   ├── Auth/                # Config, Totp, Session, Auth, AuthMiddleware, Pages
    │   ├── Controllers/         # Buyer, Campaign, Record, Analytics, Destination,
    │   │                        #   PortalExpense, Vendor, Auth, User, Audit
    │   ├── Audit.php  Database.php  Http.php  Router.php  RecordFilter.php
    └── database/
        ├── schema.sql
        ├── migrations/          # 001–013 (007–010 = auth; 011–012 = portal expenses;
        │                        #   013 = vendors)
        ├── seed.php             # demo data
        └── seed_admin.php       # bootstrap the first admin (auth)
```
