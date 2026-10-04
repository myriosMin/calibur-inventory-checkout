-- Build lists: what each robot of a season needs, and what it costs.
--
-- Source: data/Calibur_AY2627.xlsx, the AY26/27 build budget (one sheet per
-- robot: part, unit price, quantity, supplier link). Loaded by
-- scripts/import-build-lists.ts; see docs/data-cleaning.md, "Build lists".
--
-- A build list is a PLAN, not stock. Nothing here touches the ledger: a part
-- the club buys for a build still arrives through Restock, and a part on a
-- robot is still a holding of that robot. That is why a line's product link
-- is optional -- screws, bearings and fabricated plates are bought for a
-- build without ever being a store product.

-- ---------------------------------------------------------------------------
-- build_lists: one per robot per season
-- ---------------------------------------------------------------------------

create table build_lists (
  id          uuid primary key default gen_random_uuid(),
  -- e.g. 'AY2627'.
  season      text not null,
  -- The robot as the sheet names it, e.g. 'Hero', 'Double Yaw Sentry'.
  -- Deliberately not a holder: a build list plans the next robot, which is
  -- usually not the one that exists today.
  name        text not null,
  -- Where it came from, e.g. 'Calibur_AY2627.xlsx > 2627 Hero'.
  source      text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint build_lists_season_name_key unique (season, name)
);

create trigger build_lists_set_updated_at
before update on build_lists
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- build_list_lines: one per part on a build list
-- ---------------------------------------------------------------------------

create table build_list_lines (
  id              uuid primary key default gen_random_uuid(),
  build_list_id   uuid not null references build_lists(id) on delete cascade,
  -- Order on the sheet.
  position        int not null,
  -- Sub-assembly: Chassis / Gimbal / Referee. Null when the sheet has none.
  section         text,
  -- The sheet's own category: Electronics, Motor, Screws, ...
  category        text,
  part_name       text not null,
  -- The store product this line is, when that is unambiguous.
  product_id      uuid references products(id),
  -- Null while the sheet still says TBD.
  qty             int,
  -- 'buy': purchased for the build. 'referee_kit': comes with the referee
  -- system the club already holds, so it has no price.
  sourcing        text not null default 'buy',
  unit_price_sgd  numeric(10, 2),
  supplier        text,
  supplier_url    text,
  notes           text,
  -- The cell text before clean-up, and the sheet row, for tracing back.
  source_text     text,
  source_row      int,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint build_list_lines_position_key unique (build_list_id, position),
  constraint build_list_lines_qty_check check (qty is null or qty >= 0),
  constraint build_list_lines_sourcing_check check (sourcing in ('buy', 'referee_kit')),
  constraint build_list_lines_price_check check (unit_price_sgd is null or unit_price_sgd >= 0),
  constraint build_list_lines_referee_unpriced check (sourcing = 'buy' or unit_price_sgd is null)
);

create index build_list_lines_product_idx on build_list_lines (product_id) where product_id is not null;

create trigger build_list_lines_set_updated_at
before update on build_list_lines
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: staff (admin + procurement) plan builds; members see nothing
-- ---------------------------------------------------------------------------

alter table build_lists enable row level security;
create policy build_lists_staff_select on build_lists
  for select using (is_staff());
create policy build_lists_staff_insert on build_lists
  for insert with check (is_staff());
create policy build_lists_staff_update on build_lists
  for update using (is_staff()) with check (is_staff());
create policy build_lists_staff_delete on build_lists
  for delete using (is_staff());

alter table build_list_lines enable row level security;
create policy build_list_lines_staff_select on build_list_lines
  for select using (is_staff());
create policy build_list_lines_staff_insert on build_list_lines
  for insert with check (is_staff());
create policy build_list_lines_staff_update on build_list_lines
  for update using (is_staff()) with check (is_staff());
create policy build_list_lines_staff_delete on build_list_lines
  for delete using (is_staff());
