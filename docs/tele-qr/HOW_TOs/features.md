# Features

What exists today, where it lives, and whether it's actually done. Status is
based on the code and tests in this branch (`tele-qr-mvp`) plus
[checkpoint.md](../checkpoint.md), not aspiration. "Built" means the code and
tests exist; it does not mean verified on a real phone — see
[qa-checklist.md](../qa-checklist.md) for what still needs a physical device.

Each area below has its own how-to doc with the actual steps.

## Member (Telegram Mini App, `/store`)

| Feature | Status | Notes |
|---|---|---|
| Scan to open cart | Built | `?startapp=<code>` entry, resolves via `scan_codes`. Continuous-scan gate passed on real devices 2026-09-13. |
| Group codes (resistor book) | Built | `kind = 'group'` lists products at a location, tap to add. |
| Borrow flow | Built | Destination picked once per session, quantity prompt driven by `products.tier`. |
| Return flow | Built | Checklist from current holdings, no scanning. |
| Bulk/loose consumption | Built | `returnable = false` products route to `consumed`, not a destination. |
| Search fallback | Built | Every scan path has a search path behind it (camera denied, damaged label, unknown code). |
| Remembered destination | Built | `localStorage`, per device, with a "Change" escape hatch. |
| Cart submit | Built | One transaction (`submit_cart`), idempotent — a retried submit after a timeout does not double-write. |
| My items / history | Built | `/store/mine` and `/api/store/me/*`. |
| Receipt message after submit | Built, unverified | Code sends a Telegram message on submit; never confirmed against a real chat (integration tests use a fake user id by design). |

See [borrow-and-return.md](borrow-and-return.md).

## Telegram bot (`/api/tg/webhook`)

| Feature | Status | Notes |
|---|---|---|
| `/start` identity binding | Built | Matches on normalised handle, binds `telegram_user_id`. |
| Bind queue for unmatched users | Built | `telegram_bind_attempts`, resolved in `/admin/bind-queue`. |
| `/myitems`, `/help` | Built | |
| Silent in group chats unless `@mentioned` | Built | Needed once the bot joins the club group for alerts. |
| Plain-text fallback if the Mini App won't load | Built | |

See [borrow-and-return.md](borrow-and-return.md).

## Admin dashboard (`/admin`)

| Feature | Status | Notes |
|---|---|---|
| Product catalog CRUD | Built | `/admin/products` |
| Locations | Built | Part of the product form |
| Scan code generation, retire | Built | `/admin/scan-codes` |
| Label printing (single, batch by location, A4 sheet) | Built | `/admin/labels`. QR byte budget (53 bytes / v3) asserted at build time, banner if it drifts. |
| Roster CSV import | Built | `/admin/members`, skips duplicates and rows with no handle |
| Bind queue resolution | Built | `/admin/bind-queue` |
| Offboarding | Built | Clears `telegram_user_id`, sets `active = false`, keeps history |
| Holders (robots, pseudo-holders) | Built | `/admin/holders` |
| Holdings, per-holder and per-robot | Built | `/admin/holdings` |
| Restock | Built | `/admin/restock` → `admin_restock`. Opening balances land here. |
| Movement ledger + filters | Built | `/admin/movements` |
| Movement corrections | Built | `admin_reverse_movement` writes a mirror row; double-reversal is blocked by a unique index |
| Movement pagination | Gap | Reads stop at PostgREST's 1000-row cap; no pager built yet |
| Stocktake (phone-first walk + commit) | Built | `/admin/stocktake`, `admin_commit_stocktake` |
| Stocktake variance report | Built | `/admin/stocktake/variance` |
| Review queue (catalog import) | Built | `/admin/review` — see [review-and-reports.md](review-and-reports.md) |
| Role split: admin vs. procurement | Built | `is_staff()` (0024): procurement reads inventory, maintains catalog/units, restocks; cannot stocktake, reverse movements, touch members, or write scan codes |
| CSV export (catalog, holdings, ledger) | Built | Dashboard, on demand |
| Dashboard observability (sessions, scan-vs-search, bind queue depth, label health) | Built | `/admin` |
| Failed-submit tracking | Not built | A failed submit never reaches the DB by design (client-side retry) — nothing persists to count. Would need a new write path on the error branch; not decided. |

See [catalog-and-labels.md](catalog-and-labels.md),
[members-and-roles.md](members-and-roles.md),
[stock-and-stocktake.md](stock-and-stocktake.md),
[review-and-reports.md](review-and-reports.md).

## Background (Vercel Cron)

| Feature | Status | Notes |
|---|---|---|
| Overdue nudges | Built | Days-out proxy, only for `member`-held stock, `OVERDUE_THRESHOLD_DAYS` |
| Low-stock alerts | Built | Needs `TELEGRAM_ALERT_CHAT_ID` — **unset in production**, so these currently no-op |
| Weekly digest | Built | Same `TELEGRAM_ALERT_CHAT_ID` dependency; chunked to stay under Telegram's 4096-char limit |
| Cron auth | Built | `CRON_SECRET`, `?dryRun=1` for a preview run |

See [review-and-reports.md](review-and-reports.md).

## Deferred, not built

These were considered and explicitly deferred, not overlooked:

- **Per-robot BOM targets** (what a robot *should* have vs. what it holds) — needs a new table and an owner.
- **A `supplier` holder kind** to distinguish "we bought more" from "the count was off" — `reason` on the movement already makes this recoverable, so it wasn't worth a schema change.
- **Borrowing on behalf of a subteam** — noted as common in practice, not designed.

## Known operational gaps (not code)

- Most of [qa-checklist.md](../qa-checklist.md) has not been run against a real phone or the production bot, beyond the continuous-scan gate (passed 2026-09-13).
- `TELEGRAM_ALERT_CHAT_ID` is unset, so club-group alerts (low stock, weekly digest) do not fire yet.
- The catalog is imported into `public` (2026-09-14), but its 164-item review queue has not been walked by an SME, and procurement reviewer accounts don't exist yet.
- Real member roster (names, Telegram handles) is not yet imported for the live deployment.
