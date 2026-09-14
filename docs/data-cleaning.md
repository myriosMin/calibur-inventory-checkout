# Data Cleaning and Import

## TL;DR

- **The real inventory is live in `public` (imported 2026-09-14).** The people
  who run the store review it in `/admin`. The old dev fixtures are gone. A
  snapshot of the same catalog sits in the `test` schema for the integration
  tests (see tele-qr/architecture.md, "Test schema").
- **Two scripts do the work:**
  - `scripts/clean-data/build.ts` turns the spreadsheet
    (`data/RoboMaster_Inventory_3_Sheets.xlsx`) and the legacy checkout
    app's export (`data/db/*.csv`) into `data/clean/`.
  - `scripts/import-clean-data.ts` turns that into one SQL transaction.
- **Rehearsed on the live dev project, rolled back.** Migrations 0024 + 0025
  plus the full import ran inside a transaction that rolls back: 567 products
  (12 held as inactive), 314 serialised units, 591 opening-balance movements,
  164 review items, **0 negative holdings**.
- **Migration 0024** adds what the club asked for:
  - `products.ownership` (owned / on loan to the club / mixed)
  - `products.criticality` (critical / standard / expendable)
  - a per-unit `asset_units` register
  - procurement fields
  - a `procurement` role
- **Migration 0025** adds the review queue (`review_items`) and lets
  procurement stocktake the store and robots.
- **Nothing is confirmed by the people who run the store yet.**
  - Every judgement call from the clean-up becomes a review item: 1 blocker,
    127 checks, 36 info (the 141 flags, plus one check per held loan).
  - Reviewers work in `/admin/review` and the product pages, not in CSVs.
- **The legacy app's numbers can't be trusted blind.**
  - It replaced every non-numeric or blank quantity, and every not-yet-bought
    BOM line, with an invented **100** (100 rows).
  - It copied stale referee-system totals instead of counting the unit register.
- **Safety: 9 of 10 TB47S packs are recorded swollen or bad.** Quarantine them.

`data/` is gitignored because the package contains member emails.

---

## Sources, and what each is good for

| Source | As of | Trust it for | Don't trust it for |
|---|---|---|---|
| Electrical Parts tab | ~Dec 2025 | The catalog: names, locations, section → category, `Qty outside` + remarks | Level-only quantities; RoboMaster hardware (duplicated in High Value Items) |
| High Value Items tab | unit rows 2023–2025 | Per-unit register (component ID, serial, condition, allocation tag): DT7, NDJ6, batteries, Jetsons, NanoPi, OAK | The summary column (stale) |
| Referee System Inventory tab | unit rows 2023–2025 | Per-unit register for all 17 referee modules (238 units) | The summary column: LI01 says 7, there are 14 labelled units |
| Robot-Specific View tab | carried forward from 16 Dec 2025 | Per-robot counts for motors, ESCs and boards | Totals: it puts 12 M2006 on robots, and the club owns 6 |
| Legacy app `items` | Jul–Sep 2026 | The newest totals for anything that was actually counted | Every 100 it invented; referee totals |
| Legacy app `borrows` | Jul–Sep 2026 | Who has what out right now | — |
| Legacy app `logs` / `profiles` | Jul–Sep 2026 | Faulty and write-off events; emails and old roles | Names or Telegram handles (neither exists) |

## Precedence

**Total quantity:** the first of these that applies.

1. The unit register count, excluding disposed/missing units, for anything with a register.
2. The legacy app total, unless it's one of the invented 100s.
3. The High Value / Referee summary.
4. Electrical Parts storage + outside.
5. The sum of Robot-Specific View counts, for things with no stock record at
   all (mecanum wheels, Dev Board A).

Level-only stock (`a lot`, `>50`, `3 sticks`) never gets a number: tier `loose`,
no opening balance.

**Where it is:**

- **Register items:** each unit's Allocation Tag.
  - `Storage / Unallocated` → store.
  - `Other / Unassigned` → store, noted for audit (73 units).
  - `Disposed / Missing` → not in stock.
- **Motors, ESCs, boards:** the Robot-Specific View. `need N` cells are
  shortfalls, not holdings, and go to notes.
- **A handful of others:** Electrical Parts remarks, parsed by hand in
  `scripts/clean-data/curation.ts`.
- **Store** = total − robots.
  - When robots plus open loans exceed the total (C620, C610, M2006, M3508,
    center board 2), the store is seeded with just enough that nothing goes
    negative, and a review item asks for a per-robot count.

**Open loans** (legacy `borrows.status = 'open'`) keep their original
timestamps, so overdue tracking starts correct. Expendables are imported as
consumed. Two kinds become review items instead of being imported:

- A burst of 20 checkouts by one account in 7 minutes at 2am (a pack-out or
  a test of the old app).
- Any single loan of 3+ critical parts (probably on a robot).

Result: 9 imported, 23 held.

## Schema additions

