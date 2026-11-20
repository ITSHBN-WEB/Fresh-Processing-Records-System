# FPRS – Fresh Processing Records System

Module 1 (live): **Chicken Cut Parts** – New Entry, IT Processing, Records, Admin.
Module 2 (planned): **Mixed Fruit BB** – placeholder on the dashboard and sidebar.

Stack: static frontend (`public/index.html`) + Vercel serverless API (`api/`) + Neon Postgres. No build step.

```
api/        Vercel functions (9 of the 12 allowed on the free plan, incl. mf-items, mf-entries, admin-entries)
lib/        db client, HTTP helpers, entry validation/write logic
public/     index.html (the whole frontend)
db/         schema.sql, then mixed_fruit.sql (run each once in Neon)
scripts/    import-chicken-csv.js (one-off import of the old sheet)
```

## Setup

### 1. Neon
1. Create a project (pick the Singapore region if available).
2. SQL Editor → paste and run `db/schema.sql` (chicken tables and default PLU list), then run `db/mixed_fruit.sql` (Mixed Fruit BB tables). **Run both before the new code is deployed**, otherwise the dashboard cannot load.
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
Copy `.env.example` to `.env` and fill in `DATABASE_URL`, then:
```
npm install
node scripts/import-chicken-csv.js "SHBN - Chicken Processing Log.csv" --dry-run
npm run import:chicken -- "SHBN - Chicken Processing Log.csv"
```
Safe to re-run: entries that already exist are skipped.

### 4b. Load the Mixed Fruit BB masterlist (once)

The masterlist is loaded with `db/mixed_fruit_masterlist.sql` in the Neon SQL Editor (run it after `mixed_fruit.sql`; it is safe to re-run). Rows whose PLU was damaged by Excel are left out because those codes are not used in the web. Items can also be added in Admin → Master data → Mixed fruit BB. Scanned labels `28` + 5-digit PLU + 11 digits are read as the 5-digit PLU.

### 5. Control Tower
The pending-count endpoint keeps the same response shape as the old Apps Script one:
`GET https://<your-app>.vercel.app/api/pending` → `{"ok":true,"pendingCount":N,"fruitPendingCount":M,"totalPendingCount":N+M}`. `pendingCount` is still chicken only, so the existing Control Tower keeps working. (CORS enabled).

## Differences from the old app
- Data lives in Neon, not Google Sheets. The monthly audit tabs are replaced by **Records** (month filter, search, **Export CSV** in the old sheet layout).
- Admin password is checked on the server, not in the browser.
- Descriptions and material codes are always taken from the masterlist on the server.
- Admin can hide a PLU (kept on old entries, removed from dropdowns) instead of overwriting the whole list.
- Editing any quantity in IT Entry clears a previous Calculate result, so a stale valuation cannot be submitted.
- Processed entries are locked on the server as well as in the screen.
- Negative weight difference is rejected on both new entries and IT corrections.
- Times are always Malaysia time, regardless of the device's clock.

## Saving Vercel deployments (free plan)
- **Test locally first:** `npm run dev` runs the real app and API on your PC against your Neon database (http://localhost:3000). It does not create any Vercel deployment.
- **Set both environment variables before the first deploy.** Changing them later needs a redeploy.
- **Push to `main` only, in batches.** `vercel.json` has an ignore rule: a push is skipped (no build, no deployment counted) when it is on another branch, or when it only touches files outside `api/`, `lib/`, `public/`, `vercel.json` and `package.json` (README, `db/`, `scripts/`).
- **Prices, PLUs and costs never need a deploy.** They live in the database and are edited in Admin.

## Phones and PDAs
Below 900 px wide the sidebar is hidden and only the three-line menu button shows. On phone-width screens the tables become stacked cards, inputs and buttons are at least 44 px tall (16 px text, so Android does not zoom), name fields open the keyboard in capitals, and quantity fields open the numeric keypad.
