-- stock_movements is append-only, and a correction points at what it reverses.

-- data-model.md: "stock_movements is append-only. Corrections are new rows,
-- never deletes." Nothing enforced it: admin_all is FOR ALL, so a signed-in
-- admin could DELETE the very row a discrepancy points at. Splitting FOR ALL
-- into SELECT + INSERT leaves UPDATE and DELETE with no matching policy, and
-- RLS default-denies without one.
--
-- Verified safe: zero references to stock_movements anywhere in
-- src/app/admin/**, so no admin page loses a capability. The integration
-- suite's afterAll DOES delete movements, but through getServiceRoleClient(),
-- which bypasses RLS. submit_cart is SECURITY DEFINER owned by the table owner
-- (FORCE ROW LEVEL SECURITY is not set), so it bypasses RLS too.
drop policy stock_movements_admin_all on stock_movements;

create policy stock_movements_admin_select on stock_movements
  for select using (is_admin());
create policy stock_movements_admin_insert on stock_movements
  for insert with check (is_admin());

-- Deliberately NOT a BEFORE UPDATE OR DELETE trigger: a trigger would also
-- catch service_role and break the integration suite's cleanup, and since
-- service_role can already do anything it would be cosmetic.

-- Links a correction to the row it reverses -- makes "already reversed" a JOIN
-- rather than prose, and the partial unique index makes double-reversal
-- structurally impossible rather than check-then-act.
alter table stock_movements
  add column reverses_movement_id bigint references stock_movements(id);
create unique index stock_movements_reverses_key
  on stock_movements (reverses_movement_id)
  where reverses_movement_id is not null;
alter table stock_movements
  add constraint stock_movements_no_self_reverse
  check (reverses_movement_id is null or reverses_movement_id <> id);
