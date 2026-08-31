# CV Checkout — Product Overview

## TL;DR

- Inventory checkout for the club parts store. ~100–120 members, honour system,
  meant to run for years across committee handovers.
- **A camera can identify ~90 of the ~600 items. The other ~500 it physically
  cannot** — a quarter of the catalog is unmarked 1 mm resistors. So the
  catalog splits into three tiers: CV for big assets, **bin QR labels** for
  bulk parts, level-only for "a lot" items.
- **CV never decides anything.** It returns a top-3 shortlist and the user taps
  one. Turns a hard top-1 precision problem into an easy top-3 recall one.
- **Stock is held by _holders_ (store / robot / member); every change is a
  movement between them.** This answers the question the club actually has —
  _where did our motors end up_ — which today lives in a free-text spreadsheet
  cell.
- **Returns need no CV at all**: we already know what you're holding, so it's a
  checklist.
- Every CV path has a non-CV path behind it. Camera unplugged = still usable.
- Build order puts the useful thing first: **the spreadsheet is replaced at
  Phase 2, before any CV is written.**
- Costs ~6–8 person-days to set up, ~40 hrs/year to run.

---

Inventory checkout for the NUS RoboMaster club's parts store. Members take
parts and equipment from the store; the system logs who took what, where it
went, and what's left — with as little friction as possible.

This is the overview. Detail lives in the documents indexed at the bottom.

## Context

- **Closed group.** ~100–120 club members. No public enrollment.
- **Honour system.** The goal is a smooth way to log what happened, not to
  prevent theft. No anti-theft mechanisms are in scope.
- **Long-lived.** This is intended to run for years across annual committee
  handovers, not to be a one-semester project. That shapes several decisions
  toward boring and maintainable over clever.
- **Growing catalog.** ~600 items documented so far in the electrical-parts
  sheet, with two more sheets still being written. The club buys new parts
  constantly, so **no design may require retraining a model when the catalog
  changes.**

## The problem being solved

The club currently tracks inventory in a spreadsheet. Its most valuable and
most painful column is the free-text remarks on assembled parts:

```
M3508 — qty in storage 6, qty outside 58
"15 darknus, 7 hero, 6 standard, 6 sentry, 4 engineer, 6 turtlebot,
 6 old sentry, 2 lying arnd, 2 on kirby gimbal, 4 on spare robot, aerial"
```

That is a hand-maintained allocation ledger, and it goes stale immediately.
**The question the club actually needs answered is not "who borrowed this" but
"where did our motors end up".** The system is built around that.

## Key decision 1 — The catalog is three problems, not one

A camera cannot identify most of this inventory. Not because the model isn't
good enough, but because the objects are physically indistinguishable: a
quarter of the catalog is 0402 resistors, which are 1 mm long and carry no
printed marking at all.

Of ~600 items, **roughly 90–100 are visually identifiable and ~500 are not.**
So the catalog is split into tiers, each with a mechanism that suits it:

| Tier      | What                                             | ~Count | How it's identified     | Returned?     |
| --------- | ------------------------------------------------ | ------ | ----------------------- | ------------- |
| **Asset** | Motors, ESCs, Jetsons, LiDAR, batteries, tools   | ~90    | CV shortlist, or search | Yes           |
| **Bulk**  | Connectors, wires, SMD, the resistor book        | ~500   | Bin QR scan             | No — consumed |
| **Loose** | Heat shrink, crimps, jumper wire ("a lot" items) | ~20    | Bin QR, level not count | No            |

For bulk parts we don't need to recognise the item, because **the container
already identifies it.** Every row in the spreadsheet already has a location; a
QR label per bin is two seconds, 100% accurate, and scales to 5000 items with
no code changes.

Full analysis and the row-by-row breakdown: [limitations.md](limitations.md).

## Key decision 2 — CV produces a shortlist, never an answer

Even within Tier A there are lookalike clusters — `ESC610` / `ESC615` /
`ESC620` are near-identical boards differing by a printed label. An embedding
model will land in the right neighbourhood and pick the wrong member of it.

So item recognition never writes a transaction line. It retrieves the top 3
candidates and the user taps one.

- The accuracy bar drops from _top-1 precision_ to _top-3 recall_ — a far
  easier target on a growing catalog of near-duplicates.
- A bad match costs one tap, not a wrong inventory record.
- Every tap is labelled data telling us whether the CV is earning its keep.
- CV, QR scan, and text search all produce "a shortlist to confirm" — one
  interaction to build, one to learn.

## Key decision 3 — Stock is held by holders; movement is a ledger

Every unit of stock is held by a **holder**: the store, a robot, or a member.
Every change is a **movement** between holders. Borrow, return, consume, and
stocktake correction are all the same operation with different endpoints.

