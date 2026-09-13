-- Catalog import support: who owns the stock, how hard it is tracked, a
-- per-unit register for serialised hardware, procurement fields, and a
-- `procurement` staff role.
--
-- Source: docs/data-cleaning.md. Additive only -- no existing column changes
-- meaning, and every new column has a default or is nullable, so the existing
-- admin UI and submit_cart keep working untouched.

-- ---------------------------------------------------------------------------
-- products: criticality
-- ---------------------------------------------------------------------------

-- How hard an item is tracked. Orthogonal to `tier`, which only controls
-- counting UX (a soldering iron and a Jetson are both `asset`):
--   critical   -- expensive, competition-mandatory, safety-relevant or
--                 irreplaceable: DJI motors/ESCs, referee modules, Jetsons,
--                 LiPo packs, supercap banks. Serialised in asset_units
--                 wherever a unit register exists.
--   standard   -- reusable kit that is expected to come back: tools, dev
--                 boards, modules.
--   expendable -- the "don't care" pile: passives, connectors, crimps,
--                 cables. Taken, never returned, never chased.
alter table products
  add column criticality text not null default 'standard',
  add constraint products_criticality_check
    check (criticality in ('critical', 'standard', 'expendable'));

-- ---------------------------------------------------------------------------
-- products: ownership
-- ---------------------------------------------------------------------------

-- 'on_loan' = lent TO the club by another department, club, company or
-- person, and has to go back to them. 'mixed' = some units of each; the
-- per-unit truth is asset_units.ownership.
--
-- Deliberately not called "borrowed": borrow already means a member checking
-- something out of the store (stock_movements.reason = 'borrow'), and two
-- meanings of one word in the same dashboard is how data gets entered wrong.
alter table products
  add column ownership text not null default 'owned',
  add column loaned_from text,
  add column loan_due date,
  add constraint products_ownership_check
    check (ownership in ('owned', 'on_loan', 'mixed')),
  add constraint products_owned_has_no_lender
    check (ownership <> 'owned' or (loaned_from is null and loan_due is null));

-- ---------------------------------------------------------------------------
-- products: procurement fields and import provenance
-- ---------------------------------------------------------------------------

-- unit_cost_sgd is a budgeting estimate for the procurement team, not an
-- accounting record.
alter table products
  add column supplier text,
  add column unit_cost_sgd numeric(10, 2),
  add constraint products_unit_cost_check
    check (unit_cost_sgd is null or unit_cost_sgd >= 0);

-- legacy_row assumed a single source CSV. The real import merges three
-- spreadsheet tabs and the legacy checkout app's database, so provenance is
-- free text: 'clean:m3508; Electrical Parts!R173; legacy:a284994b'.
alter table products add column legacy_ref text;

-- ---------------------------------------------------------------------------
-- asset_units: the per-unit register for serialised hardware
-- ---------------------------------------------------------------------------

-- Reproduces the "High Value Items" and "Referee System Inventory" tabs: one
-- row per physical unit, with the component ID on its sticker, serial number,
-- condition, and whether that particular unit is on loan to the club.
--
-- This is a register, NOT a second ledger. *Where* stock is still lives only
-- in stock_movements (quantities per product per holder). There is
-- deliberately no holder column here: one maintained by hand would drift from
-- the ledger within weeks, which is the exact failure the ledger replaced.
create table asset_units (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references products(id),
  -- Component ID printed on the unit's sticker, e.g. 'AM02-01'.
  unit_code           text not null,
  -- Manufacturer serial. NOT unique: the source register transcribes them
  -- from scratched stickers and already contains duplicates.
  serial_number       text,
  condition           text not null default 'unknown',
  ownership           text not null default 'owned',
  loaned_from         text,
  loan_due            date,
  labelled            boolean,
  last_seen_location  text,
  last_checked_on     date,
  notes               text,
  active              boolean not null default true,
  legacy_ref          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint asset_units_condition_check
    check (condition in ('ok', 'faulty', 'disposed', 'missing', 'unknown')),
  constraint asset_units_ownership_check
    check (ownership in ('owned', 'on_loan')),
  constraint asset_units_owned_has_no_lender
    check (ownership <> 'owned' or (loaned_from is null and loan_due is null))
);

create unique index asset_units_unit_code_key on asset_units (unit_code);
create index asset_units_product_idx on asset_units (product_id);
create index asset_units_serial_idx on asset_units (serial_number)
  where serial_number is not null;

create trigger asset_units_set_updated_at
before update on asset_units
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Roles: member | procurement | admin
-- ---------------------------------------------------------------------------

-- member      -- borrows and returns through the Mini App. No /admin access.
-- procurement -- reads the whole inventory, maintains the catalog, receives
--                stock (restock). Nothing else.
-- admin       -- the developers: everything, including roles.
alter table members drop constraint members_role_check;
alter table members add constraint members_role_check
  check (role in ('member', 'procurement', 'admin'));

-- Same shape and reasoning as is_admin() (0009, 0012-0014): SECURITY DEFINER
-- so the internal `members` lookup does not recurse through members' own RLS,
-- keyed on the caller's session email only, and revoked from PUBLIC -- a
-- role-specific revoke does not override the implicit PUBLIC grant.
create or replace function is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from members m
    where m.nus_email = auth.email()
      and m.role in ('admin', 'procurement')
      and m.active
  )
