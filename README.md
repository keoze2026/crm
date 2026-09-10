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
  **Average calls a day** (Σ converted ÷ days worked), an **Initial Advance** (the
  balance the period opens with, carried forward from the previous one), and a
  derived, colour-coded **Due / Advance** balance — `initial + paid − payments`,
  labelled Advance when positive and Due when negative, never typed. One
  top-level date-range filter drives every tab.
- **Portal Expenses** — monthly per-provider expense sheet (voice minutes,
  rejected calls, rent values, payout expenses) with an auto-or-override Total
  Amount and per-provider charts.
- **Reports** — monthly breakdown, top buyers / campaigns / sources, and
  downloadable CSV reports.
- **Attendance** — daily roster, per-member summaries and break-overage reports,
  fed by an external Telegram check-in bot whose tables this app only ever
  **reads**. A day can be corrected on Staff Management and the correction shows
  here too, and each clock time is marked **late** or **early** against that
  person's expected hours.
- **Queues** — two drag-orderable sheets, **Forwarding Queues** and **Camp & Flow
  Queues**, one row per person with their queue codes as chips. The two boards are
  one table split by a `board` discriminator, so a person can hold a row on both.
  Sr. No. and totals are derived, never stored; PDF export.
- **Review** — month-wise performance and behaviour reviews grouped into
  department bands, plus a per-department monthly score. **A review judges the
  month before it is written** — a sheet filled in during September is about
  August — so every tab opens on last month.
- **Staff Management** — the one roster every other sheet picks its names from:
  **Staff** (CRUD, multi-department membership, status, and the expected
  login/logout hours the attendance pages judge a day against), **Complete
  Attendance** (a day at a time, fully editable whether or not the bot recorded
  it), **Leaves** and **Salaries**. PDF export on every tab.
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
| `vendors`         | Traffic-source metadata: manual vendors + opening advance.        |
| `vendor_payments` | Dated per-vendor ledger rows (Vendors page). Standalone.          |
| `staff`           | The one roster. Name, status, expected login/logout, bot account.  |
| `departments`     | The band catalogue, shared by the Staff and Review pages.          |
| `staff_departments` | Many-to-many: a person may sit in several departments.          |
| `staff_attendance`| A day this app owns. On a bot-recorded day it **replaces** it.    |
| `staff_leaves` / `staff_salaries` | The Leaves and Salaries sheets.                   |
| `queue_codes`     | The shared queue-code catalogue.                                  |
| `queue_assignments` / `queue_assignment_codes` | One row per person per `board`, and its ordered codes. |
| `review_entries`  | Performance and behaviour reviews, per person per `month`.        |
| `department_reviews` | One score per department per month.                            |

`call_records.total_bill` is a generated column (`counted * rate`).
A `record_type` of `buyer` links to a buyer (revenue); `campaign` links to a
campaign + traffic `source` (cost).

`vendors` / `vendor_payments`, `portal_expenses` and all the Staff, Queues and
Review tables are standalone reference tables (no `call_records` link), so the
40-day cleanup never touches them — their data is kept indefinitely. The Vendors
"Payments" figure is derived (`converted_calls × price`), not stored.

**The check-in bot's tables** (`attendance_staff`, `attendance_days`,
`attendance_breaks`) belong to a separate Telegram service. This app **only reads
them** — never creates, writes or migrates them — and every query that touches one
is guarded on its existence, so an install without the bot works fine and simply
reports everything as hand-keyed. `staff.attendance_user_id` is the link, resolved
from the person's **name** (the only thing the two systems share) and never picked
in the UI; see MAINTENANCE.md § *Staff ↔ check-in bot* when a name won't match.

A `staff_attendance` row for a day the bot recorded is an **override that replaces
that day** — login, logout, break and status all come from it, and deleting it
restores the bot's record untouched. That is why both the Staff and Attendance
pages always agree.

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
PUT    /api/vendors {name, opening_advance}   # upsert the balance the ledger starts from
DELETE /api/vendors/{id}                  # delete a manual vendor (+ its ledger rows)
GET    /api/vendor-payments?vendor&from&to    # -> {rows, opening_advance, prior_net, initial_advance}
                                              #    initial_advance carries the balance into the range
POST   /api/vendor-payments   PUT /api/vendor-payments/{id}   DELETE /api/vendor-payments/{id}

GET    /api/attendance/staff                  # the bot's roster (read-only)
GET    /api/attendance/roster?date            # one day, with expected_login/logout + late_min/early_min
GET    /api/attendance/live                   # who is checked in right now
GET    /api/attendance/days?from&to&user_id
GET    /api/attendance/summary?from&to
GET    /api/attendance/breaks?user_id&date    # -> {..., overridden} when a break was corrected
GET    /api/attendance/exceptions?type=missing_logout|over_break|late&from&to

GET    /api/staff                POST /api/staff {names[], department_ids[]}
PUT    /api/staff/{id}           # name, status, department_ids (the complete set),
                                 # expected_login / expected_logout ("HH:MM", null clears)
DELETE /api/staff/{id}           # cascades their queue, department, attendance, leave & salary rows
GET    /api/departments          POST/PUT/DELETE /api/departments[/{id}]

GET    /api/staff-attendance?from&to&staff_id   # fetched + hand-keyed days merged
POST   /api/staff-attendance     PUT /api/staff-attendance/{id}   DELETE /api/staff-attendance/{id}
                                 # DELETE on a bot-recorded day reverts to the bot's own record
GET    /api/staff-leaves?from&to         POST/PUT/DELETE /api/staff-leaves[/{id}]
GET    /api/staff-salaries?month         POST/PUT/DELETE /api/staff-salaries[/{id}]

GET    /api/queues?board=forwarding|camp_flow    POST /api/queues
PUT    /api/queues/{id}          DELETE /api/queues/{id}
GET    /api/queue-codes          POST /api/queue-codes
PUT    /api/queue-codes/{id}     DELETE /api/queue-codes/{id}

GET    /api/review-departments?month     # the bands + their score for that month
POST   /api/review-departments   PUT /api/review-departments/{id}
DELETE /api/review-departments/{id}
GET    /api/review-entries?month&kind=performance|behaviour
POST   /api/review-entries       PUT /api/review-entries/{id}
DELETE /api/review-entries/{id}
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
        ├── migrations/          # 001–014 (007–010 = auth; 011–012 = portal expenses;
        │                        #   013–014 = vendors)
        ├── seed.php             # demo data
        └── seed_admin.php       # bootstrap the first admin (auth)
```
