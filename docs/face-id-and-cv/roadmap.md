# Roadmap

## TL;DR

- **The club gets something useful before any CV is written, and CV never sits
  on the critical path.**
- **Phase 0 — de-risk (1–2 days).** Photograph 30 real Tier A items including
  the known lookalikes, embed, measure. **Gate: top-3 recall ≥ 90%.** Below
  that, ship without item CV — QR and search already cover everything.
- **Phase 1** — catalog migration + schema + admin CRUD. Unglamorous, and the
  longest.
- **Phase 2 — borrow/return with QR + search, no CV. This is the milestone that
  retires the spreadsheet.** Everything after it is acceleration.
- **Phase 3** — bin QR for the ~500 bulk items.
- **Phase 4** — face recognition (makes the common case fast).
- **Phase 5** — item CV as a shortlist accelerator, only if Phase 0 passed.
  Switchable off by config flag with zero impact.
- **Phase 6** — dashboard: per-robot BOM, overdue, low stock.
- Targets: borrow 3 items < 45 s, bulk part < 10 s, face ID < 3 s. **The honest
  metric is stocktake variance** — an honour-system tool succeeds or fails on
  whether people bother, and drift is the only external check.
- Biggest risks: catalog migration stalling on human review, and nobody using
  it because it's slower than just taking the part.

---

Ordering principle: **the club should have something useful before any CV is
written, and the CV should never sit on the critical path.** This system is
meant to run for years across committee handovers, so the boring parts —
catalog, admin UI, handover docs — matter more than the interesting parts.

## Phase 0 — De-risk the CV (1–2 days)

Before building anything, find out whether item recognition works on the actual
parts. This is cheap and it gates Phase 5.

1. Pick ~30 Tier A items, deliberately including the known lookalike clusters
   from [limitations.md](limitations.md) (ESC610/615/620, Damiao 4310/4340,
   Center board 1/2).
2. Capture 5–8 reference frames each **through the intended kiosk camera, in
   the intended lighting, held in a hand** — not clean product photos.
3. Capture a separate held-up query set, different session, different day.
4. Embed with DINOv2 ViT-B/14; measure **top-1 accuracy and top-3 recall**;
   build the confusion matrix.
5. Sweep the rejection threshold against a set of out-of-catalog objects (a
   phone, a mug, a hand, an empty frame) to find where false accepts start.

**Gate:** top-3 recall ≥ 90% on the 30-item set means the shortlist design
works and Phase 5 is worth building. Below that, ship the system without item
CV — bin QR and search already cover everything — and revisit later.

Also worth measuring here: the P100 wheel actually loads and runs (sm_60, see
[architecture.md](architecture.md)), and per-frame latency against the budget.

## Phase 1 — Catalog and schema

The unglamorous foundation. Nothing works without a real product table.

- Schema from [data-model.md](data-model.md), migrations in the repo
- Catalog migration per [catalog-migration.md](../catalog-migration.md), including
  the human review pass
- Seed holders: store, the fixed robot list, pseudo-holders
- Admin UI v1: product CRUD, member CRUD, holdings view

**Done when:** the spreadsheet's numbers are reproduced by `stock_summary`, and
an admin can add a new product without touching SQL.

## Phase 2 — Borrow and return, no CV

The whole value proposition, with a manual picker.

- Kiosk shell: home → identify → borrow/return → review → commit
- Identification via **QR only** at this stage
- Item entry via search
- Destination selection from the fixed robot list
- Return via the holdings checklist ([flows.md](flows.md) §4)
- Offline outbox

**Done when:** the club can stop maintaining the "Qty outside" column by hand.
This is the milestone that makes the project worth having; everything after it
is acceleration.

## Phase 3 — Bulk parts via bin QR

Covers the ~500 items CV can never touch.

- Generate and print QR labels for bins, book pages, and small boxes
  (~500 labels, ~1 day of printing and sticking — see
  [operations.md](operations.md) §1.2)
- Kiosk and phone scanning paths
- `loose` tier handling (level, not count)
- Stocktake flow

**Done when:** taking a handful of resistors takes under ten seconds.

## Phase 4 — Face recognition

Now the kiosk gets fast for the common case.

- Consent flow and enrollment in the admin UI, per [pdpa.md](pdpa.md)
- Face pipeline, in-memory index, confirmation step
- Threshold calibration against enrolled members
- QR fallback stays fully functional and is never removed
- Enrollment drive: 3–5 frames × ~80 members, ~3 hours, best run as a station
  at the start-of-year onboarding session ([operations.md](operations.md) §1.3)

**Done when:** an enrolled member goes from touching the screen to identified
in under three seconds, and a member who declined enrollment notices no
difference beyond one scan.

## Phase 5 — Item CV as a shortlist accelerator

Only if Phase 0 passed the gate.

- Product reference capture in the admin UI
- Reference capture drive: 5–8 frames × ~90 Tier A products, ~3–4 hours,
  splittable across several members ([operations.md](operations.md) §1.4)
- ROI-based localisation, embedding, top-K shortlist
- Presence hysteresis and quantity increment
- Rank-distribution telemetry on the dashboard

**Done when:** rank-1 acceptance exceeds the manual search path's speed for
Tier A items — measured, not assumed. If it doesn't, this phase can be turned
off with a config flag and the system is unaffected.

## Phase 6 — Dashboard and operations

- Per-robot BOM view (the thing the remarks column was trying to be)
- Overdue: assets held by a member for more than N days
- Low stock against `min_stock`
- Stocktake variance report
- Handover documentation

## Success criteria

Measurable, so that "does this work?" has an answer:

| Metric | Target |
|---|---|
| Tier A borrow, identified member, 3 items | < 45 s |
| Bulk part checkout, single item | < 10 s |
| Face identification, enrolled member | < 3 s, > 95% first-attempt |
| Item CV top-3 recall (Tier A) | ≥ 90% |
| Wrong member on a committed session | ~0 (confirmation step should make this near-impossible) |
| Stocktake variance on Tier A after 3 months | < 5% of units |
| Fraction of checkouts logged at all | The real metric — measured by stocktake variance, not by the app |

That last row is the honest one. An honour-system tool succeeds or fails on
whether people bother to use it, and the only external check is whether the
counts drift. If variance stays high after Phase 3, the problem is friction,
not features.

## Risks

| Risk | Mitigation |
|---|---|
| Item CV doesn't work on real parts | Phase 0 gate; system is fully functional without it |
| Catalog migration stalls on human review | Import electrical sheet only; add the rest through the admin UI |
| Nobody uses it (too slow vs. just taking parts) | Phase 2/3 speed targets; phone path so members don't detour to the kiosk |
| Committee handover loses the maintainer | Handover checklist in [pdpa.md](pdpa.md); docs in-repo; named positions not people |
| Spreadsheet kept in parallel, sources diverge | Hard cutover date agreed before Phase 2 ships |
| P100 stack incompatibility | Checked in Phase 0; CV workload is small enough for CPU fallback |

## Open questions

- Is there a natural deadline (competition season, semester start) that should
  anchor these phases?
- How many people are building this, and are they available across the summer
  or only in term time? Phase sizes assume one or two people part-time.
- Who is the "product owner" — the person who decides when a phase is done?
  Should be the logistics lead, not the developer.
