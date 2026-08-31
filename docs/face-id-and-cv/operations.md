# Operations — The Human Work

## TL;DR

- **~6–8 person-days to set up. ~40 hrs/year to run.** Not less work than the
  spreadsheet — better *distributed*. If nobody owns the admin load, this rots
  exactly like the spreadsheet did.
- **Face: 3 frames minimum, 5 recommended.** More is wasted — returns flatten
  fast and it's more biometric data than you need. ~2 min/member, ~3 hrs for
  80. Run it as a station at start-of-year onboarding.
- **Items: 5–8 frames** (front, back, two 45°, ≥2 held in hand). ~3–4 hrs for
  ~90 products.
- **Capture through the kiosk camera, in kiosk lighting, held as it'll be
  held.** Clean product photos on white are the wrong distribution and will
  quietly halve accuracy. This matters more than the frame count.
- **Don't over-shoot the lookalikes** — 20 frames of ESC610/615/620 won't
  separate them; the distinguishing feature is printed text. That's what the
  shortlist is for.
- **~500 QR labels, ~1 day.** One per *compartment*, not per product. The
  resistor book gets **one QR per page** (~8 labels), then tap to pick from the
  ~20 values on it — 157 pockets can't each carry a scannable code.
- Labels: ≥20 mm, short opaque code not a long URL, **laser on polyester/vinyl**
  (these bins meet flux and IPA), and **always human-readable text underneath**
  so the store works when the software doesn't.
- **Stocktake rolling — one location per month (~2 hrs).** A 600-SKU day-long
  count gets postponed forever.
- **Adding a product must stay under 5 minutes.** Treat that as a product
  requirement: slower than that and people stop, and the catalog drifts.
- Item-model swap = free background re-embed. **Face-model swap = re-enrol all
  80 in person.** Choose the face model once.

---

Every automated system has a manual tail. This document states the setup work
and the recurring work honestly, with numbers, so that nobody adopts this
system expecting it to be free and nobody inherits it without knowing what
they're inheriting.

**Headline: about 6–8 person-days to set up, and about 5 person-days per year
to keep running.**

That is not less work than the spreadsheet. It is *differently distributed*:
the spreadsheet concentrates all effort on one person heroically reconciling
after the fact, while this spreads small amounts across members at the point of
use, plus a modest, predictable admin load. If nobody owns that admin load, the
system will rot exactly like the spreadsheet did.

---

## Part 1 — One-time setup

### 1.1 Catalog migration (3–5 days) — the critical path

Detailed in [catalog-migration.md](../catalog-migration.md). The automatable part
is maybe half a day; the rest is a bench-literate member walking the review
file against the actual shelves to resolve rows like `402`, `3m resistor`, and
`Cartridge Fuse unknown`.

**This is the single largest work item in the project and the one most likely
to be skipped or half-done.** A catalog with 80 ambiguous products will
generate mistrust that outlives any amount of good engineering.

### 1.2 QR labels (~1 day)

**How many.** Roughly 500 labels, but *not* one per product — one per physical
storage compartment:

| Location | Compartments | Approach |
|---|---|---|
| Resistor book (rows 355–512) | ~8 pages, ~157 values | **One QR per page**, not per pocket |
| Small box — SMD (rows 259–355) | ~95 | One per compartment |
| Small box — supercap BOM | ~60 | One per compartment |
| Connectors, Table Shelf (rows 3–48) | ~46 | One per bin |
| Wires, blue rack / rotating shelf (rows 213–256) | ~44 | One per bin |
| Through-hole (rows 50–122) | ~73 | One per bin |
| Tier A shelving | ~10 | One per shelf/rack |

**Label a group, then tap to pick within it.** The resistor book is the clear
case: 157 pockets at 0402 scale cannot carry a scannable QR each, and shouldn't
have to. Scan the page label, the screen lists the ~20 values on that page, tap
one. This is the same shortlist-then-confirm interaction as everything else in
the system — see [limitations.md](limitations.md) — so it costs no new UI.

**Label design.**

- **Always include human-readable text under the QR.** Never a bare code. When
  a label is scuffed or the scanner misbehaves, a person must still be able to
  read `Resistor 10kΩ 0402`. This single rule is what keeps the store usable
  when the software isn't.
