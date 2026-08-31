# Data Model

## TL;DR

- **Stock is held by *holders*** — the store, each robot, each member. **Every
  change is a movement between two holders.** Borrow, return, consume and
  stocktake correction are all one operation with different endpoints.
- This captures both things the club needs at once: `actor_member_id` = *who
  did it*, `to_holder_id` = *where it went*. The per-robot breakdown that today
  lives in a prose remarks cell becomes a `group by`.
- Current holdings are **derived** by summing the ledger. Don't denormalise
  pre-emptively — at ~10⁴ movements it's free, and denormalising is the classic
  source of drift bugs.
- Products carry a **tier** (`asset` / `bulk` / `loose`) which selects their
  handling. `loose` exists because the source sheet literally records
  quantities as `a lot`.
- **The provenance columns on `stock_movements` are the most important thing
  here** — `source`, `match_score`, `match_rank`, `was_corrected`. Without them
  you can never answer "is the CV working?" and they can't be reconstructed
  later.
- **Multiple face embeddings per member**, not one. `model_version` mandatory
  on every embedding row. Normalised vectors + cosine.
- **Keep product reference images, discard face images** — that asymmetry
  decides how painful each model swap is.
- Stocktake is first-class, not admins faking edits. Variance history is a UX
  diagnostic.

---

Postgres via Supabase, with `pgvector` for embeddings.

## The core idea: stock is held by *holders*, and movement is a ledger

The current spreadsheet already contains the real model, hidden in a text
column. Row 173 of the inventory CSV:

```
M3508, qty in storage 6, qty outside 58, total 64
remarks: "15 darknus, 7 hero, 6 standard, 6 sentry, 4 engineer,
          6 turtlebot, 6 old sentry, 2 lying arnd, 2 on kirby gimbal,
          4 on spare robot, aerial"
```

That is an allocation table maintained by hand. The club does not primarily ask
"who borrowed this" — it asks **"where did our motors end up"**. So the schema
is built around that question:

- Every unit of stock is held by a **holder**: the store, a robot, or a member.
- Every change is a **movement** from one holder to another.
- Current holdings are derived by summing movements.

Borrow, return, consume, and stocktake adjustment all become the same operation
with different endpoints. This gives us both answers for free: `actor_member_id`
records *who did it*, `to_holder_id` records *where it went*.

## Tiers

Every product carries a tier, which selects its handling. See
[limitations.md](limitations.md) for why the split exists.

| Tier | Meaning | Identified by | Returned? | Counting |
|---|---|---|---|---|
| `asset` | Motors, ESCs, compute, tools | CV shortlist or search | Yes | Exact, per unit |
| `bulk` | Connectors, wires, SMD, resistors | Bin QR scan | No (consumed) | Exact, typed |
| `loose` | "a lot" items: heat shrink, crimps, jumper wire | Bin QR scan | No | Approximate; low/ok flag only |

`loose` exists because rows 36–44 of the CSV literally record quantities as
`a lot`, `3 sticks`, `>50`. Forcing exact counts on those trains people to skip
the kiosk. They get a stock *level*, not a stock *count*.

## Tables

### Identity and organisation

```sql
create table members (
  id             uuid primary key default gen_random_uuid(),
  full_name      text not null,
  display_name   text,
  nus_email      text unique,
  telegram       text,
  role           text not null default 'member',   -- member | admin
  active         boolean not null default true,
  joined_at      date,
  left_at        date,
  consent        jsonb,      -- see docs/pdpa.md for shape
  created_at     timestamptz not null default now()
);

-- The store, each robot, and each member are all holders of stock.
create table holders (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null,      -- store | robot | member | consumed | adjustment
  name           text not null,
  member_id      uuid references members(id),  -- set iff kind = 'member'
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  constraint holder_member_link check (
    (kind = 'member') = (member_id is not null)
  )
);
create unique index on holders (kind, name) where active;
```

`consumed` and `adjustment` are singleton pseudo-holders. Movements *into*
`consumed` represent parts used up; movements from/into `adjustment` represent
stocktake corrections and initial seeding. This keeps every row in one ledger
with no special cases.

