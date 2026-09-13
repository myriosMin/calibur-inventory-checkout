# Data Cleaning and Import

## TL;DR

- **The real inventory is cleaned and rehearsed, not yet imported.**
  `scripts/clean-data/build.ts` turns the spreadsheet
  (`data/RoboMaster_Inventory_3_Sheets.xlsx`) and the legacy checkout app's
  export (`data/db/*.csv`) into a review package in `data/clean/`.
  `scripts/import-clean-data.ts` turns the reviewed package into one SQL
  transaction. Migration 0024 plus the full import has been run against the
  live Supabase project inside a transaction that rolls back: 555 products,
  314 serialised units, 591 opening-balance movements, **0 negative holdings**.
- **Migration 0024 adds what the club asked for**: `products.ownership`
  (owned / on loan to the club / mixed), `products.criticality` (critical /
  standard / expendable), a per-unit `asset_units` register, procurement
  fields, and a `procurement` role with its own RLS. **Not applied yet.**
- **Nothing here has been confirmed by the people who run the store.** Every
  judgement call is either a row in `data/clean/review_flags.csv` (1 blocker,
  104 checks, 36 info) or visible in the output columns. SME review comes
  next, and reviewers edit the CSVs, not the code.
- **The legacy app's numbers can't be trusted blind.** It replaced every
  non-numeric or blank quantity, and every not-yet-bought BOM line, with an
  invented **100** (100 rows). It also copied stale referee-system totals
  instead of counting the unit register.
- **Safety: 9 of 10 TB47S packs are recorded swollen or bad.** Quarantine them.

`data/` is gitignored because the package contains member emails. Share it with
reviewers directly, not through the repo.

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

1. The unit register count, excluding disposed/missing units, for anything that has a register.
2. The legacy app total, unless it's one of the invented 100s.
3. The High Value / Referee summary.
4. Electrical Parts storage + outside.
5. The sum of Robot-Specific View counts, for things with no stock record at all (mecanum wheels, Dev Board A).

Level-only stock (`a lot`, `>50`, `3 sticks`) never gets a number. It is tier
`loose` with no opening balance.

**Where it is:**

- **Register items:** each unit's Allocation Tag.
  - `Storage / Unallocated` → store.
  - `Other / Unassigned` → store, with a note for audit (73 units).
  - `Disposed / Missing` → not in stock at all.
- **Motors, ESCs, boards:** the Robot-Specific View. `need N` cells are shortfalls, not holdings, so they go into notes.
- **A handful of others:** Electrical Parts remarks parsed by hand in
  `scripts/clean-data/curation.ts` (e.g. center board 1: "8 outside, darknus").
- **Store** = total − robots.
  - When robots plus open loans exceed the total (C620, C610, M2006, M3508,
    center board 2), the store is seeded with just enough that nothing goes
    negative, and the product is flagged.
  - The fix is a per-robot stocktake: `admin_commit_stocktake` takes a holder.

**Open loans** (legacy `borrows.status = 'open'`) keep their original
timestamps, so overdue tracking starts out correct. Expendables are imported as
consumed. Two kinds are held instead of imported:

- A burst of 20 checkouts by one account in 7 minutes at 2am. That is a
  competition pack-out or a test of the old app, not 20 personal loans.
- Any single loan of 3+ critical parts, which is probably on a robot.

Result: 9 imported, 23 held.

## Schema additions (migration 0024)

### Criticality: "how hard do we chase this?"

| Value | Meaning | Tier | Returnable | Examples | Products |
|---|---|---|---|---|---|
| `critical` | Roughly S$150+ a unit, competition-mandatory, safety-relevant, or irreplaceable | asset | yes | DJI M3508/GM6020/C620, referee modules, Jetsons, LiDAR, RealSense, TB47S/TB48S, supercap banks, Dev Board C, oscilloscope | 54 |
| `standard` | Reusable kit that should come back | asset | yes | Tools, dev boards, buck converters, center boards, Snail 2305 | 57 |
| `expendable` | The "don't care" pile | bulk / loose | no | Passives, connectors, cables, crimps, tape | 444 |

It is independent of `tier` on purpose. `tier` only drives counting UX, and a
soldering iron and a Jetson are both `asset`.

### Ownership: "is this ours?"

