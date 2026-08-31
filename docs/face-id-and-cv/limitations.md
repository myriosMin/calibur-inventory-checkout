# Limitations — What Computer Vision Can and Cannot Do Here

## TL;DR

- **~90–100 of ~600 items are camera-identifiable. ~500 are not.** No model
  fixes this; it's the objects, not the software.
- **The resistor book alone is ~157 items (26% of the catalog) and is
  impossible.** 0402 resistors are 1.0 × 0.5 mm with *no printed marking at
  all*. Row 380 (`10Ω`) and row 452 (`10kΩ`) are identical objects. Only the
  pocket they came from identifies them.
- Also hopeless: ~95 SMD parts, ~44 cables (`XT30 F-M short` vs `long`), ~46
  connectors (differ by ~1.25 mm of pin pitch).
- **Even the viable ~90 have lookalike clusters** — `ESC610`/`615`/`620` differ
  only by a printed label.
- **So: CV outputs a ranked shortlist, never an answer.** Top 3, user taps one.
  Bad match costs one tap, not a wrong record — and every tap is free labelled
  data telling us if the CV is worth keeping.
- A nearest-neighbour index *always* returns a neighbour, so two rejection
  thresholds must be calibrated on real captures before launch.

---

This document exists so that nobody (including a future maintainer, or us in six
months) rebuilds a plan around item recognition that the inventory physically
cannot support. It is the reasoning behind the three-tier model in
[idea.md](idea.md).

## Summary

Of the ~600 rows in the current electrical-parts sheet, **roughly 90–100 items
are visually identifiable by a camera. The other ~500 are not.** This is not a
model-quality problem that a better model or more training data will fix. It is
a property of the objects.

Item CV is therefore scoped to Tier A assets only, and even there it produces a
*ranked shortlist for confirmation*, never an unattended identification.

## Catalog breakdown

Source: `data/RoboMaster_Inventory_3_Sheets(Electrical Parts).csv`.
Row numbers refer to lines in that file.

| Bucket | Rows | ~Count | CV viable | Why |
|---|---|---|---|---|
| Assembled parts / motors / compute | 170–210 | ~40 | **Yes** | Large, distinct silhouettes (M3508, GM6020, Jetson, Livox LiDAR, Realsense) |
| Modules & dev boards | 123–153 | ~30 | **Yes** | Rpi, Arduino, STM32, buck converters, stepper drivers, breadboards |
| Tools | 517–538 | ~22 | **Yes** | Wire strippers, crimpers, multimeter, oscilloscope, soldering irons |
| Connectors | 3–48 | ~46 | No | XT30/60/90 and JST/Molex differ by pin count and gender at mm scale |
| Through-hole components | 50–122 | ~73 | Marginal | Category is visible; the *value* printed on the body is not, at kiosk distance |
| Wires & cables | 213–256 | ~44 | No | "XT30 F-M short" vs "long"; JST-GH 2/3/4PIN |
| SMD parts | 259–355 | ~95 | No | 0402/0603/0805 packages, stored loose in "small box" |
| **Resistor book** | 355–512 | **~157** | **Impossible** | See below |
| Supercap BOM (right-hand columns) | 3–48 | ~60 | No | SMD passives and ICs by part number |

### The resistor book is the clearest case

Rows 355–512 are E-series resistor values from 0 Ω to 10 MΩ in **0402
packages**, stored in a book of pockets. A 0402 resistor is 1.0 mm × 0.5 mm and
carries **no printed marking at all** — the package is too small to print on.

There is no camera, no lighting rig, and no model that can distinguish row 380
(`10Ω`) from row 452 (`10kΩ`). They are identical objects. The *only* thing
that identifies them is which pocket of the book they came from.

This single bucket is ~26% of the catalog.

### The same argument, weaker but still decisive, elsewhere

- **SMD (rows 259–355, ~95 items).** Same physics as above, one size up.
  0603 parts do sometimes carry markings, but not at kiosk camera distance, and
  ceramic capacitors are unmarked by convention.
- **Wires (rows 213–256).** Row 213 `XT30 F-M short` and row 214 `XT30 F-M long`
  are the same cable at two lengths. Length is not recoverable from a
  hand-held pose without a depth reference. `JST-GH 2PIN` / `3PIN` / `4PIN`
  (rows 221–225) differ by ~1.25 mm of connector width.
