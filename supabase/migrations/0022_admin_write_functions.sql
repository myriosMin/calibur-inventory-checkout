-- Admin write functions: restock, stocktake commit, movement reversal.
--
-- SECURITY MODEL -- read before editing.
--
-- These are SECURITY INVOKER, NOT SECURITY DEFINER. Admins already hold
-- unrestricted INSERT on sessions / stock_movements / stock_counts via the
-- `<table>_admin_*` policies WITH CHECK (is_admin()). A DEFINER function
-- gated on is_admin() would therefore grant *zero* extra capability while
-- adding a permanent RLS-bypass path whose guard must stay correct forever.
-- INVOKER gets identical behaviour with no new bypass: these functions are
-- atomicity wrappers over writes the caller could already perform one at a
-- time. The internal is_admin() guard below stays, but it is a fail-fast
-- error message, NOT the security boundary -- RLS is.
--
-- submit_cart stays SECURITY DEFINER + service-role-only, because it takes
-- p_member_id as an unchecked parameter. Do not harmonise them.
--
-- Grant shape, order matters (the migration-0014 lesson: a role-specific
-- REVOKE does not override the implicit PUBLIC grant):
--   revoke execute ... from public, anon;
--   grant  execute ... to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helper: map the calling role to the members row that should own the write.
-- ---------------------------------------------------------------------------
create or replace function admin_actor_member_id(p_fallback uuid)
returns uuid language plpgsql stable security invoker set search_path = public as $$
declare v_id uuid;
begin
  -- `current_user` under SECURITY INVOKER is the role PostgREST switched to and
  -- is NOT forgeable by a request body. p_fallback is honoured ONLY here, for
  -- scripts/tests: service_role already bypasses RLS entirely, so this grants
  -- it nothing it could not do with a direct INSERT.
  -- NOTE: sound ONLY because this is SECURITY INVOKER. If anyone flips it to
  -- DEFINER, current_user becomes the owner and this silently opens an
  -- impersonation hole. Do not flip it.
  if current_user = 'service_role' then
    return p_fallback;
  end if;
  select m.id into v_id from members m
   where m.nus_email = auth.email() and m.role = 'admin' and m.active;
  return v_id;   -- null => caller could not be mapped to an admin member row
end; $$;

