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

### One project, two schemas

There is one Supabase project. **`public` holds the real inventory**, which is
what the deployed app reads. **`test` is an identical copy** that the
integration tests mutate:

- same migrations
- a snapshot of the real catalog
- three test-only accounts and a few scan codes

`NEXT_PUBLIC_SUPABASE_SCHEMA` (`src/lib/supabase/schema.ts`) picks the schema
for every Supabase client. Unset means `public`, and any value other than
`public` or `test` throws.

Mistakes to avoid:

- **Any new Supabase client must pass `db: dbSchemaOption()`.** Forgetting it
  once sent a test seed into the real data.
- **Scripts that must only touch `test` import `./_test-schema` first.**
- **Every migration goes to both schemas:**
  `npx tsx scripts/migrate.ts --schema public` and `--schema test`. The `test`
  run verifies that nothing in `test` references `public`.
- **`test` is exposed to the REST API** through
  `alter role authenticator set pgrst.db_schemas = 'public, graphql_public, test'`.
  Reset that setting to un-expose it.

### Tests need live infra

`tests/integration/**` make real network calls against the **`test` schema**
of the live Supabase project and the Telegram Bot API. **There is no
mocked/local DB.**

- `vitest.config.ts` sets `NEXT_PUBLIC_SUPABASE_SCHEMA=test`.
- Every integration file imports `tests/integration/_schema-guard.ts`, which
  refuses to run unless the service-role client really targets `test`.
- Tests use real product and robot names ("DJI GM6020 motor", "Hero",
  "Sentry").
- `.env.local` is read via `scripts/_env.ts`, which never overrides variables
  that are already set.
- `vitest.config.ts` forces `fileParallelism: false` because integration files
  share and mutate the same rows. Don't re-enable it without addressing that.

Rebuild the test schema from scratch:

```bash
npx tsx scripts/migrate.ts --schema test --reset
npx tsx scripts/import-clean-data.ts --schema test
supabase db query --linked -f data/clean/import.test.sql
npx tsx scripts/seed-test-schema.ts
```

`tests/unit/**` are pure (cart reducer, code generation, catalog CSV parsing,
init-data HMAC verification, schema rewriting) and need no network.

### Scripts (`scripts/*.ts`, run via `npx tsx`)

- `migrate.ts --schema public|test [--reset] [--dry-run]`: applies pending
  migrations to one schema through the CLI. `supabase db push` does not work
  here. Each migration and its bookkeeping row go in one transaction. `--reset`
  exists only for `test`.
- `seed-test-schema.ts`: adds the test-only rows the real catalog can't
  provide: test admin `admin@example.com`, bound Telegram member `900000000001`,
  an unbound member, and scan codes. Idempotent. Refuses anything but `test`.
- `clean-data/build.ts [--force]`: merges the xlsx and the legacy app export
  (`data/db/*.csv`) into `data/clean/`, which is gitignored because it holds
  member emails. Judgement calls live in `clean-data/curation.ts`. **It refuses
  to overwrite `data/clean/` without `--force`.**
- `import-clean-data.ts [--schema public|test] [--rehearse [--with-migration]]`:
  validates `data/clean/` and writes one SQL transaction (`import.sql`, or
  `import.test.sql`). A `--rehearse` file ends in `raise exception`, so running
  it changes nothing. `public` was imported on 2026-09-14. See
  `docs/data-cleaning.md`.
- `import-build-lists.ts [--schema public|test] [--rehearse]`: loads the
  robot sheets of `data/Calibur_AY2627.xlsx` into `build_lists` (0027). This
  is a plan, not stock. It is re-runnable and replaces that season's lists by
  name. The rules are in `build-lists/rules.ts`.
- `import-catalog.ts [csvPath] [outPath]`: the original single-CSV review
  generator, read-only. Superseded by `clean-data/`.
- `create-admin-user.ts`: creates a Supabase Auth user for `/admin`.
  `bootstrap-admin.ts` does the members row too and verifies `is_admin()`.
- `dev-mock-init-data.ts <telegram_user_id>`: prints a signed mock Telegram
  `initData` string for local dev and for the integration tests.
- `ENV_FILE=<file>` makes any script load a different env file. `_env.ts`
  fails loudly if it's missing.

### Environment

Copy `.env.local.example` → `.env.local`. Required: `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`,
`NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Optional:
`NEXT_PUBLIC_SUPABASE_SCHEMA=test` to run the app locally against test data.
Full table with notes in `docs/tele-qr/architecture.md`.

Supabase project is linked via `.mcp.json` (project ref `dholwxsxzasoafeqjovk`).
Prefer the `mcp__supabase__*` tools, or `supabase db query --linked`, for
inspecting schema, logs and advisors. Make schema changes as numbered files in
`supabase/migrations/*.sql`, applied with `scripts/migrate.ts`, never by
editing the live DB ad hoc.

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
                   review queue, products, units, stocktake, restock, holders,
                   build lists
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
  The one exception is `/api/store/join`, whose caller is not a member yet.
  It verifies `initData` itself and then calls `join_with_code` (0026),
  which is gated by an admin-issued join code.
- **`/admin` uses Supabase email auth.** `src/middleware.ts` only checks
  "is there a session". Access is enforced by RLS on every query the admin
  browser client makes (`src/lib/supabase/browser.ts`); there is no bespoke
  `/api/admin/*` layer.
  - `is_admin()` (0009) covers developers.
  - `is_staff()` (0024) also admits `procurement` to read the inventory,
    maintain the catalog, restock, stocktake and work the review queue.
  - The nav hiding admin-only pages (`src/app/admin/nav.ts`) is cosmetic.

**The data model — holders and movements** (`docs/tele-qr/data-model.md`):
stock is held by a `holders` row (`store` / `robot` / `member` / `consumed` /
`adjustment` pseudo-holders), and every state change — borrow, return,
consume, stocktake correction — is one `stock_movements` row from one holder
to another. Current holdings are derived (`holdings`/`stock_summary` views),
never stored directly. `products.tier` (`asset` / `bulk` / `loose`) controls
_counting UX only_, not whether an item can be scanned.

`products.criticality` and `products.ownership` (0024) record how hard an item
is chased and whether it is on loan to the club. `asset_units` is a per-unit
register (serials, condition), not a second ledger.

`scan_codes` is a separate table from `products` (not a column) specifically
so a damaged label can be reissued a new code, or retired, without touching
the product. `kind = 'group'` codes (e.g. the resistor book) resolve to a
location and let the user pick from a list rather than a single product.

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

- `REVOKE` on a Postgres function must also revoke from the implicit `PUBLIC`
  pseudo-role, not just `anon`; role-specific revokes don't override it.
- Any route using the service-role key bypasses RLS entirely, so RLS bugs are
  invisible unless tested against a real authenticated (non-service-role)
  session. `scripts/sql/rehearse-0024-rls.sql` does that, and rolls back.

## Conventions

- Path alias `@/*` → `src/*` (`tsconfig.json`, mirrored in `vitest.config.ts`).
- Migrations in `supabase/migrations/` are numbered and additive — add a new
  numbered file rather than editing an applied one — and every one is applied
  to both `public` and `test` (`scripts/migrate.ts`).
- `docs/tele-qr/*.md` files each open with a TL;DR and close with their own
  open questions; check those before assuming a design decision is settled.

## Versioning

- Always commit feature-level changes to keep track and easier rollback if necessary.
- Push to tele-qr-mvp after fulfilling the user's request.
