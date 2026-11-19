# FPRS – Fresh Processing Records System

Module 1 (live): **Chicken Cut Parts** – New Entry, IT Processing, Records, Admin.
Module 2 (planned): **Mixed Fruit BB** – placeholder on the dashboard and sidebar.

Stack: static frontend (`public/index.html`) + Vercel serverless API (`api/`) + Neon Postgres. No build step.

```
api/        Vercel functions: entries, items, dashboard, pending, admin-login, health
lib/        db client, HTTP helpers, entry validation/write logic
public/     index.html (the whole frontend)
db/         schema.sql (run once in Neon)
scripts/    import-chicken-csv.js (one-off import of the old sheet)
```

## Setup

### 1. Neon
1. Create a project (pick the Singapore region if available).
2. SQL Editor → paste and run `db/schema.sql`. It creates the tables and seeds the default PLU list.
3. Copy the connection string (Dashboard → Connect). This is `DATABASE_URL`.

### 2. GitHub
Create a repo under `itshbn-web` (e.g. `SHBN-FPRS`) and push this folder. `.env` and `node_modules` are git-ignored.

### 3. Vercel
1. Import the GitHub repo. Framework preset: **Other**. Leave build and output settings as they are (`vercel.json` sets the output folder).
2. Environment variables:
   - `DATABASE_URL` – the Neon connection string
   - `ADMIN_PASSWORD` – the Admin page password (the old app used `7799`)
3. Deploy. Check `https://<your-app>.vercel.app/api/health` returns `{"ok":true,...}`.

`vercel.json` pins functions to `sin1` (Singapore). If your Neon project is in another region, change or remove `regions`.

### 4. Import the existing records (once)
```
npm install
DATABASE_URL="postgres://..." node scripts/import-chicken-csv.js "SHBN - Chicken Processing Log.csv" --dry-run
DATABASE_URL="postgres://..." node scripts/import-chicken-csv.js "SHBN - Chicken Processing Log.csv"
```
Safe to re-run: entries that already exist are skipped.

### 5. Control Tower
The pending-count endpoint keeps the same response shape as the old Apps Script one:
`GET https://<your-app>.vercel.app/api/pending` → `{"ok":true,"pendingCount":N}` (CORS enabled).

## Differences from the old app
- Data lives in Neon, not Google Sheets. The monthly audit tabs are replaced by **Records** (month filter, search, **Export CSV** in the old sheet layout).
- Admin password is checked on the server, not in the browser.
- Descriptions and material codes are always taken from the masterlist on the server.
- Admin can hide a PLU (kept on old entries, removed from dropdowns) instead of overwriting the whole list.
- Editing any quantity in IT Entry clears a previous Calculate result, so a stale valuation cannot be submitted.
- Processed entries are locked on the server as well as in the screen.
- Negative weight difference is rejected on both new entries and IT corrections.
- Times are always Malaysia time, regardless of the device's clock.
