# Integration tests

These tests hit the **`test` schema of the live Supabase project** and the
**real Telegram Bot API**. There is no mocked/local DB or Telegram stub, and a
CI runner needs real credentials and outbound network access. See CLAUDE.md's
"One project, two schemas" and "Tests need live infra" sections for the full
rationale; this file only lists what a run actually needs.

## Which data they touch

Only `test`. `public` holds the real inventory and must never be written by a
test. Two independent locks enforce that:

- `vitest.config.ts` sets `NEXT_PUBLIC_SUPABASE_SCHEMA=test` for every test.
  `scripts/_env.ts` never overrides an already-set variable, so `.env.local`
  can't flip it.
- Every file here imports `./_schema-guard` straight after `scripts/_env`. It
  inspects the service-role client itself and throws before any test runs
  unless it targets `test`.

The `test` schema holds:

- the same migrations as `public`
- a snapshot of the real cleaned catalog (567 products, real robots such as
  "Hero" and "Sentry")
- the rows only tests need, from `scripts/seed-test-schema.ts`:
  - `admin@example.com` (admin)
  - a member pre-bound to Telegram id `900000000001`
  - an unbound member with the handle `calibur_test_unbound`
  - scan codes for a few real products and the resistor book

## Required env vars

Loaded from `.env.local` by `scripts/_env.ts` (imported at the top of every
file here and every `scripts/*.ts`).

| Var | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL, used by `getServiceRoleClient()`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key; every integration test reads/writes via this client, bypassing RLS. |
| `TELEGRAM_BOT_TOKEN` | Signs/verifies `initData` (`member-auth.ts`, `dev-mock-init-data.ts`) and is used for real `sendMessage` calls to the Telegram Bot API (`webhook-bind.test.ts` deliberately lets these fail against fabricated chat ids). |
| `TELEGRAM_WEBHOOK_SECRET` | Checked by `/api/tg/webhook`; `webhook-bind.test.ts` throws at import time if this is unset. |

`NEXT_PUBLIC_SUPABASE_SCHEMA` is set by `vitest.config.ts`. Don't set it by hand.

## Prerequisite: the test schema

Once it exists, only the seed needs re-running (it is idempotent):

```bash
npx tsx scripts/seed-test-schema.ts
```

To rebuild it from nothing (for example after a crashed run left rows behind):

```bash
npx tsx scripts/migrate.ts --schema test --reset
npx tsx scripts/import-clean-data.ts --schema test
supabase db query --linked -f data/clean/import.test.sql
npx tsx scripts/seed-test-schema.ts
```

A new migration must reach `test` too: `npx tsx scripts/migrate.ts --schema test`.

## Running

```bash
npm test                                            # full suite (unit + integration)
npx vitest run tests/integration/holdings.test.ts   # single file
npx vitest run -t "some test name substring"        # single test by name
```

`vitest.config.ts` sets `fileParallelism: false`. This is load-bearing, not
an optimization opportunity: integration files share and mutate the same rows
in the `test` schema, and running files concurrently races those mutations
(one file's borrow/return can shift holdings another file is asserting on
mid-run). Do not re-enable per-file parallelism for this directory.

## Caution

These tests create, mutate and delete rows. Each file cleans up in `afterAll`,
but a crash mid-run can leave throwaway rows behind. They are all keyed under
the `900000000000+` fake Telegram id range or distinguishing `TEST-`/`WP*`
markers, and they only ever land in `test`, which can be rebuilt at will.
