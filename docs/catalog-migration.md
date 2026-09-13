# Catalog Migration

> **Status (2026-09-13):** steps 1–3 and 5–6 below are implemented in
> `scripts/clean-data/` and `scripts/import-clean-data.ts`, working from the
> xlsx plus the legacy checkout app's export rather than the single CSV this
> page describes. Step 4, the human review, is what remains. See
> [data-cleaning.md](data-cleaning.md). Row numbers on this page are CSV
> lines, not xlsx rows.

> **Applies to both candidate approaches** — [tele-qr](tele-qr/) and
> [face-id-and-cv](face-id-and-cv/). Whichever the committee picks, the catalog
> work is identical and has to happen first.

## TL;DR

- **This is a 3–5 day job with a human in the loop, not an import script** —
  and it's the project's critical path.
- The spreadsheet is a good record *for humans* and an unusable one for a
  database. Real defects found:
  - **Quantities that aren't numbers**: `a lot`, `3 sticks`, `>50`, `1tub`
  - **Rows 294 and 295 are byte-identical** — is the true quantity 85 or 170?
  - **Capacitors labelled as resistors** (rows 342–344)
  - **Names that identify nothing**: `402`, `3m resistor`, `Resistor 400`,
    `Power delivery thingy`, `Cartridge Fuse unknown`
  - **`Ω` mangled to `?` throughout** — but `?` is *also* a genuine unknown
    marker, so blind find-and-replace is wrong
  - **Two tables side by side** (cols A–G and I–N); a naive parse merges them
    into nonsense
  - **`Total` is 0 on many populated rows** — don't trust it, recompute
- **The remarks column is the most valuable data in the sheet**: row 173 parses
  to ten robot allocations summing to exactly the stated `Qty outside` of 58.
- **The bench-literate review pass cannot be automated and must not be
  skipped.** A catalog with 80 ambiguous products poisons trust permanently.
- **Don't wait for the two unfinished sheets.** Import electrical, go live, add
  the rest through the admin UI — which usefully exercises the add-a-product
  path that has to work for years.

---

Getting from `data/RoboMaster_Inventory_3_Sheets(Electrical Parts).csv` to a
usable `products` table. This is a real work item with a human in the loop, not
an import script — budget days, not hours.

## Why it can't just be imported

The spreadsheet is a good inventory record for humans and an unusable one for a
database. Concrete defects found in the electrical-parts sheet (row numbers are
lines in the CSV):

### Quantities that aren't numbers

| Row | Item | Qty as written |
|---|---|---|
| 36–42 | Terminal crimps, shrink tube, Dupont crimps, Pin conn M, Pin header F | `a lot` |
| 43 | pin headers male right angled | `3 sticks` |
| 46 | Female header pin | `6 sticks` |
| 239 | JST 2 pin wire | `>50` |
| 537 | soldering flux | `1tub` |
| 87–88, 90–91, 118 | LED through hole, LED SMD, Optocouplers, SMD diode | `a lot` |

These are the `loose` tier from [data-model.md](face-id-and-cv/data-model.md). They get a
stock *level*, not a count. Don't invent numbers for them during import.

### Duplicates and probable duplicates

- **Rows 294 and 295 are byte-identical**: `100nF 100V ceramic capacitor 0603
  SMD, 85`. One of these is a copy-paste artifact — but which, and is the true
  quantity 85 or 170?
- `100nF 100V ceramic capacitor` appears at row 259 (qty 68), row 294/295
  (qty 85), and row 352 as `100nF 100V ceramic capacitor SMD` (qty 32).
  Possibly three physical locations of the same part, possibly three different
  packages recorded inconsistently.
- `Capacitors 2.7V 50F` appears at row 50 (qty 9) and again at row 95 in the
  right-hand supercap column (qty 9) — same stock counted in two places.
- `Resistor 1kΩ` variants: rows 58, 308, 309, 350, 428 — through-hole, 0805,
  0603, unspecified, and book. Some are genuinely different parts; some are
  probably not.

### Mislabelled parts

Rows 342–344 describe capacitors as resistors:

```
2.2uF 16V Resistor
470pF 50V Resistor
1.5uF 16V Resistor
```

A blind import creates three products with wrong categories that will then be
wrong forever.

### Names that don't identify anything

