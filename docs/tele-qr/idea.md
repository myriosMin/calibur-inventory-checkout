# Tele-QR Checkout — Product Overview

## TL;DR

- **Every bin gets a QR sticker. Scan it, a Telegram Mini App opens with the
  scanner already running, keep scanning, tap Done.** That's the whole product.
- **One scan from the phone camera, everything after that in-app.** The sticker
  points at `t.me/<bot>/<app>?startapp=<code>`, which opens the Mini App
  directly with that item pre-added — no app-switching between items.
- **Covers all ~600 items on day one**, including the ~500 that a camera
  physically cannot identify. No tiers gated on model accuracy, and the two
  unfinished sheets come along for free.
- **No models, no embeddings, no thresholds, no kiosk, no GPU, no camera rig,
  no biometrics.** Roughly a fifth of the setup work of the CV approach and a
  fraction of the compliance burden.
- **Identity is the member's Telegram account**, bound to a handle collected at
  registration. Members cannot self-enroll.
- **Returns never require scanning** — the app knows what you have out, so it's
  a checklist. This matters because a motor installed in a robot has its
  sticker buried.
- **Stock is held by _holders_ (store / robot / member); every change is a
  movement between them.** Ported unchanged from the CV design; it answers the
  question the club actually has — *where did our motors end up*.
- One Next.js app on Vercel + Supabase. TypeScript throughout.
- Costs **~5–6 person-days to set up, ~30 hrs/year to run** — dominated by the
  catalog migration and sticking ~500 labels.

---

## Context

Inventory checkout for the NUS RoboMaster club parts store. ~100–120 members,
honour system, intended to run for years across annual committee handovers.

This is one of two candidate approaches being put to the committee. See
[../comparison.md](../comparison.md) for the side-by-side, and
[../face-id-and-cv/](../face-id-and-cv/) for the alternative.

## The problem being solved

The club tracks inventory in a spreadsheet whose most valuable and most painful
column is free text:

```
M3508 — qty in storage 6, qty outside 58
"15 darknus, 7 hero, 6 standard, 6 sentry, 4 engineer, 6 turtlebot,
 6 old sentry, 2 lying arnd, 2 on kirby gimbal, 4 on spare robot, aerial"
```

That is a hand-maintained allocation ledger that goes stale immediately. **The
question the club actually needs answered is not "who borrowed this" but "where
did our motors end up."** Everything below is built around that.

## Key decision 1 — The container identifies the item

Every storage compartment carries a QR sticker. Scanning it *is* the
identification step. No recognition, no matching, no confidence score, no
failure mode where the system picks the wrong resistor.

This is the conclusion the CV design kept arriving at from the other direction:
a quarter of the catalog is unmarked 0402 resistors that no camera will ever
distinguish, and their *pocket in the book* is the only thing that identifies
them. Tele-QR just starts there and applies it to everything.

Consequence: **coverage is total from day one.** Assets, connectors, SMD, the
resistor book, the two undocumented sheets — all equal, all handled by the same
mechanism.

## Key decision 2 — One entry point, continuous scanning

The sticker encodes a Mini App deep link, not a plain bot link:

```
https://t.me/<bot>/<app>?startapp=<code>
```

Scanning it opens the Mini App inside Telegram with that item already in the
cart and Telegram's native scanner ready. Every subsequent item is scanned
without leaving the app.

The naive design — QR opens a bot chat, bot asks questions — forces the member
to app-switch between the camera and Telegram for *every item*. An eight-part
trip becomes miserable. Owning the camera via the Mini App's
`showScanQrPopup()` is the difference between a tool people use and one they
route around.

Details: [flows.md](flows.md).

## Key decision 3 — Scan a group, then tap

A QR code resolves to either a **product** or a **group**. Groups exist because
some compartments hold many products: the resistor book has ~8 pages and ~157
values, and a 0402 pocket cannot carry a scannable code.

Scan the page → the app lists the ~20 values on it → tap one. Same
scan-then-confirm interaction as everything else, so it costs no extra UI.

## Key decision 4 — Identity is Telegram, provisioned by admins

Handles are collected during normal club registration. On a member's first
`/start`, the bot binds their handle to their stable Telegram **user id** and
never trusts the handle again.

