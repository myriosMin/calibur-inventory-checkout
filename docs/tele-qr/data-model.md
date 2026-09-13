# Data Model

## TL;DR

- **Stock is held by _holders_ (store / robot / member). Every change is a
  _movement_ between two holders.** Borrow, return, consume and stocktake
  correction are all the same operation with different endpoints.
- This reproduces the spreadsheet's `Qty in storage` / `Qty outside` columns
  exactly, and turns the free-text remarks cell into a `group by holder_id`.
- **`scan_codes` is the QR resolution table** — a code points at either one
  product or a group of them (the resistor book page).
- **Identity binds Telegram `user_id`, never `@username`.** Handles change;
  ids don't. Members are provisioned by admins, never self-enrolled.
- **No embedding tables, no `bot_sessions`.** The cart is client state in the
  Mini App until submit, so there's no server-side session to expire.
- Ported from the CV design minus the CV. The ledger was never about the
  camera.

---

## The core idea

The current spreadsheet already contains the real model, hidden in a text
column. Row 173 of the inventory CSV:

```
M3508, qty in storage 6, qty outside 58, total 64
remarks: "15 darknus, 7 hero, 6 standard, 6 sentry, 4 engineer,
          6 turtlebot, 6 old sentry, 2 lying arnd, 2 on kirby gimbal,
          4 on spare robot, aerial"
```

That is an allocation table maintained by hand. So:

- Every unit of stock is held by a **holder**: the store, a robot, or a member.
- Every change is a **movement** from one holder to another.
- Current holdings are derived by summing movements.

`actor_member_id` records *who did it*; `to_holder_id` records *where it went*.

## Tiers

Tiers survive from the CV design, but they no longer gate on model accuracy —
every tier is scanned identically. They now only control **how counting works**.

| Tier | Meaning | Returned? | Counting |
|---|---|---|---|
| `asset` | Motors, ESCs, compute, tools | Yes | Exact; quantity defaults to 1 |
| `bulk` | Connectors, wires, SMD, resistors | No — consumed | Exact; quantity prompted |
| `loose` | "a lot" items: heat shrink, crimps, jumper wire | No | Level only, never counted |

`loose` exists because rows 36–44 of the CSV literally record quantities as
`a lot`, `3 sticks`, `>50`. Forcing exact counts on those teaches people to
skip the app.

## Tables

### Identity

```sql
create table members (
  id                  uuid primary key default gen_random_uuid(),
  full_name           text not null,
  display_name        text,
  nus_email           text unique,
  telegram_username   text unique,     -- collected at club registration
  telegram_user_id    bigint unique,   -- bound on first /start; the real key
  telegram_bound_at   timestamptz,
  role                text not null default 'member',   -- member | procurement | admin (0024)
  active              boolean not null default true,
  joined_at           date,
  left_at             date,
  created_at          timestamptz not null default now()
);
create index on members (telegram_user_id) where active;
```

Rules that are easy to get wrong:

- **`telegram_username` is for the initial bind only.** After
  `telegram_user_id` is set, every lookup uses the id. Usernames can be
  changed, released, and re-claimed by a different person; ids are permanent.
- **Normalise handles on write** — lowercase, strip a leading `@`. Members will
  enter them inconsistently at registration.
- **Offboarding clears `telegram_user_id` and sets `active = false`**, so a
  graduated member's Telegram account stops working immediately.

```sql
-- Unrecognised users who messaged the bot. The admin dashboard's bind queue,
-- and the abuse log for when visitors scan a sticker.
create table telegram_bind_attempts (
  id                uuid primary key default gen_random_uuid(),
  telegram_user_id  bigint not null,
  username          text,
  display_name      text,
  scan_code         text,        -- what they scanned, if anything
  resolved_member   uuid references members(id),
  created_at        timestamptz not null default now()
);
```

### Holders

```sql
create table holders (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,   -- store | robot | member | consumed | adjustment
  name        text not null,
  member_id   uuid references members(id),  -- set iff kind = 'member'
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint holder_member_link check ((kind = 'member') = (member_id is not null))
);
create unique index on holders (kind, name) where active;
```

`consumed` and `adjustment` are singleton pseudo-holders. Movements *into*
`consumed` represent parts used up; movements from/into `adjustment` represent
stocktake corrections and initial seeding. Every row lives in one ledger with
no special cases.

