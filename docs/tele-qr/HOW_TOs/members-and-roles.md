# Members and roles (admin guide)

Covers `/admin/join-codes`, `/admin/members` and `/admin/bind-queue`. Admin
only — procurement accounts don't see these pages.

## Onboarding with a join code (the normal way)

1. **People › Join codes** (`/admin/join-codes`) → **New code**, set how many
   people and how many minutes (default 10 people, 5 minutes), add a note like
   "Freshmen briefing", **Create code**.
2. Put the QR on a screen, or read the code out (`ABCD-EF23`).
3. Each person scans the QR, or messages the bot `/start` and taps **Join**.
   The Mini App asks for the code, their full name and NUS email, and shows
   the PDPA notice. They tick it and submit. They can borrow straight away.
4. Watch the count go up. **Close this code now** ends it early.

What happens to each submission:

- **Email or verified Telegram handle matches an unlinked roster row** (role
  `member`): that row is linked. The roster's own name is kept, and legacy
  loans stay with them. No duplicate is created.
- **Nothing matches**: a new `member` is created with what they typed.
- **Email already linked to another Telegram account**: refused.
- **Matches a staff row (admin/procurement), a deactivated member, or two
  different rows**: refused and put in the bind queue for you to link by hand.
  A typed email proves nothing, so staff are never linked this way.

**Checking for a leak.** The use limit only caps the damage. The
**Tried after close** column is what shows a leak: it counts attempts made
after a code expired, ran out or was revoked. A couple are latecomers. Many
means the code travelled. The Attempts table shows every try with its Telegram
id and result, and each joined member links to their record, so you can
offboard anyone who shouldn't be there. Five wrong codes in 15 minutes locks a
Telegram account out for that window. Attempt rows are purged after 90 days,
like bind attempts. `members.join_code_id` permanently records which code
each person joined with.

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

With join codes this should stay short. It fills from two places:

- `/start` from someone whose handle matches no roster row. They are also
  offered the Join button.
- A join the code couldn't safely resolve (see above). These show the full
  name they typed.

Match them to the right `members` row and bind in one click. Joining with a
code later resolves any rows they left here.

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
