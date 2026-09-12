import { NextResponse } from "next/server";

import { isValidCronSecret } from "@/lib/server/cron-auth";
import {
  buildLowStockAlertText,
  buildNegativeStockAlertText,
  buildOverdueNudgeText,
  buildWeeklyDigestText,
  type OverdueItem,
} from "@/lib/reports/messages";
import { dueForNudge, outstandingLots, selectOverdue } from "@/lib/reports/overdue";
import {
  fetchBorrowerHolders,
  fetchHolderLedger,
  fetchProducts,
  fetchStockLevels,
  fetchStoreDeltaSince,
} from "@/lib/reports/queries";
import { dateInZone, isDigestDay } from "@/lib/reports/schedule";
import { classifyStockLevels, selectNewlyLow, selectNewlyNegative } from "@/lib/reports/stock";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { sendMessageSafely } from "@/lib/telegram/bot-api";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// /api/cron/daily — the club's only scheduled job.
//
// ONE route, not one per report. Vercel's cron frequency is plan-limited, so
// the budget goes on a single daily trigger and this handler decides what is
// actually due: overdue nudges every day, low-stock and data-integrity
// alerts on the day something crosses a line, and the weekly digest on the
// digest weekday.
//
// Scheduled `0 1 * * *` in vercel.json. Vercel cron expressions are UTC, and
// 01:00 UTC is 09:00 in Singapore -- the club's morning, and a time when a
// message about a part someone is holding can still change what they do that
// day. (vercel.json is JSON and cannot carry this comment; it lives here.)
//
// The governing constraint is `docs/tele-qr/flows.md` §7: "Keep these rare.
// A bot that nags gets muted, and a muted bot can't tell you about a real
// problem." Every notification below is therefore either edge-triggered (it
// fires when a state CHANGES) or cadence-limited (see `shouldNudge` in
// src/lib/reports/overdue.ts). Nothing here fires simply because a condition
// is still true.
//
// It also carries one non-notification duty: purging
// `telegram_bind_attempts` older than 90 days. That is a PDPA retention
// commitment (`docs/tele-qr/pdpa.md` §Retention), not housekeeping — that
// table is the only thing in the system accumulating data about people who
// are NOT members, and the doc is explicit that "it exists to clear a queue,
// not to build a log of who wandered through the lab."
// ---------------------------------------------------------------------------

/** `flows.md` §7's "Asset out > N days". Overridable per club via env. */
const DEFAULT_OVERDUE_THRESHOLD_DAYS = 21;

/**
 * Once a nudge has been sent about a lot, the next one is this many days
 * later. See `shouldNudge` for why this needs no stored state.
 */
export const NUDGE_CADENCE_DAYS = 7;

/**
 * Window used to decide whether a product *newly* crossed below `min_stock`
 * (or below zero). Matches the cron's own cadence: one run, one day of
 * movements. Slightly wider than 24h on purpose so a run that fires a few
 * minutes late cannot open a gap that hides a crossing.
 */
const TRANSITION_WINDOW_HOURS = 25;

/** PDPA retention for `telegram_bind_attempts`. */
const BIND_ATTEMPT_RETENTION_DAYS = 90;

/** Telegram messages cap at 4096 characters; the digest stays well inside it. */
const DIGEST_SECTION_LIMIT = 15;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * Group chat ids are negative, so this cannot be a "positive number" parse.
 * An unparseable value is treated exactly like an unset one: no-op, never
 * throw. A typo'd env var must not turn a cron run — or a deploy — red.
 */
function parseChatId(raw: string | undefined): number | null {
  if (!raw || !raw.trim()) return null;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    console.error(`[cron] TELEGRAM_ALERT_CHAT_ID is not an integer ("${raw}") — alerts disabled.`);
    return null;
  }
  return parsed;
}

