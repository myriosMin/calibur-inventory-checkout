# Flows

## TL;DR

- Home → **[Borrow] / [Return]** → identify → do the thing → review → Done.
  Mode is picked *before* identification so the kiosk knows what to do the
  instant it recognises you.
- **Identity must be confirmed** ("You're Alex? [Yes] [Not me]"). Item errors
  have the cart as a safety net; a wrong identity has nothing. One tap closes
  the biggest silent-failure mode in the system.
- **Returns need no CV.** After identification we know exactly what that member
  or robot holds — it's a checklist with +/- per line. Partial returns fall out
  for free.
- **Bulk parts: scan bin QR, type a quantity.** Phone is the better interface
  here than the kiosk.
- Quantity = one unit per continuous presence in frame; leave and re-enter to
  increment. **Needs hysteresis** (5 frames present / 8 absent / 1.5 s gap) or
  detector flicker creates phantom counts. Plus +/- and tap-to-type, because
  nobody should wave 12 cable ties past a camera.
- Face recognition **stops** once you're identified — frees the GPU and removes
  the "who's in frame now" ambiguity. Two people in frame → match the largest
  face.
- 90 s inactivity timeout, Cancel always visible, commit only on Done.
- **Every CV path has a non-CV path behind it.** Camera unplugged, GPU dead, or
  Supabase down → the kiosk still works. Otherwise it gets abandoned the first
  time it breaks mid-build-season.

---

State machines for every user-facing path, including the error and abandonment
branches. The original idea doc described only a happy path; most of the real
work is in the branches.

## Global rules

These apply to every kiosk flow:

- **A session always has an owner.** Nothing is written without a
  `session.member_id`.
- **Cancel is always available.** Every screen after the home screen has a
  visible Cancel that discards the session (`status = 'cancelled'`).
- **Inactivity timeout: 90 s.** On timeout the session is marked `abandoned`
  and the kiosk returns home. Nothing is committed. A 15 s warning with a
  "still here" button precedes it.
- **Commit is explicit.** Only pressing Done writes movements. Everything
  before that is client-side cart state.
- **Face recognition runs only during identification.** Once a member is
  identified the face pipeline stops for the rest of the session. This frees
  the GPU for item inference and removes the "who is in frame now" ambiguity.
- **Multiple faces: match the largest bounding box.** The person at the kiosk
  is nearer than anyone behind them. During item mode, bystanders are ignored
  entirely because face matching is off.

## 1. Home

```
HOME
 ├─ [Borrow]   → IDENTIFY (mode = borrow)
 ├─ [Return]   → IDENTIFY (mode = return)
 └─ [Restock]  → IDENTIFY (mode = restock, admins only)
```

Mode is chosen before identification so the kiosk knows what to do the moment
it recognises someone. Screen is idle/dark until touched — the camera does not
run continuously. See [pdpa.md](pdpa.md) for why.

## 2. Identify

```
IDENTIFY
 ├─ face detected → embed → nearest member
 │    ├─ score ≥ threshold  → CONFIRM_IDENTITY
 │    └─ score <  threshold → retry up to 5 s → QR_FALLBACK
 ├─ no face after 10 s      → QR_FALLBACK
 └─ [Identify another way]  → QR_FALLBACK   (always available)

CONFIRM_IDENTITY  "You're Alex — [Yes] [Not me]"
 ├─ [Yes]      → session.identified_by = 'face' → mode screen
 └─ [Not me]   → QR_FALLBACK

QR_FALLBACK
  kiosk shows QR encoding session_id
  → member scans with phone, authenticates, confirms
  → backend binds member to session, kiosk advances
  → session.identified_by = 'qr'
  timeout 120 s → HOME
```

**The confirmation step is not optional.** A misidentified member silently
attributes an entire checkout to the wrong person, and unlike item errors there
is no cart to review it in. One tap closes the biggest silent-failure mode in
the system.

`QR_FALLBACK` is a real authentication flow, not a displayed image: the QR
encodes the session id, the phone page authenticates the member, and the
backend links the two. It is required by [pdpa.md](pdpa.md) as the
non-biometric alternative for anyone who declines face enrollment, and it
doubles as the recovery path whenever recognition fails.

## 3. Borrow (Tier A assets)

```
BORROW_DEST   "Where is this going?"
  → fixed list of robots + "Personal / bench"
  → session.dest_holder_id

BORROW_ITEMS  (loop)
 ├─ camera runs item detection on the ROI
 ├─ stable detection ≥ N frames → embed crop → top-K nearest
 │    ├─ best score ≥ threshold → SHORTLIST (top 3 + "none of these")
 │    └─ best score <  threshold → SEARCH
 ├─ [Scan bin QR]  → resolves directly to a product → cart
 ├─ [Search]       → text search → cart
 └─ [Done]         → REVIEW

SHORTLIST
 ├─ tap a product  → add to cart, record match_rank
 └─ [None of these]→ SEARCH, and record the miss

REVIEW  → cart with per-line +/- and delete
 ├─ [Back]    → BORROW_ITEMS
 ├─ [Cancel]  → discard
 └─ [Confirm] → COMMIT
```

### Quantity

An item counts as **one unit for the whole time it is continuously present**.
Leaving and re-entering the frame increments it.

Detector flicker will otherwise produce phantom increments, so this needs
hysteresis, not a raw presence flag:

