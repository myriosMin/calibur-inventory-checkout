# Parts Store Checkout — Documentation

Inventory checkout for the NUS RoboMaster club parts store. ~100–120 members,
honour system, intended to run for years across annual committee handovers.

**Two candidate approaches are documented here. One will be built.**
[**→ comparison.md**](comparison.md) is the decision document for the
committee.

## Start here

| | |
|---|---|
| [**comparison.md**](comparison.md) | Side-by-side of both approaches, with a recommendation. Read this first. |
| [**catalog-migration.md**](catalog-migration.md) | **Shared.** Cleaning the spreadsheet into a real catalog — the critical path under either approach. |

## The two approaches

### [tele-qr/](tele-qr/) — QR stickers + Telegram Mini App *(recommended)*

Every bin gets a QR sticker. Scanning one opens a Telegram Mini App with the
item in a cart and the scanner still running; scan the rest, pick the robot,
tap Done. Covers all ~600 items. No hardware, no models, no biometrics.

[idea](tele-qr/idea.md) ·
[flows](tele-qr/flows.md) ·
[data model](tele-qr/data-model.md) ·
[QR labels](tele-qr/qr-labels.md) ·
[architecture](tele-qr/architecture.md) ·
[operations](tele-qr/operations.md) ·
[PDPA](tele-qr/pdpa.md) ·
[roadmap](tele-qr/roadmap.md)

### [face-id-and-cv/](face-id-and-cv/) — Kiosk with face and item recognition

A camera kiosk recognises the member's face, then proposes a shortlist of what
they're holding up. Handles ~90 of the ~600 items; the rest still need QR
labels. Requires a kiosk, camera and lighting, and stores biometric data.

[idea](face-id-and-cv/idea.md) ·
[limitations](face-id-and-cv/limitations.md) ·
[flows](face-id-and-cv/flows.md) ·
[data model](face-id-and-cv/data-model.md) ·
[architecture](face-id-and-cv/architecture.md) ·
[operations](face-id-and-cv/operations.md) ·
[PDPA](face-id-and-cv/pdpa.md) ·
[roadmap](face-id-and-cv/roadmap.md)

## What's true under both

- **The catalog migration is the critical path** and can start before the
  decision is made.
- **~500 QR labels get printed and stuck either way** — a camera cannot
  identify a 1 mm unmarked resistor, and a quarter of the catalog is exactly
  that. See [limitations](face-id-and-cv/limitations.md).
- **The data model is the same**: stock is held by *holders* (store / robot /
  member), and every change is a *movement* between them. This is what answers
  the question the club actually has — *where did our motors end up* — which
  today lives in a free-text spreadsheet cell.
- **Returns are a checklist, not a scan or a photo.** We already know what
  you're holding.
- Roughly 60% of the work is identical under both proposals.

## Also here

- [archive/idea-v1.md](archive/idea-v1.md) — the original one-page concept,
  kept for the reasoning trail.

Every document opens with a TL;DR and closes with its own open questions.