### Criticality (0024): "how hard do we chase this?"

| Value | Meaning | Tier | Returnable | Examples | Products |
|---|---|---|---|---|---|
| `critical` | Roughly S$150+ a unit, competition-mandatory, safety-relevant, or irreplaceable | asset | yes | DJI M3508/GM6020/C620, referee modules, Jetsons, LiDAR, RealSense, TB47S/TB48S, supercap banks, Dev Board C, oscilloscope | 54 |
| `standard` | Reusable kit that should come back | asset | yes | Tools, dev boards, buck converters, center boards, Snail 2305 | 57 |
| `expendable` | The "don't care" pile | bulk / loose | no | Passives, connectors, cables, crimps, tape | 444 |

It is independent of `tier`, which only drives counting UX. On the product page,
changing criticality sets the matching tier and returnable, which stay editable.

### Ownership (0024): "is this ours?"

`owned` (default), `on_loan` (lent *to* the club; it has to go back) or
`mixed`, plus `loaned_from` and `loan_due`. It is not called "borrowed" because
borrow already means a member checkout.

The sheets record exactly three loans:

- Jetson AGX Thor (Advantech)
- one Jetson AGX Orin (Samuel)
- one OAK-D Lite (Huimin)

Everything else is assumed owned. **This is the assumption reviewers are most
likely to overturn.**

### `asset_units` (0024)

One row per physical unit: component ID (the sticker), serial, condition,
per-unit ownership, last seen, last checked. 314 units: 231 ok, 49 unknown, 30
faulty, 3 disposed, 1 missing. It is a register, **not a ledger**: there is no
holder column, because where stock is lives only in `stock_movements`.

### `review_items` (0025)

One row per open question, optionally linked to a product.

- **Severity:** `blocker` / `check` / `info`.
- **Status:** `open`, then `resolved` or `dismissed`, with a note.
- **Who closed it and when** is stamped by a trigger from the signed-in session.

### Roles

| | member | procurement | admin |
|---|---|---|---|
| Borrow / return in the Mini App | ✓ | ✓ | ✓ |
| Read products, holdings, movements, units, review queue | — | ✓ | ✓ |
| Add / edit products, locations, units; resolve review items | — | ✓ | ✓ |
| Receive stock (`admin_restock`) | — | ✓ | ✓ |
| Stocktake the store or a robot | — | ✓ | ✓ |
| Stocktake a member's holder, reverse movements, scan codes, members & roles, bind queue | — | — | ✓ |

Admins are the developers. Reviewers get `procurement`. The `/admin` nav hides
admin-only pages from procurement, but that is cosmetic; RLS is the boundary.

`scripts/sql/rehearse-0024-rls.sql` checks each role as `authenticated` with a
forged JWT email, then rolls back. It passes on the live project:

- **procurement** reads products and review items and can resolve them (the
  closer is stamped as itself). It can restock, count the store and a robot,
  and insert products. It is blocked from counting a member's holder, reversals,
  consume movements, scan codes and self-promotion.
- **member** sees nothing and can do none of it.
- **admin** keeps everything.

## Findings

**Quantities**

- **The legacy app invented a quantity of 100 for 100 rows.** All ignored.
- **13 counted items disagree between the sheet and the legacy app**, almost all
  upward in the app. For example: XT30 straight F 19 → 99, JST 2-pin straight
  4 → 54, XT30 F-M long 14 → 114. That is consistent with an August 2026
  connector restock recorded only in the app. The import took the app's figure.
- **27 products have sources that disagree on the total.** Worst is the referee
  system, where the summary column lags the unit register (VT12 1 vs 8, VT13
  3 vs 8, CM01 6 vs 11), while TC01, AM02, FI02 and VT02 go the other way.
- **The Robot-Specific View allocates more than exists:**

  | Part | On robots (view) | Recorded total |
  |---|---|---|
  | M3508 (incl. flywheel) | 73 | 64 |
  | C620 | 77 | 72 |
  | M2006 | 12 | 6 |
  | C610 | 11 | 9 |
  | Center board 2 | 26 | 24 |

- **38 resistor-book values (91kΩ–10MΩ) were never counted.**

**Duplicates**

- **Every piece of RoboMaster hardware is counted twice.** The Electrical Parts
  "Assembled parts" rows duplicate the High Value Items tab. Merged into one
  product each.
- **"Battery old/new" and "Old/New controller"** almost certainly double-count
  the TB47S/TB48S and NDJ6/DT7 registers. Held.
- **Legacy app:** DM3519 entered twice (41 each), then DM3520 at 41 a minute
  later (held). PM02 entered twice.
- **Sheet rows:** R294 = R295; R276 and R345 are the same part.
- **Unit register:** PM02-10/11/12 are used twice (renamed PM02-19/20/21; relabel),
  and two serials each appear on two units.

**Misfiled and mislabelled**