- `present` after **5 consecutive** detected frames (~0.7 s at 7 fps)
- `absent` after **8 consecutive** undetected frames (~1.1 s)
- a minimum **1.5 s** gap between the absent transition and the next increment

Tunable in config, calibrated during the Phase 0 spike.

Nobody should have to wave 12 cable ties past a camera, so the cart line always
has +/- controls and a tap-to-type quantity. For anything above about three
units, typing is the expected path.

### Commit

One transaction:

1. `sessions.status = 'committed'`, `ended_at = now()`
2. one `stock_movements` row per cart line:
   `from = store`, `to = session.dest_holder_id`, `reason = 'borrow'`
3. provenance columns from the UI: `source`, `match_score`, `match_rank`,
   `was_corrected`

## 4. Return

Returns need no item recognition at all, because after identification we
already know exactly what that member (or robot) is holding.

```
RETURN_SOURCE  "Returning from where?"
  → robots the member has borrowed to, + "Personal / bench"

RETURN_LIST
  → checklist of current holdings for that holder, from the `holdings` view
  → each line: product, qty held, qty returning (default 0, +/- to adjust)
 ├─ [Return all]     → sets every line to full qty
 ├─ [Something else] → SEARCH  (returning an item with no borrow record)
 └─ [Done]           → REVIEW → COMMIT
```

Movements are `from = holder`, `to = store`, `reason = 'return'`.

Partial returns are the normal case and fall out of the model for free — a line
returning 2 of 6 simply moves 2. Returning something with no borrow record is
allowed (it happens: parts predate the system, or someone else borrowed them);
it produces a movement from `adjustment` and is flagged for admin review rather
than blocked.

## 5. Bulk parts (Tier B/C)

No CV. Works on the kiosk or on a phone.

```
BULK
 ├─ scan bin QR → product resolved
 │    ├─ tier = bulk  → number pad, default 1 → cart
 │    └─ tier = loose → [took some] / [took the last of it] → cart
 ├─ [Search] → text search on name + spec → same as above
 └─ [Done]   → COMMIT
```

Movements are `from = store`, `to = consumed`, `reason = 'consume'`.

`loose` products never get an exact count — "took the last of it" sets the
stock level to empty and raises a restock flag. This matches the reality of
rows 36–44 in the source spreadsheet, which record quantities as `a lot`.

**Phone is the better interface here.** Typing "47" on a phone beats any kiosk
keyboard, and the member is standing at a shelf, not at the kiosk. The QR
self-identification flow from step 2 already gives us phone sessions, so this
costs little extra.

## 6. Stocktake

Admin-initiated, corrects drift without faking transactions.

```
STOCKTAKE
  → pick a location (e.g. 'book', 'small box', 'Rotating shelf')
  → walk the list of products in it
  → enter counted qty per product; expected qty shown for reference
  → [Commit] → writes stock_counts rows
             → writes adjustment movements for every variance
```

Variance history is a diagnostic: a product with large recurring variance is
one nobody is logging, which points at a UX problem rather than a people
problem.

## 7. Enrollment (admin UI, not the kiosk)

**Member enrollment**

```
→ create member record
→ present consent text, record explicit opt-in (docs/pdpa.md)
   ├─ declines → member is QR-only, no face capture, fully functional
   └─ accepts  → capture 3–5 frames at the kiosk camera, in kiosk lighting
→ embed, store with model_version, discard the raw frames
→ verify: run a live match, confirm it identifies them
```

**Product enrollment (Tier A only)**

```
→ create/select product
→ capture 5–8 reference frames through the kiosk camera, held as a member
  would hold it: several angles, both orientations, in-hand
→ embed, store with model_version and capture_note
→ verify: hold it up, confirm it appears at rank 1
```

The capture conditions matter more than the count. Reference embeddings taken
from clean product photos on white will not match a greasy motor gripped in a
hand under kiosk lighting — the domain gap eats the margin. **Enroll through
the same camera, in the same pose, in the same room.**

## 8. Failure and degraded modes

| Failure | Behaviour |
|---|---|
| Supabase unreachable at commit | Write to local outbox, show "saved, will sync", retry in background. Never lose a committed cart. |
| Supabase unreachable at start | Kiosk runs from its cached catalog + holdings snapshot; commits queue. Banner shows stale-data warning. |
| Camera not detected | Skip to QR identification and search-based item entry. Kiosk stays fully usable. |
| GPU/model load failure | Same — degrade to search-only. Log loudly to the admin dashboard. |
| Member walks away mid-cart | 90 s timeout, session `abandoned`, nothing written. |
| Kiosk process crash mid-session | Session stays `open`; a nightly job marks sessions open > 6 h as `abandoned`. |
| Item genuinely not in catalog | "Not in catalog" button captures a photo + note, creates an admin task. Better a flagged unknown than an unlogged one. |

The through-line: **every CV path has a non-CV path behind it.** The system
must remain fully usable with the camera unplugged, or it will be abandoned the
first time it breaks during a competition build.

## Open questions

- Should `restock` (receiving a purchase order) be a kiosk mode at all, or an
  admin-UI-only bulk paste? Leaning admin UI — restocking happens by invoice,
  not by holding parts up to a camera.
- On borrow, should the destination be asked before or after the cart? Before
  is fewer taps for the common case (one robot per trip); after is more
  flexible. Currently before, with an edit affordance in REVIEW.
- Do we need a "borrow on behalf of" mode for the person who collects parts for
  their whole subteam? Common in practice; deferred to Phase 5.