**Members cannot enroll themselves.** Anyone unrecognised gets a polite refusal
and lands in a pending queue on the admin dashboard, which doubles as the abuse
log for when visitors scan a sticker.

No biometrics anywhere. [pdpa.md](pdpa.md) is consequently about a tenth the
size of its CV counterpart.

## Key decision 5 — Returns are a checklist, not a scan

After identification we already know exactly what a member or robot is holding,
so returning is: pick the source, tick what's coming back, done.

This isn't just convenience. A GM6020 installed on Sentry has its sticker
buried inside the robot — a return flow that requires scanning would be
physically impossible for exactly the high-value items that matter most.

## Key decision 6 — Stock is held by holders; movement is a ledger

Ported unchanged from the CV design, because it was never about the camera:

- Every unit of stock is held by a **holder**: the store, a robot, or a member.
- Every change is a **movement** between holders.
- Borrow, return, consume, and stocktake correction are one operation with
  different endpoints.

`actor_member_id` records who did it, `to_holder_id` records where it went. The
per-robot breakdown that lives in a prose cell today becomes a `group by`.

Schema: [data-model.md](data-model.md).

## Flow, in brief

```
   [scan sticker with phone camera]
                ↓
   Mini App opens, item pre-added, scanner ready
                ↓
   Borrow or Return?   →  Where for?  (fixed robot list)
                ↓
   scan · scan · scan          ← never leaves Telegram
                ↓
   cart review, adjust quantities
                ↓
   Done → movements written
```

Returns skip the scanning entirely. Full detail including error and degraded
paths: [flows.md](flows.md).

## Architecture, in brief

One Next.js app on Vercel: the Mini App at `/store`, the admin dashboard at
`/admin`, the Telegram webhook and Mini App API as route handlers, and Vercel
Cron for overdue and low-stock notifications. Supabase (Singapore) for Postgres
and RLS. TypeScript throughout — no Python, no separate service.

Details: [architecture.md](architecture.md).

## What it costs to run

**~5–6 person-days to set up**, dominated by the catalog migration (3–5 days)
and printing and sticking ~500 labels (~1 day). **~30 hrs/year to maintain** —
new members, new products, a rolling stocktake of one location per month.

That is not less work than the spreadsheet; it is better distributed. The
spreadsheet concentrates everything on one person reconciling after the fact.
This spreads small amounts across members at the point of use, plus a
predictable admin load that must be somebody's named responsibility.

Full breakdown: [operations.md](operations.md).

## Build order

1. **Catalog and schema** — the migration is the critical path
2. **Labels** — design, print, stick ~500
3. **Mini App borrow/return** — the milestone that replaces the spreadsheet
4. **Admin dashboard** — catalog, members, holdings, pending users
5. **Stocktake + notifications** — overdue, low stock
6. **Nice-to-haves** — stock queries, "my items", text fallback

Phases, gates, success metrics: [roadmap.md](roadmap.md).

## Documents

| Document | What's in it |
|---|---|
| [flows.md](flows.md) | Mini App and bot flows, including errors and degraded modes |
| [data-model.md](data-model.md) | Schema, holder/movement ledger, Telegram identity binding |
| [qr-labels.md](qr-labels.md) | Code scheme, `startapp` payload limits, label spec, printing |
| [architecture.md](architecture.md) | Next.js/Vercel/Supabase layout, auth, `initData` validation |
| [operations.md](operations.md) | Setup and recurring human work, with hours |
| [pdpa.md](pdpa.md) | Personal data handling — much lighter without biometrics |
| [roadmap.md](roadmap.md) | Phases, success criteria, risks |
| [../catalog-migration.md](../catalog-migration.md) | *(shared)* Spreadsheet defects and the import plan |
| [../comparison.md](../comparison.md) | *(shared)* Side-by-side against the CV approach, for the committee |

## Open questions

- Which items get their own sticker vs. a group sticker? Needs a walk of the
  actual shelves — see [qr-labels.md](qr-labels.md).
- Is a label printer available, or do we buy one (~S$100)?
- Do we want a plain-chat fallback if the Mini App fails to load? Recommended
  eventually, not in v1.
- What's the real rate of new SKUs per year? The ~100 estimate drives the
  recurring-effort figure and could be firmed up from purchasing records.
