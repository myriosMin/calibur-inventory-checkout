-- Expensive items: anything worth S$20 or more a unit is tracked, never spent.
--
-- The club's rule (2026-10-04): the checkout works for every item, but an
-- item priced at S$20 or more is expensive and has to be tracked properly,
-- and data questions about expensive items are resolved before any others.
--
-- "Tracked properly" in this schema means returnable. submit_cart (0019)
-- sends a returnable item to the borrower's holder as a `borrow`, where it
-- stays on the ledger, shows on /store/mine, and is nudged when overdue; a
-- non-returnable item goes straight to the `consumed` pseudo-holder and is
-- never asked about again. So an expensive item must never be
-- non-returnable, and the database refuses it.
--
-- The S$20 line is also in src/lib/expensive.ts (EXPENSIVE_THRESHOLD_SGD),
-- for the copy the dashboard shows; tests/unit/expensive.test.ts keeps the
-- two in step. Changing it means a new migration, on purpose: it decides
-- what the checkout lets people take away for good.

-- ---------------------------------------------------------------------------
-- products.expensive
-- ---------------------------------------------------------------------------

-- Priced: the price decides. Unpriced: a `critical` item (by definition
-- roughly S$150+, competition-mandatory or irreplaceable) is assumed
-- expensive; anything else is not, until someone prices it.
alter table products
  add column expensive boolean
  generated always as (coalesce(unit_cost_sgd >= 20, criticality = 'critical')) stored;

-- Every existing critical row is already returnable (0024 set them all to
-- asset + returnable), and no product has a price yet, so this holds today.
alter table products
  add constraint products_expensive_returnable check (returnable or not expensive);

create index products_expensive_idx on products (id) where expensive;

-- ---------------------------------------------------------------------------
-- stock_summary: carry the price and the flag
-- ---------------------------------------------------------------------------

-- Same view as 0015, two columns appended (create or replace may only add
-- columns at the end). The dashboard, the nightly digest and the stocktake
-- walk all read stock levels from here.
create or replace view stock_summary with (security_invoker = true) as
select
  p.id as product_id,
  p.name,
  p.tier,
  p.unit,
  p.min_stock,
  p.location_id,
  coalesce(sum(h.qty) filter (where hd.kind = 'store'), 0)::bigint as qty_in_store,
  coalesce(sum(h.qty) filter (where hd.kind in ('robot', 'member')), 0)::bigint as qty_out,
  coalesce(sum(h.qty) filter (where hd.kind = 'consumed'), 0)::bigint as qty_consumed,
  p.unit_cost_sgd,
  p.expensive
from products p
left join holdings h on h.product_id = p.id
left join holders hd on hd.id = h.holder_id
where p.active
group by p.id;

-- ---------------------------------------------------------------------------
-- review_items.about_expensive
-- ---------------------------------------------------------------------------

-- An item is high priority when its product is expensive, or when it is
-- about expensive things that no single product_id captures (a list of
-- loans, say). This column is the second case, set by staff on the item.
alter table review_items add column about_expensive boolean not null default false;

-- The one such item the catalog clean-up raised: the 23 legacy-app loans
-- that were held back include a Jetson AGX Orin, a Livox LiDAR, a RealSense,
-- a Hikvision camera, referee modules and motors.
update review_items
   set about_expensive = true
 where entity = 'loan' and subject = 'Legacy-app loans not imported';