Robots are seeded from the spreadsheet's remarks columns: DarkNUS, Hero,
Standard, Sentry, Old Sentry, Engineer, Turtlebot, Aerial, Kirby gimbal. An
admin adds new ones (roughly annually) — no schema change, no deploy.

### Catalog

```sql
create table locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,   -- 'Table Shelf', 'Rotating shelf', 'book', 'small box'
  parent_id   uuid references locations(id),
  created_at  timestamptz not null default now()
);

create table products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  tier        text not null,        -- asset | bulk | loose
  category    text,                 -- Connectors, SMD, Wires, Tools, Assembled
  location_id uuid references locations(id),
  returnable  boolean not null default false,
  min_stock   integer,              -- low-stock threshold; null = no alert
  unit        text not null default 'pcs',
  part_number text,
  spec        jsonb,                -- {value:"10k", package:"0402", tolerance:"1%"}
  notes       text,
  active      boolean not null default true,
  legacy_row  integer,              -- source row in the imported CSV
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on products (tier) where active;
create index on products (location_id);
```

`spec` as jsonb matters for the resistor book: 157 products differing only in
one field. It makes search usable (`10k` + `0402`) and drives the group-picker
list.

`legacy_row` keeps a pointer back into the spreadsheet through the messy import
described in [../catalog-migration.md](../catalog-migration.md).

### Scan codes

The QR resolution table. One lookup path for every sticker.

```sql
create table scan_codes (
  code        text primary key,     -- short base64url string, lives in the QR
  kind        text not null,        -- product | group
  product_id  uuid references products(id),
  location_id uuid references locations(id),
  label       text,                 -- human text printed under the QR
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint code_target check (
    (kind = 'product' and product_id is not null and location_id is null) or
    (kind = 'group'   and location_id is not null and product_id is null)
  )
);
```

- `kind = 'product'` → straight into the cart.
- `kind = 'group'` → the Mini App lists active products at that location and
  the user taps one. This is how ~157 resistor values live behind ~8 page
  stickers.

Codes are **opaque and short** — see [qr-labels.md](qr-labels.md) for the
generation scheme and the `startapp` length limit that constrains it.

Keeping codes in their own table (rather than a column on `products`) means a
damaged label can be reprinted with a *new* code without touching the product,
and a retired code can be deactivated rather than deleted — so a stale sticker
found in a drawer gives a clean "this label is retired" instead of a wrong hit.

### The ledger

```sql
create table sessions (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references members(id),
  mode            text not null,     -- borrow | return | restock | stocktake
  dest_holder_id  uuid references holders(id),  -- robot or member, for borrow
  source          text not null,     -- miniapp | bot | admin
  started_at      timestamptz not null default now(),
  committed_at    timestamptz
);

create table stock_movements (
  id               bigserial primary key,
  product_id       uuid not null references products(id),
  from_holder_id   uuid not null references holders(id),
  to_holder_id     uuid not null references holders(id),
  qty              integer not null check (qty > 0),
  session_id       uuid references sessions(id),
  actor_member_id  uuid references members(id),
  reason           text not null,    -- see the CHECK below (migration 0017)
  scan_code        text,             -- what was scanned, for label diagnostics
  entry_method     text,             -- scan | group_pick | search | admin
  created_at       timestamptz not null default now(),
  constraint no_self_move check (from_holder_id <> to_holder_id)
);
create index on stock_movements (product_id, created_at desc);
create index on stock_movements (to_holder_id, product_id);
create index on stock_movements (session_id);
```

`reason` was free text until migration `0017`, which pinned it to a CHECK.
The documented `adjust` value **was never once written** and has been retired
in favour of two signed literals, so a variance query is
`where reason = 'stocktake_loss'` rather than a join to `holders` to work out
which way the movement went:

| `reason` | Written by |
|---|---|
| `borrow` / `consume` / `return` | `submit_cart` |
| `return_adjustment` | `submit_cart`, when more is returned than was logged out |
| `seed` | `scripts/seed-fixtures.ts` |
| `restock` | `admin_restock` — newly received stock |
| `stocktake_gain` / `stocktake_loss` | `admin_commit_stocktake` |
| `correction` | `admin_reverse_movement` |

Migration `0021` also makes the table **append-only in practice**: the admin
RLS policy was `FOR ALL`, so an admin could delete the very row a discrepancy
pointed at. It is now split into `SELECT` + `INSERT`, and a correction is a
mirror row carrying `reverses_movement_id`, with a partial unique index making
double-reversal structurally impossible.