This captures both things the club needs — `actor_member_id` records _who did
it_, `to_holder_id` records _where it went_ — and it reproduces the
spreadsheet's per-robot breakdown automatically instead of in prose.

Schema: [data-model.md](data-model.md).

## Key decision 4 — Every CV path has a non-CV path behind it

The kiosk must remain fully usable with the camera unplugged, or it will be
abandoned the first time it breaks mid-build-season.

- Face recognition fails or is declined → QR self-identification on the phone
- Item CV fails or scores low → bin QR scan, or text search
- Supabase unreachable → local outbox, commits sync later

The QR identification path is also a PDPA requirement: face enrollment is
opt-in, and a member who declines must get a system that works exactly as well.

## Key decision 5 — Embedding-based matching, no retraining

Both faces and items use open-set nearest-neighbour matching against stored
embeddings, not trained classifiers. Adding a member or a product means
capturing a few frames and inserting rows — never retraining or redeploying.

This was the original doc's central insight and it survives intact. What
changed is scope: it now applies to ~90 Tier A products rather than the whole
catalog, and it feeds a shortlist rather than a decision.

## Flow, in brief

```
HOME  [Borrow] [Return]
  ↓
IDENTIFY   face → "You're Alex? [Yes] [Not me]"   or   QR on phone
  ↓
BORROW: pick destination (which robot) → add items → review cart → Done
RETURN: pick source → tick off the checklist of what's held → Done
```

Returns need no item recognition at all: after identification we already know
exactly what that member or robot is holding, so it's a checklist.

Full state machines including timeouts, cancellation, and failure branches:
[flows.md](flows.md).

## Architecture, in brief

React + Vite kiosk frontend → FastAPI backend on the P100 PC → Supabase
(Postgres + pgvector, Singapore region). Plus a phone web app for QR
identification and bulk scanning, and an admin web UI.

The vector index lives **in memory on the backend**, not in per-frame Supabase
queries — the whole index is under 3 MB. Supabase is the source of truth and
the write target, not the hot path. This also gives offline operation for free.

Details, model choices, latency budget, and the P100 caveat:
[architecture.md](architecture.md).

## What it costs to run

This system is not free to operate, and pretending otherwise is how it ends up
abandoned. Roughly **6–8 person-days to set up** (the catalog migration
dominates) and **~40 hours per year to maintain** — new member enrollment, new
product entry, a rolling stocktake of one location per month, and an annual
PDPA review.

That is not less work than the spreadsheet; it is better distributed. The
spreadsheet concentrates everything on one person reconciling after the fact.
This spreads small amounts across members at the point of use, plus a
predictable admin load that must be somebody's named responsibility.

Full breakdown — including how many reference images per face and per item, how
many QR labels and how to print them, and stocktake cadence:
[operations.md](operations.md).

## Build order

Something useful ships before any CV is written:

0. **De-risk** — measure item recognition on 30 real parts (gates step 5)
1. **Catalog and schema** — the migration is a real work item
2. **Borrow/return with QR + search** — _this is the milestone that replaces the
   spreadsheet_
3. **Bulk parts via bin QR** — covers the 500 items CV can't
4. **Face recognition** — makes the common case fast
5. **Item CV** — only if step 0 passed; can be switched off without impact
6. **Dashboard** — per-robot BOM, overdue, low stock

Phases, gates, success metrics, risks: [roadmap.md](roadmap.md).

## Documents

| Document                                     | What's in it                                                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [limitations.md](limitations.md)             | Why ~500 items can't be recognised; the tier analysis; lookalike clusters; the shortlist design                             |
| [data-model.md](data-model.md)               | Schema, the holder/movement ledger, embeddings, RLS                                                                         |
| [flows.md](flows.md)                         | State machines for every path, including errors and degraded modes                                                          |
| [architecture.md](architecture.md)           | Components, models, latency budget, deployment, P100 notes                                                                  |
| [operations.md](operations.md)               | The human work: setup and recurring effort, with hours. How many images per face/item, QR label printing, stocktake cadence |
| [pdpa.md](pdpa.md)                           | Biometric data compliance, consent text, retention, handover                                                                |
| [catalog-migration.md](../catalog-migration.md) | Spreadsheet defects and the plan to import it                                                                               |
| [roadmap.md](roadmap.md)                     | Phases, success criteria, risks                                                                                             |
| [archive/idea-v1.md](../archive/idea-v1.md)     | The original one-page concept, kept for the reasoning trail                                                                 |

Each document carries its own "Open questions" section. The ones that most
affect the plan right now:

- Where does the through-hole bucket land — Tier B, or is some of it Tier A?
- Who is the bench-literate reviewer for the catalog migration, and when?
- Is there a deadline (competition season, semester start) to anchor phases to?
- Does NUS have a biometric-data policy stricter than the PDPA baseline?
