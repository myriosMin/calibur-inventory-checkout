# Integration tests

These tests hit the **live dev Supabase project** and the **real Telegram Bot
API** — there is no mocked/local DB or Telegram stub. A CI runner needs real
credentials and outbound network access. See CLAUDE.md's "Tests need live
infra" section for the full rationale; this file only lists what a CI job
needs to actually run them.

## Required env vars

Loaded from `.env.local` by `scripts/_env.ts` (imported at the top of every
file here and every `scripts/*.ts`). Verified against what the test files and
their transitive imports (`@/lib/supabase/server`, `@/lib/server/member-auth`,
`@/lib/telegram/bot-api`, `scripts/dev-mock-init-data.ts`) actually read from
`process.env` — not copied wholesale from `.env.local.example`.

| Var | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL, used by `getServiceRoleClient()`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key; every integration test reads/writes via this client, bypassing RLS. |
| `TELEGRAM_BOT_TOKEN` | Signs/verifies `initData` (`member-auth.ts`, `dev-mock-init-data.ts`) and is used for real `sendMessage` calls to the Telegram Bot API (`webhook-bind.test.ts` deliberately lets these fail against fabricated chat ids). |
| `TELEGRAM_WEBHOOK_SECRET` | Checked by `/api/tg/webhook`; `webhook-bind.test.ts` throws at import time if this is unset. |

`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`, and
`NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME` are in `.env.local.example` but are only
read by browser/middleware code (`src/lib/supabase/browser.ts`,
`src/lib/supabase/middleware-client.ts`) that no integration test path
touches — not required for CI.

## Prerequisite: seed fixtures

Tests read/mutate fixture rows (a bound test member, robots, products across
all tiers, scan codes) inserted by:

```bash
npx tsx scripts/seed-fixtures.ts
```

Idempotent (looks up by natural key before inserting) — safe, and expected,
to run before every test run rather than only once.

## Running

```bash
npm test                                            # full suite (unit + integration)
npx vitest run tests/integration/holdings.test.ts   # single file
npx vitest run -t "some test name substring"        # single test by name
```

`vitest.config.ts` sets `fileParallelism: false`. This is load-bearing, not
an optimization opportunity: integration files share and mutate the same
live fixture rows in the same Supabase project, and running files
concurrently races those mutations (one file's borrow/return can shift
holdings another file is asserting on mid-run). Do not re-enable
per-file parallelism for this directory.

## Caution

Dev Supabase project only. These tests create, mutate, and delete real rows
(cleaned up in each file's `afterAll`, but a crash mid-run can leave
throwaway rows behind — all keyed under the `900000000000+` fake Telegram id
range or distinguishing `TEST-`/`WP*`-prefixed markers for exactly this
reason). Never point `.env.local` at a production project when running
these.
