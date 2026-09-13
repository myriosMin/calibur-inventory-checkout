# QA Checklist — the things software can't verify for itself

Everything in this file needs a real phone, a real Telegram account, or a
printer. None of it can be done from an agent session, and **the first item
gates the entire physical rollout** — do not print 500 labels until it passes.

Work top to bottom; later sections assume the earlier ones passed.

---

## 0. The gate — continuous scanning on real hardware ✅ PASSED

`roadmap.md` Phase 0 calls this "the one load-bearing assumption": the
multi-item design collapses into app-switching-per-item if `showScanQrPopup`
doesn't stay open.

**Confirmed working on real devices (2026-09-13).** The gate is cleared and
label printing is no longer blocked on it. Re-run this section only if the
Telegram client's scanner behaviour appears to change after an app update.

## 1. Bot and Mini App configuration

- [ ] BotFather Mini App short name is **`app`**, and
      `NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME` matches it. **Resolved a different
      way than first planned:** Telegram requires a short name of at least 3
      characters, so `app` cannot be shortened. The budget is met by the *code*
      instead — 6-character scan codes put the link at exactly 53 bytes, the
      version-3 limit. Nothing to change here; `/admin/labels` shows a banner
      if the numbers ever drift.
- [ ] BotFather's Mini App URL points at the deployed production URL
- [ ] Bot username is final. **Changing it later breaks every printed QR** —
      `operations.md` calls this "the one true reprint-everything event"
- [ ] `getWebhookInfo` shows the webhook on the production `/api/tg/webhook`

## 2. Identity binding

- [ ] `/start` from your own phone, with your handle in `members` → binds,
      replies "Welcome, <name>. You're all set."
- [ ] `/start` again → "Welcome back" (no duplicate binding)
- [ ] `/start` from an unrelated account → politely refused, lands in
      `/admin/bind-queue`, and an admin can bind it in one click
- [ ] In the **club group chat** (once the bot is added for alerts): a bare
      `/start` or `/myitems` is ignored, and the bot does not reply publicly.
      Only `/cmd@<botname>` is answered.

## 3. Borrow and return, end to end

- [ ] Full borrow on-device; confirm the `stock_movements` rows in
      `/admin/movements`
- [ ] Full return against those holdings
- [ ] The text receipt actually arrives in Telegram (it has never been confirmed
      against a real chat — the integration tests deliberately use a fabricated
      user id, so every send fails "chat not found" by design)
- [ ] **Deny camera permission** → the search-only path still completes a borrow
- [ ] **Kill the network mid-submit** → the cart is preserved with a retry and
      is *not* cleared. Then retry: exactly **one** set of movements is written,
      not two (this is what the idempotency token is for). Test on **both**
      borrow and return.
- [ ] `/store/mine` shows what you hold and your own history — and nobody
      else's

## 4. Labels

- [ ] Print one A4 sheet from `/admin/labels` on the actual sticker stock
- [ ] Measure a QR: **≥ 20 mm**
- [ ] Scan it with a phone camera at arm's length, under lab lighting, matte
      finish. Then scuff one and confirm the human-readable name and
      `location · code` still identify the bin
- [ ] Scan a **group** label (resistor book page) → lists the values at that
      location and one tap adds the right product
- [ ] Retire a code in `/admin/scan-codes`, scan the old sticker → clean
      "retired" message, and the miss shows up on the dashboard
- [ ] Only after all of the above: the ~360–500 label print run

## 5. Admin walkthrough on the deployed instance

- [ ] Log in at `/admin` as a real admin (bootstrap with
      `npx tsx scripts/bootstrap-admin.ts` if this is the first one)
- [ ] Create a product, generate a label, **restock it** — confirm this whole
      path stays under five minutes. `operations.md` treats that as a product
      requirement: slower than five minutes and the catalog rots, which is
      exactly how the spreadsheet failed.
- [ ] Run a stocktake on one location from a **phone** at the shelf, with a
      deliberate miscount → exactly one adjustment movement, correct direction
- [ ] Reverse a movement → mirror row appears; it cannot be reversed twice
- [ ] Import a small roster CSV, including a row with no Telegram handle
      (valid) and a duplicate (skipped, reported)
- [ ] Offboard a test member → binding cleared, `active = false`, history kept
- [ ] Export the three CSVs

## 6. Cron and notifications

- [ ] `CRON_SECRET` set in Vercel; `curl` with a wrong secret → 401
- [ ] `?dryRun=1` with the right secret reports what *would* be sent
- [ ] `TELEGRAM_ALERT_CHAT_ID` set to the club group (get it with
      `npx tsx scripts/get-chat-id.ts`); a low-stock alert arrives there
- [ ] An overdue nudge reaches the borrower — and **does not repeat daily**.
      `flows.md`: "a bot that nags gets muted, and a muted bot can't tell you
      about a real problem."
- [ ] Confirm the daily job ran in the Vercel dashboard

## 7. Before trusting it with the real catalog

- [ ] The bench-literate catalog review pass (`catalog-migration.md`) — the
      genuinely irreducible human work, 3–5 days, and the project's critical path
- [ ] Opening balances entered via `/admin/restock`. **Until this happens,
      `holdings` will go negative on every borrow** — borrows are deliberately
      never blocked, so a negative balance means a missing opening balance
      rather than a theft
- [ ] Agree a hard cutover date so the spreadsheet is not maintained in parallel
