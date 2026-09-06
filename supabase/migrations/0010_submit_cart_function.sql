-- submit_cart: the single-transaction cart submission function.
-- Source: plan §8 WP14 "submit_cart function contract" — normative, given
-- verbatim there. security definer + set search_path = public per WP1's
-- file spec (§5 WP1, file 0010 description).

create or replace function submit_cart(
  p_member_id uuid, p_mode text, p_dest_holder_id uuid,
  p_source_holder_id uuid, p_source text, p_lines jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_session_id uuid;
  v_store_id uuid; v_consumed_id uuid;
  v_line jsonb; v_product record; v_to_holder uuid; v_reason text;
  v_held_qty numeric;
begin
  select id into v_store_id from holders where kind='store' and active limit 1;
  select id into v_consumed_id from holders where kind='consumed' and active limit 1;
  insert into sessions (member_id, mode, dest_holder_id, source, committed_at)
    values (p_member_id, p_mode, p_dest_holder_id, p_source, now())
    returning id into v_session_id;

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

-- Postgres grants EXECUTE on new functions to PUBLIC by default, and
-- PostgREST auto-exposes every function in an exposed schema as an RPC
-- endpoint. submit_cart is SECURITY DEFINER and takes p_member_id as a plain
-- argument rather than deriving it from the caller's session, so without this
-- revoke, anyone holding the public anon key could call
-- /rest/v1/rpc/submit_cart directly and write arbitrary stock movements as
-- any member -- bypassing the initData validation that /api/store/cart/submit
-- is supposed to enforce. Only the server's service-role client may call it.
revoke execute on function submit_cart(uuid, text, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function submit_cart(uuid, text, uuid, uuid, text, jsonb) to service_role;
