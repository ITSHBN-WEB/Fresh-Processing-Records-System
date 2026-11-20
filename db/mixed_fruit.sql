-- =====================================================================
-- FPRS - Module 2: Mixed Fruit BB  (tables prefixed mf_)
-- Run once in the Neon SQL Editor AFTER schema.sql. Safe to re-run.
-- =====================================================================

-- PLU masterlist. role 'input' = fruit that goes into the mix,
-- role 'output' = the Mixed Fruit BB product that is produced (BB FRUITS ...).
create table if not exists mf_items (
  id          serial primary key,
  plu         text not null unique,
  material    text not null,
  description text not null,
  uom         text not null check (uom in ('EA', 'KG')),
  category    text not null default 'Fruit',
  role        text not null default 'input' check (role in ('input', 'output')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists mf_entries (
  id                 text primary key,
  created_at         timestamptz not null default now(),
  recorded_by        text not null,
  supervisor         text not null,
  output_plu         text not null,
  output_description text not null,
  output_material    text not null,
  output_uom         text not null,
  output_qty         numeric(10,2) not null check (output_qty > 0),
  status             text not null default 'pending' check (status in ('pending', 'completed')),
  material_doc_a     text not null default '',
  material_doc_b     text not null default '',
  keyed_in_by        text not null default '',
  keyed_in_at        timestamptz,
  updated_at         timestamptz not null default now()
);
create index if not exists mf_entries_created_idx on mf_entries (created_at desc);
create index if not exists mf_entries_status_idx  on mf_entries (status, created_at desc);

create table if not exists mf_entry_items (
  id          bigserial primary key,
  entry_id    text not null references mf_entries(id) on delete cascade,
  position    int  not null,
  plu         text not null,
  description text not null,
  material    text not null,
  uom         text not null,
  qty         numeric(10,2) not null check (qty > 0)
);
create index if not exists mf_entry_items_entry_idx on mf_entry_items (entry_id, position);

-- The two Mixed Fruit BB output products (the fruit list itself is loaded
-- with scripts/import-fruit-masterlist.js)
insert into mf_items (plu, material, description, uom, role) values
  ('10361', '10073089', 'BB FRUITS',            'EA', 'output'),
  ('11386', '10116498', 'BB FRUITS - IMPORTED', 'EA', 'output')
on conflict (plu) do nothing;
