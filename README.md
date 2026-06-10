# FutureForge Ops

Internal agency operations platform. One database, three feeds, growing set of views.

**Modules in v1**
- **Dashboard** — project profitability: hours × dev rates = cost, vs quoted revenue = margin. Plus an "unmatched hours" reconciliation list.
- **Projects** — one row per Slack project channel (`tc-ct-ocf` convention), with inline editing of client name, display name, and quoted revenue.
- **Hours Mirror** — the Upwork logging assistant, ported as a module (screen-share → Claude vision → per-account weekly grid → free gaps).

**Stack:** React + Vite · Supabase (database + auth) · Vercel (hosting) · Zapier (Slack → projects feed) · Apps Script (sheets → hours feed).

---

## Setup, in order

### 1. Supabase (the database)
1. Create a free project at [supabase.com](https://supabase.com) (org: FutureForge, pick a region close to you).
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, run it. This creates `projects`, `devs`, `hours_entries`, `upwork_blocks`, the profitability and reconciliation views, and security policies.
3. **Authentication → Providers**: leave Email enabled, and turn **off** "Allow new users to sign up" (internal tool — you create accounts).
4. **Authentication → Users → Add user**: create accounts for yourself and the team (email + password).
5. **Settings → API**: copy the **Project URL** and the **anon public** key.

### 2. Run locally
```bash
cp .env.example .env     # paste the URL and anon key into .env
npm install
npm run dev              # opens on http://localhost:5173
```
Without a `.env` the app runs in *setup mode* — every page explains what to connect instead of crashing.

### 3. GitHub + Vercel (hosting)
```bash
git init
git add -A
git commit -m "FutureForge Ops v1"
# create an empty repo on github.com first, then:
git remote add origin https://github.com/YOUR-ORG/futureforge-ops.git
git push -u origin main
```
Then at [vercel.com](https://vercel.com): **Add New → Project → import the repo**. Vite is auto-detected. Under **Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same values as `.env`). Deploy. Every future `git push` deploys automatically.

> Routing note: if refreshing a sub-page 404s on Vercel, add a `vercel.json` with a rewrite of all routes to `/` — ask Claude for it.

### 4. Zapier (Slack channels → projects table)
1. **Trigger:** Slack → *New Channel*.
2. **Filter:** only continue if *Channel Name* matches `^(tc|bc|nn)-` (Zapier's "Only continue if… text matches pattern").
3. **Action:** Supabase → *Create Row* in table `projects`, mapping just `channel` → the Slack channel name. (The database trigger derives account / client / project codes automatically.)
   - The Supabase connection in Zapier uses the **service_role** key (Settings → API), which is allowed to write. Never put that key in the web app.

If channels are sometimes created **private**, the trigger won't see them unless the connected Slack user is a member — fallback is the manual "Add project" form on the Projects page.

### 5. Apps Script (dev sheets → hours_entries)
The existing daily Notion sync already reads every dev's hours. Extend it to also POST rows to Supabase:
- Endpoint: `https://YOUR-PROJECT.supabase.co/rest/v1/hours_entries`
- Headers: `apikey: SERVICE_ROLE_KEY`, `Authorization: Bearer SERVICE_ROLE_KEY`, `Content-Type: application/json`, `Prefer: resolution=merge-duplicates`
- Body: `[{ "dev_id": …, "raw_key": "tc-ct-ocf", "work_date": "2026-06-08", "hours": 2.5 }]`
- The `unique (dev_id, raw_key, work_date)` constraint makes daily re-runs idempotent.
- Matching `raw_key → project_id` can be done in the script (fetch projects once, match lowercased channel) or left null and fixed via the dashboard's unmatched list.

First, seed the `devs` table (SQL editor):
```sql
insert into devs (name, hourly_cost) values
('Musa', 0), ('Nahian', 0), ('Moiz', 0), ('Md. Aminul', 0),
('Shaheer', 0), ('Shahab', 0), ('Muhammad Nuruddin', 0), ('Abdullah', 0);
```
…then set real hourly costs on each row (or via SQL) — costs stay at $0 until you do.

---

## Roadmap notes
- **Hours Mirror → Supabase**: blocks currently persist in `localStorage` (same key as the standalone app, so existing data carries over). Next step: write blocks to `upwork_blocks` keyed by week, enabling history and cross-device use.
- **Project identification in the Mirror**: extend the vision prompt to also read the client name / contract title from the diary page, match against the `projects` table (`account + client initials`), auto-tag blocks with `project_id`.
- **Upwork constraint (unchanged):** no write API — hours can't be pushed programmatically; no browser extensions / scraping / agents acting on Upwork pages (ToS risk). Screen-pixel reading stays the safe lane.