Robots are seeded from the remarks columns: DarkNUS, Hero, Standard, Sentry,
Old Sentry, Engineer, Turtlebot, Aerial, Kirby gimbal. New robots are added by
an admin roughly once a year.

### Catalog

```sql
create table locations (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,        -- 'Table Shelf', 'Rotating shelf', 'book', 'small box'
  qr_code        text unique,          -- printed label, null for non-binned locations
  parent_id      uuid references locations(id),
  created_at     timestamptz not null default now()
);

create table products (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  tier           text not null,        -- asset | bulk | loose
  category       text,                 -- Connectors, SMD, Wires, Tools, Assembled
  location_id    uuid references locations(id),
  qr_code        text unique,          -- per-product label where bins are 1:1 with a part
  returnable     boolean not null default false,
  min_stock      integer,              -- low-stock threshold; null = no alert
  unit           text not null default 'pcs',
  part_number    text,                 -- manufacturer PN where known
  spec           jsonb,                -- {value: "10k", package: "0402", tolerance: "1%"}
  notes          text,
  active         boolean not null default true,
  legacy_row     integer,              -- source row in the imported CSV, for traceability
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on products (tier) where active;
create index on products (location_id);
```

`returnable` should be true for essentially all `asset` rows and false for
`bulk`/`loose`. It is a separate column rather than derived from tier so that
an exception (a consumable tool bit, a bulk item that is genuinely lent out)
doesn't require a tier change.

`spec` as jsonb matters for the resistor book: 157 products differing only by
one field. It makes the admin search box usable (`10k` + `0402`) and it is how
the bin QR resolves to a specific product.

`legacy_row` keeps a pointer back into the source spreadsheet through the
messy import described in [catalog-migration.md](../catalog-migration.md).

### The ledger

```sql
create table sessions (
  id                 uuid primary key default gen_random_uuid(),
  member_id          uuid references members(id),
  mode               text not null,     -- borrow | return | restock | stocktake
  dest_holder_id     uuid references holders(id),  -- robot or member, for borrow
  status             text not null default 'open', -- open | committed | cancelled | abandoned
  identified_by      text,              -- face | qr | manual
  face_match_score   real,
  kiosk_id           text,
  started_at         timestamptz not null default now(),
  ended_at           timestamptz
);

create table stock_movements (
  id                 bigserial primary key,
  product_id         uuid not null references products(id),
  from_holder_id     uuid not null references holders(id),
  to_holder_id       uuid not null references holders(id),
  qty                integer not null check (qty > 0),
  session_id         uuid references sessions(id),
  actor_member_id    uuid references members(id),
  reason             text,              -- borrow | return | consume | adjust | seed
  -- provenance, for measuring whether the CV is working
  source             text,              -- cv | qr | search | admin | import
  match_score        real,
  match_rank         integer,           -- which shortlist position the user picked
  was_corrected      boolean not null default false,
  created_at         timestamptz not null default now(),
  constraint no_self_move check (from_holder_id <> to_holder_id)
);
create index on stock_movements (product_id, created_at desc);
create index on stock_movements (to_holder_id, product_id);
create index on stock_movements (session_id);
```

**The provenance columns are the most important thing in this schema.** Without
`source`, `match_score`, `match_rank`, and `was_corrected` we can never answer
"is the item recognition actually working, and where should the threshold be?"
They cost nothing to record and cannot be reconstructed later.

### Derived views

```sql
-- Who holds what, right now.
create view holdings as
select product_id, holder_id, sum(delta) as qty from (
  select product_id, to_holder_id   as holder_id,  qty as delta from stock_movements
  union all
  select product_id, from_holder_id as holder_id, -qty as delta from stock_movements
) m
group by product_id, holder_id
having sum(delta) <> 0;

-- The dashboard's headline numbers, mirroring the spreadsheet's columns.
create view stock_summary as
select p.id as product_id, p.name, p.tier, p.min_stock,
       coalesce(sum(h.qty) filter (where hd.kind = 'store'), 0)  as qty_in_store,
       coalesce(sum(h.qty) filter (where hd.kind <> 'store'), 0) as qty_out
from products p
left join holdings h on h.product_id = p.id
left join holders hd on hd.id = h.holder_id
where p.active
group by p.id;
```

