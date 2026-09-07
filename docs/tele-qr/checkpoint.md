# Checkpoint — 2026-09-07

Tracks progress against `/Users/myrios/.claude/plans/let-s-implement-this-docs-tele-qr-wondrous-parasol.md`
("Tele-QR Checkout — Implementation Plan (Phases 1–3)"). Read that plan for
full work-package detail; this doc is the status snapshot, not a replacement
for it.

**Branch:** `tele-qr-mvp` (pushed, not merged to `main`; 1 commit: `6019330`).
**Live:** https://calibur-checkout.vercel.app (Vercel project `calibur-checkout`,
promoted to Production for a stable URL). Webhook registered against this URL.

---

## UI/UX redesign pass (not yet committed as of this writing)

Goals: fewest possible taps for borrow/return, no emoji, uncluttered/minimal
visual design. Applied across `/store` and (palette only) `/admin`:

- **Palette**: `gray`/`blue` → `slate`/`emerald` app-wide (industrial neutral +
  single accent), per a `ui-ux-pro-max` design-system query.
- **Icons**: every emoji/glyph (🛒📷🔍✅❌✕✓) replaced with a small hand-rolled
  SVG set (`src/components/ui/icons.tsx`) — kept dependency-free like the rest
  of the UI kit rather than pulling in an icon library.
- **Cart** (`src/app/store/components/Cart.tsx`): one full-width primary
  "Done", a Scan more / Search secondary pair, Cancel demoted to a ghost
  text-link in the header.
- **Click reduction**: destination now auto-fills from a remembered last
  choice (`localStorage`, overridable via "Change") instead of asking every
  session — resolves `flows.md`'s open question. Return's "Returning from
  where?" screen is skipped when there's only one possible source. Loose-tier
  quantity prompt was deliberately **left alone** — `flows.md` documents
  "Took the last of it" as a future restock-flag trigger, not redundant UI.
- New `CHANGE_DEST` cart-reducer action (distinct from the one-shot
  `SET_DEST`) backs the "Change destination" override; covered by a unit test.
- Verified: `npm run build`, `npm run lint`, and `npm test -- tests/unit` all
  clean. No browser-automation tool was available in this environment, so the
  redesigned flows were checked via SSR smoke-curls + code review, not
  click-through in an actual browser — worth a manual pass before relying on
  it for WP24's on-device testing.

---

## Done: Phases 1–3 (all 24 work packages)

**Schema (WP1):** 14 migrations applied to the live Supabase project —
`members`, `holders`, `products`, `scan_codes`, `stock_movements`,
`stock_counts`, `telegram_bind_attempts`, the `holdings`/`holdings_sources`
views, RLS on every table, the `submit_cart` atomic-write function, and the
`create_member_holder` trigger. Full RLS + `is_admin()` correctness verified
against a real authenticated admin session, not just service-role calls (see
"Bugs found" below).

**Libraries (WP2–WP4):** Telegram init-data/webhook HMAC verification,
opaque scan-code generation (`src/lib/codes/generate.ts`), and the shared UI
kit (`Button`, `Sheet`, `Stepper`, `Toast`).

**Glue (WP5–WP6):** Supabase browser/server/middleware clients + generated
DB types; `requireMember` server-side auth helper used by every `/api/store/*`
route.

**Scripts (WP7–WP9):** `seed-fixtures.ts` (dev fixture data — products,
holders, robots, test members), `import-catalog.ts` (parses the real 538-row
catalog CSV into a flagged review CSV per `docs/catalog-migration.md`),
`create-admin-user.ts`, `dev-mock-init-data.ts`.

**API routes (WP10–WP14):** `/api/tg/webhook` (identity binding),
`/api/store/resolve`, `/api/store/search`, `/api/store/holdings` (+
`/sources`), `/api/store/cart/submit` (atomic via `submit_cart`). Also added
beyond the original plan: `/api/store/destinations` (see "beyond plan"
below).

**Mini App (WP15–WP17):** `/store` entry + continuous-scan client
(`webapp-client.ts`), the borrow flow (cart, destination picker, per-tier
quantity prompts, search fallback), the return flow (holdings checklist).

