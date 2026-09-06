-- Derived views: holdings and stock_summary.
-- Source: docs/tele-qr/data-model.md lines 241-259, verbatim, plus
-- security_invoker = true (per plan §0009 note) so these views respect the
-- querying role's RLS (relevant on Postgres 15+, which Supabase projects run)
-- rather than the view owner's.

create view holdings
with (security_invoker = true) as
select product_id, holder_id, sum(delta) as qty from (
  select product_id, to_holder_id   as holder_id,  qty as delta from stock_movements
  union all
  select product_id, from_holder_id as holder_id, -qty as delta from stock_movements
) m
group by product_id, holder_id
having sum(delta) <> 0;

create view stock_summary
with (security_invoker = true) as
select p.id as product_id, p.name, p.tier, p.min_stock,
       coalesce(sum(h.qty) filter (where hd.kind = 'store'), 0)  as qty_in_store,
       coalesce(sum(h.qty) filter (where hd.kind <> 'store'), 0) as qty_out
from products p
left join holdings h  on h.product_id = p.id
left join holders  hd on hd.id = h.holder_id
where p.active
group by p.id;
