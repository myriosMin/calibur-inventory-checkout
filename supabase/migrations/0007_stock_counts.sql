-- Stocktake: first-class stock counts (not admin-faked edits).
-- Source: docs/tele-qr/data-model.md lines 275-285, verbatim.

create table stock_counts (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id),
  counted_qty   integer not null,
  expected_qty  integer not null,   -- snapshot of holdings at count time
  counted_by    uuid references members(id),
  session_id    uuid references sessions(id),
  note          text,
  created_at    timestamptz not null default now()
);