**Admin (WP18–WP22):** auth-gated `/admin` (middleware + layout + login),
and CRUD/management pages for **products**, **holders**, **scan-codes**
(create/retire/regenerate), **members** (create/edit — closes gap #1 below),
and the **bind-queue**. All talk to Supabase directly from the browser via
RLS — no bespoke `/api/admin/*` layer, per the plan's decision #8.

**Tests (WP23):** `tests/integration/*.test.ts` covers all 5 Tier-4 routes
end-to-end (bind → resolve → borrow → holdings → return) against the real
dev Supabase project, plus unit tests for the cart reducer, code generator,
catalog import, and init-data verification. **94/94 passing.**
`npm run build` and `npm run lint` both clean.

---

## Done beyond the original plan

- **`/api/store/destinations`** — the plan's borrow flow only had an endpoint
  returning *previously-used* destinations, which would make it impossible
  for a new member to borrow to a robot for the first time. Added a proper
  endpoint backed by `holders`.
- **Deployment (today):** linked the existing Vercel project, set the 5 env
  vars the app actually reads, deployed, promoted to Production for a stable
  URL, and re-pointed the bot's webhook at it.
- **5 test QR labels** generated (SVG, encode real `t.me/…?startapp=<code>`
  deep links to live catalog rows) and sent to the user for hands-on testing.

## Bugs found and fixed during supervision (not in the plan)

1. `submit_cart` was callable by the public anon key (missing `REVOKE`) —
   would have let unauthenticated callers write stock movements.
2. `is_admin()` caused infinite RLS recursion under a real authenticated
   session — invisible to every prior route since they all used the
   service-role key, which bypasses RLS entirely.
3. `is_admin()`'s effective grant to `anon` survived an initial `REVOKE …
   FROM anon` because Postgres also grants `EXECUTE` to the implicit
   `PUBLIC` pseudo-role, which every role inherits regardless of role-specific
   revokes — fixed by also revoking from `PUBLIC` (migration `0014`).
4. Three functions had a mutable `search_path` (minor hijack risk).
5. `/api/store/resolve`'s retired-code 404 reused a module-level singleton
   `Response` object — since a `Response` body is a single-use stream, every
   404 after the first silently returned an empty body. Found by the WP21
   subagent while verifying scan-code retire/regenerate.
6. Vitest's default per-file parallelism raced integration test files
   against shared live fixture rows — fixed via `fileParallelism: false`
   rather than the plan's suggested truncate-and-reseed script (simpler,
   same effect, costs some wall-clock time).

---

## Known gaps / left to do

### 1. ~~No way to add a real member yet~~ — **Resolved**: `/admin/members`
built (`src/app/admin/members/page.tsx` — list + create; `[id]/page.tsx` —
edit), mirroring the products/holders pattern. Creating a member here also
fires the existing `create_member_holder` trigger, so no separate holder-row
step is needed. One thing still inherent to any admin-gated system and not
this page's job: **the very first real admin** still has to be bootstrapped
by hand once (a `members` row with a matching `nus_email` + `role = 'admin'`,
plus `scripts/create-admin-user.ts` for the Supabase Auth side) — chicken/egg,
since you need `/admin` access to reach this page in the first place. Every
admin after that first one can be added through the page itself. Telegram
binding (`telegram_user_id`) still isn't set here by design — that only ever
happens via the bind-queue flow when the member first messages the bot.

### 2. ~~WP23's CI-readiness breadcrumb was skipped~~ — **Resolved**:
`tests/integration/README.md` now documents the env vars a CI runner needs.

### 3. WP24 — Manual verification checklist (14 items, real devices/bot)
This is the one part of the plan that fundamentally cannot be done inside an
agent session. Status of each item as of today:

| # | Item | Status |
|---|---|---|
| 1 | BotFather: confirm bot username + Mini App short name are final | **Unconfirmed** — bot/app names already exist in `.env.local` (`calibur_checkout_bot` / `app`), but whether BotFather's Mini App URL actually points at the deployed URL has not been verified (flagged to the user; can't check via Bot API) |
| 2 | Real bot token/username in `.env.local` | Done — already present |
| 3 | Deploy a preview build to Vercel (public HTTPS) | Done — promoted to Production instead of preview, for URL stability |
| 4 | Point BotFather's Mini App URL at the deployed URL | **Not confirmed** — same as #1 |
| 5 | Set the Telegram webhook + confirm via `getWebhookInfo` | Done — webhook set to `https://calibur-checkout.vercel.app/api/tg/webhook` |
| 6 | Real phone `/start`, handle matches a seeded member → confirm bind | **Not done** — the tooling exists (`/admin/members`, gap #1 above) but nobody has created the user's real `members` row through it yet |
| 7 | `/start` from a second, unrelated account → lands in bind queue, admin resolves it | **Not done** |
| 8 | Generate a real QR, scan with phone camera, confirm Mini App opens with item pre-added | Partially done — 5 QR SVGs generated and sent to the user; on-device scan not yet confirmed |
| 9 | **Gate, do not skip:** `showScanQrPopup` continuous-scan callback works on both iOS and Android | **Not done** — this is the load-bearing assumption for the whole continuous-scan design (`roadmap.md` Phase 0). Must pass on both platforms before any label printing. |
| 10 | Full borrow flow on-device, verify `stock_movements` rows | **Not done** |
| 11 | Full return flow on-device against holdings from #10 | **Not done** |
| 12 | Deny camera permission → search-only path still completes a borrow | **Not done** |
| 13 | Kill network mid-submit → cart preserved with retry, not cleared | **Not done** |
| 14 | Log into `/admin`, walk bind-queue resolution + product creation + scan-code creation once each | **Not done** on the deployed instance (was done repeatedly against the live DB during development, but not as a fresh end-to-end admin walkthrough post-deploy) |

### 4. Explicitly out of scope for this plan (Phase 4/5, physical work)
Not gaps — deliberately deferred per the plan's stated scope:
- Full Phase 4 admin dashboard (batch label printing, movement-history
  corrections).
- Phase 5: stocktake UI, Vercel Cron notifications (asset-overdue nudges,
  low-stock alerts, weekly digest) — see `flows.md` §6–7 for the spec when
  this is picked up.
- The real 538-row bench-literate catalog review pass (human task, per
  `docs/catalog-migration.md`) — tooling exists (`import-catalog.ts`), the
  review itself doesn't.
- Physical label printing (~360–500 labels) — gated on WP24 item #9 passing
  on both platforms, and on a physical shelf walk to finalize the location
  count (`qr-labels.md`'s open question).
- Supabase Auth "leaked password protection" is disabled on the project — a
  one-toggle fix in the dashboard, unrelated to any code here.

---

## Immediate next actions (suggested order)

1. Bootstrap the first real admin (still requires the one-time manual step in
   gap #1 above — a direct `members` insert + `create-admin-user.ts`), then
   use the now-built `/admin/members` page for the user's own real row (name,
   email, Telegram handle) so WP24 items #6, #9–14 become possible to run at
   all, and for onboarding everyone after that.
2. Confirm BotFather's Mini App URL matches the deployed URL (item #1/#4).
3. Run WP24 items #6–14 for real, with item #9 (continuous scan on iOS +
   Android) as the hard gate before anything else downstream matters.
