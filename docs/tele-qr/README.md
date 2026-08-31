# Tele-QR Checkout — Docs

One of two candidate approaches, and the recommended one. See
[../comparison.md](../comparison.md) for the side-by-side and
[../README.md](../README.md) for the index.

- [Idea](idea.md) — product overview and motivation
- [Flows](flows.md) — Mini App and bot flows, including errors and degraded modes
- [Data model](data-model.md) — schema, holder/movement ledger, Telegram identity
- [QR labels](qr-labels.md) — code scheme, `startapp` limits, label spec, printing
- [Architecture](architecture.md) — Next.js on Vercel, Supabase, `initData` validation
- [Operations](operations.md) — the human work of running it
- [PDPA](pdpa.md) — personal data handling; no biometrics
- [Roadmap](roadmap.md) — what ships when

Shared with the other approach:

- [Catalog migration](../catalog-migration.md) — cleaning the spreadsheet into
  a real catalog; the critical path either way