- **Resistor book:** 3Ω and 3.6Ω rows sit inside the kΩ run (read as 3kΩ and
  3.6kΩ); 5.5kΩ (7.5kΩ) and 31Ω (30Ω) aren't E24 values.
- **Parts named wrongly:** capacitors labelled as resistors (R342–344). "3m" and
  "4m" resistors are read as milliohm current-sense shunts. The 2N7000 is a
  MOSFET, not a BJT.
- **Legacy app quirk:** it filed every tool under SMD and imported the "Tools"
  header as a product.

**Unidentifiable (held):** `402`, `422`, `X pulse`, `X hx0089b`, "Power delivery
thingy", "Load resistor big", "Sparkfun opamp".

**Condition and safety**

- **TB47S: 9 of 10 recorded swollen or bad.** Imported as faulty.
- **Gone:** 3 TB48S destroyed in Mar 2025; 1 AM02 missing since 2023.
- **Reported faulty in the legacy app, units unidentified:** 2 VT03 and 2 AM12.
- **Jetson Orin NX:** the labelled unit is recorded killed by overvoltage (Jul
  2026). A second was written off, possibly the same incident logged twice.

**People**

- **No legacy account has a name or a Telegram handle**, only an email.
- **11 accounts were `admin` in the legacy app.** All are proposed as `member`
  except the developer.

**Procurement backlog:** `bom_lines.csv` has 68 lines. 52 v2 supercap
controller parts come with MPN, description and quantity per build; 10 have a
quantity but no part number; 6 capacitor-bank parts have no quantity. They are
not in the database yet.

## How the review works

After the import, reviewers sign in to `/admin` with a `procurement` account.

1. **Review** (`/admin/review`) lists every open item, blockers first.
   Reviewers can filter by severity, topic or text. Each item links to its
   product.
2. **On the product page**, reviewers:
   - read the product's open review items
   - see where every unit is on the ledger
   - fix details: name, category, criticality, ownership and lender, supplier,
     cost, location, active
   - edit its individual units (serial, condition, per-unit loan)
3. **Wrong quantity?** Count it in **Stocktake**, either a store shelf or a
   robot (robot counts can add parts the ledger doesn't list). Quantities are
   never typed over. A count writes a correction an admin can see and reverse.
4. **Resolve** the review item with a note saying what was found. **Dismiss**
   only when the item itself is wrong.
5. **Held products** are imported **inactive**. Check them, fix them, switch them
   to active, then count them in: they start with no stock.
6. **New items:** create them in **Products**, then receive the quantity in
   **Restock**.

The `/admin/products` list shows criticality, ownership, in-store and out
quantities, and open review counts. It filters on all of them, including
"needs review".

## How it was imported (2026-09-14)

One Supabase project, two schemas: `public` for the real data and `test` for
the tests (tele-qr/architecture.md, "Test schema").

```bash
# 0. The package (once): data/clean/
npx tsx scripts/clean-data/build.ts

# 1. public: purge the dev fixtures (done once, snapshot kept), migrate, rehearse, import
npx tsx scripts/migrate.ts --schema public
npx tsx scripts/import-clean-data.ts --rehearse
supabase db query --linked -f data/clean/import.rehearse.sql   # "IMPORT REHEARSAL OK", rolled back
npx tsx scripts/import-clean-data.ts
supabase db query --linked -f data/clean/import.sql

# 2. test: the same catalog, plus test accounts and scan codes
npx tsx scripts/migrate.ts --schema test --reset
npx tsx scripts/import-clean-data.ts --schema test
supabase db query --linked -f data/clean/import.test.sql
npx tsx scripts/seed-test-schema.ts

# 3. Reviewers: add each in /admin/members with role "procurement" and their
#    email, then give them a password
npx tsx scripts/create-admin-user.ts <email> <password>
```

Notes:

- **`supabase db query -f` runs a file as a single transaction**: an error
  anywhere rolls back everything, including DDL. That was verified before
  relying on it.
- **Duplicate admin merged.** The legacy account `minmyrios@gmail.com` is the
  existing admin Myrios, so that `members.csv` row was pointed at
  `myriosmin@u.nus.edu` and the import kept the existing row.
- **Types** in `src/lib/types/database.ts` are regenerated from `public` and
  describe `test` too.
- **Admin login needs a matching email.** Staff sign in only if their Supabase
  Auth email equals `members.nus_email`.
- **One imported loan is already overdue** (a PM02 out since 7 Aug 2026).

## Open questions

- Which critical items are actually borrowed from other departments or clubs?
  The sheets only ever recorded three loans.
- Who else is admin, and who reviews as procurement?
- Are the 13 M3508 flywheel motors part of the 64, or extra?
- Is S$150 the right line for `critical`?
- What is the "UV charger", who or what is "Hopps", and should the four DarkSTDs
  be one holder or four?
- Should the procurement backlog (`bom_lines.csv`) live in the dashboard too?
- Should critical items eventually be scanned per unit rather than per product?