$$;

revoke execute on function is_staff() from public, anon;
grant  execute on function is_staff() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS for procurement
-- ---------------------------------------------------------------------------

-- Policies are permissive, so every policy below is ORed with the existing
-- <table>_admin_* ones: admins lose nothing. What stays admin-only, by
-- omission: members (beyond one's own row), telegram_bind_attempts,
-- scan_codes writes, stock_counts writes (stocktake), reversals, scan_misses.

create policy products_staff_select on products
  for select using (is_staff());
create policy products_staff_insert on products
  for insert with check (is_staff());
create policy products_staff_update on products
  for update using (is_staff()) with check (is_staff());

create policy locations_staff_select on locations
  for select using (is_staff());
create policy locations_staff_insert on locations
  for insert with check (is_staff());
create policy locations_staff_update on locations
  for update using (is_staff()) with check (is_staff());

create policy holders_staff_select on holders
  for select using (is_staff());
create policy scan_codes_staff_select on scan_codes
  for select using (is_staff());
create policy stock_counts_staff_select on stock_counts
  for select using (is_staff());

create policy stock_movements_staff_select on stock_movements
  for select using (is_staff());
create policy sessions_staff_select on sessions
  for select using (is_staff());

-- Receiving stock, and only receiving stock. A procurement account cannot
-- write a borrow, a stocktake correction or a reversal, even by hand.
create policy stock_movements_staff_insert_restock on stock_movements
  for insert with check (is_staff() and reason = 'restock');
create policy sessions_staff_insert_restock on sessions
  for insert with check (is_staff() and mode = 'restock');

-- admin_actor_member_id() (SECURITY INVOKER) looks up the caller's own
-- members row; without this a procurement caller reads zero rows and every
-- restock fails with "no admin members row". One's own row only.
create policy members_select_self on members
  for select using (nus_email = auth.email());

alter table asset_units enable row level security;
create policy asset_units_admin_all on asset_units
  for all using (is_admin()) with check (is_admin());
create policy asset_units_staff_select on asset_units
  for select using (is_staff());
create policy asset_units_staff_insert on asset_units
  for insert with check (is_staff());
create policy asset_units_staff_update on asset_units
  for update using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- Let procurement call admin_restock
-- ---------------------------------------------------------------------------

-- Both stay SECURITY INVOKER (see 0022's security model note): RLS above is
-- the boundary, these guards are fail-fast messages. admin_commit_stocktake
-- and admin_reverse_movement also call admin_actor_member_id(), but keep
-- their own is_admin() guard and admin-only RLS, so widening the actor
-- lookup grants procurement nothing there.
create or replace function admin_actor_member_id(p_fallback uuid)
returns uuid language plpgsql stable security invoker set search_path = public as $$
declare v_id uuid;
begin
  -- NOTE: sound ONLY because this is SECURITY INVOKER (see 0022). Do not flip it.
  if current_user = 'service_role' then
    return p_fallback;
  end if;
  select m.id into v_id from members m
   where m.nus_email = auth.email()
     and m.role in ('admin', 'procurement')
     and m.active;
  return v_id;
end; $$;

create or replace function admin_restock(
  p_lines jsonb,
  p_note text default null,
  p_client_token uuid default null,
  p_actor_member_id uuid default null
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_actor uuid;
  v_store uuid;
  v_adjustment uuid;
  v_session_id uuid;
  v_line jsonb;
  v_product record;
  v_qty int;
begin
  -- Fail-fast message, NOT the boundary (RLS is).
  if not (is_staff() or current_user = 'service_role') then
    raise exception 'admin or procurement privileges required' using errcode = '42501';
  end if;

  v_actor := admin_actor_member_id(p_actor_member_id);
  if v_actor is null then
    raise exception 'no admin or procurement members row for the calling user'
      using errcode = '42501',
            hint = 'every staff Supabase Auth email must equal their members.nus_email';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'p_lines must be a non-empty JSON array';
  end if;

  select id into strict v_store      from holders where kind = 'store'      and active;
  select id into strict v_adjustment from holders where kind = 'adjustment' and active;

  insert into sessions (member_id, mode, dest_holder_id, source, committed_at,
                        client_token, note)
    values (v_actor, 'restock', v_store, 'admin', now(), p_client_token, p_note)
    on conflict (client_token) do nothing
    returning id into v_session_id;

  if v_session_id is null then
    -- Replay of an already-committed token: return the original session and
    -- write nothing.
    select id into v_session_id from sessions where client_token = p_client_token;
    return v_session_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from products
      where id = (v_line->>'productId')::uuid and active;
    if not found then
      raise exception 'unknown or inactive product %', v_line->>'productId';
    end if;

    v_qty := (v_line->>'qty')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'qty must be a positive integer for product %', v_product.id;
    end if;

    insert into stock_movements (product_id, from_holder_id, to_holder_id, qty,
                                 session_id, actor_member_id, reason, entry_method)
      values (v_product.id, v_adjustment, v_store, v_qty,
              v_session_id, v_actor, 'restock', 'admin');
  end loop;

  return v_session_id;
end; $$;
