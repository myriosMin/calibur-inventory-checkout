# Flows

## TL;DR

- **One entry point:** scan a sticker → Mini App opens inside Telegram with the
  item pre-added and the scanner already running. No app-switching between
  items.
- First item costs ~3 taps (borrow/return, destination, confirm). **Every
  subsequent item costs 1 scan and 0–1 taps.**
- **`showScanQrPopup()` stays open** until dismissed — return `false` from the
  callback and it keeps scanning. This is the whole reason for the Mini App.
- **Returns never scan.** Pick source → tick what's coming back → done. A motor
  installed in a robot has its sticker buried.
- **Scanning a group code** (resistor book page) lists the products at that
  location; tap one.
- **Unrecognised Telegram users are refused and queued** for an admin to bind.
  No self-enrollment.
- Every scan path has a search path behind it. Sticker damaged, code retired,
  camera denied — still usable.

---

## 1. Entry

Every sticker encodes:

```
https://t.me/<bot>/<app>?startapp=<code>
```

Scanning with the phone's native camera opens the Mini App **inside Telegram**,
with `<code>` available via `initDataUnsafe.start_param`.

```
scan sticker
  ├─ member recognised     → resolve code → OPEN_CART
  ├─ member not recognised → refuse politely, log to bind queue
  └─ never opened the bot  → Telegram shows the bot's start screen first;
                             one tap, once per member ever
```

Code resolution:

| `scan_codes.kind` | Behaviour |
|---|---|
| `product` | Item added to cart directly |
| `group` | List active products at that location → user taps one |
| unknown / inactive | "This label is retired or unrecognised" → search |

The group case is how ~157 resistor values sit behind ~8 page stickers — see
[qr-labels.md](qr-labels.md).

## 2. Borrow

```
OPEN_CART  (first scan of a session)
  → "Borrow or Return?"          [Borrow] [Return]
  → "Where is this going?"       [Hero] [Standard] [Sentry] … [Personal/bench]
  → quantity:
       tier = asset → defaults to 1, no prompt
       tier = bulk  → [1] [2] [5] [10] [Type…]
       tier = loose → [Took some] [Took the last of it]

CART  (live, in-app)
  Borrowing → Hero  (Change)
  • Resistor 10kΩ 0402      × 10   [-] [+]
  • XT30 right angle M      ×  2   [-] [+]
  [Scan more]  [Search]
  [           Done            ]
  (Cancel, de-emphasized, top-right)

  scan more → scanner reopens, item appended, cart updates in place
  Done      → one API call, one transaction, movements written
```

Design rules:

- **Destination is asked once per session, not per item.** This is most of the
  tap savings.
- **The destination prompt is skipped entirely when the member has a
  remembered last choice** (stored client-side, per device) — it auto-fills
  and the sheet never opens. A "Change" link next to the destination name is
  the escape hatch if it's wrong. This resolves the open question below.
- **Scanning the same product twice increments its line** rather than adding a
  duplicate. It maps onto the physical act of grabbing another one.
- **Tier drives the quantity prompt.** Assets are almost always 1, so skipping
  the prompt takes an asset scan to zero taps.
- **The cart is client state** until Done. Nothing is written incrementally, so
  there is no partial commit to clean up and no server-side session to expire.

### Continuous scanning

```js
tg.showScanQrPopup({ text: "Scan the next item" }, (raw) => {
  const code = parseStartApp(raw);
  addToCart(code);
  return false;          // ← false keeps the scanner open
});
```

Returning `true` (or calling `closeScanQrPopup()`) dismisses it. Verify this
behaviour on both iOS and Android before building on it — the continuous case
is the load-bearing assumption of the whole design.

## 3. Return

No scanning. After identification the app already knows what is held.

```
RETURN_SOURCE  "Returning from where?" -- skipped automatically when the
               member only has one possible source (the common case: just
               Personal/bench, or one robot); shown only when there's a
               real choice to make
  → robots this member has borrowed to, + Personal/bench

RETURN_LIST    checklist from the `holdings` view
  • GM6020            held 2   returning [0] [-] [+]
  • Center board 2    held 1   returning [0] [-] [+]
  [Return all]  [Add item]  [Done]
```

Movements are `from = holder`, `to = store`, `reason = 'return'`.

Partial returns are the normal case and fall out of the model for free.
Returning something with no borrow record is allowed — it happens, since parts
predate the system — and produces a movement from `adjustment`, flagged for
admin review rather than blocked.

