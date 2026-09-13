# Roadmap

## TL;DR

- **Six phases, ~5–6 person-days of prep plus the build.** The spreadsheet is
  replaced at **Phase 3**.
- **Phase 0 is a half-day spike** to verify the one load-bearing assumption:
  that `showScanQrPopup` scans continuously on both iOS and Android. Everything
  else in the design is conventional web work.
- Phases 1–2 (catalog, labels) are prep work that must happen regardless and
  can run in parallel with the build.
- **Success is measured by stocktake variance, not by app usage.** An honour
  system succeeds or fails on whether people bother, and drift is the only
  external check.
- Biggest risks: the catalog migration stalling, and choosing a bot name that
  later has to change.

---

## Phase 0 — Verify the scanner — **passed** (2026-09-13)

The entire design rests on one assumption. Test it before anything else.

1. Stand up a minimal Mini App with `showScanQrPopup`.
2. Confirm the callback returning `false` **keeps the scanner open** for
   repeated scans — on **both iOS and Android**, on a couple of real member
   phones, not just a simulator.
3. Confirm a `?startapp=<code>` deep link opens the Mini App with
   `start_param` populated.
4. Confirm the first-time-user path (never opened the bot) is one extra tap and
   not a dead end.

**Gate:** if continuous scanning doesn't work as documented, the multi-item
flow collapses to app-switching per item and the design needs rethinking before
any labels are printed. Everything downstream assumes this passes.

> **Status: PASSED (2026-09-13).** Continuous scanning is confirmed working on
> real devices. The gate is cleared and label printing is no longer blocked on
> it — the assumption Phases 1–6 were built on holds.

Also settle here, because it's irreversible later: **the bot and app names**.
They're baked into every QR ([qr-labels.md](qr-labels.md)).

## Phase 1 — Catalog and schema

- Schema from [data-model.md](data-model.md), migrations in the repo
- Catalog migration per [../catalog-migration.md](../catalog-migration.md),
  including the bench-literate review pass
- **Label survey during the same shelf walk** — count compartments, decide
  product vs. group codes
- Seed holders: store, the fixed robot list, pseudo-holders
- Import the member roster with normalised handles

**Done when:** `stock_summary` reproduces the spreadsheet's numbers, and the
compartment count for the print run is known.

## Phase 2 — Labels

- Generate codes, design the template, print
- Clean bins, stick ~360–500 labels
- Admin UI: print label, batch print by location, retire code

Can overlap with Phase 3 development — it's physical work by different people.

**Done when:** every compartment has a scannable sticker with human-readable
text under it.

## Phase 3 — Mini App borrow and return

The milestone that matters.

- `?startapp=` entry, code resolution (product and group)
- Continuous scanning, cart, quantity by tier
- Destination selection from the fixed robot list
- Return as a checklist from `holdings`
- Search fallback everywhere
- `initData` validation, single-transaction submit
- Bot webhook: identity binding, bind queue

**Done when:** the club can stop maintaining the "Qty outside" column by hand.
Everything after this is refinement.

## Phase 4 — Admin dashboard — **built** (2026-09-12)

- Catalog CRUD, member management, bind queue
- Holdings and per-robot views
- Movement history and corrections
- Label printing

Some of this is needed *during* Phase 1, so build the catalog CRUD early and
the rest here.

## Phase 5 — Stocktake and notifications — **built** (2026-09-12)

- Stocktake flow by location, variance report
- Vercel Cron: overdue, low stock, weekly digest
- Scan-vs-search label health report

## Phase 6 — Refinements — **mostly built** (2026-09-12)

Only once the above is real:

- ~~Plain-chat fallback in the bot for when the Mini App won't load~~ — built
- ~~"My items" and stock queries in the bot~~ — built (`/myitems`, `/help`,
  plus `/store/mine` in the Mini App, which `pdpa.md` requires anyway)
- ~~Remember last destination as a default~~ — built
- Per-robot BOM targets — **still deferred**; needs a `robot_bom` table and,
  more importantly, an owner willing to maintain it

## Success criteria

| Metric | Target |
|---|---|
| Single item, scan to done | < 15 s |
| Eight-item trip, scan to done | < 90 s |
| Taps per additional item after the first | ≤ 1 |
| Automatic handle bind rate on first scan | > 80% |
| Products reached by search rather than scan | < 10% (higher = label problem) |
| Stocktake variance on Tier A after 3 months | < 5% of units |
| **Fraction of takings actually logged** | **The real metric — measured by stocktake variance, not app analytics** |

That last row is the honest one. If variance stays high after Phase 3, the
problem is friction, not features.

## Risks

| Risk | Mitigation |
|---|---|
| `showScanQrPopup` doesn't scan continuously | Phase 0 gate, before any labels are printed |
| Catalog migration stalls on the review pass | Import electrical sheet only; add the rest through the admin UI |
| Bot name changes later | Every QR breaks. Choose short and final in Phase 0 |
| Labels fall off or get solvent-damaged | Polyester stock, human-readable text, scan-vs-search monitoring, easy reprints |
| Nobody uses it | Speed targets above; the point-of-use phone flow is the main defence |
| Committee handover loses the maintainer | Team accounts not personal, handover checklist in [operations.md](operations.md) |
| Telegram dependency questioned by committee | Raised explicitly in [pdpa.md](pdpa.md); fallback is a plain web app with its own login |
| Spreadsheet maintained in parallel | Agree a hard cutover date before Phase 3 ships |

## Open questions

- Is there a natural deadline — competition season, semester start — to anchor
  these phases to?
- How many people are building this, and over what period? Phase sizes assume
  one or two people part-time.
- Who is the product owner deciding when a phase is done? Should be the
  logistics lead, not the developer.
