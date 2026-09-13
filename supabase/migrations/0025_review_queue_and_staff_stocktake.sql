-- Review queue for the catalog go-live, and stocktake for procurement.
--
-- Source: docs/data-cleaning.md. The cleaned catalog is imported and then
-- reviewed IN the dashboard by the people who run the store, instead of as
-- CSVs. review_items carries every flag the clean-up raised, so a reviewer
-- sees *why* a product needs a look next to the product itself, and closing
-- one records who decided and when.

-- ---------------------------------------------------------------------------
-- review_items
-- ---------------------------------------------------------------------------

create table review_items (
  id               bigserial primary key,
  severity         text not null,
  -- What kind of thing the item is about: product | unit | loan | member | bom | legacy.
  -- Free text on purpose: the next review (the mechanical sheet) will bring
  -- its own kinds, and nothing branches on this column.
  entity           text not null,
  -- Human-readable subject, e.g. the product or unit name.
  subject          text not null,
  product_id       uuid references products(id),
  issue            text not null,
  status           text not null default 'open',
  resolution_note  text,
  resolved_by      uuid references members(id),
  resolved_at      timestamptz,
  source           text,
  created_at       timestamptz not null default now(),
  constraint review_items_severity_check check (severity in ('blocker', 'check', 'info')),
  constraint review_items_status_check check (status in ('open', 'resolved', 'dismissed')),
  constraint review_items_resolution_shape check ((status = 'open') = (resolved_at is null))
);

create index review_items_open_idx on review_items (severity, id) where status = 'open';
create index review_items_product_idx on review_items (product_id) where product_id is not null;

-- Who closed it is stamped from the session, never taken from the client:
-- a reviewer cannot record a decision under someone else's name.
create or replace function review_items_stamp_resolution()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'open' then
      new.resolved_at := null;
      new.resolved_by := null;
    else
      new.resolved_at := now();
      -- Readable under RLS for staff via members_select_self (0024).
      new.resolved_by := (select m.id from members m where m.nus_email = auth.email() and m.active);
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function review_items_stamp_resolution() from public, anon;

create trigger review_items_stamp_resolution
before update on review_items
for each row execute function review_items_stamp_resolution();

alter table review_items enable row level security;
create policy review_items_admin_all on review_items
  for all using (is_admin()) with check (is_admin());
create policy review_items_staff_select on review_items
  for select using (is_staff());
create policy review_items_staff_insert on review_items
  for insert with check (is_staff());
create policy review_items_staff_update on review_items
  for update using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- Stocktake for procurement
-- ---------------------------------------------------------------------------

-- Correcting a count is the only way a reviewer can fix a number (the ledger
-- is append-only, 0021), and every correction is a stock_counts row plus a
-- signed movement, reversible by an admin. Reversal itself stays admin-only.
create policy stock_counts_staff_insert on stock_counts
  for insert with check (is_staff());
create policy sessions_staff_insert_stocktake on sessions
  for insert with check (is_staff() and mode = 'stocktake');
create policy stock_movements_staff_insert_stocktake on stock_movements
  for insert with check (is_staff() and reason in ('stocktake_gain', 'stocktake_loss'));

-- Verbatim from 0022 except the guard (is_staff), and procurement may only
-- count the store or a robot: writing a loss against a member's personal
-- holder is an accusation, and stays an admin decision.
create or replace function admin_commit_stocktake(
  p_counts jsonb,
  p_holder_id uuid default null,
  p_location_id uuid default null,
  p_note text default null,
  p_client_token uuid default null,
  p_actor_member_id uuid default null
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_actor uuid;
  v_holder uuid;
  v_adjustment uuid;
  v_session_id uuid;
  v_count jsonb;
  v_product record;
  v_pid uuid;
  v_counted int;
  v_expected int;
  v_variance int;
  v_movement_id bigint;
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

  if p_counts is null or jsonb_typeof(p_counts) <> 'array' or jsonb_array_length(p_counts) = 0 then
    raise exception 'p_counts must be a non-empty JSON array';
  end if;

  select id into strict v_adjustment from holders where kind = 'adjustment' and active;

  if p_holder_id is not null then
    select id into v_holder from holders where id = p_holder_id and active;
    if v_holder is null then
      raise exception 'unknown or inactive holder %', p_holder_id;
    end if;
  else
    select id into strict v_holder from holders where kind = 'store' and active;
  end if;

  if v_holder = v_adjustment then
    raise exception 'the adjustment pseudo-holder cannot be stocktaken';
  end if;

  if not (is_admin() or current_user = 'service_role')
     and not exists (select 1 from holders where id = v_holder and kind in ('store', 'robot')) then
    raise exception 'procurement can only stocktake the store or a robot' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('stocktake:' || v_holder::text));

  insert into sessions (member_id, mode, dest_holder_id, source, committed_at,
                        location_id, note, client_token)
    values (v_actor, 'stocktake', v_holder, 'admin', now(),
            p_location_id, p_note, p_client_token)
    on conflict (client_token) do nothing
    returning id into v_session_id;

  if v_session_id is null then
    select id into v_session_id from sessions where client_token = p_client_token;
    return v_session_id;
  end if;

  for v_count in select * from jsonb_array_elements(p_counts) loop
    v_pid := (v_count->>'productId')::uuid;
    select * into v_product from products where id = v_pid and active;
    if not found then
      raise exception 'unknown or inactive product %', v_count->>'productId';
    end if;

    v_counted := (v_count->>'countedQty')::int;
    if v_counted is null or v_counted < 0 then
      raise exception 'countedQty must be a non-negative integer for product %', v_pid;
    end if;

    -- Recompute `expected` server-side; see 0022 for why `as delta` matters.
    select coalesce(sum(delta), 0)::int into v_expected from (
      select  qty as delta from stock_movements
        where to_holder_id   = v_holder and product_id = v_pid
      union all
      select -qty from stock_movements
        where from_holder_id = v_holder and product_id = v_pid
    ) s;

    v_variance := v_counted - v_expected;
    v_movement_id := null;

    if v_variance > 0 then
      insert into stock_movements (product_id, from_holder_id, to_holder_id, qty,
                                   session_id, actor_member_id, reason, entry_method)
        values (v_pid, v_adjustment, v_holder, v_variance,
                v_session_id, v_actor, 'stocktake_gain', 'admin')
        returning id into v_movement_id;
    elsif v_variance < 0 then
      insert into stock_movements (product_id, from_holder_id, to_holder_id, qty,
                                   session_id, actor_member_id, reason, entry_method)
        values (v_pid, v_holder, v_adjustment, -v_variance,
                v_session_id, v_actor, 'stocktake_loss', 'admin')
        returning id into v_movement_id;
    end if;

    insert into stock_counts (product_id, holder_id, counted_qty, expected_qty,
                              counted_by, session_id, movement_id, note)
      values (v_pid, v_holder, v_counted, v_expected,
              v_actor, v_session_id, v_movement_id, v_count->>'note');
  end loop;

  return v_session_id;
end; $$;