| Row | Name | Problem |
|---|---|---|
| 346 | `402` | Package size? Part number? Value? |
| 347 | `422` | Same |
| 348–349 | `3m resistor`, `4m Resistor` | 3 milliohm? 3 megohm? |
| 57 | `Resistor 400` | No unit |
| 51 | `Capacitors 50V 10k ?F` | 10 kilo-microfarad is not a thing |
| 74 | `Load resistor big` | — |
| 128 | `Power delivery thingy` | — |
| 129 | `X hx0089b` | — |
| 93 | `Sparkfun opamp` | Which one? |
| 97 | `Cartridge Fuse unknown` | Honest, at least |

These need a human who knows the parts bench to resolve. Some will only be
resolvable by going and looking at the bin.

### Encoding damage

The `Ω` character is mangled to `?` throughout — rows 55–70, and the entire
resistor book at rows 355–512 (`1.2?`, `10k?`, `680?`). Fix the encoding on
read or the catalog gets 150+ products with corrupted names. Note that `?` also
appears as a genuine unknown marker (row 97), so a blind find-and-replace is
wrong.

### Structural quirks

- **The sheet is two tables side by side.** Columns A–G are the main inventory;
  columns I–N are a separate supercapacitor-controller BOM with its own
  numbering and a `Needed` column rather than `Qty in storage`. A naive CSV
  parse merges them into nonsense rows.
- **Section headers are data rows**: `Connectors` (row 2),
  `Components through hole` (row 49), `Assembled parts` (row 169), `Wires`
  (row 212), `SMD` (row 258), `Tools` (row 516). These carry the category for
  every row beneath them and must be turned into a real column.
- **Empty filler rows** at 154–168 and 513–515.
- **The `Remarks` column on assembled parts is structured data in prose.**
  Row 173: `"15 darknus, 7 hero, 6 standard, 6 sentry, 4 engineer, 6 turtlebot,
  6 old sentry, 2 lying arnd, 2 on kirby gimbal, 4 on spare robot, aerial"` —
  this parses to ten allocations summing to 58, which matches `Qty outside`.
  This is the most valuable data in the sheet and the most fragile.
- **`Total` is sometimes a formula result and sometimes 0** even when
  `Qty in storage` is populated (rows 22–23, 36–44, 213 onward) — don't trust it;
  recompute.

## Migration plan

**1. Parse and split.** Read as UTF-8 with the Ω repair. Split the two
side-by-side tables. Drop filler rows. Propagate section headers down as
`category`.

**2. Classify into tiers.** Mostly mechanical, from category and package:

| Source category | Tier |
|---|---|
| Assembled parts, Tools, and boards from rows 123–153 | `asset` |
| Connectors, Wires, SMD, resistor book, through-hole | `bulk` |
| Anything whose quantity reads `a lot` / `sticks` / `>N` / `tub` | `loose` |

**3. Normalise names into name + spec.** For the resistor book especially,
`10k?` becomes `{name: "Resistor 10kΩ 0402", spec: {value: "10k", package:
"0402", type: "resistor"}}`. Structured spec is what makes 157 near-identical
products searchable.

**4. Human review pass.** Generate a review CSV with three columns: the
original row, the proposed product, and a flag. Flag everything in the
"defects" section above. **A bench-literate member walks the review file and
the shelves together.** This is the step that cannot be automated and the one
most likely to be skipped — don't.

**5. Import.** Products first, then seed `stock_movements` with
`reason = 'seed'` from the `adjustment` holder into `store` for in-storage
quantities, and into the appropriate robot holder for parsed remarks
allocations. Keep `legacy_row` on every product.

**6. Reconcile.** Diff the imported `stock_summary` against the spreadsheet's
own numbers. Every mismatch is either an import bug or a pre-existing
spreadsheet error — both are worth knowing about before go-live.

## Sequencing note

The two undocumented sheets (mechanical and one other) are still being written.
**Don't wait for them.** Import the electrical sheet, get the system running,
and add the others through the admin UI as they are finished — that also
exercises the "add a product" path properly, which is the one that has to work
for years.

## Open questions

- Who is the bench-literate reviewer for step 4, and when are they available?
  This is the migration's critical path.
- Should the resistor book be 157 products, or one product with a `value`
  dimension and per-value stock? 157 products is simpler and matches the bin
  structure (one pocket = one product = one QR label). Recommending 157.
- Are the duplicate `100nF` rows genuinely different locations? Needs a look at
  the actual shelves.
- Does the club want to keep updating the spreadsheet in parallel during
  transition? Strongly advise against — two sources of truth diverge within
  weeks. Pick a cutover date.
