# Checkpoint — 2026-09-12

Status snapshot. Read this first when picking the work back up.

**Branch:** `tele-qr-mvp`. **Live:** https://calibur-checkout.vercel.app
(Vercel project `calibur-checkout`). **Supabase:** `dholwxsxzasoafeqjovk`,
migrations `0001`–`0023` applied.

**Tests: 506 passing across 37 files.** `npm run lint` and `npm run build`
clean. `npm run build` is the only typecheck — there is no separate script.

---

## TL;DR

Phases 1–6 are built. **The system is feature-complete for the club's actual
workflow** — provision members, label bins, borrow, return, restock, count,
correct, get nudged, see the numbers.

Two things stand between here and real use, and neither is code:

1. ~~The continuous-scan gate has never been tested on a real phone.~~
   **PASSED (2026-09-13)** — continuous scanning is confirmed working on real
   devices, so the assumption every phase rests on holds, and label printing is
   no longer gated.
2. **The catalog is still fixtures.** The bench-literate review pass
   ([../catalog-migration.md](../catalog-migration.md)) is 3–5 days of human
   work and remains the project's critical path.

---

## What was built this pass (Phases 4–6)

Nine migrations (`0015`–`0023`) plus six feature areas.

### Defects found and fixed in existing work

These were already live and wrong; they are the reason this pass touched the
schema at all.

- **Nothing could add stock to the store.** `submit_cart` only wrote
  borrow/return/consume, so an imported catalog would start at zero and every
  borrow would drive `holdings` negative. Fixed by `admin_restock` +
  `/admin/restock`. This blocked launch and appeared in no roadmap phase.
- **`stock_summary.qty_out` computed nonsense** — it summed every non-store
  holder, folding in `consumed` (parts that are gone, not "outside") and
  `adjustment`, whose balance is large and negative because every seed movement
  sources from it. The one view reproducing the spreadsheet's headline number.
  Nothing read it, so fixing it was free.
- **The pseudo-holders were not singletons.** Unique only on `(kind, name)`, so
  `/admin/holders` could create a second active `store` and `submit_cart`'s
  `limit 1` would silently split stock across two ledger identities.
- **`stock_movements` was not actually append-only.** The admin RLS policy was
  `FOR ALL`, so an admin could delete the very row a discrepancy pointed at.
- **`submit_cart` had no idempotency.** A double-tap of Done, or the documented
  keep-the-cart-and-retry path firing after a request that timed out but had
  committed, wrote every movement twice.
- **`generate.ts` imported `node:crypto` into a client component.**

### New capability

| Area | What |
|---|---|
| Stock in | `/admin/restock`, `admin_restock` |
| Ledger | `/admin/movements` with filters; corrections as mirror rows (`admin_reverse_movement`); `/admin/holdings` per holder and per robot |
| Labels | `qrcode` dep, bulk code generation, A4 `@media print` sheet, single reprint. **QR-v3 53-byte budget asserted at build time** |
| Stocktake | Phone-first walk (localStorage, no draft table), `admin_commit_stocktake`, variance report |
| Member-facing | `/store/mine`, `/api/store/me/*`, bot `/myitems` + `/help` + fallback, cart idempotency, "took the last of it" |
| Member ops | Roster CSV import, offboarding/unbind, `bootstrap-admin.ts`, `get-chat-id.ts` |
| Cron | `/api/cron/daily` — overdue, low stock, weekly digest, 90-day bind-attempt purge |
| Dashboard | `/admin` observability, label health, CSV export |

### Design decisions worth not re-litigating

- **The new `admin_*` RPCs are `SECURITY INVOKER`, not `DEFINER`.** Admins
  already hold unrestricted INSERT on those tables via RLS, so a DEFINER
  function gated on `is_admin()` would grant zero extra capability while adding
  a permanent RLS-bypass path. The internal guard is a fail-fast message; RLS
  is the boundary. `submit_cart` stays DEFINER and service-role-only because it
  takes `p_member_id` as an unchecked parameter — **do not harmonise them.**
