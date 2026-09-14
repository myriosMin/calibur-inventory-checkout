# Members and roles (admin guide)

Covers `/admin/members` and `/admin/bind-queue`. Admin only — procurement
accounts don't see these pages.

## Importing a roster

`/admin/members` has a bulk CSV import (`operations.md` budgets this at ~1
hour for 120 members — it's a bulk job, not one-by-one).

Required column: `full_name` (also accepted: `name`). Optional:
`display_name`, `nus_email`, `telegram_username`. Paste or upload the CSV,
review the preview (it shows what will be created, skipped, or flagged as
invalid before you commit anything), then commit. Duplicate emails/handles
are skipped and reported, not silently overwritten.

Normalise handles before import if you can — lowercase, no leading `@` — the
importer does this too, but cleaner input means fewer surprises in the
preview.

## Adding one member by hand

`/admin/members` → create. Same fields as the CSV row. A holder row for them
is created automatically.

## The bind queue

Expect 10–20% of imported members to fail automatic binding on first
`/start` — no Telegram username set, or it changed since they registered.
They land in `/admin/bind-queue` with their Telegram display name and user
id. Match them to the right `members` row and bind in one click.

The queue also doubles as an abuse log — anyone who scans a sticker out of
curiosity and isn't a member shows up here too, harmlessly.

## Offboarding

`/admin/members/[id]` → offboard. This clears their `telegram_user_id` and
sets `active = false`. Their Telegram account stops working against the bot
immediately; their borrow/return history is kept, not deleted.

## Roles

| Role | Can do |
|---|---|
| `member` | Borrow/return via the Mini App, see their own history |
| `procurement` | Everything below, via `/admin`: read inventory, maintain products/locations/units, restock. Cannot stocktake, reverse movements, manage members, or write scan codes. |
| `admin` | Everything |

Set a member's role from their detail page. Procurement accounts still need a
Supabase Auth login — create one with `npx tsx scripts/create-admin-user.ts
<email> <password>` after setting their `members.role` to `procurement`.
Bootstrapping the very first admin is `npx tsx scripts/bootstrap-admin.ts`,
which does both steps and verifies `is_admin()` actually returns true for
them.

The nav hiding admin-only links from procurement accounts is cosmetic —
access is actually enforced by Postgres row-level security, not by what's
shown in the sidebar.
