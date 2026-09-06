-- Catalog: locations and products.
-- Source: docs/tele-qr/data-model.md lines 129-155, plus WP1's additions:
-- CHECK on tier, and a generic set_updated_at() trigger to keep
-- products.updated_at current (design decisions §0.5).

create table locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,   -- 'Table Shelf', 'Rotating shelf', 'book', 'small box'
  parent_id   uuid references locations(id),
  created_at  timestamptz not null default now()
);

create table products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  tier        text not null,        -- asset | bulk | loose
  category    text,                 -- Connectors, SMD, Wires, Tools, Assembled
  location_id uuid references locations(id),
  returnable  boolean not null default false,
  min_stock   integer,              -- low-stock threshold; null = no alert
  unit        text not null default 'pcs',
  part_number text,
  spec        jsonb,                -- {value:"10k", package:"0402", tolerance:"1%"}
  notes       text,
  active      boolean not null default true,
  legacy_row  integer,              -- source row in the imported CSV
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint products_tier_check check (tier in ('asset', 'bulk', 'loose'))
);
create index on products (tier) where active;
create index on products (location_id);

-- Generic trigger function to keep updated_at current on any table that has
-- the column. Reused wherever else it's needed later in the project.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger products_set_updated_at
before update on products
for each row execute function set_updated_at();
