# Operations — The Human Work

## TL;DR

- **~5–6 person-days to set up, ~30 hrs/year to run.**
- Setup is dominated by two things: the **catalog migration (3–5 days)** and
  **printing and sticking ~500 labels (~1 day)**. Everything else is hours.
- There is **no face enrollment and no reference photo capture** — that's ~7
  hours of setup and a recurring per-product cost that the CV approach carries
  and this one doesn't.
- Recurring work is mostly **new products (~8 hrs/yr)** and a **rolling
  stocktake, one location per month (~24 hrs/yr)**.
- **Adding a new product must stay under 5 minutes** or the catalog rots — same
  way the spreadsheet did.
- This is not *less* work than the spreadsheet, it's **better distributed**. It
  still needs a named owner.

---

## Part 1 — One-time setup

### 1.1 Catalog migration (3–5 days) — the critical path

Detailed in [../catalog-migration.md](../catalog-migration.md). Roughly half a
day is automatable; the rest is a bench-literate member walking the review file
against the actual shelves to resolve rows like `402`, `3m resistor`, and
`Cartridge Fuse unknown`.

**This is the largest work item and the one most likely to be half-done.** A
catalog with 80 ambiguous products generates mistrust that outlives any amount
of good engineering.

Do the [label survey](qr-labels.md) during this same walk — you're already at
the shelves, and the compartment count is the one number the print run needs.

### 1.2 Labels (~1 day)

~360–500 stickers. Full spec in [qr-labels.md](qr-labels.md); the operational
shape:

| Task | Effort |
|---|---|
| Choose short bot/app names, generate codes | 1 hr |
| Design the label template | 1 hr |
| Print | 1 hr |
| **Clean bins and stick ~500 labels** | **6–8 hrs** |

The sticking is the real cost: 30–45 s each once you account for cleaning the
surface and finding the right bin. Two people, one afternoon, working in
location order.

Clean with IPA first. A label applied over flux residue lifts within weeks, and
re-labelling is slower than labelling.

### 1.3 Member provisioning (~15 min per intake)

**Join codes are the normal path** (`/admin/join-codes`, see
[HOW_TOs/members-and-roles.md](HOW_TOs/members-and-roles.md)). At a briefing,
an admin creates a code for about the number of people in the room, puts its
QR on the screen, and everyone joins themselves in a minute: code, name, NUS
email, accept the notice. Nobody has to collect Telegram handles in advance,
so the old "~10–20% fail the automatic bind" step mostly disappears. Anyone
whose email or verified handle matches an unlinked roster row is linked to it
instead of duplicated.

The roster CSV import still exists. Use it when the club's records should come
first, such as a legacy member list with loans attached. Its members bind on
`/start` by handle, or with a code by email. The bind queue now holds only the
cases a code can't resolve safely: staff rows, deactivated members, and
ambiguous matches.

Compare: the CV approach needs ~3 hours of in-person face capture plus consent
for the same roster.

### 1.4 Seed holders and thresholds (~1 hr)

- Create robot holders from the spreadsheet's remarks: DarkNUS, Hero, Standard,
  Sentry, Old Sentry, Engineer, Turtlebot, Aerial, Kirby gimbal
- Set `min_stock` on the parts worth alerting on — don't do all 600; pick the
  ones that actually stop work when they run out
- Set the overdue threshold (days)

### 1.5 What you don't have to do

Worth stating explicitly, since it's most of the difference in setup cost:

- No face enrollment sessions (~3 hrs)
- No product reference photography (~3–4 hrs, 5–8 frames × ~90 items)
- No threshold calibration (~2–4 hrs)
- No camera mounting or lighting setup (~2 hrs)
- No consent collection process

## Part 2 — Recurring work

| Task | Cadence | Effort/yr | Owner |
|---|---|---|---|
| Provision new members (join codes) | Each intake (~2×/yr) | ~0.5 hr | Admin |
| Clear the bind queue | As it fills | ~1 hr | Admin |
| Offboard leavers | Annually | ~1 hr | Admin |
| **Add new products** (create, label, stick) | ~100 SKUs/yr | **~8 hrs** | Logistics lead |
| **Rolling stocktake** | 1 location/month | **~24 hrs** | Rotating |
| Review stocktake variance | Quarterly | ~2 hrs | Logistics lead |
| Reprint damaged labels | As noticed | ~1 hr | Anyone |
| Committee handover | Annually | ~2 hrs | Outgoing lead |
| **Total** | | **~40 hrs** | |

