-- =====================================================================
-- FPRS - Fresh Processing Records System  |  Neon (Postgres) schema
-- Module 1: Chicken Cut Parts  (tables prefixed cc_)
-- Module 2: Mixed Fruit BB     (will use the mf_ prefix, added later)
-- Run this once in the Neon SQL Editor. Safe to re-run.
-- =====================================================================

-- PLU / cost master (replaces the hidden "ItemsDB" sheet)
create table if not exists cc_items (
  id          serial primary key,
  type        text not null check (type in ('base', 'cut')),
  plu         text not null,
  description text not null,
  material    text not null,
  cost        numeric(12,2) not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (type, plu)
);

-- One row per submission (replaces "EntriesDB" + the monthly tabs)
create table if not exists cc_entries (
  id                     text primary key,
  created_at             timestamptz not null default now(),
  staff                  text not null,
  supervisor             text not null,
  base_plu               text not null,
  base_description       text not null,
  base_material          text not null,
  base_qty               numeric(10,2) not null check (base_qty > 0),
  total_cut_qty          numeric(10,2) not null default 0,
  difference             numeric(10,2) not null default 0,
  status                 text not null default 'pending' check (status in ('pending', 'completed')),
  system_amount          numeric(14,2),
  calculated             jsonb,
  material_doc_a         text not null default '',
  material_doc_b         text not null default '',
  weight_discrepancy_doc text not null default '',
  keyed_in_by            text not null default '',
  keyed_in_at            timestamptz,
  updated_at             timestamptz not null default now()
);
create index if not exists cc_entries_created_idx on cc_entries (created_at desc);
create index if not exists cc_entries_status_idx  on cc_entries (status, created_at desc);

-- Cut parts of each submission
create table if not exists cc_entry_cuts (
  id          bigserial primary key,
  entry_id    text not null references cc_entries(id) on delete cascade,
  position    int  not null,
  plu         text not null,
  description text not null,
  material    text not null,
  qty         numeric(10,2) not null check (qty > 0)
);
create index if not exists cc_entry_cuts_entry_idx on cc_entry_cuts (entry_id, position);

-- Default masterlist (same as the Apps Script defaults)
insert into cc_items (type, plu, description, material, cost) values
  ('base', '50046', 'FRESH WHOLE CHICKEN',      '10089824', 11.50),
  ('base', '50083', 'CHICKEN LEG QUARTER',      '10056837', 12.68),
  ('base', '50429', 'IM FROZEN CHICKEN',        '10041605', 10.40),
  ('cut',  '50053', 'FRESH CHICKEN THIGH',      '10089831', 11.50),
  ('cut',  '50050', 'FRESH CHICKEN WHOLE LEG',  '10089828', 11.50),
  ('cut',  '50049', 'FRESH CHICKEN DRUMSTICK',  '10089827', 11.50),
  ('cut',  '50082', 'CHICKEN WING LOOSE',       '10056285', 13.34),
  ('cut',  '50058', 'FRESH CHICKEN BREASTMEAT', '10089836', 11.50),
  ('cut',  '50052', 'FRESH CHICKEN NECK',       '10089830',  3.50),
  ('cut',  '50048', 'FRESH CHICKEN TAIL',       '10089826',  9.00),
  ('cut',  '50083', 'CHICKEN LEG QUARTER',      '10056837', 12.68)
on conflict (type, plu) do nothing;
