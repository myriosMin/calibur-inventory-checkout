-- scan_misses: the failed-resolve log.
--
-- architecture.md's observability list wants "unknown or retired codes
-- scanned, with counts". /api/store/resolve 404s today without recording
-- anything, so a label that has fallen off is invisible until someone
-- complains.
--
-- Scope note: the scan-vs-search ratio is ALREADY derivable from
-- stock_movements.entry_method for every item that reached a cart, which is
-- exactly what that column is for. The only genuinely uncaptured event is the
-- failed resolve, so this logs misses only -- a full scan_events log would be
-- an order of magnitude more rows for one extra denominator.
create table scan_misses (
  id         bigserial primary key,
  code       text not null,
  -- Why it missed. The API deliberately returns ONE indistinguishable 404 for
  -- all of these (the UI must not reveal "retired" vs "never existed"); this
  -- column is the private version and does not leak.
  outcome    text not null check (outcome in (
               'unknown',           -- no scan_codes row
               'retired',           -- scan_codes.active = false
               'inactive_product',  -- resolves to a deactivated product
               'missing_target'     -- corrupt row: kind set, target null
             )),
  member_id  uuid references members(id),
  created_at timestamptz not null default now()
);

create index scan_misses_code_created_idx on scan_misses (code, created_at desc);
create index scan_misses_created_idx on scan_misses (created_at desc);

alter table scan_misses enable row level security;
create policy scan_misses_admin_select on scan_misses
  for select using (is_admin());
-- No INSERT policy on purpose: the only writer is /api/store/resolve via
-- getServiceRoleClient(), which bypasses RLS. Supabase's default privileges
-- grant table-level rights to anon/authenticated on new public tables, so RLS
-- is what stands in the way -- with no INSERT policy neither role can write,
-- and only admins can read.