`qty_in_store` and `qty_out` reproduce the spreadsheet's "Qty in storage" and
"Qty outside" columns exactly, and the per-robot breakdown that today lives in
a free-text remarks field becomes a `group by holder_id`.

At this scale (order 10⁴ movements after several years) summing the ledger on
read is fine. If the dashboard ever slows, denormalise `qty_in_store` onto
`products` with a trigger — but do not do this pre-emptively; it is the classic
source of drift bugs.

### Stocktake

Bulk counts drift regardless of how good the logging is. The correction path
must be first-class rather than something admins fake with edits.

```sql
create table stock_counts (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references products(id),
  counted_qty    integer not null,
  expected_qty   integer not null,      -- snapshot of holdings at count time
  counted_by     uuid references members(id),
  session_id     uuid references sessions(id),
  note           text,
  created_at     timestamptz not null default now()
);
```

Committing a count writes the difference as a movement to/from the `adjustment`
holder. The variance history is itself useful: a part with large recurring
variance is one people aren't logging, which tells us where the UX is failing.

### Embeddings

```sql
create table member_face_embeddings (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references members(id) on delete cascade,
  embedding      vector(512) not null,
  model_version  text not null,         -- e.g. 'insightface/buffalo_l@1'
  created_at     timestamptz not null default now()
);

create table product_embeddings (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references products(id) on delete cascade,
  embedding      vector(768) not null,
  model_version  text not null,         -- e.g. 'dinov2/vitb14@1'
  capture_note   text,                  -- 'front', 'angled', 'in hand'
  image_path     text,                  -- Supabase Storage key; see below
  created_at     timestamptz not null default now()
);

create index on member_face_embeddings using hnsw (embedding vector_cosine_ops);
create index on product_embeddings      using hnsw (embedding vector_cosine_ops);
```

Rules that are easy to get wrong and expensive to fix later:

- **Multiple embeddings per member, not one.** The doc's original schema had a
  single `face_embedding` column. The same argument that justifies several
  reference photos per product (angles, lighting) applies to faces (glasses,
  haircuts, kiosk lighting at night). Store 3–5.
- **`model_version` is mandatory on every row.** The moment we swap the item
  model, every stored vector becomes meaningless. Queries must filter on the
  active model version, and a model change is a re-embed job, not a redeploy.
- **Store L2-normalised vectors and use cosine distance.** Mixing normalised
  and unnormalised vectors in one index produces silently wrong neighbours.
- **Keep product reference images; discard face images.** This asymmetry is
  deliberate. Product photos are not personal data, so we keep them in a
  Supabase Storage bucket (`image_path` above) — which turns an item-model swap
  into a background re-embed job with no human work. Face photos are personal
  data and are destroyed at enrollment, which means a *face*-model swap
  requires re-enrolling every member in person. Choose the face model once and
  stay on it; see [operations.md](operations.md) §3.
- **`on delete cascade` on faces is deliberate** — deleting a member must
  actually destroy their biometric data. See [pdpa.md](pdpa.md).
- Vector dimensions above are placeholders matching the candidate models in
  [architecture.md](architecture.md); fix them when the models are chosen, and
  note that changing the dimension means a new column, not an alter.

## Access control

Supabase RLS, minimum viable:

- The kiosk backend uses a service role; the browser never talks to Supabase
  directly for CV data.
- `members`, `member_face_embeddings`: readable only by service role and
  admins. Never exposed to the frontend.
- A member can read their own movements and holdings.
- Admins can read and write everything.
- `stock_movements` is append-only for non-admins; corrections are new rows
  with `was_corrected` set on the original, never deletes.

## Open questions

- Should `bulk` products with a 1:1 bin mapping carry the QR on the product or
  on the location? Currently both columns exist; pick one convention during
  the label print run and drop the other.
- Do we need `expected_return_date` on asset borrows for overdue alerts, or is
  "out for more than N days" a good enough proxy? Leaning proxy — dates that
  nobody sets are worse than no dates.
- Per-robot BOM targets (what a robot *should* have vs what it holds) would
  make the dashboard much more useful, but need a `robot_bom` table and someone
  to maintain it. Deferred to after Phase 5.