- **Borrows are never blocked on insufficient stock.** A member standing there
  with the part in their hand should not be argued with, and blocking teaches
  people to stop logging. Negative holdings are surfaced as a data-quality
  signal instead, and almost always mean a missing opening balance.
- **Overdue uses a "days out" proxy, not `expected_return_date`** — dates
  nobody sets are worse than no dates. Only `member`-held stock is nudged; a
  motor bolted to Hero is where it belongs.
- **Notifications are edge-triggered or cadence-limited**, never "fire because
  the condition is still true". `flows.md` §7: a bot that nags gets muted.
- **Stocktake has no draft table** — the walk is client state in `localStorage`
  and commits in one RPC, the same pattern as the cart.

## Bugs found by the branch code review (all fixed)

Two were half-finished features rather than nits: **returns never sent the
idempotency token** (so the fix applied to only half the flows), and **the bot
answered commands in group chats** — which bites precisely because the alert
feature requires the bot to join the club group, where `/start` would have run
identity binding and replied publicly. Also: label health reported every
group-labelled product (the whole resistor book) as unlabelled; two admin reads
would have silently truncated at PostgREST's 1000-row cap; the weekly digest
could exceed Telegram's 4096-char limit and report success anyway.

---

## Known gaps

### 1. On-device verification — the real one
Nothing in [qa-checklist.md](qa-checklist.md) has been done. No browser
automation or physical device is available in an agent session, and the
continuous-scan gate (§0) must pass **before any labels are printed**.

### 2. Data
The catalog review pass and the member roster import are human work. Tooling
exists for both (`import-catalog.ts`, `/admin/members` CSV import); the work
itself does not. **Opening balances must be entered via `/admin/restock`** or
holdings go negative on every borrow.

### 3. "Failed submits" is on the observability list and is not buildable
A failed submit never reaches the database and the cart is client state with
client-side retry, so nothing persists to count. Recording it needs a new write
path on the submit error branch — its own decision, noted in `architecture.md`.

### 4. Operational notes for whoever is next
- **`SUPABASE_DB_PASSWORD` in `.env.local` is stale**, and port 5432 is blocked
  from at least some networks, so `supabase db push` does not work. Migrations
  `0015`–`0023` were applied with `supabase db query --linked -f <file>` (the
  Management API) and recorded in `supabase_migrations.schema_migrations` by
  hand, matching the timestamp-style versions the earlier MCP-applied
  migrations use. `supabase migration list` reports local-only rows as a
  result — a pre-existing divergence that affects `0001`–`0014` equally.
- **The project is in `ap-south-1` (Mumbai), not Singapore.** Earlier drafts of
  these docs claimed otherwise; corrected on 2026-09-12. Not migrated because
  the club intends to self-host Supabase later. See [pdpa.md](pdpa.md).
- The dev project contains a member bound to a **real** Telegram account, so
  anything that sends messages must be dry-run-guarded in tests. The cron
  integration test does this.
- Integration tests hit the live dev Supabase and the real Bot API.
  `fileParallelism: false` is load-bearing — they share fixture rows.

### 5. Deferred, deliberately
Per-robot BOM targets (needs a table and an owner); a `supplier` holder kind to
separate "we bought 200 more" from "the count was off by 12" (`reason` already
distinguishes them, so the report is recoverable either way); pagination on
`/admin/movements` beyond the shared row cap.

---

## Immediate next actions

1. ~~Run the continuous-scan gate.~~ **Done — passed 2026-09-13.**
2. ~~Rename the Mini App short name to `s`.~~ **Not possible** — Telegram
   requires at least 3 characters. Resolved instead by generating **6-character
   scan codes**, which put the link at exactly 53 bytes (QR v3). No BotFather
   change needed; `app` stays.
3. `CRON_SECRET` is set in Vercel. **`TELEGRAM_ALERT_CHAT_ID` is still unset**
   — club-chat alerts no-op until it is (`npx tsx scripts/get-chat-id.ts`).
4. Bootstrap the first real admin (`npx tsx scripts/bootstrap-admin.ts`), then
   import the roster.
5. The catalog review pass, then opening balances via `/admin/restock`.
