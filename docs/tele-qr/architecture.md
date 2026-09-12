# Architecture

## TL;DR

- **One Next.js app on Vercel + Supabase (Singapore). TypeScript throughout, no
  Python, no separate service.**
- `/store` is the Mini App, `/admin` is the dashboard, `/api/*` are route
  handlers, Vercel Cron drives notifications.
- **The Mini App never touches Supabase directly.** It calls `/api/store/*`,
  which validates Telegram `initData` server-side with the bot token, then uses
  the service role.
- **Validate `initData` on every request.** `initDataUnsafe` is named that for a
  reason — it's client-supplied and trivially forged.
- **Webhook, not long polling** — serverless has no long-running process, and
  we have a public HTTPS endpoint anyway.
- No GPU, no models, no kiosk, no on-prem box to babysit. The whole thing fits
  in free tiers.

---

## Shape

```
┌─────────────────────────────────────────────────────────┐
│ Next.js on Vercel  (single project, single repo)        │
│                                                         │
│  /store/*          Mini App — runs inside Telegram      │
│                    scanner, cart, returns, my items     │
│                                                         │
│  /admin/*          Dashboard — Supabase email auth      │
│                    catalog, members, holdings,          │
│                    stocktake, bind queue, labels        │
│                                                         │
│  /api/tg/webhook   Telegram updates → identity binding  │
│  /api/store/*      Mini App API → validates initData    │
│  /api/cron/*       Vercel Cron → overdue, low stock     │
└────────────────────────┬────────────────────────────────┘
                         │ service role
                         ▼
              ┌──────────────────────┐
              │ Supabase (Singapore) │
              │ Postgres + RLS       │
              │ admin auth           │
              └──────────────────────┘
```

Two client surfaces, one codebase, one deployment.

## Why everything is on Vercel

An earlier draft put a Python bot on a club PC with long polling. That made
sense when the design implied a GPU. It doesn't now:

- **Mini Apps must be served over public HTTPS**, so a public endpoint is
  required regardless.
- The admin dashboard is a public web app anyway.
- Long polling needs a long-running process, which serverless doesn't have —
  and once there's a public endpoint, webhooks are strictly simpler.
- An on-prem box is a handover liability: somebody has to know which PC it runs
  on and why it stopped after a power cut.

With no GPU in the design, on-prem buys nothing and costs ongoing attention.

## Request paths

### Mini App → API

The Mini App runs in Telegram's web view and receives `initData` — a signed
payload identifying the user.

```
Mini App                    /api/store/*                 Supabase
   │  fetch + initData header    │                           │
   ├────────────────────────────►│                           │
   │                             │ verify HMAC-SHA256        │
   │                             │ with bot token            │
   │                             │ check auth_date freshness │
   │                             │ resolve telegram_user_id  │
   │                             │   → member                │
   │                             ├──────────────────────────►│
   │                             │   service role write      │
   │◄────────────────────────────┤                           │
```

Non-negotiables:

- **Validate `initData` server-side on every request.** Telegram signs it with
  the bot token; recompute the HMAC and compare. The `initDataUnsafe` object
  the client exposes is unsigned and trivially forged — never trust it for
  identity, only for reading `start_param` before validation.
- **Check `auth_date` freshness** (reject anything older than ~24 h) so a
  captured payload can't be replayed indefinitely.
- **The service-role key lives only in Vercel env vars**, never in anything the
  browser can reach. The Mini App has no Supabase credentials at all.
- Reject any request whose resolved member is `active = false`.

### Telegram → webhook

`/api/tg/webhook` handles `/start` (identity binding, per
[flows.md](flows.md) §5) and nothing else in v1. Set the webhook once at deploy
and include Telegram's secret token header so the endpoint can't be spoofed.

### Cron → notifications

Vercel Cron hits `/api/cron/*` on a schedule for overdue checks, low-stock
alerts, and the weekly digest. Guard these routes with a shared secret — cron
endpoints are public URLs.

## The cart is client state

The Mini App holds the cart in memory until the user taps Done, then submits it
in one call, written as one session plus its movements **in a single
transaction**.

This is why there's no `bot_sessions` table, no TTL, no expiry prompt, no
abandonment handling, and no partial commit to reconcile. All of that
machinery existed in earlier drafts only because the chat was the UI.

Practical consequence: if the submit fails, keep the cart and show a retry.
Never clear it on error — the member has the parts in their hand.

## Admin auth

Supabase email auth, restricted to committee members. RLS gives admins full
read/write; members can read their own history.

Deliberately *not* Telegram login for admins — the dashboard is a laptop
surface, and mixing two identity systems in one app costs more than it saves.

## Environment

| Variable | Where | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Vercel env | Signs and validates `initData`; never client-side |
| `TELEGRAM_WEBHOOK_SECRET` | Vercel env | Header check on the webhook route |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env | Server-only |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel env | Public, used by `/admin` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel env | Public, `/admin` only |
| `CRON_SECRET` | Vercel env | Guards `/api/cron/*` (cron endpoints are public URLs). Unset = every call rejected |
| `TELEGRAM_ALERT_CHAT_ID` | Vercel env | Club **group** chat for low-stock / data-check / weekly-digest messages. A group, not a person, so alerts survive committee handover. Unset = those messages are skipped and the cron still runs |
| `OVERDUE_THRESHOLD_DAYS` | Vercel env | Optional; days a member may hold a returnable item before the bot mentions it. Default 21 |

## Observability

Minimum useful set on the admin dashboard:

- Sessions per day, by mode
- **Scan vs. search ratio** — a product consistently reached by search has a
  missing or damaged label ([qr-labels.md](qr-labels.md))
- Unknown or retired codes scanned, with counts
- Bind queue depth
- ~~Failed submits~~ — **not built, and not currently buildable.** A failed
  submit never reaches the database (that is what "failed" means here), and
  the cart is deliberately client state with client-side retry
  ([flows.md](flows.md) §8), so nothing persists to count. Recording them
  would need a new write path on the error branch of `/api/store/cart/submit`
  — worth deciding on its own merits rather than smuggling in with a chart.
- Stocktake variance by location
- **Label health** — products consistently reached by search rather than
  scan, with a reprint link ([qr-labels.md](qr-labels.md))

## Cost

Free tier on both, comfortably. ~120 members generating maybe a few hundred
sessions a month is nowhere near Vercel's or Supabase's limits. The only real
spend is labels and possibly a label printer.

## Open questions

- Is Telegram's `showScanQrPopup` continuous-scan behaviour identical on iOS and
  Android? **Load-bearing assumption — verify before building.**
- Does the club have a Vercel account, or should this sit under a personal one?
  A team account is worth setting up for handover, so access transfers with the
  committee rather than a graduating student.
- ~~Do we want Supabase's own backups, or a periodic CSV export for the club's
  peace of mind?~~ **Resolved, implemented**: the dashboard exports three
  CSVs on demand (catalog, holdings, movement ledger) via `src/lib/reports/export.ts`.
  On demand rather than periodic — a scheduled export has nowhere to put a
  file that a committee would actually find later, and a button someone
  presses at handover is the case that mattered.