`owned` (default), `on_loan` (lent *to* the club; it has to go back) or
`mixed`, plus `loaned_from` and `loan_due`.

It is named "on loan", not "borrowed", because borrow already means a member
checking something out.

The sheets record exactly three loans:

- Jetson AGX Thor (Advantech, Sep 2025)
- one Jetson AGX Orin (Samuel, Feb 2024)
- one OAK-D Lite (Huimin)

Everything else is assumed owned. **This is the assumption reviewers are most
likely to overturn**, because the sheet never asked.

### `asset_units`: the per-unit register

One row per physical unit: component ID (the sticker), serial, condition,
per-unit ownership, last-seen location, last-checked date. 314 units: 231 ok,
49 unknown, 30 faulty, 3 disposed, 1 missing.

It is a register, **not a second ledger**. There is deliberately no holder
column: where stock is still lives only in `stock_movements`, per product. A
holder column maintained by hand would drift from the ledger within weeks.

### Roles

| | member | procurement | admin |
|---|---|---|---|
| Borrow / return in the Mini App | ✓ | ✓ | ✓ |
| Read products, holdings, movements, units | — | ✓ | ✓ |
| Add / edit products, locations, units | — | ✓ | ✓ |
| Receive stock (`admin_restock`) | — | ✓ | ✓ |
| Stocktake, reversals, scan codes, members & roles, bind queue | — | — | ✓ |

Admins are the developers.

`scripts/sql/rehearse-0024-rls.sql` checks each role as `authenticated` with a
forged JWT email, the way PostgREST would, then rolls back. It passed on the
live project:

- **procurement** reads all products, sees only its own member row and zero bind attempts, can restock and insert products. It is blocked from consume movements, stocktake and scan codes, and cannot promote itself.
- **member** sees no products and cannot restock.
- **admin** keeps stocktake and every other capability.

**Not done (UI):**

- `/admin` still shows every page to anyone signed in. For procurement, the admin-only pages come back empty or refuse writes: correct, but not friendly.
- The products page doesn't show or edit criticality/ownership, and there is no page for `asset_units` yet.
- The roster import and members page accept `procurement` already.

## Findings

**Quantities**

- **The legacy app invented a quantity of 100 for 100 rows.** All ignored.
- **13 counted items disagree between the sheet and the legacy app**, almost all
  upward in the app. For example: XT30 straight F 19 → 99, JST 2-pin straight
  4 → 54, XT30 F-M long 14 → 114. That is consistent with an August 2026
  connector restock recorded only in the app. The import took the app's figure;
  verify on the shelf.
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
  "Assembled parts" rows (M3508, C620, Jetsons, DR16, LiDAR, RealSense…)
  duplicate the High Value Items tab. Merged into one product each.
- **"Battery old/new" (17, 8) and "Old/New controller" (6, 7)** almost certainly
  double-count the TB47S/TB48S and NDJ6/DT7 registers. Held.
- **Legacy app:** DM3519 entered twice (41 each), then DM3520 at 41 a minute later
  (held). PM02 entered twice.
- **Sheet rows:** R294 and R295 are byte-identical; R276 and R345 are the same part (10 vs 9).
- **Unit register:** component IDs PM02-10/11/12 are used twice (the second set is
  renamed PM02-19/20/21 and needs relabelling), and two serials each appear on
  two units.

**Misfiled and mislabelled**

- **Resistor book:** 3Ω and 3.6Ω rows sit inside the kΩ run (read as 3kΩ and
  3.6kΩ); 5.5kΩ (7.5kΩ) and 31Ω (30Ω) aren't E24 values.
- **Parts named wrongly:** capacitors labelled as resistors (R342–344). "3m" and
  "4m" resistors are read as milliohm current-sense shunts, not megohm. The
  2N7000 is a MOSFET, not a BJT.
- **Legacy app quirks:** it filed every tool under SMD, and imported the "Tools"
  section header as a product.

**Unidentifiable (held):** `402`, `422`, `X pulse`, `X hx0089b`, "Power delivery
thingy", "Load resistor big", "Sparkfun opamp".

**Condition and safety**

- **TB47S: 9 of 10 recorded swollen or bad.** Swollen LiPo packs are a fire
  risk; imported as faulty.