export async function GET(request: Request) {
  if (!isValidCronSecret(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // A dry run reports exactly what a real run would do, and sends/deletes
  // nothing. It is behind the same secret (it does strictly less than the
  // real thing), and it exists for two reasons: an admin can ask "what would
  // go out today?" before wiring the chat id, and the integration suite can
  // exercise the whole pipeline against the live dev database without
  // messaging a real person.
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";

  const now = new Date();
  const thresholdDays = parsePositiveInt(
    process.env.OVERDUE_THRESHOLD_DAYS,
    DEFAULT_OVERDUE_THRESHOLD_DAYS,
  );
  const alertChatId = parseChatId(process.env.TELEGRAM_ALERT_CHAT_ID);

  const db = getServiceRoleClient();

  // -------------------------------------------------------------------------
  // 1. Overdue assets -> the borrower, by DM.
  // -------------------------------------------------------------------------
  const [borrowers, products] = await Promise.all([fetchBorrowerHolders(db), fetchProducts(db)]);
  const productById = new Map(products.map((product) => [product.id, product]));
  const borrowerByHolderId = new Map(borrowers.map((borrower) => [borrower.holderId, borrower]));

  const ledger = await fetchHolderLedger(
    db,
    borrowers.map((borrower) => borrower.holderId),
  );

  // Only things that come back. A consumed resistor is not overdue, it is
  // spent — `products.returnable` and the asset tier are what "expected back"
  // means in this schema (data-model.md), and there is no due-date column by
  // design.
  const lots = outstandingLots(ledger, borrowers.map((b) => b.holderId)).filter((lot) => {
    const product = productById.get(lot.productId);
    return Boolean(product && product.active && (product.tier === "asset" || product.returnable));
  });

  const overdue = selectOverdue(lots, now, thresholdDays);
  const due = dueForNudge(overdue, thresholdDays, NUDGE_CADENCE_DAYS);

  // One message per member, not one per part: three nudges in a row is how a
  // bot gets muted.
  const byMember = new Map<string, { name: string; chatId: number | null; items: OverdueItem[] }>();
  for (const lot of due) {
    const borrower = borrowerByHolderId.get(lot.holderId);
    const product = productById.get(lot.productId);
    if (!borrower || !product) continue;
    const entry = byMember.get(borrower.memberId) ?? {
      name: borrower.memberName,
      chatId: borrower.telegramUserId,
      items: [],
    };
    entry.items.push({
      productName: product.name,
      qty: lot.qty,
      unit: product.unit,
      daysOut: lot.daysOut,
    });
    byMember.set(borrower.memberId, entry);
  }

  let nudgesSent = 0;
  let nudgesUnreachable = 0;
  for (const entry of byMember.values()) {
    if (entry.chatId === null) {
      // Never bound Telegram (or the binding was cleared on offboarding).
      // Counted, not retried: the fix is the bind queue, not this job.
      nudgesUnreachable += 1;
      continue;
    }
    nudgesSent += 1;
    if (!dryRun) {
      await sendMessageSafely(
        entry.chatId,
        buildOverdueNudgeText({ memberName: entry.name, items: entry.items }),
      );
    }
  }

  // -------------------------------------------------------------------------
  // 2. Low stock and negative balances -> the club chat.
  // -------------------------------------------------------------------------
  const levels = await fetchStockLevels(db);
  const { low, negative } = classifyStockLevels(levels);

  const windowStart = new Date(now.getTime() - TRANSITION_WINDOW_HOURS * 3_600_000).toISOString();
  const storeDeltas = await fetchStoreDeltaSince(db, windowStart);
  const newlyLow = selectNewlyLow(low, storeDeltas);
  const newlyNegative = selectNewlyNegative(negative, storeDeltas);

  const canAlert = alertChatId !== null;
  let lowStockAlerted = false;
  let negativeAlerted = false;

  if (canAlert && newlyLow.length > 0) {
    lowStockAlerted = true;
    if (!dryRun) {
      await sendMessageSafely(
        alertChatId,
        buildLowStockAlertText(
          newlyLow.map((row) => ({
            name: row.name,
            qtyInStore: row.qtyInStore,
            minStock: row.minStock,
            unit: row.unit,
          })),
        ),
      );
    }
  }

  if (canAlert && newlyNegative.length > 0) {
    negativeAlerted = true;
    if (!dryRun) {
      await sendMessageSafely(
        alertChatId,
        buildNegativeStockAlertText(
          newlyNegative.map((row) => ({
            name: row.name,
            qtyInStore: row.qtyInStore,
            unit: row.unit,
          })),
        ),
      );
    }
  }

  // -------------------------------------------------------------------------
  // 3. Weekly digest -> the club chat, on the digest weekday only.
  // -------------------------------------------------------------------------
  const digestDue = isDigestDay(now);
  let digestSent = false;

  if (digestDue && canAlert) {
    digestSent = true;
    if (!dryRun) {
      await sendMessageSafely(
        alertChatId,
        buildWeeklyDigestText({
          date: dateInZone(now),
          outstanding: levels
            .filter((row) => row.qtyOut > 0)
            .sort((a, b) => b.qtyOut - a.qtyOut || a.name.localeCompare(b.name))
            .map((row) => ({ name: row.name, qtyOut: row.qtyOut, unit: row.unit })),
          lowStock: low.map((row) => ({
            name: row.name,
            qtyInStore: row.qtyInStore,
            minStock: row.minStock,
            unit: row.unit,
          })),
          negative: negative.map((row) => ({
            name: row.name,
            qtyInStore: row.qtyInStore,
            unit: row.unit,
          })),
          overdue: overdue.flatMap((lot) => {
            const borrower = borrowerByHolderId.get(lot.holderId);
            const product = productById.get(lot.productId);
            if (!borrower || !product) return [];
            return [
              {
                memberName: borrower.memberName,
                productName: product.name,
                qty: lot.qty,
                unit: product.unit,
                daysOut: lot.daysOut,
              },
            ];
          }),
          sectionLimit: DIGEST_SECTION_LIMIT,
        }),
      );
    }
  }

  // -------------------------------------------------------------------------
  // 4. PDPA retention purge.
  // -------------------------------------------------------------------------
  const purgeCutoff = new Date(
    now.getTime() - BIND_ATTEMPT_RETENTION_DAYS * 86_400_000,
  ).toISOString();

  let purged: number | null = null;
  if (!dryRun) {
    const { data, error } = await db
      .from("telegram_bind_attempts")
      .delete()
      .lt("created_at", purgeCutoff)
      .select("id");
    if (error) {
      // Reported, not thrown: a failed purge must not cost the club the
      // notifications that already went out above, and the next run retries
      // it anyway. It IS a compliance commitment, so it is surfaced in the
      // response body rather than swallowed silently.
      console.error("[cron] Failed to purge telegram_bind_attempts:", error.message);
    } else {
      purged = data?.length ?? 0;
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    ranAt: now.toISOString(),
    thresholdDays,
    nudgeCadenceDays: NUDGE_CADENCE_DAYS,
    alertChatConfigured: canAlert,
    overdue: {
      outstandingLots: lots.length,
      overdueLots: overdue.length,
      dueForNudge: due.length,
      membersNotified: nudgesSent,
      membersUnreachable: nudgesUnreachable,
    },
    lowStock: { total: low.length, newlyLow: newlyLow.length, alerted: lowStockAlerted },
    negativeStock: {
      total: negative.length,
      newlyNegative: newlyNegative.length,
      alerted: negativeAlerted,
    },
    digest: { due: digestDue, sent: digestSent },
    retention: {
      table: "telegram_bind_attempts",
      olderThanDays: BIND_ATTEMPT_RETENTION_DAYS,
      deleted: purged,
    },
  });
}
