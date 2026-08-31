# CV Checkout — Product Idea

## Context

Logistics/inventory checkout for a school club (e.g. borrowing/taking supplies or
equipment from a club store). Users are a **closed group** (club members) —
no walk-up public enrollment needed. This is an **honor-system** checkout:
the goal is a smooth, low-friction way to log who took what, not to prevent
theft or fraud. No anti-theft mechanisms (weight sensors, multi-camera
tracking, etc.) are in scope.

## Flow

1. App runs continuously watching for a face, or a user presses a trigger
   button to start a check.
2. Detected face is matched against enrolled members (facial recognition).
3. On successful match, the app switches to item-detection mode.
4. User holds up 1–2 items at a time, steadily, until the app confirms
   detection (no fast pass-by — user is expected to hold still).
5. Detected item + quantity is added to a running cart, shown live on
   screen. User can review/adjust before finishing.
6. On "Done", the cart (items, quantities), matched user, and metadata
   (timestamp, session id) are written to Supabase.

## Key design decisions

- **Honor system, closed group** → no need to defend against spoofing,
  hidden items, or miscounts as security risks. The live, editable cart
  is the safety net for any CV mistakes — not a security feature but a
  correctness one.
- **Low-data, low-maintenance recognition (both face and item)** — priority
  is avoiding a training/retraining burden as the club roster and item
  catalog change over time. This points to **embedding-based, open-set
  matching** for both:
  - **Faces**: standard practice already — embedding model (e.g.
    ArcFace/InsightFace) produces a vector per enrolled member from one or
    a few photos; recognition is nearest-neighbor match, no training per
    person.
  - **Items**: use the same pattern instead of a fixed-class classifier.
    A general-purpose visual embedding model (e.g. CLIP or DINOv2) embeds
    whatever's in frame; match via nearest-neighbor against a
    `product_embeddings` table (Supabase `pgvector`). Adding a new item to
    the catalog = capture a few reference photos, generate embeddings,
    insert rows. No model retraining as the catalog grows.
- **1–2 items at a time, held steady** — simplifies the detection problem
  considerably vs. detecting many simultaneous/overlapping items. Item
  presence is confirmed once the detector's match is stable across a few
  frames (avoids acting on a blurry mid-motion frame).
- **Quantity** — since items are shown one hold-up at a time rather than
  many at once, quantity is largely driven by repeated hold-ups (show item,
  confirm, show again to increment) rather than trying to count multiple
  overlapping instances in a single frame. Simpler and more reliable than
  multi-instance counting, consistent with the "hold until detected"
  interaction.

## Rough architecture

- **Frontend**: React + Vite. Captures webcam frames, displays live
  face-match status, live cart, and Done button.
- **Backend**: Python FastAPI. Receives frames (REST or WebSocket),
  runs inference on GPU (P100), returns match/detection results.
- **CV pipeline**:
  - Lightweight face detector runs continuously/cheaply; heavier face
    embedding model runs only once a stable face crop is available.
  - Item detector locates the held object in frame (separating it from
    the hand); crop is embedded and matched against the product index.
- **Data (Supabase / Postgres + pgvector)**:
  - `members` — id, name, face_embedding, metadata
  - `products` — id, name, metadata
  - `product_embeddings` — product_id, embedding (supports multiple
    reference embeddings per product, e.g. different angles)
  - `transactions` — id, member_id, timestamp, session metadata
  - `transaction_items` — transaction_id, product_id, quantity

## Open questions / not yet decided

- Hand/item occlusion: how much does a hand gripping an item hurt
  detection accuracy, and is a hand-aware detector worth the extra
  complexity vs. just relying on "hold it steady" + user correction in
  the live cart?
- Expected eventual catalog size, and whether reference photos for new
  items will be captured by an admin tool or ad hoc.
- Hardware setup: single kiosk (camera + GPU box) location, lighting
  conditions, network path to Supabase.
- Face embedding model and item embedding model choices — need to pick
  specific models before implementation (tradeoffs in accuracy vs. P100
  inference speed).
