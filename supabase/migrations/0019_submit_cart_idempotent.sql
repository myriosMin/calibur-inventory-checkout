-- submit_cart gains p_client_token (idempotency) and `into strict` holder
-- lookups. Revert by re-applying 0010_submit_cart_function.sql.
--
-- `create or replace` CANNOT add a parameter -- it would create a second
-- overload, and PostgREST then resolves RPCs by body-key set, a latent
-- ambiguity bug. So: drop and recreate.
--
-- The per-line loop below is copied byte-for-byte from 0010. Do not "improve"
-- it. p_client_token defaults NULL and a NULL never conflicts on a
-- NULLS-DISTINCT unique index, so an omitting caller gets byte-identical 0010
-- behaviour.

drop function if exists submit_cart(uuid, text, uuid, uuid, text, jsonb);

create function submit_cart(
  p_member_id uuid, p_mode text, p_dest_holder_id uuid,
  p_source_holder_id uuid, p_source text, p_lines jsonb,
  p_client_token uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_session_id uuid;
  v_store_id uuid; v_consumed_id uuid;
  v_line jsonb; v_product record; v_to_holder uuid; v_reason text;
  v_held_qty numeric;
begin
  -- `into strict` replaces 0010's `limit 1`, now that 0016 enforces exactly
  -- one active holder per pseudo-kind. A second active 'store' must be a loud
  -- failure, not an arbitrary pick.
  select id into strict v_store_id    from holders where kind='store'    and active;
  select id into strict v_consumed_id from holders where kind='consumed' and active;

  -- IDEMPOTENCY. The client mints one token per cart and reuses it across
  -- retries; architecture.md's "keep the cart and show a retry" contract makes
  -- a timed-out-but-committed request routine, not an edge case.
  -- ON CONFLICT DO NOTHING rather than SELECT-then-INSERT: it closes the race
  -- against a concurrent double-tap, blocking on the in-flight inserter's row
  -- lock and finding the row on the re-read afterwards (READ COMMITTED takes a
  -- fresh snapshot per statement).
  insert into sessions (member_id, mode, dest_holder_id, source, committed_at,
                        client_token)
    values (p_member_id, p_mode, p_dest_holder_id, p_source, now(), p_client_token)
    on conflict (client_token) do nothing
    returning id into v_session_id;

  if v_session_id is null then
    -- Already committed under this token: return the original session id and
    -- write nothing. The caller gets a 200 and its cart clears, which is
    -- correct for both a double-tap and a retry-after-timeout.
    select id into v_session_id from sessions where client_token = p_client_token;
    return v_session_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from products where id = (v_line->>'productId')::uuid and active;
    if not found then raise exception 'unknown or inactive product %', v_line->>'productId'; end if;

    if p_mode = 'borrow' then
      if v_product.returnable then
        v_to_holder := p_dest_holder_id; v_reason := 'borrow';
      else
        -- dest is a robot holder vs the member's personal holder: see §0 decision #2
        if exists (select 1 from holders where id = p_dest_holder_id and kind = 'robot') then
          v_to_holder := p_dest_holder_id; v_reason := 'consume';
        else
          v_to_holder := v_consumed_id; v_reason := 'consume';
        end if;
      end if;
      insert into stock_movements (product_id, from_holder_id, to_holder_id, qty, session_id, actor_member_id, reason, scan_code, entry_method)
        values (v_product.id, v_store_id, v_to_holder, (v_line->>'qty')::int, v_session_id, p_member_id, v_reason, v_line->>'scanCode', v_line->>'entryMethod');

    elsif p_mode = 'return' then
      select coalesce(sum(delta),0) into v_held_qty from (
        select qty as delta from stock_movements where to_holder_id = p_source_holder_id and product_id = v_product.id
        union all
        select -qty from stock_movements where from_holder_id = p_source_holder_id and product_id = v_product.id
      ) s;
      if (v_line->>'qty')::int <= v_held_qty then
        insert into stock_movements (product_id, from_holder_id, to_holder_id, qty, session_id, actor_member_id, reason, entry_method)
          values (v_product.id, p_source_holder_id, v_store_id, (v_line->>'qty')::int, v_session_id, p_member_id, 'return', v_line->>'entryMethod');
      else
        if v_held_qty > 0 then
          insert into stock_movements (product_id, from_holder_id, to_holder_id, qty, session_id, actor_member_id, reason, entry_method)
            values (v_product.id, p_source_holder_id, v_store_id, v_held_qty, v_session_id, p_member_id, 'return', v_line->>'entryMethod');
        end if;
        insert into stock_movements (product_id, from_holder_id, to_holder_id, qty, session_id, actor_member_id, reason, entry_method)
          values (v_product.id, (select id from holders where kind='adjustment' and active limit 1), v_store_id, (v_line->>'qty')::int - v_held_qty, v_session_id, p_member_id, 'return_adjustment', v_line->>'entryMethod');
      end if;
    end if;
  end loop;

  return v_session_id;
end;
$$;

-- Same rationale as 0010's revoke: submit_cart is SECURITY DEFINER and takes
-- p_member_id as a plain argument rather than deriving it from the caller's
-- session, so anyone holding the public anon key could otherwise write
-- arbitrary stock movements as any member. Only the server's service-role
-- client may call it. `public` first -- a role-specific revoke does not
-- override the implicit PUBLIC grant (the migration-0014 lesson).
revoke execute on function submit_cart(uuid, text, uuid, uuid, text, jsonb, uuid)
  from public, anon, authenticated;
grant  execute on function submit_cart(uuid, text, uuid, uuid, text, jsonb, uuid)
  to service_role;
