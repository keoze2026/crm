# CallFlow CRM

A pay-per-call / call-forwarding CRM. Team members enter daily call volumes for
**buyers** (the revenue side — calls sold/forwarded to customers) and
**campaigns** (the cost side — media-buying campaigns that source the calls).
The difference between the two is the **gross margin**.

- **client/** — React + TypeScript + Tailwind CSS + Recharts (Vite)
- **server/** — PHP REST API + PostgreSQL (PDO)
- Theme: blue-600 / white

## Features

- **Dashboard** — KPI cards (revenue, cost, margin, counted calls) with
  period-over-period deltas; revenue/cost/margin trend (day / month / year);
  most-active-buyers chart; answered-vs-missed trend; top traffic sources.
- **Call Records** — fast data entry for both record types, inline computed
  total bill, filters (type, date range, buyer, campaign, source search),
  sortable columns, pagination, and CSV export of the filtered set.
- **Buyers / Campaigns** — card views with per-entity revenue/cost, answer
  rate, record counts and last activity; create / edit / delete.
- **Reports** — monthly breakdown, top buyers / campaigns / sources, and
  downloadable CSV reports.

## Data model

| Table          | Purpose                                                        |
| -------------- | ------------------------------------------------------------- |
| `buyers`       | Customers who buy forwarded calls (revenue). e.g. `RTG 04`.   |
| `campaigns`    | Media-buying campaigns that source calls (cost). e.g. `C-05`. |
| `call_records` | One daily row: date, type, answered/missed/counted, rate.     |

`call_records.total_bill` is a generated column (`counted * rate`).
A `record_type` of `buyer` links to a buyer (revenue); `campaign` links to a
campaign + traffic `source` (cost).

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
```

## Project layout

```
CRM/
├── client/
│   └── src/
│       ├── api/client.ts        # typed API wrapper
│       ├── components/          # Layout, ui kit, DateRange
│       ├── lib/                 # format helpers, useAsync hook
│       ├── pages/               # Dashboard, Records, Buyers, Campaigns, Reports
│       └── types.ts
└── server/
    ├── public/index.php         # entry point + router wiring
    ├── src/
    │   ├── Controllers/         # Buyer, Campaign, Record, Analytics
    │   ├── Database.php  Http.php  Router.php  RecordFilter.php
    └── database/
        ├── schema.sql
        └── seed.php
```
