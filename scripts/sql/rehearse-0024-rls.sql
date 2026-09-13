-- Rehearsal of the procurement RLS from migrations 0024 and 0025 against a
-- real database. ALWAYS ROLLS BACK: it ends by raising an exception carrying
-- the report.
--
-- Run it in the same transaction as the migration text:
--
--   { echo 'begin;'; cat supabase/migrations/0024_*.sql supabase/migrations/0025_*.sql \
--       scripts/sql/rehearse-0024-rls.sql; } > /tmp/rehearse.sql
--   supabase db query --linked -f /tmp/rehearse.sql
--
-- Once both are applied, run this file on its own (still wrapped in begin;).
-- The RLS bugs this project has already hit were invisible to service-role
-- tests (checkpoint.md), so every check here runs as `authenticated` with a
-- forged JWT email, the way PostgREST would.

do $$
declare
  v_report text := '';
  v_n bigint;
  v_ok boolean;
  v_product uuid;
  v_store uuid;
  v_consumed uuid;
  v_robot uuid;
  v_member_holder uuid;
  v_procurement uuid;
  v_review bigint;
begin
  -- Fixtures, written as the owner. Rolled back with everything else.
  insert into members (full_name, nus_email, role)
    values ('RLS probe: procurement', 'rls-probe-procurement@example.invalid', 'procurement')
    returning id into v_procurement;
  insert into members (full_name, nus_email, role) values
    ('RLS probe: member', 'rls-probe-member@example.invalid', 'member'),
    ('RLS probe: admin', 'rls-probe-admin@example.invalid', 'admin');
  select h.id into strict v_member_holder from holders h join members m on m.id = h.member_id
   where m.nus_email = 'rls-probe-member@example.invalid';
  select id into v_product from products where active order by created_at limit 1;
  if v_product is null then
    insert into products (name, tier) values ('RLS probe product', 'bulk') returning id into v_product;
  end if;
  select id into strict v_store from holders where kind = 'store' and active;
  select id into strict v_consumed from holders where kind = 'consumed' and active;
  select id into v_robot from holders where kind = 'robot' and active order by name limit 1;
  if v_robot is null then
    insert into holders (kind, name) values ('robot', 'RLS probe robot') returning id into v_robot;
  end if;
  insert into review_items (severity, entity, subject, product_id, issue)
    values ('check', 'product', 'RLS probe', v_product, 'probe issue')
    returning id into v_review;

  -- ---- procurement --------------------------------------------------------
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"rls-probe-procurement@example.invalid"}', true);
  perform set_config('request.jwt.claim.email', 'rls-probe-procurement@example.invalid', true);
  execute 'set local role authenticated';

  select count(*) into v_n from products;
  v_report := v_report || format('PROCUREMENT products visible=%s; ', v_n);
  select count(*) into v_n from members;
  v_report := v_report || format('members visible=%s (expect 1); ', v_n);
  select count(*) into v_n from telegram_bind_attempts;
  v_report := v_report || format('bind attempts visible=%s (expect 0); ', v_n);

  begin
    perform admin_restock(jsonb_build_array(jsonb_build_object('productId', v_product, 'qty', 1)), 'rls probe');
    v_report := v_report || 'restock ok; ';
  exception when others then
    v_report := v_report || format('restock FAILED (%s); ', sqlerrm);
  end;

  begin
    insert into stock_movements (product_id, from_holder_id, to_holder_id, qty, reason)
      values (v_product, v_store, v_consumed, 1, 'consume');
    v_report := v_report || 'consume insert ALLOWED (BAD); ';
  exception when others then
    v_report := v_report || 'consume insert blocked; ';
  end;

  begin
    perform admin_commit_stocktake(jsonb_build_array(jsonb_build_object('productId', v_product, 'countedQty', 0)));
    v_report := v_report || 'store stocktake ok; ';
  exception when others then
    v_report := v_report || format('store stocktake FAILED (%s); ', sqlerrm);
  end;

  begin
    perform admin_commit_stocktake(jsonb_build_array(jsonb_build_object('productId', v_product, 'countedQty', 2)), v_robot);
    v_report := v_report || 'robot stocktake ok; ';
  exception when others then
    v_report := v_report || format('robot stocktake FAILED (%s); ', sqlerrm);
  end;

  begin
    perform admin_commit_stocktake(jsonb_build_array(jsonb_build_object('productId', v_product, 'countedQty', 0)), v_member_holder);
    v_report := v_report || 'member-holder stocktake ALLOWED (BAD); ';
  exception when others then
    v_report := v_report || 'member-holder stocktake blocked; ';
  end;

  begin
    perform admin_reverse_movement((select max(id) from stock_movements));
    v_report := v_report || 'reversal ALLOWED (BAD); ';
  exception when others then
    v_report := v_report || 'reversal blocked; ';
  end;

  begin
    insert into products (name, tier, criticality) values ('RLS probe: new product', 'bulk', 'expendable');
    v_report := v_report || 'product insert ok; ';
  exception when others then
    v_report := v_report || format('product insert FAILED (%s); ', sqlerrm);
  end;

  begin
    insert into scan_codes (code, kind, product_id) values ('rlsprb', 'product', v_product);
    v_report := v_report || 'scan code insert ALLOWED (BAD); ';
  exception when others then
    v_report := v_report || 'scan code insert blocked; ';
  end;

  update members set role = 'admin' where nus_email = 'rls-probe-procurement@example.invalid';
  get diagnostics v_n = row_count;
  v_report := v_report || format('self-promotion rows=%s (expect 0); ', v_n);

  select count(*) into v_n from review_items;
  v_report := v_report || format('review items visible=%s; ', v_n);
  update review_items set status = 'resolved', resolution_note = 'probe' where id = v_review;
  get diagnostics v_n = row_count;
  select resolved_by = v_procurement and resolved_at is not null into v_ok from review_items where id = v_review;
  v_report := v_report || format('resolve rows=%s stamped-by-self=%s; ', v_n, v_ok);

  execute 'reset role';

  -- ---- plain member -------------------------------------------------------
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"rls-probe-member@example.invalid"}', true);
  perform set_config('request.jwt.claim.email', 'rls-probe-member@example.invalid', true);
  execute 'set local role authenticated';

  select count(*) into v_n from products;
  v_report := v_report || format('| MEMBER products visible=%s (expect 0); ', v_n);
  select count(*) into v_n from review_items;
  v_report := v_report || format('review items visible=%s (expect 0); ', v_n);
  begin
    perform admin_restock(jsonb_build_array(jsonb_build_object('productId', v_product, 'qty', 1)));
    v_report := v_report || 'restock ALLOWED (BAD); ';
  exception when others then
    v_report := v_report || 'restock blocked; ';
  end;
  begin
    perform admin_commit_stocktake(jsonb_build_array(jsonb_build_object('productId', v_product, 'countedQty', 0)));
    v_report := v_report || 'stocktake ALLOWED (BAD); ';
  exception when others then
    v_report := v_report || 'stocktake blocked; ';
  end;

  execute 'reset role';

  -- ---- admin: nothing lost ------------------------------------------------
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"rls-probe-admin@example.invalid"}', true);
  perform set_config('request.jwt.claim.email', 'rls-probe-admin@example.invalid', true);
  execute 'set local role authenticated';

  select count(*) into v_n from members;
  v_report := v_report || format('| ADMIN members visible=%s; ', v_n);
  begin
    perform admin_commit_stocktake(jsonb_build_array(jsonb_build_object('productId', v_product, 'countedQty', 0)), v_member_holder);
    v_report := v_report || 'member-holder stocktake ok; ';
  exception when others then
    v_report := v_report || format('member-holder stocktake FAILED (%s); ', sqlerrm);
  end;
  begin
    insert into asset_units (product_id, unit_code) values (v_product, 'RLS-PROBE-01');
    v_report := v_report || 'asset unit insert ok; ';
  exception when others then
    v_report := v_report || format('asset unit insert FAILED (%s); ', sqlerrm);
  end;

  execute 'reset role';

  raise exception 'RLS REHEARSAL (rolled back): %', v_report;
end $$;