## 4. Bulk consumption

Same as borrow, but `to = consumed` and no destination is asked. Chosen
implicitly by tier: scanning a `bulk` or `loose` product in borrow mode records
consumption, not a loan, because `products.returnable` is false.

`loose` items never get an exact count — "took the last of it" sets the level to
empty and raises a restock flag. This matches reality for the rows the
spreadsheet records as `a lot`.

## 5. Identity binding

Two entry points. The join code is the normal one.

```
Join code (Mini App, /api/store/join -> join_with_code, 0026)
  scan an admin's join QR, open the Join button, or get routed here by a
  403 not_registered on the first scan
  → form: code, full name, NUS email, accept the notice
  → code must be live: not revoked, not expired, uses left (row-locked)
      ├─ email / verified handle matches an unlinked `member` row → link it
      ├─ nothing matches                                  → create a member
      ├─ email linked to another Telegram account         → refused
      └─ staff row, deactivated, or ambiguous             → bind queue
  → every attempt logged in join_code_attempts; a scanned code resumes after joining

/start (bot webhook)
  → look up member by normalised handle (lowercase, strip @)
      ├─ hit  → bind telegram_user_id, set telegram_bound_at
      │         → "Welcome, Alex. You're all set."
      └─ miss → "I don't recognise you yet…" + a Join button (Mini App, startapp=join)
                → row in telegram_bind_attempts (the admin bind queue)
```

With join codes, the two failure cases below don't matter for anyone who has a
code. They still apply to roster-imported members who only ever send `/start`.

Two failure cases that **will** happen and must be designed for:

- **The member has no Telegram username.** Usernames are optional; if they never
  set one there is nothing to match on.
- **They changed their handle** between registration and first scan.

Both land in the bind queue, where an admin sees the user id and display name
and binds them in one click. The queue doubles as the abuse log for visitors
and other lab users who scan a sticker out of curiosity.

After binding, **every lookup uses `telegram_user_id`.** Handles are never
trusted again.

## 6. Stocktake

Admin-initiated, in the admin dashboard rather than the Mini App.

```
→ pick a location ('book', 'small box', 'Rotating shelf', …)
→ walk the product list, enter counted qty; expected shown for reference
→ Commit → stock_counts rows + adjustment movements for every variance
```

Variance is a diagnostic, not an accusation. A part with persistently high
variance is one people aren't logging, which is a UX bug to fix rather than a
person to chase. This is an honour system.

## 7. Notifications (Vercel Cron)

Outbound bot messages, the one job the bot keeps besides binding:

| Trigger | Message | To |
|---|---|---|
| Asset out > N days | "You've had a GM6020 out for 3 weeks" | Borrower |
| Stock below `min_stock` | "XT30 straight M is down to 2" | Logistics lead |
| Weekly digest | Outstanding items, low stock | Logistics lead |

Keep these rare. A bot that nags gets muted, and a muted bot can't tell you
about a real problem.

## 8. Failure and degraded modes

| Failure | Behaviour |
|---|---|
| Sticker damaged or unreadable | Human-readable text under every QR; member uses search |
| Code retired or unknown | "This label is retired" → search, and log it for the admin |
| Camera permission denied | Search-only path; cart works identically |
| Mini App won't load | Bot replies with a plain-text fallback (Phase 6 — see [roadmap.md](roadmap.md)) |
| Supabase unreachable at submit | Cart is client state; show a retry, don't clear it |
| Member walks off mid-cart | Nothing was written; cart dies with the web view |
| Unrecognised user | Refused, queued for admin |
| Member left the club | `active = false` clears the binding; refused |

The through-line: **every scan path has a search path behind it.** The system
must stay usable when a label falls off, or it will be abandoned the first time
one does.

## Open questions

- ~~Should the destination prompt remember the member's last choice as a
  default?~~ **Resolved, implemented**: yes, via `localStorage` on the
  member's device (`src/app/store/borrow/page.tsx`), overridable with a
  "Change" link in Cart. Not synced across devices — a member who borrows from
  a second phone gets asked once more there.
- Is "Borrow or Return?" needed at all on a scan, given `products.returnable`
  and current holdings usually imply the answer? Could drop to one tap in the
  common case; needs a look at real usage before optimising.
- Should a member be able to borrow *on behalf of* their subteam? Common in
  practice; deferred.
