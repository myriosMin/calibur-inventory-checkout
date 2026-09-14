# Borrow and return (member guide)

For any club member with a bound Telegram account. Everything below runs
inside Telegram — no separate app or login.

## First time

Message the bot and send `/start`. If your handle matches a `members` row,
you're bound immediately. If not, you're told to ask a committee member —
you've landed in the admin bind queue and someone needs to bind you by hand
(this happens to 10–20% of people, usually no Telegram username set, or a
changed handle).

## Borrowing

1. Scan a bin's sticker with your phone camera. Telegram opens the Mini App
   with that item already in your cart.
2. Choose **Borrow**.
3. Pick where it's going (a robot, or Personal/bench). This is asked once per
   session — after that it's remembered as your default, with a **Change**
   link if it's wrong this time.
4. Set the quantity if asked. Assets (motors, tools) default to 1 with no
   prompt.
5. Keep scanning — the scanner stays open. Scanning the same item again just
   bumps its quantity.
6. Tap **Done**. This writes everything in one go; nothing is saved until you
   tap it.

If the item is a consumable (bulk or loose parts — connectors, resistors,
heat shrink), there's no destination step: it's recorded as used, not
borrowed.

## Returning

No scanning required — the app already knows what you're holding.

1. Open the Mini App and choose **Return**.
2. If you've borrowed to more than one place, pick which one you're returning
   from.
3. Tick what you're bringing back and adjust quantities. Partial returns are
   normal.
4. Tap **Done**.

## If a label is scuffed or a scan fails

Use **Search** instead — it's on every screen that has a scanner. Type the
product name; the rest of the flow is identical.

## Checking what you hold

`/store/mine` in the Mini App, or send the bot `/myitems`, shows your current
holdings and your own history — nobody else's.

## Bot commands

| Command | What it does |
|---|---|
| `/start` | Bind your Telegram account (first time only) |
| `/myitems` | List what you currently hold |
| `/help` | Show available commands |

In the club group chat the bot only answers when explicitly mentioned
(`/myitems@<botname>`) — a bare `/start` there is ignored so it doesn't reply
publicly.

## If the Mini App won't open

The bot replies with a plain-text fallback instead of leaving you stuck.

## Things that are true regardless

- Nothing is written to the ledger until you tap Done — walking away mid-cart
  loses nothing and writes nothing.
- If your submit fails (bad connection, etc.), your cart is kept and offered
  for retry — it is never silently cleared.
- Borrowing is never blocked for insufficient stock. Take the part; if the
  numbers go negative that's a data problem for an admin to fix, not something
  you need to argue with.