revoke execute on function admin_actor_member_id(uuid) from public, anon;
grant  execute on function admin_actor_member_id(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- admin_restock: newly received stock, adjustment -> store, one session.
-- Line shape: [{"productId": uuid, "qty": int}, ...]
-- ---------------------------------------------------------------------------
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
  if not (is_admin() or current_user = 'service_role') then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;

  v_actor := admin_actor_member_id(p_actor_member_id);
  if v_actor is null then
    raise exception 'no admin members row for the calling user'
      using errcode = '42501',
            hint = 'every admin''s Supabase Auth email must equal their members.nus_email';
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

revoke execute on function admin_restock(jsonb, text, uuid, uuid) from public, anon;
grant  execute on function admin_restock(jsonb, text, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- admin_commit_stocktake: counted quantities -> variance corrections.
-- Count shape: [{"productId": uuid, "countedQty": int, "note": text?}, ...]
-- ---------------------------------------------------------------------------
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
  if not (is_admin() or current_user = 'service_role') then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;

  v_actor := admin_actor_member_id(p_actor_member_id);
  if v_actor is null then
    raise exception 'no admin members row for the calling user'
      using errcode = '42501',
            hint = 'every admin''s Supabase Auth email must equal their members.nus_email';
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

  -- Two admins counting the same shelf would each read the same
  -- pre-correction `expected` and each write a full correction, doubling it.
  -- Transaction-scoped, so it releases on commit or rollback with no unlock
  -- path to forget.
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

    -- Recompute `expected` server-side. NEVER trust the client's number --
    -- what the admin saw may be an hour old; the ledger at commit time is the
    -- only defensible baseline.
    -- `as delta` on the first branch is load-bearing: without it the
    -- subquery's columns are named `qty` and `?column?`, and sum(delta)
    -- fails at RUNTIME with 42703 -- plpgsql does not parse SQL inside a
    -- function body at CREATE time, so the migration applies clean and the
    -- first real stocktake is what blows up. Same shape as submit_cart's
    -- held-qty subquery in 0010.
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
    -- variance = 0 -> NO movement (qty > 0 and no_self_move both forbid it);
    -- the stock_counts row alone records "counted, matched".

    insert into stock_counts (product_id, holder_id, counted_qty, expected_qty,
                              counted_by, session_id, movement_id, note)
      values (v_pid, v_holder, v_counted, v_expected,
              v_actor, v_session_id, v_movement_id, v_count->>'note');
  end loop;

  return v_session_id;
end; $$;

revoke execute on function admin_commit_stocktake(jsonb, uuid, uuid, text, uuid, uuid)
  from public, anon;
grant  execute on function admin_commit_stocktake(jsonb, uuid, uuid, text, uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- admin_reverse_movement: write the mirror of a mistaken movement.
--
-- Out of scope, deliberately: partial reversal ("undo 3 of the 5"). That is
-- not a reversal but an adjustment with a different quantity; keeping
-- reverses_movement_id a clean 1:1 is worth more. If ever needed it is a
-- fourth function, not a parameter.
-- ---------------------------------------------------------------------------
create or replace function admin_reverse_movement(
  p_movement_id bigint,
  p_note text default null,
  p_client_token uuid default null,
  p_actor_member_id uuid default null
) returns bigint language plpgsql security invoker set search_path = public as $$
declare
  v_actor uuid;
  v_orig stock_movements;
  v_session_id uuid;
  v_new_id bigint;
begin
  if not (is_admin() or current_user = 'service_role') then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;

  v_actor := admin_actor_member_id(p_actor_member_id);
  if v_actor is null then
    raise exception 'no admin members row for the calling user'
      using errcode = '42501',
            hint = 'every admin''s Supabase Auth email must equal their members.nus_email';
  end if;

  select * into v_orig from stock_movements where id = p_movement_id;
  if not found then
    raise exception 'unknown movement %', p_movement_id;
  end if;

  if v_orig.reason = 'correction' then
    raise exception 'movement % is itself a correction; reverse the original',
      p_movement_id;
  end if;

  -- Advisory only; the partial unique index from 0021 is the real guarantee,
  -- turning a concurrent double-reverse into a 23505.
  if exists (select 1 from stock_movements where reverses_movement_id = p_movement_id) then
    raise exception 'movement % has already been reversed', p_movement_id;
  end if;

  insert into sessions (member_id, mode, dest_holder_id, source, committed_at,
                        client_token, note)
    values (v_actor, 'correction', v_orig.from_holder_id, 'admin', now(),
            p_client_token, p_note)
    on conflict (client_token) do nothing
    returning id into v_session_id;

  if v_session_id is null then
    -- Replay: find the correction written under this token.
    select sm.id into v_new_id
      from stock_movements sm
      join sessions s on s.id = sm.session_id
     where s.client_token = p_client_token
       and sm.reverses_movement_id = p_movement_id;
    return v_new_id;
  end if;

  -- The mirror: from/to swapped, same product and qty.
  insert into stock_movements (product_id, from_holder_id, to_holder_id, qty,
                               session_id, actor_member_id, reason, entry_method,
                               reverses_movement_id)
    values (v_orig.product_id, v_orig.to_holder_id, v_orig.from_holder_id,
            v_orig.qty, v_session_id, v_actor, 'correction', 'admin', v_orig.id)
    returning id into v_new_id;

  return v_new_id;
end; $$;

revoke execute on function admin_reverse_movement(bigint, text, uuid, uuid) from public, anon;
grant  execute on function admin_reverse_movement(bigint, text, uuid, uuid) to authenticated, service_role;
