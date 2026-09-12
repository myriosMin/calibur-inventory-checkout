-- Constrain stock_movements.reason and .entry_method to the vocabulary the
-- code actually writes.
--
-- Pre-flight run before applying:
--   select reason, count(*) from stock_movements group by 1 order by 2 desc;
--   select count(*) from stock_movements where reason is null;
-- Result: seed 20, return 6, consume 4, borrow 4; 0 nulls. entry_method was
-- likewise checked: admin 20, scan 7, search 6, group_pick 1, 0 nulls.
--
-- stocktake_gain/stocktake_loss replace the docs' never-written `adjust`:
-- the sign is recoverable from holder direction, but splitting them makes
-- `where reason = 'stocktake_loss'` the entire variance query instead of a
-- join to holders.
--
-- NOT VALID then VALIDATE as separate statements so the existing-row scan is
-- separately revertable.
alter table stock_movements
  add constraint stock_movements_reason_check
  check (reason is not null and reason in (
    'borrow',             -- member takes a returnable asset       (submit_cart)
    'consume',            -- member takes a bulk/loose item        (submit_cart)
    'return',             -- asset comes back to the store         (submit_cart)
    'return_adjustment',  -- over-return: stock never logged out   (submit_cart)
    'seed',               -- initial import              (scripts/seed-fixtures)
    'restock',            -- newly received stock            (admin_restock)
    'stocktake_gain',     -- counted MORE than the ledger says
    'stocktake_loss',     -- counted LESS than the ledger says
    'correction'          -- reversal of a mistaken movement
  )) not valid;
alter table stock_movements validate constraint stock_movements_reason_check;

-- Nullable: submit_cart writes v_line->>'entryMethod', which is NULL on the
-- return_adjustment line in one existing path.
alter table stock_movements
  add constraint stock_movements_entry_method_check
  check (entry_method is null or entry_method in
         ('scan', 'group_pick', 'search', 'admin')) not valid;
alter table stock_movements validate constraint stock_movements_entry_method_check;
