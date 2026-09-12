-- Singleton enforcement for the pseudo-holders, plus the indexes the Phase
-- 4/5 read paths need.
--
-- Pre-flight run before applying (must return 3 rows, all count = 1):
--   select kind, count(*) from holders
--    where active and kind in ('store','consumed','adjustment') group by 1;
-- Result: store 1, consumed 1, adjustment 1.
--
-- Do NOT use CREATE INDEX CONCURRENTLY here: the Supabase CLI wraps each
-- migration file in a transaction and CONCURRENTLY is illegal there. At
-- current row counts the lock is single-digit milliseconds.

-- Pseudo-holders are documented as singletons (data-model.md) but nothing
-- enforced it: the existing unique index is on (kind, name), so two active
-- 'store' holders with different names are legal and /admin/holders can
-- create one. submit_cart's `limit 1` would then silently pick one.
create unique index holders_singleton_kind_idx
  on holders (kind)
  where active and kind in ('store', 'consumed', 'adjustment');

-- getReturnSourceHolders() does `select to_holder_id from stock_movements
-- where actor_member_id = ?` on EVERY /api/store/holdings and
-- /holdings/sources call -- the hottest member-facing read path -- with no
-- index on actor_member_id at all. Two columns so it can be index-only.
create index stock_movements_actor_to_idx
  on stock_movements (actor_member_id, to_holder_id);

-- The existing (product_id, created_at desc) cannot serve a globally
-- time-ordered scan: dashboard "recent activity", "sessions per day by mode",
-- and the cron's "asset out > N days" sweep.
create index stock_movements_created_at_idx
  on stock_movements (created_at desc);

-- Mirror of the existing (to_holder_id, product_id). The `holdings` view is a
-- UNION ALL of an inbound and an outbound branch; a qual on holder_id pushes
-- through the GROUP BY into BOTH branches, so today exactly half that plan is
-- indexed. Also makes admin_commit_stocktake's per-product expected-qty
-- subquery two index scans instead of two seq scans, 157 times in a row.
create index stock_movements_from_product_idx
  on stock_movements (from_holder_id, product_id);

-- Member history page, and the integration suite's afterAll cleanup
-- (`delete from sessions where member_id = ? and source = ?`).
create index sessions_member_started_idx
  on sessions (member_id, started_at desc);

-- architecture.md's "sessions per day, by mode" dashboard tile.
create index sessions_mode_started_idx
  on sessions (mode, started_at desc);

-- The bind queue is the UNRESOLVED rows; a partial index stays sized to the
-- queue rather than to all history. (/admin/bind-queue orders created_at desc.)
create index telegram_bind_attempts_open_idx
  on telegram_bind_attempts (created_at desc)
  where resolved_member is null;