- **Connectors (rows 3–48).** `Molex 2x3` vs `Molex 2x4`, `XT60 straight M` vs
  `XT60 straight F`. Pin counting on a hand-held connector is theoretically
  possible with a macro lens and a fixed jig; it is not possible with a webcam
  at arm's length, and building the jig costs more than a label.
- **Through-hole passives (rows 50–122).** A model can tell "this is a
  resistor" from "this is an electrolytic capacitor". It cannot read
  `Resistor 5.1kΩ` (row 60) versus `Resistor 6.8kΩ` (row 61) from colour bands
  at video resolution with the body partly gripped.

## Lookalikes *inside* Tier A

The viable bucket is not clean either. Known confusion clusters:

| Cluster | Rows | Distinguishing feature |
|---|---|---|
| `ESC620` / `ESC610` / `ESC615` | 181–183 | Printed label only; boards are near-identical |
| `Damiao 4340` / `4310` | 177–178 | Similar body, different dimensions |
| `Center board 1` / `2` | 190–191 | Different PCB, similar footprint and colour |
| `Battery rack new` / `old` | 184–185 | Minor revision differences |
| `Battery old` / `Battery new` | 186–187 | Same form factor |
| `Jetson Orin NX` / `Jetson AGX` | 193–194 | Distinguishable by size, but often in carriers |
| `Capacitor bank New` / `Old` | 170–171 | Assembly revisions |

An embedding model will reliably land in the right *cluster* and unreliably
pick the right member of it. That is the direct motivation for the shortlist
design below.

## Design consequence: shortlist, not classifier

Item CV must never write a transaction line on its own. Instead:

1. Embed the crop, retrieve the top-K nearest products.
2. If the best score is below the rejection threshold, show the search box.
3. Otherwise present the top 3 as large tap targets, best first, with the
   score visible.
4. The user taps one. That tap is the transaction.

Why this is the right shape:

- **The accuracy bar drops from top-1 precision to top-3 recall**, which is a
  far easier target on a growing catalog full of near-duplicates.
- **Failure costs one tap**, not a wrong inventory record.
- **It produces labelled data for free.** Every tap tells us whether rank 1 was
  correct, which is how the rejection threshold gets tuned and how we know
  whether the CV is earning its keep. See `match_rank` and `was_corrected` in
  [data-model.md](data-model.md).
- **It unifies the UI.** CV, bin QR scan, and text search all produce "a
  shortlist to confirm", so there is one interaction to build and learn.

## Things CV will not do in this system

Recorded explicitly so they don't get re-proposed:

- Identify any Tier B or Tier C part. Bin QR does this.
- Count multiple instances in one frame. Quantity comes from repeated hold-ups
  (Tier A) or typed entry (Tier B).
- Distinguish individual units of the same product. We track *quantities per
  holder*, not serial numbers. See [data-model.md](data-model.md).
- Detect that someone took something without logging it. This is an honour
  system; the stocktake flow is the correction mechanism, not surveillance.
- Read printed part numbers or labels. If we ever need this, it is an OCR
  feature and a separate decision.

## The rejection threshold matters more than the model

A nearest-neighbour index always returns a neighbour. An empty frame, a hand, a
coffee cup, or an unenrolled item will all match *something*. Two thresholds
must be calibrated against real captures before launch and stored in config,
not hard-coded:

- `face_match_min_score` — below this, fall back to QR self-identification.
- `item_match_min_score` — below this, skip the shortlist and open search.

Both need a labelled evaluation set to set sensibly. Building that set is a
task in [roadmap.md](roadmap.md), not an afterthought.

## Open questions

- Where exactly does the through-hole bucket (rows 50–122) land? It is the one
  genuinely ambiguous group — category-recognisable but not value-recognisable.
  Current assumption: treat as Tier B (bin QR), revisit if the bins turn out to
  be mixed.
- The two undocumented sheets (mechanical, and one other) will shift these
  counts. Mechanical parts are plausibly *more* CV-friendly than electrical
  ones — screws by length are hard, but wheels, plates, and pulleys are not.
- Is there any appetite for a macro-lens second camera for connectors? Assumed
  no; noted only to record that it was considered and rejected as
  disproportionate.
