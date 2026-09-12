# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

Inventory checkout system for the NUS RoboMaster club's parts store (~100–120
members). Every storage bin/location gets a QR sticker; scanning one opens a
Telegram Mini App with the item in a cart, the scanner still running. Stock is
tracked as a movement ledger between _holders_ (store / robot / member), which
reproduces the club's existing spreadsheet model (`Qty in storage` / `Qty
outside` + a free-text allocation remark) as real data.

Two candidate designs were compared in `docs/`; **tele-qr is the one being
built** (see `docs/comparison.md` for why). Full spec docs live under
`docs/tele-qr/` — read `architecture.md` and `data-model.md` before making
non-trivial changes; they are authoritative over any assumption you'd
otherwise bring to a "Telegram bot + inventory" project. **`docs/tele-qr/checkpoint.md`
is the current status snapshot** (what's done, known gaps, next actions) —
read it first when resuming work on this branch.

## Commands

```bash
npm run dev              # next dev
npm run build             # next build
npm run lint               # eslint
npm test                    # vitest run (all tests, single pass)
npm run test:watch      # vitest watch mode
npx vitest run tests/unit/cart-reducer.test.ts   # single file
npx vitest run -t "test name substring"           # single test by name
```

No standalone typecheck script; `npm run build` type-checks as part of the
Next.js build.

### Tests need live infra

`tests/integration/**` make real network calls against the live dev Supabase
project and the Telegram Bot API — **there is no mocked/local DB for tests.**
They read `.env.local` via `tests/../scripts/_env.ts` (same loader every
`scripts/*.ts` uses, since these run outside Next.js's own env loading).
Fixture rows come from `scripts/seed-fixtures.ts` (idempotent — safe to
re-run). `vitest.config.ts` forces `fileParallelism: false` because
integration files share and mutate the same fixture rows; don't re-enable it
without addressing that.

`tests/unit/**` are pure (cart reducer, code generation, catalog CSV parsing,
init-data HMAC verification) and need no network.

### Scripts (`scripts/*.ts`, run via `npx tsx`)

- `seed-fixtures.ts` — idempotent dev fixtures (members, robots, products
  across all 3 tiers, scan codes, seed movements) into the live dev project.
- `import-catalog.ts [csvPath] [outPath]` — parses the real 538-row inventory
  CSV into a flagged review CSV (`scripts/out/catalog-review.csv`). Read-only:
  never touches the DB. See `docs/catalog-migration.md`.
- `create-admin-user.ts` — bootstraps a Supabase Auth user for `/admin`.
- `dev-mock-init-data.ts <telegram_user_id>` — prints a signed mock Telegram
  `initData` string for local dev/testing without a real Telegram client (used
  by `NEXT_PUBLIC_DEV_MOCK_INIT_DATA` and by the integration tests).

### Environment

Copy `.env.local.example` → `.env.local`. Required: `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`,
`NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Full table with
notes in `docs/tele-qr/architecture.md`.

Supabase project is linked via `.mcp.json` (project ref `dholwxsxzasoafeqjovk`)
— prefer the `mcp__supabase__*` tools for inspecting schema/logs/advisors over
raw SQL, and `supabase/migrations/*.sql` (numbered, applied in order) for
schema changes rather than editing the live DB ad hoc.

## Architecture

One Next.js app on Vercel + one Supabase project (Postgres + RLS, currently
in `ap-south-1`/Mumbai — not Singapore, despite older doc text; self-hosting
is planned).
No Python, no separate service, no GPU/models — see `docs/tele-qr/architecture.md`
for the full rationale (this replaced an earlier "camera + face recognition"
design; that design's docs remain at `docs/face-id-and-cv/` for history only,
not being built).

```
/store/*          Mini App — runs inside Telegram's web view
                   continuous QR scan → cart → destination → submit
/admin/*          Dashboard — Supabase email auth (middleware-gated)
                   products, holders, scan-codes, bind queue
/api/tg/webhook    Telegram → identity binding (/start)
/api/store/*       Mini App API — the ONLY thing the Mini App talks to
```

**Two completely different auth models, one codebase:**

- **`/store` (Mini App) never talks to Supabase directly.** It calls
  `/api/store/*` with a raw Telegram `initData` string in the
  `X-Telegram-Init-Data` header. Every route's _sole_ auth mechanism is
  `requireMember()` (`src/lib/server/member-auth.ts`), which HMAC-verifies
  `initData` server-side with `TELEGRAM_BOT_TOKEN`, resolves it to an active
  `members` row via `telegram_user_id`, and only then uses the Supabase
  **service role** (bypasses RLS) to read/write. Never trust
  `initDataUnsafe`/client-supplied identity for anything security-relevant.
- **`/admin` uses Supabase email auth.** `src/middleware.ts` only checks
  "is there a session" — it does _not_ check "is this user an admin". That's
  enforced by RLS's `is_admin()` (`supabase/migrations/0009_rls_policies.sql`)
  on every query the admin browser client makes directly against Supabase
  (`src/lib/supabase/browser.ts`) — there is no bespoke `/api/admin/*` layer.
  A signed-in non-admin passes middleware but gets empty results / write
  failures from RLS.

**The data model — holders and movements** (`docs/tele-qr/data-model.md`):
stock is held by a `holders` row (`store` / `robot` / `member` / `consumed` /
`adjustment` pseudo-holders), and every state change — borrow, return,
consume, stocktake correction — is one `stock_movements` row from one holder
to another. Current holdings are derived (`holdings`/`stock_summary` views),
never stored directly. `products.tier` (`asset` / `bulk` / `loose`) controls
_counting UX only_, not whether an item can be scanned. `scan_codes` is a
separate table from `products` (not a column) specifically so a damaged label
can be reissued a new code, or retired, without touching the product —
`kind = 'group'` codes (e.g. the resistor book) resolve to a location and let
the user pick from a list rather than a single product.

**The cart is client-side state, not a DB session.** The Mini App
(`src/app/store/components/cartReducer.ts`) holds the cart in memory until the
user taps Done, then submits the whole thing in one call to
`/api/store/cart/submit`, written via the `submit_cart` Postgres function as
one `sessions` row + all its `stock_movements` in a **single transaction**.
There is deliberately no `bot_sessions` table, TTL, or partial-commit
handling — if submit fails, the client keeps the cart and offers retry; it
must never clear the cart on error.

**RLS/security gotchas already hit once** (see `docs/tele-qr/checkpoint.md`
"Bugs found" for the full list before touching migrations or `is_admin()`):
`REVOKE` on a Postgres function must also revoke from the implicit `PUBLIC`
pseudo-role, not just `anon` — role-specific revokes don't override it. Any
route using the service-role key bypasses RLS entirely, so RLS bugs are
invisible unless tested against a real authenticated (non-service-role)
session.

## Conventions

- Path alias `@/*` → `src/*` (`tsconfig.json`, mirrored in `vitest.config.ts`).
- Migrations in `supabase/migrations/` are numbered and additive — add a new
  numbered file rather than editing an applied one.
- `docs/tele-qr/*.md` files each open with a TL;DR and close with their own
  open questions; check those before assuming a design decision is settled.

## Versioning

- Always commit feature-level changes to keep track and easier rollback if necessary.
- Push to tele-qr-mvp after fulfilling the user's request.