Realistically ~30 hrs if the stocktake cadence relaxes for stable locations.

### Adding a new product — the most frequent task

The club buys constantly, so this path must stay cheap. ~3 minutes per SKU:

1. Create the product in the admin UI (name, tier, category, location, spec)
   — `/admin/products`
2. Generate and print the label — `/admin/labels` (single label, or batch the
   whole location if you are relabelling a shelf)
3. Stick it
4. Record the received quantity — `/admin/restock`

**Opening balances matter more than they look.** Until a product has been
restocked at least once, the ledger thinks the store holds zero of it, and
every borrow drives its holding negative. Borrows are deliberately never
blocked on insufficient stock — a member standing there with the part in their
hand should not be argued with — so a negative balance is a *data-quality
signal*, surfaced on the dashboard, and almost always means a missing opening
balance rather than a missing part.

**If this ever takes longer than five minutes, people stop doing it and the
catalog drifts out of date** — which is precisely how the spreadsheet failed.
Treat the speed of this flow as a product requirement.

Note this is *shorter* than the CV equivalent, which additionally needs 5–8
reference photos per Tier A item.

### Stocktake — rolling, never one big day

A full count of ~600 SKUs is a miserable 6-hour job that gets postponed
indefinitely. Count **one location per month** instead:

`Table Shelf → Rotating shelf → small box (SMD) → small box (supercap) →
book → blue rack → battery charging point → …`

Each is ~2 hours, the whole catalog is covered roughly annually, nothing is ever
more than a year stale. Tier A shelving deserves more — quarterly, and always
before and after a competition.

Committing a count writes adjustment movements automatically
([data-model.md](data-model.md)); nobody edits numbers by hand.

**Variance is a diagnostic, not an accusation.** A part with persistently high
variance is one people aren't logging, which means the flow for it is too slow.
That's a UX bug to fix, not a person to chase. This is an honour system.

### Label health

Unlike the CV approach, this system has a physical component that degrades.
Watch the **scan vs. search ratio** on the dashboard: a product consistently
reached by search almost certainly has a missing or damaged sticker. Reprint on
that signal rather than waiting for a complaint — the dashboard's label-health
card lists the suspects and links straight to a reprint, and the
unknown/retired-code card catches stickers that are still being scanned after
their code was retired.

## Part 3 — The expensive events

Genuinely rare, and much cheaper than the CV approach's equivalents.

**Changing the bot username.** Every printed QR breaks, because the bot name is
in the URL. This is the one true reprint-everything event — which is why
[qr-labels.md](qr-labels.md) insists on choosing short, final names *before*
the print run. Pick once, keep forever.

**Re-organising the store.** Moving parts between bins means re-labelling those
bins. Batch print by location makes it a couple of hours rather than a day.

**Adding a new robot.** An admin creates a holder. No schema change, no deploy,
no reprint.

**Committee handover.** The real long-term failure mode isn't technical — it's
that the person who understood it graduated. Minimum handover:

- [ ] Named successors for logistics lead, admin, and technical roles
      (positions, not people)
- [ ] Vercel and Supabase access transferred (use a team account, not a
      personal one)
- [ ] Bot token and service-role key rotated
- [ ] Walk through: add a product, print a label, provision a member, run a
      stocktake
- [ ] The annual data review is now their job ([pdpa.md](pdpa.md))
- [ ] These docs live in the repo and should be updated when things change

## Open questions

- Who holds the logistics-lead role, and is ~30 hrs/yr realistic on top of
  their existing load? If not, the rolling stocktake is what to cut first — it
  degrades data quality gracefully, unlike skipping product entry.
- Label printer: buy (~S$100) or use A4 sheets? A printer pays for itself in
  reprint convenience if the store gets reorganised even once.
- How many SKUs does the club actually add per year? The ~100 estimate is
  extrapolated from the spreadsheet; purchasing records would firm up the
  largest recurring line.
