# Architecture

## TL;DR

- React + Vite kiosk → FastAPI backend on the P100 PC → Supabase (Postgres +
  pgvector, **Singapore region**). Plus a phone web app and an admin UI — three
  clients, one backend contract.
- **The vector index lives in memory, not in per-frame Supabase queries.** The
  entire index is under 3 MB (~1.7 MB products, ~0.7 MB faces). Brute-force
  cosine over a numpy matrix; faiss is unnecessary at this size. Supabase stays
  the source of truth and write target, just not the hot path — which also
  gives **offline operation for free**.
- WebSocket, ~7 fps, 640 px JPEG. **Drop frames under load, never queue them**
  — a backlog makes the UI react to what you did two seconds ago.
- Budget: **≤ 300 ms** from "held steady" to shortlist on screen.
- **DINOv2 over CLIP** for items — CLIP aligns to text/categories, DINOv2 to
  visual instance similarity, and we need "this specific ESC". InsightFace
  `buffalo_l` for faces (80 members is an easy problem).
- **Start with a fixed on-screen ROI box** for localisation. No model, costs
  nothing, and the interaction already asks the user to hold still.
- **Explicitly not a trained-class detector** — that's a retrain every time the
  club buys something, which is the burden this design exists to avoid.
- **P100 caveat: compute capability 6.0, no tensor cores, and sm_60 support is
  being dropped from recent wheels.** Verify your build actually contains sm_60
  kernels. Honestly, the workload is small enough that the P100 is a
  convenience, not a requirement — don't let it dictate the kiosk's location.

## Shape

```
┌─────────────────────────────────────────────┐
│ Kiosk PC (the one with the P100)            │
│                                             │
│  Browser ── React + Vite                    │
│    │  webcam capture, cart UI, shortlist    │
│    │  WebSocket (JPEG frames ~7 fps)        │
│    ▼                                        │
│  FastAPI backend                            │
│    ├─ face pipeline    (detect → embed)     │
│    ├─ item pipeline    (localise → embed)   │
│    ├─ in-memory vector index (faiss/numpy)  │
│    └─ local outbox (SQLite) for offline     │
└──────────────────┬──────────────────────────┘
                   │ HTTPS
                   ▼
        ┌──────────────────────┐      ┌──────────────────┐
        │ Supabase (Singapore) │◄─────│ Admin UI (web)   │
        │ Postgres + pgvector  │      │ catalog, members │
        │ source of truth      │      │ dashboard, tools │
        └──────────────────────┘      └──────────────────┘
                   ▲
                   │
        ┌──────────┴───────────┐
        │ Phone web app        │
        │ QR identify, bulk    │
        │ scanning, my items   │
        └──────────────────────┘
```

Three clients, one backend contract. The kiosk is the only one that needs the
GPU; the phone and admin UI are ordinary web apps talking to Supabase.

## Why the vector index lives in memory, not in pgvector queries

The original plan matched embeddings by querying Supabase. Don't — that is a
round trip to a hosted database *per frame*.

The whole index is tiny:

- ~90 Tier A products × ~6 embeddings × 768 dims × 4 B ≈ **1.7 MB**
- ~80 members × 4 embeddings × 512 dims × 4 B ≈ **0.7 MB**

Load it into the backend process at startup, brute-force cosine over a numpy
matrix (microseconds at this size — faiss is not needed and adds a dependency),
and refresh on a catalog-change notification or a 5-minute poll.

**Supabase remains the source of truth and the write target.** It is simply not
in the hot path. The `pgvector` HNSW indexes in [data-model.md](data-model.md)
still earn their place for admin-side search and for the phone app.

This also gives offline operation for free: a kiosk with a warm index and a
cached catalog keeps working through a network outage, queueing commits in its
outbox.

## Frame transport and latency budget

Target: **≤ 300 ms from "item held steady" to shortlist on screen.**

| Stage | Budget |
|---|---|
| Capture + JPEG encode (browser) | 15 ms |
| WebSocket to localhost | ~1 ms |
| Localisation (ROI crop or detector) | 30 ms |
| Embedding (DINOv2 ViT-B/14 or similar) | 60 ms |
| Index search (in-memory, ~600 vectors) | < 1 ms |
| Render | 20 ms |
| Slack for stability hysteresis | remainder |

Transport decisions:

- **WebSocket, not REST.** Per-frame HTTP handshakes are wasteful and make
  backpressure impossible.
- **~7 fps, 640 px longest edge, JPEG q75.** Enough for stable-detection
  hysteresis; a fraction of the bandwidth of raw 30 fps.
- **Drop frames under load, never queue them.** A backlog produces a UI that
  reacts to what the user did two seconds ago, which feels broken. The backend
  holds at most one in-flight frame and discards the rest.
- Frames are processed and discarded in memory. **Nothing is written to disk.**
  See [pdpa.md](pdpa.md).

## Model choices

Not yet locked. Candidates and the constraints that narrow them:

**Face detection + embedding** — InsightFace (`buffalo_l`: SCRFD detector +
ArcFace r50, 512-d) is the default. It is well supported, runs via ONNX
Runtime, and 80 members is a trivially easy recognition problem — expect
comfortable margins with a conservative threshold.

**Item embedding** — DINOv2 (ViT-B/14, 768-d) over CLIP. This matters: CLIP is
trained for semantic/category alignment with text, DINOv2 for visual instance
similarity. We need "this specific ESC", not "an electronic board", so DINOv2's
self-supervised features are the better fit. Verify on real captures in the
Phase 0 spike before committing.

**Item localisation** — start with a **fixed on-screen ROI box** ("hold the
item in the square"). It costs nothing, requires no model, and the interaction
already asks the user to hold still. Add a class-agnostic detector (YOLO on
COCO classes, or SAM2 / YOLO-World) only if the spike shows the fixed box is
the accuracy bottleneck.

**Explicitly not a trained-class detector.** Training YOLO on the catalog would
require hundreds of annotated frames per class and a full retrain every time
the club buys something new. The club buys things constantly, so this is
exactly the maintenance burden the embedding approach exists to avoid.

## The P100 caveat

The P100 is Pascal GP100, **compute capability 6.0**, 16 GB HBM2. Two things to
check before committing to a stack:

- **No tensor cores.** Anything assuming them (flash-attention kernels, some
  bf16 paths) will fall back or fail to build. Pascal does have fast packed
  fp16, so fp16 inference is still worthwhile.
- **sm_60 support is being dropped.** Recent PyTorch and ONNX Runtime builds
  have been narrowing their compiled architecture lists. **Verify that the
  specific wheel you install actually contains sm_60 kernels before designing
  around this GPU** — the failure mode is a runtime "no kernel image available"
  rather than an install error.

Honest note: with item CV scoped to ~90 products and running as a shortlist
generator, the compute requirement is modest. A recent CPU can plausibly serve
this workload at 7 fps, and any of the four club PCs would do. **The P100 is a
convenience, not a requirement** — don't let it constrain the kiosk's physical
location.

## Deployment

- **Kiosk**: the P100 PC, browser in kiosk mode, backend as a systemd service
  (or a Windows service) with restart-on-failure. Catalog and index cached to
  disk so it survives a reboot without network.
- **Admin UI + phone app**: static hosting (Vercel or similar), talking to
  Supabase directly with RLS enforcing access.
- **Supabase**: Singapore region — see [pdpa.md](pdpa.md) on data residency.
- **Config**: thresholds (`face_match_min_score`, `item_match_min_score`,
  hysteresis frame counts, timeouts) live in a config table, not in code, so
  they can be tuned without a deploy.
- **Secrets**: the service-role key lives only on the kiosk backend. The
  browser never holds it.

## Observability

Minimum useful set, surfaced on the admin dashboard:

- Sessions per day, by mode and by `identified_by`
- **Shortlist rank distribution** — how often rank 1 was accepted vs corrected.
  This is the single number that says whether item CV is working.
- Rejection rate: how often the score fell below threshold and dropped to search
- Commit failures and outbox depth
- Model version currently loaded, and last index refresh time

## Open questions

- One kiosk or several? Everything above assumes one. Multiple kiosks work
  unchanged (each has its own index and outbox) as long as `kiosk_id` is
  recorded, but commit races on the same product need a think.
- Does the club want the phone app to work off-site (checking what's borrowed
  from home)? Trivial if the admin UI and phone app are the same deployment.
- Camera choice and mounting are unresolved and matter more than the model:
  fixed focus at a known working distance, decent low-light behaviour, and
  consistent lighting will move accuracy more than any architecture change
  here.
