-- The ledger: sessions and stock_movements.
-- Source: docs/tele-qr/data-model.md lines 200-227, plus WP1's additions:
-- CHECK on sessions.mode and sessions.source (design decisions §0.5).

create table sessions (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references members(id),
  mode            text not null,     -- borrow | return | restock | stocktake
  dest_holder_id  uuid references holders(id),  -- robot or member, for borrow
  source          text not null,     -- miniapp | bot | admin
  started_at      timestamptz not null default now(),
  committed_at    timestamptz,
  constraint sessions_mode_check check (mode in ('borrow', 'return', 'restock', 'stocktake')),
  constraint sessions_source_check check (source in ('miniapp', 'bot', 'admin'))
);

create table stock_movements (
  id               bigserial primary key,
  product_id       uuid not null references products(id),
  from_holder_id   uuid not null references holders(id),
  to_holder_id     uuid not null references holders(id),
  qty              integer not null check (qty > 0),
  session_id       uuid references sessions(id),
  actor_member_id  uuid references members(id),
  reason           text,             -- borrow | return | consume | adjust | seed
  scan_code        text,             -- what was scanned, for label diagnostics
  entry_method     text,             -- scan | group_pick | search | admin
  created_at       timestamptz not null default now(),
  constraint no_self_move check (from_holder_id <> to_holder_id)
);
create index on stock_movements (product_id, created_at desc);
create index on stock_movements (to_holder_id, product_id);
create index on stock_movements (session_id);