`scan_code` and `entry_method` are the cheap diagnostics: a label that gets
scanned and then abandoned is probably damaged or on the wrong bin, and a
product reached by search far more often than by scan is one whose sticker has
fallen off.

Because the Mini App submits the whole cart at once, a session and its
movements are written in a **single transaction**. There is no partially
committed cart.

### Derived views

```sql
create view holdings as
select product_id, holder_id, sum(delta) as qty from (
  select product_id, to_holder_id   as holder_id,  qty as delta from stock_movements
  union all
  select product_id, from_holder_id as holder_id, -qty as delta from stock_movements
) m
group by product_id, holder_id
having sum(delta) <> 0;

create view stock_summary as
select p.id as product_id, p.name, p.tier, p.min_stock,
       coalesce(sum(h.qty) filter (where hd.kind = 'store'), 0)  as qty_in_store,
       coalesce(sum(h.qty) filter (where hd.kind <> 'store'), 0) as qty_out
from products p
left join holdings h  on h.product_id = p.id
left join holders  hd on hd.id = h.holder_id
where p.active
group by p.id;
```

`qty_in_store` and `qty_out` reproduce the spreadsheet's two columns exactly,
and the per-robot breakdown that lives in prose today is a `group by
holder_id`.

At this scale (order 10⁴ movements after several years) summing on read is
fine. If the dashboard ever slows, denormalise onto `products` with a trigger —
but don't do it pre-emptively; it's the classic source of drift bugs.

### Stocktake

Bulk counts drift regardless of how good the logging is, so correction must be
first-class rather than something admins fake with edits.

```sql
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
```

Committing a count writes the difference as a movement to/from `adjustment`.
Variance history is itself a diagnostic: a part with large recurring variance is
one people aren't logging, which points at a UX problem rather than a person.

### Ownership, criticality and the unit register (migration 0024)

Added for the real catalog import. Details and the reasoning are in
[../data-cleaning.md](../data-cleaning.md).

- `products.criticality`: `critical | standard | expendable`. It says how hard
  an item is tracked, independent of `tier`.
- `products.ownership`: `owned | on_loan | mixed`, plus `loaned_from` and
  `loan_due`. `on_loan` means lent *to* the club by another department, club
  or company. It is deliberately not called "borrowed", because a borrow is a
  member checkout.
- `products.supplier`, `products.unit_cost_sgd`: for the procurement team.
- `products.legacy_ref`: provenance across the three spreadsheet tabs and the
  legacy app. `legacy_row` could only point into one CSV.
- `asset_units`: one row per serialised unit (component ID, serial, condition,
  per-unit ownership). It is a register, not a ledger, and has no holder
  column: where stock is still lives only in `stock_movements`.
- `members.role` is widened to `member | procurement | admin`.

## Access control

Supabase RLS:

- The Mini App **never talks to Supabase directly.** It calls `/api/store/*`,
  which validates Telegram `initData` server-side and uses the service role.
  See [architecture.md](architecture.md).
- Admins authenticate with Supabase email auth and can read/write everything.
- Procurement (`is_staff()`, migration 0024) authenticates the same way. It
  can read the inventory, maintain products, locations and units, and receive
  stock through `admin_restock`. It cannot stocktake, reverse movements, write
  scan codes or see members other than itself.
- A member can read their own movements and holdings.
- `stock_movements` is append-only for non-admins. Corrections are new rows,
  never deletes.
- `telegram_bind_attempts` is admin-only.

## Open questions

- ~~Should `loose` products carry a `level` enum (`ok` / `low` / `empty`) as a
  column, or be derived from the most recent movement?~~ **Resolved, neither**:
  "Took the last of it" writes a zero-quantity `stock_counts` row against the
  store holder, so the flag lives in the table that already exists for
  "somebody physically looked at this shelf". No new column, and the restock
  signal lands in the same place a stocktake would put it.
- ~~Do we need `expected_return_date` on asset borrows, or is "out for more
  than N days" a good enough proxy for overdue?~~ **Resolved, proxy** — dates
  nobody sets are worse than no dates. `/api/cron/daily` reconstructs FIFO lots
  from the raw ledger and nudges at 21/28/35 days (`OVERDUE_THRESHOLD_DAYS`).
  Only `member`-held stock is nudged: a motor bolted to Hero is where it
  belongs.
- Per-robot BOM targets (what a robot *should* have vs. what it holds) would
  make the dashboard much more useful, but need a `robot_bom` table and an
  owner. Deferred.
