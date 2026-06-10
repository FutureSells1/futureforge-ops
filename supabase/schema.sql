-- ============================================================
-- FutureForge Ops — Supabase schema v1
-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor)
-- ============================================================

-- ---------- PROJECTS ----------
-- One row per Slack project channel. Fed by the Zapier zap
-- (Slack "New Channel" -> filter ^(tc|bc|nn)- -> insert row).
-- channel is the source of truth; account/client/project codes
-- are derived from the naming convention tc-ct-ocf.
create table if not exists projects (
  id           bigint generated always as identity primary key,
  channel      text not null unique,            -- e.g. 'tc-ct-ocf'
  account      text not null check (account in ('tc','bc','nn')),
  client_code  text not null,                   -- e.g. 'ct'
  project_code text not null,                   -- e.g. 'ocf'
  display_name text,                            -- human label, e.g. 'Webflow Website — Caio Tralba'
  client_name  text,                            -- e.g. 'Caio Tralba'
  quoted_revenue numeric(12,2) default 0,       -- what we quoted the client
  status       text not null default 'active' check (status in ('active','archived')),
  created_at   timestamptz not null default now()
);

-- Helper: derive the code columns from the channel name on insert,
-- so the Zapier zap only needs to send { channel }.
create or replace function projects_derive_codes()
returns trigger language plpgsql as $$
begin
  new.channel := lower(trim(new.channel));
  new.account := split_part(new.channel, '-', 1);
  new.client_code := split_part(new.channel, '-', 2);
  new.project_code := nullif(split_part(new.channel, '-', 3), '');
  if new.project_code is null then
    new.project_code := new.client_code; -- two-segment channels: project = client
  end if;
  return new;
end $$;

drop trigger if exists trg_projects_derive on projects;
create trigger trg_projects_derive
  before insert or update of channel on projects
  for each row execute function projects_derive_codes();

-- ---------- DEVS ----------
-- One row per developer. hourly_cost drives the cost side of
-- profitability (hours x hourly_cost).
create table if not exists devs (
  id          bigint generated always as identity primary key,
  name        text not null unique,    -- matches the dev's spreadsheet identity, e.g. 'Musa'
  hourly_cost numeric(10,2) not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- HOURS ENTRIES ----------
-- One row per dev / project / date. Fed daily by the extended
-- Apps Script (the same one that powers the Notion sync).
-- raw_key keeps whatever string the dev wrote in the sheet
-- (Slack Channel column, or Project column when channel blank),
-- so unmatched rows are auditable instead of silently dropped.
create table if not exists hours_entries (
  id          bigint generated always as identity primary key,
  dev_id      bigint not null references devs(id),
  project_id  bigint references projects(id),   -- null = unmatched, see reconciliation view
  raw_key     text not null,                    -- e.g. 'tc-ct-ocf' or free-text project name
  work_date   date not null,
  hours       numeric(6,2) not null check (hours >= 0),
  source      text not null default 'sheet',
  created_at  timestamptz not null default now(),
  unique (dev_id, raw_key, work_date)           -- idempotent daily sync: re-runs upsert, never duplicate
);

create index if not exists idx_hours_project on hours_entries(project_id);
create index if not exists idx_hours_date on hours_entries(work_date);

-- ---------- UPWORK BLOCKS ----------
-- Logged time blocks read by the Hours Mirror module.
-- week_start = the Monday (UTC) of the week the block belongs to.
create table if not exists upwork_blocks (
  id         bigint generated always as identity primary key,
  account    text not null check (account in ('tc','bc','nn')),
  week_start date not null,
  day        smallint not null check (day between 0 and 6),  -- 0 = Mon
  start_min  int not null check (start_min between 0 and 1440),
  end_min    int not null check (end_min between 0 and 1440),
  label      text default '',
  project_id bigint references projects(id),
  created_at timestamptz not null default now(),
  check (end_min > start_min)
);

create index if not exists idx_blocks_week on upwork_blocks(account, week_start);

-- ---------- PROFITABILITY VIEW ----------
-- Cost per project = sum(hours x dev hourly_cost). Margin = quoted - cost.
create or replace view project_profitability as
select
  p.id,
  p.channel,
  p.account,
  p.display_name,
  p.client_name,
  p.status,
  p.quoted_revenue,
  coalesce(sum(h.hours), 0)                          as total_hours,
  coalesce(sum(h.hours * d.hourly_cost), 0)          as total_cost,
  p.quoted_revenue - coalesce(sum(h.hours * d.hourly_cost), 0) as margin
from projects p
left join hours_entries h on h.project_id = p.id
left join devs d on d.id = h.dev_id
group by p.id;

-- ---------- RECONCILIATION VIEW ----------
-- Hours rows whose raw_key didn't match any project channel.
create or replace view unmatched_hours as
select h.id, d.name as dev, h.raw_key, h.work_date, h.hours
from hours_entries h
join devs d on d.id = h.dev_id
where h.project_id is null
order by h.work_date desc;

-- ---------- ROW LEVEL SECURITY ----------
-- Internal tool: any logged-in user can read and write everything.
-- Writers from automations (Zapier, Apps Script) use the service-role
-- key, which bypasses RLS. The anon key can do nothing.
alter table projects      enable row level security;
alter table devs          enable row level security;
alter table hours_entries enable row level security;
alter table upwork_blocks enable row level security;

create policy "authenticated full access" on projects
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on devs
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on hours_entries
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on upwork_blocks
  for all to authenticated using (true) with check (true);
