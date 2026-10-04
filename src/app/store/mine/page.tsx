"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import Button from "@/components/ui/Button";
import { IconClipboard, IconHistory } from "@/components/ui/icons";
import { getWebApp } from "@/lib/telegram/webapp-client";

type Status = "loading" | "ready" | "error";

/** Response shapes of /api/store/me/holdings and /api/store/me/history.
 * Declared locally rather than imported from src/lib/server/member-activity:
 * that module pulls in the Supabase service-role graph, and nothing under
 * src/app/store/** may reference it even type-only (see the warning at the
 * top of src/lib/supabase/server.ts). Same convention /store/return uses for
 * its SourceHolder/HoldingItem shapes. */
interface HoldingItem {
  productId: string;
  name: string;
  tier: string;
  unit: string;
  qty: number;
  expensive?: boolean;
}

interface HolderHoldings {
  holderId: string;
  holderName: string;
  holderKind: string;
  items: HoldingItem[];
}

interface HistoryEvent {
  id: number;
  at: string;
  reason: string | null;
  qty: number;
  productName: string;
  unit: string;
  fromHolderName: string;
  toHolderName: string;
}

/** Human phrasing for a ledger `reason`, from the member's point of view.
 * Anything unrecognised falls through to the raw reason rather than being
 * hidden -- an unexplained row in your own history is worse than a jargon
 * one, and this list is allowed to lag the reason vocabulary
 * (supabase/migrations/0017_movement_reason_constraint.sql). */
function describeEvent(event: HistoryEvent): string {
  switch (event.reason) {
    case "borrow":
      return `Borrowed to ${event.toHolderName}`;
    case "consume":
      return `Used on ${event.toHolderName}`;
    case "return":
      return `Returned from ${event.fromHolderName}`;
    case "return_adjustment":
      return `Returned (no borrow record) from ${event.fromHolderName}`;
    default:
      return `${event.reason ?? "Movement"}: ${event.fromHolderName} → ${event.toHolderName}`;
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * "My items" (docs/tele-qr/architecture.md's /store surface). This is the
 * member-facing half of docs/tele-qr/pdpa.md's access-and-correction
 * obligation -- "a member can see their own history in the Mini App and ask
 * an admin to correct an error" -- so the correction route is spelled out at
 * the bottom of the page rather than left implicit.
 *
 * Both endpoints are scoped server-side to the member resolved from
 * HMAC-verified initData; nothing here identifies the member to the server.
 */
export default function MyItemsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("");
  const [holders, setHolders] = useState<HolderHoldings[]>([]);
  const [events, setEvents] = useState<HistoryEvent[]>([]);

  useEffect(() => {
    let cancelled = false;

    // getWebApp() touches `window` and throws when Telegram's WebApp global
    // is genuinely absent, so it is read here (client-only, after mount)
    // rather than during render -- the same lazy read /store/return uses.
    Promise.resolve().then(async () => {
      if (cancelled) return;

      let initData: string;
      try {
        initData = getWebApp().initData;
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setMessage(
          err instanceof Error ? err.message : "This page must be opened inside Telegram.",
        );
        return;
      }

      try {
        const headers = { "X-Telegram-Init-Data": initData };
        const [holdingsRes, historyRes] = await Promise.all([
          fetch("/api/store/me/holdings", { headers }),
          fetch("/api/store/me/history", { headers }),
        ]);
        if (!holdingsRes.ok) throw new Error(`Couldn't load your items (${holdingsRes.status}).`);
        if (!historyRes.ok) throw new Error(`Couldn't load your history (${historyRes.status}).`);

        const holdingsJson = (await holdingsRes.json()) as { holders: HolderHoldings[] };
        const historyJson = (await historyRes.json()) as { events: HistoryEvent[] };
        if (cancelled) return;

        setHolders(holdingsJson.holders ?? []);
        setEvents(historyJson.events ?? []);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Couldn't load your items.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const totalItems = holders.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <main className="flex min-h-dvh flex-col bg-neutral-950 px-4 pb-6 pt-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h1 className="text-lg font-semibold text-neutral-100">My items</h1>
        <Button variant="ghost" onClick={() => router.push("/store")} className="px-2">
          Back
        </Button>
      </div>

      {status === "loading" ? (
        <p className="py-8 text-center text-sm text-neutral-400">Loading…</p>
      ) : null}

      {status === "error" ? (
        <p className="py-8 text-center text-sm text-red-400">{message}</p>
      ) : null}

      {status === "ready" ? (
        <>
          <section className="mb-6">
            <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              <IconClipboard size={16} /> Out with you
            </h2>

            {totalItems === 0 ? (
              <p className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-6 text-center text-sm text-neutral-400">
                You have nothing out right now.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {holders.map((group) => (
                  <div
                    key={group.holderId}
                    className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2"
                  >
                    <p className="py-1 text-sm font-semibold text-neutral-100">
                      {group.holderName}
                    </p>
                    <ul className="divide-y divide-neutral-800">
                      {group.items.map((item) => (
                        <li
                          key={item.productId}
                          className="flex items-center justify-between gap-3 py-2"
                        >
                          <span className="min-w-0 truncate text-sm text-neutral-100">
                            {item.name}
                            {item.expensive ? (
                              <span className="ml-2 text-xs text-amber-300">Expensive</span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-xs text-neutral-400">
                            × {item.qty} {item.unit}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="flex-1">
            <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              <IconHistory size={16} /> Recent activity
            </h2>

            {events.length === 0 ? (
              <p className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-6 text-center text-sm text-neutral-400">
                Nothing recorded yet.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-900 px-3">
                {events.map((event) => (
                  <li key={event.id} className="py-2">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 truncate text-sm text-neutral-100">
                        {event.productName}
                      </p>
                      <p className="shrink-0 text-xs text-neutral-400">
                        × {event.qty} {event.unit}
                      </p>
                    </div>
                    <p className="text-xs text-neutral-400">
                      {describeEvent(event)}
                      <span className="text-neutral-600"> · {formatDate(event.at)}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="mt-6 text-center text-xs text-neutral-600">
            Something look wrong? Ask a committee member to correct it.
          </p>
        </>
      ) : null}
    </main>
  );
}