- Encode a **short opaque code** (`rm.cv/0A3F`), not a long URL. Short strings
  keep the QR at low density so it stays scannable at 20 mm. Resolve the code
  server-side.
- **Minimum 20 mm QR** for reliable phone scanning at arm's length. Go larger
  where there's room.
- **Laser print on polyester or vinyl labels**, not inkjet on paper. These bins
  get handled with flux, IPA, and hot air; paper labels degrade within a year
  and inkjet smudges on contact with solvent.

**Sticking them on** is the slow part: ~500 labels at roughly 30–45 s each once
you account for cleaning the surface and finding the right bin. Budget 6–8
hours. It is a good task for two people and an afternoon.

**Plan for reprints from day one.** Labels fall off, get covered, get solvent
on them. The admin UI needs a "print label" button per product and a batch
print per location, available from the start — not added later when the first
label peels.

### 1.3 Member enrollment (~3 hours for 80 members)

**How many images per face: 3 minimum, 5 recommended.**

For a closed set of 80 people, ArcFace-class embeddings are accurate from a
single good frontal capture. The extra frames buy robustness to real variation,
not baseline accuracy. Capture in one sitting with deliberate variation:

1. Neutral, straight on
2. Slight left turn
3. Slight right turn
4. With glasses on, if they wear them
5. Without glasses, if they wear them

**More than about 5 is wasted effort** — the returns flatten quickly and every
extra vector is more index and more storage of biometric data, which cuts
against [pdpa.md](pdpa.md).

**Capture through the kiosk camera, in the kiosk's lighting.** Reference
embeddings taken on a laptop webcam in a bright room will not match faces at
the kiosk at 9pm. The domain gap is the most common cause of poor real-world
recognition, and it is entirely avoidable.

Budget ~2 minutes per member including reading and recording consent. Run it as
a station at the start-of-year onboarding session rather than chasing people
individually.

### 1.4 Product reference capture (~3–4 hours for ~90 Tier A items)

**How many images per item: 5–8.**

- Front, back, and two 45° angles
- At least two held in a hand, as a member would actually present it
- Both orientations if the item isn't symmetric

Again: **through the kiosk camera, in the kiosk's lighting, held as it will be
held.** Clean product photos on a white background are the wrong training
distribution and will quietly halve your accuracy.

**Don't over-invest in the lookalike clusters.** It's tempting to shoot 20
frames each of `ESC610` / `ESC615` / `ESC620` hoping to separate them. It won't
work — the distinguishing feature is printed text the embedding doesn't
capture. That's what the shortlist is for. Give them the standard 5–8 and let
the user tap.

Budget ~2 minutes per product with a decent capture UI. This is a good task to
split across a few members over a week.

### 1.5 Threshold calibration (2–4 hours)

Once faces and products are enrolled, `face_match_min_score` and
`item_match_min_score` must be set against real data, not guessed:

- Collect ~50 positive queries (enrolled members, catalogued items) and ~30
  negatives (a phone, a mug, a bare hand, an empty frame, a visitor).
- Sweep the threshold; pick the point where false accepts hit zero, then back
  off slightly for margin.
- Store in the config table, not in code, so re-tuning doesn't need a deploy.

### 1.6 Camera and lighting (~2 hours)

Cheap and high-leverage. Fixed camera position at a known working distance,
consistent lighting that doesn't depend on time of day or whether the blinds
are open, and a marked spot on the bench where items are held. **This will move
accuracy more than any model choice.**

---

## Part 2 — Recurring work

| Task | Cadence | Effort | Owner |
|---|---|---|---|
| Enroll new members | Each intake (~2×/year, ~30 people) | ~1 hr/year | Admin |
| Offboard leavers + delete face data | Annually, start of academic year | ~1 hr/year | Data owner |
| Add new products (create, label, capture) | Per purchase, ~100 SKUs/year | ~8 hrs/year | Logistics lead |
| Rolling stocktake | One location per month | ~2 hrs/month = 24 hrs/year | Rotating |
| Review stocktake variance | Quarterly | ~2 hrs/year | Logistics lead |
| Reprint damaged labels | As noticed | ~1 hr/year | Anyone |
| Threshold re-check | Annually or if the dashboard drifts | ~1 hr/year | Technical |
| Committee handover | Annually | ~2 hrs/year | Outgoing lead |
| **Total** | | **~40 hrs/year** | |

