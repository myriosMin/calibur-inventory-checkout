-- sessions: idempotency token, stocktake location, free-text note, and a
-- widened mode vocabulary. All additive.

-- One idempotency key for all four write paths. A plain (not partial) unique
-- index: btree unique is NULLS DISTINCT by default, so unlimited token-less
-- sessions coexist and ON CONFLICT inference stays trivial -- a partial index
-- would force `on conflict (client_token) where ...` at every call site.
alter table sessions add column client_token uuid;
create unique index sessions_client_token_key on sessions (client_token);

-- Which shelf this stocktake walked. On the session, not on every count row:
-- one stocktake = one location, and products.location_id is mutable, so the
-- walk's location is otherwise unrecoverable after the fact.
alter table sessions add column location_id uuid references locations(id);

-- "PO 4471, received from Cytron", "recount after the shelf collapse".
alter table sessions add column note text;

-- A correction is not a borrow/return/restock/stocktake. Widening a CHECK can
-- never invalidate an existing row, so this is unconditionally safe.
alter table sessions drop constraint sessions_mode_check;
alter table sessions add constraint sessions_mode_check
  check (mode in ('borrow', 'return', 'restock', 'stocktake', 'correction'));
