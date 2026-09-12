-- stock_counts: make a count holder-scoped, link it to the movement it
-- produced, and constrain its shape.
--
-- Pre-flight run before applying: `select count(*) from stock_counts;` -> 0.
-- (Had it been non-zero, each `set not null` would need splitting into
-- backfill-then-constrain.)

-- A count is holder-scoped: "12 at Hero" and "12 in the store" are different
-- facts, and expected_qty is not interpretable without knowing which holder it
-- snapshotted. Today the column's absence means the table can only ever mean
-- "the store", implicitly.
alter table stock_counts add column holder_id uuid references holders(id);
update stock_counts set holder_id =
  (select id from holders where kind = 'store' and active) where holder_id is null;
alter table stock_counts alter column holder_id set not null;

-- What this count produced. NULL is meaningful and common: zero variance
-- writes no movement (qty > 0 and no_self_move both forbid it) and "counted,
-- matched" is still a fact worth recording. This column plus the atomic commit
-- is why no `applied` flag is needed: a row exists iff it was applied.
alter table stock_counts add column movement_id bigint references stock_movements(id);

alter table stock_counts alter column session_id set not null;

-- One count per product per stocktake. Correctness, not speed: makes a
-- duplicate productId in the payload a loud 23505 rather than two
-- contradictory rows and two stacked corrections.
create unique index stock_counts_session_product_key
  on stock_counts (session_id, product_id);

-- "Variance history for this part".
-- No index on session_id alone -- (session_id, product_id) serves it as a
-- leading-column prefix.
create index stock_counts_product_created_idx
  on stock_counts (product_id, created_at desc);

alter table stock_counts
  add constraint stock_counts_counted_qty_check check (counted_qty >= 0);
