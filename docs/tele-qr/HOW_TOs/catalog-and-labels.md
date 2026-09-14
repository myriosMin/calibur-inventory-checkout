# Catalog and labels (admin/procurement guide)

Covers `/admin/products` and `/admin/labels`. Both roles can create products
and print labels; only admins can manage scan codes directly
(`/admin/scan-codes`).

## Adding a new product

This has to stay under 5 minutes or the catalog rots — treat it as a hard
requirement, not a nice-to-have.

1. `/admin/products` → create. Fill in name, tier (`asset` / `bulk` /
   `loose`), category, location, and spec if it matters (value, package,
   tolerance — used by search and the resistor-book group picker).
2. `/admin/labels` → generate and print a label for it (see below).
3. Stick the label on the bin.
4. `/admin/restock` → record the quantity you actually received.

Step 4 matters more than it looks: until a product has been restocked at
least once, the ledger thinks the store holds zero of it, and the first
borrow drives it negative.

## Tiers, and why they matter

| Tier | Returned? | Counting |
|---|---|---|
| `asset` | Yes | Exact; quantity defaults to 1 |
| `bulk` | No — consumed | Exact; quantity prompted |
| `loose` | No — consumed | Level only ("took some" / "took the last of it") |

Tier doesn't affect whether something can be scanned — only how the quantity
prompt and stocktake behave.

## Printing labels

`/admin/labels`:

- **Single label** — for one product, e.g. a reprint.
- **Batch by location** — every product at a location on one A4 sheet, for a
  reorganised shelf or the initial print run.

The page shows a banner if the QR budget (53 bytes / version-3) has drifted —
this happens if the bot or app name changes, which is otherwise the one event
that breaks every printed label. Don't ignore that banner.

Physical spec: 20 mm minimum QR, laser print on polyester/vinyl (not paper —
it doesn't survive flux and IPA), matte finish, human-readable text always
printed under the code. Full detail in [../qr-labels.md](../qr-labels.md).

## Group labels (the resistor book, or any bin with several closely related
parts)

One label per location, not per product. Scanning it lists the products at
that location and the member taps one. Set this up by creating a `group` scan
code pointed at a location in `/admin/scan-codes`, rather than a `product`
code.

## Managing scan codes (`/admin/scan-codes`, admin only)

- **Generate code** — creates a new opaque code for a product or a group
  location.
- **Regenerate** — creates a replacement code for the same target and retires
  the old one. Use this for a damaged label rather than editing the existing
  code; the old sticker then fails cleanly ("this label is retired") instead
  of silently working.
- **Retire** — deactivates a code without deleting it, so a stray old sticker
  found later gives a clean rejection.

Codes are never reused, and retiring one doesn't touch the product record.

## Watching for label problems

The dashboard's **label health** card lists products reached by search far
more than by scan — that's the signal a sticker is missing or damaged.
Reprint from there rather than waiting for a complaint. The **unknown/retired
codes** card catches stickers still being scanned after their code was
retired.
