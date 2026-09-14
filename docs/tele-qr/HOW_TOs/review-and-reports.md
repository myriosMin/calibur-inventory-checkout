# Review queue, notifications, and reports

Covers `/admin/review`, the dashboard (`/admin`), CSV export, and Vercel Cron
notifications.

## The review queue

`/admin/review`. This is the queue of everything the catalog import couldn't
decide on its own (ambiguous rows, missing specs, uncertain quantities — see
[../data-cleaning.md](../data-cleaning.md)). Each item has a severity
(blocker / check / info), often links to a product, and a status (open /
resolved / dismissed).

Working an item:

1. Filter by status, severity, or "about" (which entity it concerns) to find
   what to work on next — blockers first.
2. Go fix the actual product record (or count it properly in Stocktake if
   it's a quantity question).
3. Resolve the review item with a note describing what you found and changed.
   Dismiss only if the item turns out to be simply wrong, not if it's just
   inconvenient.

Both admin and procurement roles can work the queue.

## Dashboard observability

`/admin` (the landing page after login). Minimum useful set, read live off
the ledger:

- Sessions per day, by mode
- Scan-vs-search ratio — a product reached mostly by search has a missing or
  damaged label
- Unknown/retired codes scanned, with counts
- Bind queue depth
- Stocktake variance by location
- Label health — products reached by search rather than scan, with a direct
  reprint link

There is no "failed submits" chart, and there isn't going to be one without a
schema change: a failed submit never reaches the database by design (the cart
is client state with client-side retry), so nothing persists to count.

## Exporting data

The dashboard has three CSV exports, generated on demand: catalog, holdings,
and the full movement ledger. Use these for a committee handover or an
offline backup — there's no scheduled export, since a file nobody remembers
to look for isn't useful.

## Notifications (Vercel Cron)

`/api/cron/daily`, scheduled by Vercel, guarded by `CRON_SECRET`.

| Notification | Trigger | Goes to |
|---|---|---|
| Overdue nudge | An asset out past `OVERDUE_THRESHOLD_DAYS` (default 21) | The borrower |
| Low stock | A product below `min_stock` | The club group chat |
| Weekly digest | Weekly | The club group chat |

These are edge-triggered or cadence-limited on purpose — a bot that nags gets
muted, and a muted bot can't warn about a real problem.

**Setup required before these actually fire in the club group:**
`TELEGRAM_ALERT_CHAT_ID` must be set in Vercel's environment (get the id with
`npx tsx scripts/get-chat-id.ts`). Until it's set, the cron job still runs but
group-chat messages are skipped.

To check what a run would send without sending it, hit the endpoint with
`?dryRun=1` and the correct `CRON_SECRET`.
