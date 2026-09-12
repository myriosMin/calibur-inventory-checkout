-- stock_summary: fix qty_out.
--
-- The 0008 definition summed every non-store holder into qty_out, folding in
-- `consumed` (parts that are gone, not "outside") and `adjustment`, whose
-- balance is large and *negative* because every `seed` / `return_adjustment`
-- movement sources from it. The published number was therefore
-- robots + members + consumed - seeded_total, i.e. meaningless.
--
-- Zero readers in src/, scripts/, tests/ today, so this is free to fix now.
-- Reversal = the verbatim body from 0008_views.sql.
--
-- Note for the dashboard/cron authors: qty_in_store can legitimately be
-- negative today (imported catalog with no restock). Treat `< 0` as a
-- data-integrity warning, NOT a low-stock alert.

drop view if exists stock_summary;

create view stock_summary with (security_invoker = true) as
select p.id as product_id, p.name, p.tier, p.unit, p.min_stock, p.location_id,
       coalesce(sum(h.qty) filter (where hd.kind = 'store'), 0)::bigint
         as qty_in_store,
       -- "Qty outside" in the spreadsheet's sense: held by a robot or a
       -- member, i.e. expected back one day. Deliberately NOT "everything
       -- that isn't the store".
       coalesce(sum(h.qty) filter (where hd.kind in ('robot','member')), 0)::bigint
         as qty_out,
       coalesce(sum(h.qty) filter (where hd.kind = 'consumed'), 0)::bigint
         as qty_consumed
from products p
left join holdings h  on h.product_id = p.id
left join holders  hd on hd.id = h.holder_id
where p.active
group by p.id;