- **Gone:** 3 TB48S destroyed in Mar 2025 aerial testing; 1 AM02 missing since 2023.
- **Reported faulty in the legacy app, units unidentified:** 2 VT03 and 2 AM12.
- **Jetson Orin NX:** the one labelled unit is recorded killed by overvoltage
  (Jul 2026). A second was written off, possibly in the same incident logged twice.

**People**

- **No legacy account has a name or a Telegram handle**, only an email. Nobody
  can bind until the club roster supplies them.
- **11 accounts were `admin` in the legacy app.** All are proposed as `member`
  except the developer, who is proposed as `admin`.

**Procurement backlog:** `bom_lines.csv` has 68 lines:

- 52 parts for the v2 supercap controller, each with MPN, a decoded description
  and quantity per build.
- 10 lines with a quantity but no part number.
- 6 capacitor-bank parts with no quantity.

None of these are products, because nothing is on the shelf.

## The review package (`data/clean/`)

| File | What it is | Reviewer's job |
|---|---|---|
| `review_flags.csv` | Every assumption and discrepancy, blocker → check → info | Work through it top to bottom |
| `products.csv` | 567 products with `action` (import / hold), each source's quantity side by side, the basis used, previous names | Fix names, category, criticality, ownership; set `action` |
| `opening_balances.csv` | The ledger seed: qty per product per holder | **This decides stock**, not `products.qty_total` |
| `asset_units.csv` | 314 units | Condition, ownership, serials |
| `open_loans.csv` | 32 open legacy loans with `action` | Confirm or release the held ones |
| `members.csv` | 40 accounts, in the `/admin/members` roster format plus two review columns | Real names, Telegram handles, roles |
| `holders.csv`, `locations.csv` | Robots and places | Rename or merge |
| `bom_lines.csv` | Procurement backlog | Procurement |

Suggested order:

1. The blocker and safety items.
2. The `hold` rows.
3. Roles.
4. Over-allocated and totals-disagree items (walk the robots).
5. Sheet-vs-app differences (walk the shelves).
6. Ownership of every critical item.
7. Everything else.

**After review, only re-run the importer, never `build.ts`.** The build refuses
to overwrite `data/clean/` without `--force`, because overwriting discards the
edits.

## Importing

```bash
# 0. Build the package (once, before review starts)
npx tsx scripts/clean-data/build.ts

# 1. Rehearse against the linked project -- always rolls back
npx tsx scripts/import-clean-data.ts --rehearse --with-migration
supabase db query --linked -f data/clean/import.rehearse.sql   # expect "IMPORT REHEARSAL OK"

# 2. Apply migration 0024 (not `db push`: see tele-qr/checkpoint.md), record it in
#    supabase_migrations.schema_migrations as for 0015-0023, then regenerate
#    src/lib/types/database.ts -- 0024's types were added by hand
supabase db query --linked -f supabase/migrations/0024_catalog_import_ownership_criticality_roles.sql

# 3. Import
npx tsx scripts/import-clean-data.ts
supabase db query --linked -f data/clean/import.sql
```

`supabase db query -f` runs a file as a single transaction: an error anywhere
rolls back everything, including DDL. That was verified before relying on it,
and it is what makes the rehearsals safe.

Things to know before running the real import:

- **Import into a database without the dev fixtures.** Otherwise fixture
  products named `M3508`, `GM6020` and `Terminal crimps` sit next to the real
  ones, and fixture robots `Engineer` and `Standard` linger as borrow
  destinations.
- **Holders, members and locations are reused by name or email.** A second
  import is refused.
- **Admin login needs a matching email.** Staff sign in to `/admin` only if
  their Supabase Auth email equals `members.nus_email`. The legacy emails are
  personal Gmail addresses.
- **One imported loan is already overdue**: a PM02 out since 7 Aug 2026. Its
  borrower will be nudged once they bind.

## Open questions

- Which critical items are actually borrowed from other departments or clubs?
  The sheets only ever recorded three loans.
- Who is procurement, and who else is admin?
- Are the 13 M3508 flywheel motors part of the 64, or extra?
- Is S$150 the right line for `critical`?
- What is the "UV charger", who or what is "Hopps", and should the four DarkSTDs
  be one holder or four?
- Should critical items eventually be scanned per unit (component ID on the
  sticker) rather than per product? Today the ledger is per product, and
  `asset_units` only records identity and condition.