### Adding a new product — the most frequent task

The club buys constantly, so this path must stay cheap. ~5 minutes per SKU:

1. Create the product in the admin UI (name, tier, category, location, spec)
2. Print and stick the label
3. **Tier A only:** capture 5–8 reference frames
4. Seed the received quantity as a `restock` movement

If this ever takes longer than five minutes, people will stop doing it and the
catalog will drift out of date — which is precisely how the spreadsheet failed.
Treat the speed of this flow as a product requirement, not a nice-to-have.

### Stocktake — do it rolling, never as one big day

A full count of ~600 SKUs is a miserable 6-hour job that gets postponed
indefinitely. Instead, count **one location per month**:

`Table Shelf → Rotating shelf → small box (SMD) → small box (supercap) →
book → blue rack → battery charging point → …`

Each is ~2 hours, the whole catalog is covered roughly annually, and nothing is
ever more than a year stale. Tier A shelving should be counted more often —
quarterly, and always before and after a competition.

Committing a count writes adjustment movements automatically
([data-model.md](data-model.md)); nobody edits numbers by hand.

**Variance is a diagnostic, not an accusation.** A part with persistently high
variance is one people aren't logging, which means the flow for it is too slow.
That's a UX bug to fix, not a person to chase. This is an honour system.

### Annual PDPA review

At the start of each academic year, per [pdpa.md](pdpa.md):

- Delete face embeddings for members who have left
- Confirm the consent text version is still current
- Confirm the named data owner position is filled
- Spot-check that no code path has started retaining frames

---

## Part 3 — The expensive events

Rare, but they should not be surprises.

### Swapping the item embedding model

Because raw product reference images are **kept** (they aren't personal data),
this is a background re-embed job over stored images — hours of compute, no
human work. This is the reason to keep them. See the storage note in
[data-model.md](data-model.md).

### Swapping the face embedding model

This one is genuinely expensive: **every member must be re-enrolled in person.**

Face photographs are discarded at enrollment by design ([pdpa.md](pdpa.md)),
so there is nothing to re-embed from. That's a deliberate trade — a real
privacy win paid for with a painful migration — and it has one practical
consequence:

> **Choose the face model once, carefully, and stay on it.** Verify it works at
> the kiosk before enrolling 80 people, because changing it later means
> re-enrolling everyone, including members who have since graduated and cannot
> be re-enrolled at all.

If a face model change becomes unavoidable, run it alongside the annual intake
so most of the enrollment work is happening anyway.

### Adding a new robot

Rare (roughly annually). An admin creates a new `holder` of kind `robot`. No
schema change, no deploy.

### Committee handover

The system's real failure mode over a multi-year horizon isn't technical, it's
that the person who understood it graduated. At minimum, handover must cover:

- [ ] Named successors for the data owner, system admin, and technical roles
      (positions, not people)
- [ ] Admin UI access transferred; service-role key rotated
- [ ] Walk through: add a product, enroll a member, run a stocktake
- [ ] The annual PDPA review is now their job
- [ ] Where these docs live, and that they should be updated when things change

---

## Open questions

- Who holds the logistics-lead role, and is the ~40 hrs/year realistic on top
  of their existing load? If not, the rolling stocktake is the part to cut
  first — it degrades data quality gracefully, unlike skipping product entry.
- Is there a label printer available, or does this need buying? A cheap
  thermal label printer would make the reprint story much better than sheet
  labels and is worth the ~S$100.
- Should reference capture for new Tier A products be *required* before the
  product goes live, or optional with a "no CV yet" state? Optional is more
  realistic; required is better data. Leaning optional, with the admin
  dashboard listing products missing references.
- How many SKUs does the club actually add per year? The ~100 estimate above is
  a guess from the spreadsheet's growth; the purchasing records would give a
  real number and would firm up the recurring-effort total.
