# Tele-QR vs. Face-ID + CV — Decision Document

*For the committee. Two candidate approaches to the same problem; one will be
built.*

## TL;DR

- Both solve the same problem: replace the inventory spreadsheet, and answer
  *where did our motors end up*.
- **Tele-QR** — every bin gets a QR sticker; members scan with their phone in
  Telegram. Covers **all ~600 items**, costs ~5–6 days to set up, no hardware,
  no biometrics.
- **Face-ID + CV** — a kiosk with a camera recognises the member's face and the
  item they hold up. Covers **~90 of ~600 items** for the CV part (the rest
  still need QR labels anyway), costs ~6–8 days plus hardware, and stores
  biometric data.
- **The CV approach needs QR labels too.** It is not "cameras instead of
  stickers" — it's "cameras *plus* stickers", because a camera cannot identify
  a 1 mm unmarked resistor.
- **Recommendation: Tele-QR.** It does more, for less, with fewer things that
  can break and no biometric compliance burden. The CV approach's distinctive
  capability applies to 15% of the catalog and duplicates what a sticker
  already does.
- The one thing CV genuinely offers: **no phone needed, and no sticker to fall
  off.** If the committee weights those highly, that's the case for it.

---

## What each one actually is

**Tele-QR** ([docs](tele-qr/)) — Every storage compartment carries a QR
sticker. A member scans one with their phone camera; a Telegram Mini App opens
with the item already in a cart and the scanner still running. They scan the
rest of what they're taking, pick which robot it's for, tap Done. Returns are a
checklist of what they're holding.

**Face-ID + CV** ([docs](face-id-and-cv/)) — A kiosk PC with a camera sits in
the store. A member walks up, the camera recognises their face, then they hold
each item up to the camera. A model returns its three best guesses and the
member taps the right one. Bulk parts — the ~500 items the camera can't
identify — are handled by scanning QR labels, same as Tele-QR.

## Side by side

| | **Tele-QR** | **Face-ID + CV** |
|---|---|---|
| **Catalog coverage** | All ~600 items, one mechanism | ~90 items by camera; ~500 still need QR labels |
| **Unfinished sheets** | Work automatically | Need per-item assessment and reference photos |
| **Hardware** | None — members' own phones | Kiosk PC, camera, mount, lighting; GPU optional |
| **Where you stand** | At the shelf, hands in the bin | At the kiosk, carrying everything to it |
| **Setup effort** | ~5–6 person-days | ~6–8 person-days |
| **Ongoing effort** | ~30 hrs/year | ~40 hrs/year |
| **Adding a new product** | ~3 min (create, label, stick) | ~5 min (+ 5–8 reference photos for assets) |
| **Biometric data** | None | Face embeddings for ~120 members |
| **PDPA burden** | Light — a notice at registration | Heavy — consent, retention, deletion, annual review |
| **QR labels needed** | ~500 | ~500 (unavoidable either way) |
| **Fails when** | A label falls off; no phone | Camera/lighting drift; model errors; PC unplugged |
| **Recovery** | Human-readable text + search | Search fallback, QR fallback |
| **Novel risk** | Continuous scanning must work as documented | Item recognition must actually work on real parts |
| **Hosting** | Vercel + Supabase, free tier | On-prem PC + Supabase |
| **Codebase** | One Next.js app | Next.js + Python backend + CV pipeline |

## The load-bearing fact

Roughly **500 of the ~600 catalogued items cannot be identified by any camera**.
A quarter of the catalog is 0402 resistors — 1 mm long, with no printed
markings at all. The only thing that identifies them is which pocket of the
book they came from.

Full analysis: [face-id-and-cv/limitations.md](face-id-and-cv/limitations.md).

This is why the CV approach **also** needs ~500 QR labels. The choice is not
*cameras or stickers*. It is:

- **Stickers** (Tele-QR), or
- **Stickers, plus a camera that additionally handles ~90 large items**

The second option's extra capability has to justify a kiosk, a camera, a
lighting setup, two models, threshold calibration, reference photography for
every new asset, and a biometric compliance regime.

## What each approach is genuinely better at

**Tele-QR is better at:**

- Working on the entire catalog, immediately, including the two unfinished
  sheets
- Point of use — you scan where you're standing, not at a kiosk across the room
- Setup and maintenance cost
- Having very few moving parts: no models, no thresholds, no GPU, no lighting
- Compliance — no biometrics means most of [pdpa.md](tele-qr/pdpa.md) simply
  doesn't apply
- Handover — one codebase, hosted, nothing physical to babysit

**Face-ID + CV is better at:**

- **Not needing a phone.** A member with a flat battery or no Telegram can
  still check out.
- **Not depending on stickers.** Labels fall off, get covered by parts, get
  solvent on them. A camera doesn't.
- **Hands-full ergonomics** for large items — holding a motor to a camera is
  arguably easier than one-handing a phone.
- Being a more interesting engineering project, which is a real consideration
  for a robotics club even if it isn't a product argument.

## Honest weaknesses

**Tele-QR:**

- Depends on members having phones with Telegram, and on a third-party service
  ([pdpa.md](tele-qr/pdpa.md) covers this)
- Labels are a physical component that degrades and needs occasional reprinting
- Changing the bot username later breaks every printed QR — a one-time decision
  that has to be right
- Rests on `showScanQrPopup` scanning continuously; a half-day spike verifies
  this before anything else is built

**Face-ID + CV:**

- The core capability is unproven on the club's actual parts and needs a
  1–2 day spike to gate it
- Even within its ~90 items there are lookalike clusters (ESC610/615/620,
  Damiao 4310/4340) it will get wrong — which is why it can only ever propose a
  shortlist, not decide
- Stores biometric data for ~120 members, with a consent flow, deletion
  obligations, and an annual review
- The face model can never be changed without re-enrolling everyone in person,
  because photos are discarded by design
- Physical dependencies — camera position, lighting, a PC that stays plugged in
- More things to hand over: two languages, a CV pipeline, calibrated thresholds

## Recommendation

**Build Tele-QR.**

It covers the whole catalog rather than 15% of it, costs less to set up and
less to run, has no biometric exposure, and has far fewer failure modes. Its
one novel risk is verifiable in half a day, before any money is spent on
labels.

The CV approach's distinctive capability — recognising ~90 large items from a
camera — mostly duplicates what a sticker on the same item already does, while
adding a kiosk, two models, a lighting rig, and a compliance regime.

**If the committee prefers the CV approach**, the strongest reasons would be
not wanting to depend on members' phones or on stickers staying attached. Both
are legitimate. If that's the direction, the sequencing in
[face-id-and-cv/roadmap.md](face-id-and-cv/roadmap.md) still applies: build the
QR-and-search system first, and add CV afterwards as an accelerator — because
that system is needed either way, and it keeps the unproven part off the
critical path.

**What doesn't change either way:** the [catalog migration](catalog-migration.md)
is the critical path, ~500 QR labels get printed and stuck, and the
holder/movement data model is the same. Roughly 60% of the work is identical
under both proposals, so the decision is less final than it looks — and the
catalog work can start before it's made.

## If you want to decide quickly

Three questions settle it:

1. **Is depending on members' phones acceptable?** If no → CV.
2. **Is the club comfortable storing face data for every member?** If no →
   Tele-QR.
3. **Does the club want to build a CV system for its own sake?** A legitimate
   answer for a robotics club — but it should be an explicit choice, not one
   smuggled in as a technical requirement.
