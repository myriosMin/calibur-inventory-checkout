# Stock operations and stocktake (admin/procurement guide)

Covers `/admin/restock`, `/admin/movements`, `/admin/holdings`,
`/admin/holders`, and `/admin/stocktake`.

## Restocking (admin and procurement)

`/admin/restock`:

1. Search for a product and add it as a line (repeat for as many products as
   you received in this delivery).
2. Set the quantity per line.
3. Optionally add a note.
4. Submit.

This is also how you enter **opening balances** for a freshly imported
catalog — a product with zero recorded restocks will go negative on its first
borrow, since borrows are never blocked for insufficient stock.

## Holders

`/admin/holders` (admin only) manages who stock can be held by: the store
itself, each robot, and the fixed pseudo-holders (`consumed`, `adjustment`).
Adding a new robot needs no schema change or deploy — just a new holder row.
`consumed` and `adjustment` are singletons; the system won't let a second one
be created active.

## Holdings

`/admin/holdings` shows current stock per holder — per robot, per member, and
the store itself — derived live from the movement ledger, not stored
directly.

## The movement ledger

`/admin/movements` lists every stock change (borrow, return, consume,
restock, stocktake correction) with filters. It's append-only: nobody,
including admins, can delete a row from the UI or via RLS.

**Correcting a mistake**: don't edit or delete anything. Use **Reverse** on
the movement — it writes a mirror row rather than touching the original, so
the ledger stays a complete record. A movement can't be reversed twice.

Note: reads currently stop at 1000 rows (PostgREST's cap) — there's no pager
yet, so a very wide filter on a long-running deployment may silently truncate.
Narrow the filter if a query looks short.

## Stocktake

`/admin/stocktake`. Designed to be run from a phone, standing at the shelf.

1. Pick a location.
2. Walk the product list; enter the counted quantity for each (expected is
   shown alongside for reference, not as a target to match).
3. Commit. This writes an adjustment movement for every line where counted
   differs from expected — you never edit a balance by hand.

`/admin/stocktake/variance` shows the resulting variance report. Treat
variance as a diagnostic, not an accusation: a product with persistently high
variance usually means the borrow/return flow for it is too slow or
confusing, which is a UX problem to fix, not a person to chase.

Recommended cadence (from [../operations.md](../operations.md)): one location
per month rather than one big annual count. Tier-A (asset) shelving deserves
more — quarterly, and before/after a competition.

Note: only admins can stocktake or reverse movements. Procurement can restock
and maintain the catalog, but not either of those.
