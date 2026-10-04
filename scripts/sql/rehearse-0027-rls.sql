-- RLS rehearsal for migration 0027 (build lists). ALWAYS ROLLS BACK: it ends
-- by raising an exception carrying the report. Each check runs as
-- `authenticated` with a forged JWT email, the way PostgREST would.
--
--   { echo 'begin;'; echo 'set local search_path = test;'; cat scripts/sql/rehearse-0027-rls.sql; } > /tmp/r.sql
--   supabase db query --linked -f /tmp/r.sql
--
-- (swap `test` for `public` to check the real schema).

do $$
declare
  v_report text := '';
  v_n bigint;
  v_list uuid;
begin
  insert into members (full_name, nus_email, role) values
    ('RLS probe: procurement', 'rls-probe-procurement@example.invalid', 'procurement'),
    ('RLS probe: member', 'rls-probe-member@example.invalid', 'member');

  -- ---- procurement --------------------------------------------------------
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"rls-probe-procurement@example.invalid"}', true);
  perform set_config('request.jwt.claim.email', 'rls-probe-procurement@example.invalid', true);
  execute 'set local role authenticated';

  select count(*) into v_n from build_list_lines;
  v_report := v_report || format('PROCUREMENT lines visible=%s; ', v_n);
  insert into build_lists (season, name) values ('RLS', 'probe') returning id into v_list;
  insert into build_list_lines (build_list_id, position, part_name, qty) values (v_list, 1, 'probe', 1);
  update build_list_lines set qty = 2 where build_list_id = v_list;
  delete from build_lists where id = v_list;
  get diagnostics v_n = row_count;
  v_report := v_report || format('insert/update/delete ok (deleted %s); ', v_n);

  -- ---- member -------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"rls-probe-member@example.invalid"}', true);
  perform set_config('request.jwt.claim.email', 'rls-probe-member@example.invalid', true);
  execute 'set local role authenticated';

  select count(*) into v_n from build_list_lines;
  v_report := v_report || format('MEMBER lines visible=%s (expect 0); ', v_n);
  begin
    insert into build_lists (season, name) values ('RLS', 'member probe');
    v_report := v_report || 'member insert ALLOWED (BAD); ';
  exception when others then
    v_report := v_report || 'member insert refused; ';
  end;

  -- ---- anon ---------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.email', '', true);
  execute 'set local role anon';
  -- is_staff() is not executable by anon (0024), so anon is refused outright.
  begin
    select count(*) into v_n from build_lists;
    v_report := v_report || format('ANON lists visible=%s (expect refused or 0)', v_n);
  exception when insufficient_privilege then
    v_report := v_report || 'ANON refused';
  end;

  raise exception 'RLS 0027 REHEARSAL, rolled back: %', v_report;
end $$;
