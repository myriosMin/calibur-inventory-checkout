-- RLS: is_admin() helper, RLS enabled on every base table, and policies.
-- Source: plan WP1 §0009 spec, plus design decisions §0.4 (is_admin()).

-- Admins authenticate via Supabase email auth; members.telegram_user_id has
-- nothing to do with that session. This checks that the authenticated
-- Supabase Auth email matches an active admin's members.nus_email.
-- Operational consequence: every admin's Supabase Auth account must be
-- created with an email that exactly matches their members.nus_email row.
create or replace function is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from members m
    where m.nus_email = auth.email() and m.role = 'admin' and m.active
  )
$$;

alter table members enable row level security;
alter table telegram_bind_attempts enable row level security;
alter table holders enable row level security;
alter table locations enable row level security;
alter table products enable row level security;
alter table scan_codes enable row level security;
alter table sessions enable row level security;
alter table stock_movements enable row level security;
alter table stock_counts enable row level security;

-- Admin policy per table: full access, gated by is_admin().
create policy members_admin_all on members
  for all using (is_admin()) with check (is_admin());

create policy holders_admin_all on holders
  for all using (is_admin()) with check (is_admin());

create policy locations_admin_all on locations
  for all using (is_admin()) with check (is_admin());

create policy products_admin_all on products
  for all using (is_admin()) with check (is_admin());

create policy scan_codes_admin_all on scan_codes
  for all using (is_admin()) with check (is_admin());

create policy sessions_admin_all on sessions
  for all using (is_admin()) with check (is_admin());

create policy stock_counts_admin_all on stock_counts
  for all using (is_admin()) with check (is_admin());

-- telegram_bind_attempts: admin-only, no member policy at all (matches docs:
-- "admin-only").
create policy telegram_bind_attempts_admin_all on telegram_bind_attempts
  for all using (is_admin()) with check (is_admin());

-- stock_movements: admin full access, plus a member-read-own-movements
-- policy. This member policy is currently unreachable in Phases 1-3 since
-- members never hold a Supabase Auth session (all member access is via the
-- service-role key from /api/store/*, which bypasses RLS entirely); included
-- for spec completeness and any future direct-read surface.
create policy stock_movements_admin_all on stock_movements
  for all using (is_admin()) with check (is_admin());

create policy stock_movements_member_select_own on stock_movements
  for select using (
    actor_member_id in (select id from members where nus_email = auth.email())
  );
